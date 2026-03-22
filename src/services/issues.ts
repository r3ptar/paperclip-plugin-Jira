import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { JiraConfig } from "../constants.js";
import type { JiraClient } from "../jira/types.js";
import type {
  JiraComment,
  JiraIssue,
  JiraTransition,
} from "../jira/types.js";
import { isValidJiraId, isValidJiraKey } from "../jira/validate-id.js";

// ─── ADF Helpers ──────────────────────────────────────────────────────────────

/**
 * Wraps a plain text string in Atlassian Document Format (ADF).
 * Used for Cloud (API v3) description and comment bodies.
 */
function toAdf(text: string): object {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

/**
 * Formats a description value for the target deployment mode.
 * Cloud: ADF object. Server/DC: plain string.
 */
function formatDescription(
  text: string,
  deploymentMode: JiraConfig["deploymentMode"],
): unknown {
  return deploymentMode === "cloud" ? toAdf(text) : text;
}

/**
 * Formats a comment body for the target deployment mode.
 */
function formatCommentBody(
  text: string,
  deploymentMode: JiraConfig["deploymentMode"],
): unknown {
  return deploymentMode === "cloud" ? toAdf(text) : text;
}

// ─── Validation Helpers ───────────────────────────────────────────────────────

/**
 * Validates that a string is a valid Jira issue ID (numeric) or issue key
 * (e.g. PROJ-123). Throws if invalid to prevent URL injection.
 */
function validateIssueIdOrKey(issueIdOrKey: string): void {
  if (!isValidJiraId(issueIdOrKey) && !isValidJiraKey(issueIdOrKey)) {
    throw new Error(
      `Invalid Jira issue ID or key: "${issueIdOrKey}". ` +
        "Expected a numeric ID (e.g. '10001') or issue key (e.g. 'PROJ-123').",
    );
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Full CRUD for Jira issues including transitions, comments, assignment,
 * and issue links.
 *
 * Handles Cloud (ADF) vs Server/DC (wiki markup) description format
 * differences transparently based on config.deploymentMode.
 */
export class JiraIssueService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly client: JiraClient,
    private readonly config: JiraConfig,
  ) {}

  // ─── Read ─────────────────────────────────────────────────────────────────

  /**
   * Fetch a single issue by ID or key.
   *
   * @param issueIdOrKey  Numeric ID ("10001") or issue key ("PROJ-123")
   * @param fields        Optional list of field names to include in the response.
   *                      When omitted, Jira returns all navigable fields.
   */
  async getIssue(
    issueIdOrKey: string,
    fields?: string[],
  ): Promise<JiraIssue> {
    validateIssueIdOrKey(issueIdOrKey);

    let path = `/issue/${issueIdOrKey}`;
    if (fields && fields.length > 0) {
      path += `?fields=${fields.join(",")}`;
    }

    this.ctx.logger.debug("Fetching issue", { issueIdOrKey, fields });
    return this.client.get<JiraIssue>(path);
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  /**
   * Create a new Jira issue.
   *
   * Description format is automatically handled based on deploymentMode:
   * - Cloud: ADF (Atlassian Document Format)
   * - Server/DC: plain text / wiki markup
   */
  async createIssue(params: {
    projectKey: string;
    summary: string;
    issueType: string;
    description?: string;
    priority?: string;
    labels?: string[];
    assigneeAccountId?: string;
  }): Promise<JiraIssue> {
    const fields: Record<string, unknown> = {
      project: { key: params.projectKey },
      summary: params.summary,
      issuetype: { name: params.issueType },
    };

    if (params.description) {
      fields.description = formatDescription(
        params.description,
        this.config.deploymentMode,
      );
    }

    if (params.priority) {
      fields.priority = { name: params.priority };
    }

    if (params.labels && params.labels.length > 0) {
      fields.labels = params.labels;
    }

    if (params.assigneeAccountId) {
      fields.assignee = { accountId: params.assigneeAccountId };
    }

    this.ctx.logger.info("Creating issue", {
      projectKey: params.projectKey,
      issueType: params.issueType,
      summary: params.summary.slice(0, 80),
    });

    const created = await this.client.post<JiraIssue>("/issue", { fields });

    this.ctx.logger.info("Created issue", {
      issueId: created.id,
      issueKey: created.key,
    });

    return created;
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  /**
   * Update an existing issue's fields.
   *
   * Only the provided fields are updated; omitted fields are unchanged.
   */
  async updateIssue(
    issueIdOrKey: string,
    fields: {
      summary?: string;
      description?: string;
      priority?: string;
      labels?: string[];
    },
  ): Promise<void> {
    validateIssueIdOrKey(issueIdOrKey);

    const updateFields: Record<string, unknown> = {};

    if (fields.summary !== undefined) {
      updateFields.summary = fields.summary;
    }

    if (fields.description !== undefined) {
      updateFields.description = formatDescription(
        fields.description,
        this.config.deploymentMode,
      );
    }

    if (fields.priority !== undefined) {
      updateFields.priority = { name: fields.priority };
    }

    if (fields.labels !== undefined) {
      updateFields.labels = fields.labels;
    }

    if (Object.keys(updateFields).length === 0) {
      this.ctx.logger.warn("updateIssue called with no fields to update", {
        issueIdOrKey,
      });
      return;
    }

    this.ctx.logger.debug("Updating issue", {
      issueIdOrKey,
      fieldNames: Object.keys(updateFields),
    });

    await this.client.put(`/issue/${issueIdOrKey}`, { fields: updateFields });
  }

  // ─── Transitions ──────────────────────────────────────────────────────────

  /**
   * Fetch the available transitions for an issue.
   *
   * Jira transitions represent the valid workflow moves from the current
   * status. Each transition has an `id` and a `to` status.
   */
  async getTransitions(issueIdOrKey: string): Promise<JiraTransition[]> {
    validateIssueIdOrKey(issueIdOrKey);

    const response = await this.client.get<{ transitions: JiraTransition[] }>(
      `/issue/${issueIdOrKey}/transitions`,
    );
    return response.transitions;
  }

  /**
   * Execute a workflow transition on an issue.
   *
   * @param issueIdOrKey  The issue to transition
   * @param transitionId  The transition ID (from getTransitions)
   * @param comment       Optional comment to add during the transition
   * @param resolution    Optional resolution name (e.g. "Done", "Won't Do")
   */
  async transitionIssue(
    issueIdOrKey: string,
    transitionId: string,
    comment?: string,
    resolution?: string,
  ): Promise<void> {
    validateIssueIdOrKey(issueIdOrKey);

    if (!isValidJiraId(transitionId)) {
      throw new Error(
        `Invalid transition ID: "${transitionId}". Expected a numeric ID.`,
      );
    }

    const body: Record<string, unknown> = {
      transition: { id: transitionId },
    };

    if (comment) {
      body.update = {
        comment: [
          {
            add: {
              body: formatCommentBody(comment, this.config.deploymentMode),
            },
          },
        ],
      };
    }

    if (resolution) {
      body.fields = { resolution: { name: resolution } };
    }

    this.ctx.logger.info("Transitioning issue", {
      issueIdOrKey,
      transitionId,
      hasComment: !!comment,
      resolution: resolution ?? null,
    });

    await this.client.post(`/issue/${issueIdOrKey}/transitions`, body);
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  /**
   * Add a comment to an issue.
   *
   * Comment body format is automatically handled based on deploymentMode.
   */
  async addComment(
    issueIdOrKey: string,
    body: string,
  ): Promise<JiraComment> {
    validateIssueIdOrKey(issueIdOrKey);

    this.ctx.logger.debug("Adding comment", {
      issueIdOrKey,
      bodyLength: body.length,
    });

    const commentBody = formatCommentBody(body, this.config.deploymentMode);

    return this.client.post<JiraComment>(
      `/issue/${issueIdOrKey}/comment`,
      { body: commentBody },
    );
  }

  // ─── Assignment ───────────────────────────────────────────────────────────

  /**
   * Assign or unassign an issue.
   *
   * @param accountId  The Jira accountId to assign, or null to unassign.
   */
  async assignIssue(
    issueIdOrKey: string,
    accountId: string | null,
  ): Promise<void> {
    validateIssueIdOrKey(issueIdOrKey);

    if (accountId !== null && !accountId) {
      throw new Error(
        "accountId must be a non-empty string or null (to unassign).",
      );
    }

    this.ctx.logger.info("Assigning issue", {
      issueIdOrKey,
      accountId: accountId ?? "(unassign)",
    });

    // Cloud uses accountId, Server/DC uses name
    const body = this.config.deploymentMode === "cloud"
      ? { accountId }
      : { name: accountId };
    await this.client.put(`/issue/${issueIdOrKey}/assignee`, body);
  }

  // ─── Issue Links ──────────────────────────────────────────────────────────

  /**
   * Create a link between two issues.
   *
   * @param inwardIssueKey   The issue key for the inward side (e.g. "is blocked by")
   * @param outwardIssueKey  The issue key for the outward side (e.g. "blocks")
   * @param linkType         The link type name (e.g. "Blocks", "Relates", "Clones")
   */
  async linkIssues(
    inwardIssueKey: string,
    outwardIssueKey: string,
    linkType: string,
  ): Promise<void> {
    if (!isValidJiraKey(inwardIssueKey) && !isValidJiraId(inwardIssueKey)) {
      throw new Error(`Invalid inward issue key: "${inwardIssueKey}"`);
    }
    if (!isValidJiraKey(outwardIssueKey) && !isValidJiraId(outwardIssueKey)) {
      throw new Error(`Invalid outward issue key: "${outwardIssueKey}"`);
    }

    this.ctx.logger.info("Linking issues", {
      inwardIssueKey,
      outwardIssueKey,
      linkType,
    });

    await this.client.post("/issueLink", {
      type: { name: linkType },
      inwardIssue: { key: inwardIssueKey },
      outwardIssue: { key: outwardIssueKey },
    });
  }
}
