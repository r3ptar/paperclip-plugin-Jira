import { vi, describe, it, expect, beforeEach } from "vitest";
import { handleJiraIssueWebhook } from "../src/webhooks/jira-issue-webhook.js";
import { DEFAULT_CONFIG, ENTITY_TYPES } from "../src/constants.js";
import type { JiraConfig } from "../src/constants.js";
import type { JiraWebhookPayload } from "../src/jira/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockContext() {
  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    secrets: {
      resolve: vi.fn(),
    },
    entities: {
      list: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    issues: {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

function createWebhookInput(body: any, headers?: Record<string, string>) {
  return {
    parsedBody: body,
    headers: headers ?? {},
  } as any;
}

function createMinimalIssue(overrides?: Partial<Record<string, any>>) {
  return {
    id: "10001",
    key: "PROJ-1",
    self: "https://acme.atlassian.net/rest/api/3/issue/10001",
    fields: {
      summary: "Test issue",
      status: {
        id: "1",
        name: "To Do",
        statusCategory: { id: 2, key: "new", name: "To Do", colorName: "blue-gray" },
      },
      issuetype: { id: "10001", name: "Task", subtask: false },
      project: { id: "10000", key: "PROJ", name: "Project" },
      assignee: null,
      priority: { id: "3", name: "Medium" },
      labels: ["backend"],
      created: "2026-03-20T10:00:00.000Z",
      updated: "2026-03-20T10:00:00.000Z",
    },
    ...overrides,
  };
}

function createPayload(
  event: JiraWebhookPayload["webhookEvent"],
  extraFields?: Partial<JiraWebhookPayload>,
): JiraWebhookPayload {
  return {
    webhookEvent: event,
    timestamp: Date.now(),
    issue: createMinimalIssue(),
    ...extraFields,
  };
}

function configWithSecret(secretRef: string): JiraConfig {
  return { ...DEFAULT_CONFIG, webhookSecretRef: secretRef };
}

// ─── Verification ───────────────────────────────────────────────────────────

describe("handleJiraIssueWebhook — verification", () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("rejects webhook when secret is configured but body has no webhookSecret field", async () => {
    const config = configWithSecret("ref/webhook-secret");
    ctx.secrets.resolve.mockResolvedValue("my-shared-secret");

    const input = createWebhookInput(
      createPayload("jira:issue_created"),
      { "x-atlassian-webhook-identifier": "abc" },
    );

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("does not include a webhookSecret field"),
    );
    expect(ctx.entities.upsert).not.toHaveBeenCalled();
  });

  it("rejects webhook when body secret does not match configured secret", async () => {
    const config = configWithSecret("ref/webhook-secret");
    ctx.secrets.resolve.mockResolvedValue("correct-secret");

    const body = { ...createPayload("jira:issue_created"), webhookSecret: "wrong-secret" };
    const input = createWebhookInput(body, { "x-atlassian-webhook-identifier": "abc" });

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("secret mismatch"),
      expect.any(Object),
    );
    expect(ctx.entities.upsert).not.toHaveBeenCalled();
  });

  it("accepts webhook when no secret is configured and logs warning", async () => {
    const config = { ...DEFAULT_CONFIG, webhookSecretRef: "" };

    const input = createWebhookInput(createPayload("jira:issue_created"));

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("webhookSecretRef is not configured"),
    );
    // Should proceed to process the event (upsert called for issue_created)
    expect(ctx.entities.upsert).toHaveBeenCalled();
  });

  it("accepts webhook when secret matches using timingSafeEqual", async () => {
    const config = configWithSecret("ref/webhook-secret");
    ctx.secrets.resolve.mockResolvedValue("my-shared-secret");

    const body = { ...createPayload("jira:issue_created"), webhookSecret: "my-shared-secret" };
    const input = createWebhookInput(body, { "x-atlassian-webhook-identifier": "abc" });

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.logger.error).not.toHaveBeenCalled();
    expect(ctx.entities.upsert).toHaveBeenCalled();
  });
});

// ─── Event Routing ──────────────────────────────────────────────────────────

describe("handleJiraIssueWebhook — event routing", () => {
  let ctx: ReturnType<typeof createMockContext>;
  const config: JiraConfig = { ...DEFAULT_CONFIG, webhookSecretRef: "" };

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("skips processing when payload is missing", async () => {
    const input = createWebhookInput(null);

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("missing or empty payload"),
    );
    expect(ctx.entities.upsert).not.toHaveBeenCalled();
  });

  it("skips processing when webhookEvent is missing", async () => {
    const input = createWebhookInput({ timestamp: Date.now() });

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("missing or empty payload"),
    );
  });

  it("handles missing issue data gracefully for issue_created", async () => {
    const body: JiraWebhookPayload = {
      webhookEvent: "jira:issue_created",
      timestamp: Date.now(),
      // no issue field
    };
    const input = createWebhookInput(body);

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("missing issue data"),
    );
    expect(ctx.entities.upsert).not.toHaveBeenCalled();
  });

  it("handles missing issue data gracefully for issue_updated", async () => {
    const body: JiraWebhookPayload = {
      webhookEvent: "jira:issue_updated",
      timestamp: Date.now(),
    };
    const input = createWebhookInput(body);

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("missing issue data"),
    );
  });

  it("handles missing issue data gracefully for issue_deleted", async () => {
    const body: JiraWebhookPayload = {
      webhookEvent: "jira:issue_deleted",
      timestamp: Date.now(),
    };
    const input = createWebhookInput(body);

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("missing issue data"),
    );
  });
});

// ─── issue_created ──────────────────────────────────────────────────────────

describe("handleJiraIssueWebhook — jira:issue_created", () => {
  let ctx: ReturnType<typeof createMockContext>;
  const config: JiraConfig = { ...DEFAULT_CONFIG, webhookSecretRef: "", projectKey: "PROJ" };

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("creates an entity tracking record for the new issue", async () => {
    const input = createWebhookInput(createPayload("jira:issue_created"));

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.entities.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: ENTITY_TYPES.jiraIssue,
        externalId: "10001",
        title: "Test issue",
        status: "pending",
        data: expect.objectContaining({
          jiraIssueId: "10001",
          jiraIssueKey: "PROJ-1",
          projectKey: "PROJ",
          jiraStatus: "To Do",
        }),
      }),
    );
  });

  it("ignores issue_created for an untracked project", async () => {
    const otherProjectIssue = createMinimalIssue();
    otherProjectIssue.fields.project = { id: "20000", key: "OTHER", name: "Other Project" };

    const body = createPayload("jira:issue_created", { issue: otherProjectIssue as any });
    const input = createWebhookInput(body);

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring issue_created for untracked project"),
      expect.any(Object),
    );
    expect(ctx.entities.upsert).not.toHaveBeenCalled();
  });

  it("tracks issue when projectKey config is empty (no filter)", async () => {
    const noFilterConfig: JiraConfig = { ...DEFAULT_CONFIG, webhookSecretRef: "", projectKey: "" };
    const input = createWebhookInput(createPayload("jira:issue_created"));

    await handleJiraIssueWebhook(ctx, input, noFilterConfig);

    expect(ctx.entities.upsert).toHaveBeenCalled();
  });
});

// ─── issue_updated ──────────────────────────────────────────────────────────

describe("handleJiraIssueWebhook — jira:issue_updated", () => {
  let ctx: ReturnType<typeof createMockContext>;
  const config: JiraConfig = {
    ...DEFAULT_CONFIG,
    webhookSecretRef: "",
    reverseStatusMapping: { "In Progress": "in_progress" },
  };

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("skips update when no tracked entity exists for the issue", async () => {
    ctx.entities.list.mockResolvedValue([]);

    const input = createWebhookInput(createPayload("jira:issue_updated"));

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("No tracked entity"),
      expect.any(Object),
    );
    expect(ctx.issues.update).not.toHaveBeenCalled();
  });

  it("updates Paperclip issue status when Jira status changes", async () => {
    const entity = {
      entityType: ENTITY_TYPES.jiraIssue,
      externalId: "10001",
      scopeId: "paperclip-issue-123",
      data: { companyId: "company-1" },
    };
    ctx.entities.list.mockResolvedValue([entity]);
    ctx.issues.get.mockResolvedValue({
      id: "paperclip-issue-123",
      companyId: "company-1",
      title: "Test issue",
      status: "todo",
    });

    const issue = createMinimalIssue();
    issue.fields.status = {
      id: "3",
      name: "In Progress",
      statusCategory: { id: 4, key: "indeterminate", name: "In Progress", colorName: "blue" },
    };

    const body = createPayload("jira:issue_updated", {
      issue: issue as any,
      changelog: {
        id: "100",
        items: [
          { field: "status", fieldtype: "jira", from: "1", fromString: "To Do", to: "3", toString: "In Progress" },
        ],
      },
    });
    const input = createWebhookInput(body);

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.issues.update).toHaveBeenCalledWith(
      "paperclip-issue-123",
      expect.objectContaining({ status: "in_progress" }),
      "company-1",
    );
  });

  it("updates Paperclip issue title when summary changes", async () => {
    const entity = {
      entityType: ENTITY_TYPES.jiraIssue,
      externalId: "10001",
      scopeId: "paperclip-issue-123",
      data: { companyId: "company-1" },
    };
    ctx.entities.list.mockResolvedValue([entity]);
    ctx.issues.get.mockResolvedValue({
      id: "paperclip-issue-123",
      companyId: "company-1",
      title: "Old title",
      status: "todo",
    });

    const issue = createMinimalIssue();
    issue.fields.summary = "New title";

    const body = createPayload("jira:issue_updated", {
      issue: issue as any,
      changelog: {
        id: "101",
        items: [
          { field: "summary", fieldtype: "jira", from: null, fromString: "Old title", to: null, toString: "New title" },
        ],
      },
    });
    const input = createWebhookInput(body);

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.issues.update).toHaveBeenCalledWith(
      "paperclip-issue-123",
      expect.objectContaining({ title: "New title" }),
      "company-1",
    );
  });

  it("only updates entity tracking when entity has no linked Paperclip issue", async () => {
    const entity = {
      entityType: ENTITY_TYPES.jiraIssue,
      externalId: "10001",
      scopeId: "", // not linked
      data: {},
    };
    ctx.entities.list.mockResolvedValue([entity]);

    const input = createWebhookInput(createPayload("jira:issue_updated"));

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.issues.get).not.toHaveBeenCalled();
    expect(ctx.issues.update).not.toHaveBeenCalled();
    expect(ctx.entities.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "synced" }),
    );
  });

  it("does not call issues.update when no relevant fields changed", async () => {
    const entity = {
      entityType: ENTITY_TYPES.jiraIssue,
      externalId: "10001",
      scopeId: "paperclip-issue-123",
      data: { companyId: "company-1" },
    };
    ctx.entities.list.mockResolvedValue([entity]);
    ctx.issues.get.mockResolvedValue({
      id: "paperclip-issue-123",
      companyId: "company-1",
      title: "Test issue",
      status: "todo",
    });

    // Changelog has only an unrelated field change (e.g. labels)
    const body = createPayload("jira:issue_updated", {
      changelog: {
        id: "102",
        items: [
          { field: "labels", fieldtype: "jira", from: null, fromString: "", to: null, toString: "backend" },
        ],
      },
    });
    const input = createWebhookInput(body);

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.issues.update).not.toHaveBeenCalled();
    // Entity tracking should still be updated
    expect(ctx.entities.upsert).toHaveBeenCalled();
  });
});

// ─── issue_deleted ──────────────────────────────────────────────────────────

describe("handleJiraIssueWebhook — jira:issue_deleted", () => {
  let ctx: ReturnType<typeof createMockContext>;
  const config: JiraConfig = { ...DEFAULT_CONFIG, webhookSecretRef: "" };

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("marks tracked entity as deleted", async () => {
    const entity = {
      entityType: ENTITY_TYPES.jiraIssue,
      externalId: "10001",
      scopeId: "paperclip-issue-123",
    };
    ctx.entities.list.mockResolvedValue([entity]);

    const input = createWebhookInput(createPayload("jira:issue_deleted"));

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.entities.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: ENTITY_TYPES.jiraIssue,
        externalId: "10001",
        status: "deleted",
        data: expect.objectContaining({
          deletedAt: expect.any(String),
        }),
      }),
    );
  });

  it("does nothing when no tracked entity exists for the deleted issue", async () => {
    ctx.entities.list.mockResolvedValue([]);

    const input = createWebhookInput(createPayload("jira:issue_deleted"));

    await handleJiraIssueWebhook(ctx, input, config);

    expect(ctx.entities.upsert).not.toHaveBeenCalled();
    expect(ctx.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("No tracked entity for deleted Jira issue"),
      expect.any(Object),
    );
  });
});
