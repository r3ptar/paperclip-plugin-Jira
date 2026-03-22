import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { JiraClient } from "../jira/types.js";
import type {
  JiraIssueType,
  JiraProject,
  JiraStatus,
} from "../jira/types.js";
import { isValidJiraId, isValidJiraKey } from "../jira/validate-id.js";

// ─── Validation ───────────────────────────────────────────────────────────────

function validateProjectIdOrKey(projectIdOrKey: string): void {
  // Project keys are uppercase letters (e.g. "PROJ"), IDs are numeric.
  // We accept both: numeric IDs via isValidJiraId, and project keys
  // which are alpha-only uppercase (simpler than issue keys -- no dash+number).
  const isValidProjectKey = /^[A-Z][A-Z0-9_]*$/.test(projectIdOrKey);
  if (!isValidJiraId(projectIdOrKey) && !isValidProjectKey) {
    throw new Error(
      `Invalid Jira project ID or key: "${projectIdOrKey}". ` +
        "Expected a numeric ID (e.g. '10001') or project key (e.g. 'PROJ').",
    );
  }
}

// ─── Response Types ─────────────────────────────────────────────────────────

/**
 * Shape returned by GET /project/{key}/statuses.
 * Returns statuses grouped by issue type.
 */
interface ProjectStatusesResponse {
  id: string;
  name: string;
  subtask: boolean;
  statuses: JiraStatus[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Provides read access to Jira projects, issue types, and workflow statuses.
 */
export class JiraProjectService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly client: JiraClient,
  ) {}

  /**
   * List projects visible to the authenticated user.
   *
   * Uses the paginated /project/search endpoint (Cloud) which returns
   * projects in the standard paginated envelope with key "values".
   *
   * @param maxResults  Maximum number of projects to return. Defaults to 50.
   */
  async listProjects(maxResults?: number): Promise<JiraProject[]> {
    this.ctx.logger.debug("Listing projects", { maxResults });

    return this.client.listAll<JiraProject>(
      "/project/search",
      "values",
      { maxResults: maxResults ?? 50 },
    );
  }

  /**
   * Fetch a single project by ID or key.
   */
  async getProject(projectIdOrKey: string): Promise<JiraProject> {
    validateProjectIdOrKey(projectIdOrKey);

    this.ctx.logger.debug("Fetching project", { projectIdOrKey });
    return this.client.get<JiraProject>(`/project/${projectIdOrKey}`);
  }

  /**
   * Fetch the issue types available in a project.
   *
   * Uses GET /project/{key}/statuses which returns issue types with their
   * associated statuses. We extract just the issue type metadata.
   */
  async getIssueTypes(projectIdOrKey: string): Promise<JiraIssueType[]> {
    validateProjectIdOrKey(projectIdOrKey);

    this.ctx.logger.debug("Fetching issue types", { projectIdOrKey });

    const response = await this.client.get<ProjectStatusesResponse[]>(
      `/project/${projectIdOrKey}/statuses`,
    );

    return response.map((entry) => ({
      id: entry.id,
      name: entry.name,
      subtask: entry.subtask,
    }));
  }

  /**
   * Fetch all workflow statuses for a project.
   *
   * GET /project/{key}/statuses returns statuses grouped by issue type.
   * This method flattens and deduplicates them into a single list,
   * keyed by status ID.
   */
  async getStatuses(projectIdOrKey: string): Promise<JiraStatus[]> {
    validateProjectIdOrKey(projectIdOrKey);

    this.ctx.logger.debug("Fetching project statuses", { projectIdOrKey });

    const response = await this.client.get<ProjectStatusesResponse[]>(
      `/project/${projectIdOrKey}/statuses`,
    );

    // Flatten all statuses across issue types and deduplicate by ID
    const statusMap = new Map<string, JiraStatus>();
    for (const issueType of response) {
      for (const status of issueType.statuses) {
        if (!statusMap.has(status.id)) {
          statusMap.set(status.id, status);
        }
      }
    }

    return Array.from(statusMap.values());
  }
}
