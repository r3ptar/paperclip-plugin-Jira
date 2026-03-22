import { describe, expect, it, vi, beforeEach } from "vitest";
import { ReconciliationService } from "../src/sync/reconcile.js";
import type { ReconciliationResult } from "../src/sync/reconcile.js";
import type { JiraConfig } from "../src/constants.js";
import { DEFAULT_CONFIG, ENTITY_TYPES } from "../src/constants.js";
import type { JiraIssue, JiraTransition } from "../src/jira/types.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<JiraConfig> = {}): JiraConfig {
  return {
    ...DEFAULT_CONFIG,
    syncJql: "project = TEST",
    conflictStrategy: "jira_wins",
    reverseStatusMapping: {
      "To Do": "todo",
      "In Progress": "in_progress",
      Done: "done",
    },
    statusMapping: {
      ...DEFAULT_CONFIG.statusMapping,
      todo: "To Do",
      in_progress: "In Progress",
      done: "Done",
    },
    ...overrides,
  };
}

function createMockContext(overrides?: Record<string, unknown>) {
  return {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    entities: {
      list: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    issues: {
      get: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
    },
    state: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as any;
}

function createMockIssueService(overrides?: Record<string, unknown>) {
  return {
    getTransitions: vi.fn().mockResolvedValue([]),
    transitionIssue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

function createMockSearchService(overrides?: Record<string, unknown>) {
  return {
    searchAllIssues: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

function makeJiraIssue(
  key: string,
  statusName: string,
  categoryKey: string = "indeterminate",
  overrides: Partial<JiraIssue> = {},
): JiraIssue {
  return {
    id: `id-${key}`,
    key,
    self: `https://jira.example.com/rest/api/3/issue/${key}`,
    fields: {
      summary: `Issue ${key}`,
      status: {
        id: "1",
        name: statusName,
        statusCategory: { id: 1, key: categoryKey, name: statusName, colorName: "blue" },
      },
      issuetype: { id: "10001", name: "Task", subtask: false },
      project: { id: "10000", key: "TEST", name: "Test Project" },
      created: "2026-03-20T10:00:00.000Z",
      updated: "2026-03-20T12:00:00.000Z",
    },
    ...overrides,
  } as JiraIssue;
}

function makeTrackedEntity(
  jiraKey: string,
  scopeId: string,
  jiraStatusName: string = "To Do",
  lastSyncedAt: string = "2026-03-20T10:00:00.000Z",
) {
  return {
    id: `entity-${jiraKey}`,
    entityType: ENTITY_TYPES.jiraIssue,
    scopeKind: "issue",
    scopeId,
    externalId: `id-${jiraKey}`,
    title: `Issue ${jiraKey}`,
    status: "active",
    data: {
      jiraIssueId: `id-${jiraKey}`,
      jiraIssueKey: jiraKey,
      jiraStatusName,
      lastSyncedAt,
    },
    createdAt: "2026-03-20T08:00:00.000Z",
    updatedAt: "2026-03-20T10:00:00.000Z",
  };
}

// ─── Returns early when syncJql is empty ────────────────────────────────────

describe("ReconciliationService — empty syncJql", () => {
  it("returns early with empty result when syncJql is empty", async () => {
    const ctx = createMockContext();
    const config = makeConfig({ syncJql: "" });
    const svc = new ReconciliationService(ctx, createMockIssueService(), createMockSearchService(), config);

    const result = await svc.reconcile("company-1");

    expect(result.total).toBe(0);
    expect(result.synced).toBe(0);
    expect(result.created).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.drifted).toBe(0);
    expect(result.errors).toBe(0);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "syncJql is empty -- skipping reconciliation",
    );
  });

  it("returns early with empty result when syncJql is whitespace", async () => {
    const ctx = createMockContext();
    const config = makeConfig({ syncJql: "   " });
    const svc = new ReconciliationService(ctx, createMockIssueService(), createMockSearchService(), config);

    const result = await svc.reconcile("company-1");

    expect(result.total).toBe(0);
    expect(result.created).toBe(0);
  });
});

// ─── New issues in Jira (created) ───────────────────────────────────────────

describe("ReconciliationService — new Jira issues", () => {
  it("counts new issues in Jira not yet tracked", async () => {
    const jiraIssue = makeJiraIssue("TEST-1", "To Do", "new");
    const ctx = createMockContext();
    const searchService = createMockSearchService({
      searchAllIssues: vi.fn().mockResolvedValue([jiraIssue]),
    });
    const config = makeConfig();
    const svc = new ReconciliationService(ctx, createMockIssueService(), searchService, config);

    const result = await svc.reconcile("company-1");

    expect(result.created).toBe(1);
  });

  it("creates entity tracking for newly discovered Jira issues", async () => {
    const jiraIssue = makeJiraIssue("TEST-1", "To Do", "new");
    const ctx = createMockContext();
    const searchService = createMockSearchService({
      searchAllIssues: vi.fn().mockResolvedValue([jiraIssue]),
    });
    const config = makeConfig();
    const svc = new ReconciliationService(ctx, createMockIssueService(), searchService, config);

    await svc.reconcile("company-1");

    expect(ctx.entities.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: ENTITY_TYPES.jiraIssue,
        externalId: "id-TEST-1",
        title: "Issue TEST-1",
        status: "pending",
        data: expect.objectContaining({
          jiraIssueId: "id-TEST-1",
          jiraIssueKey: "TEST-1",
          companyId: "company-1",
          jiraStatus: "To Do",
        }),
      }),
    );
  });
});

// ─── Tracked entities no longer in Jira scope (deleted) ─────────────────────

describe("ReconciliationService — out-of-scope entities", () => {
  it("counts tracked entities no longer in Jira scope", async () => {
    const tracked = makeTrackedEntity("TEST-99", "scope-99");
    const ctx = createMockContext({
      entities: {
        list: vi.fn().mockResolvedValue([tracked]),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });
    // Jira returns no issues — the tracked entity is out of scope
    const searchService = createMockSearchService({
      searchAllIssues: vi.fn().mockResolvedValue([]),
    });
    const config = makeConfig();
    const svc = new ReconciliationService(ctx, createMockIssueService(), searchService, config);

    const result = await svc.reconcile("company-1");

    expect(result.deleted).toBe(1);
  });

  it("marks out-of-scope entities with status and timestamp", async () => {
    const tracked = makeTrackedEntity("TEST-99", "scope-99");
    const ctx = createMockContext({
      entities: {
        list: vi.fn().mockResolvedValue([tracked]),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });
    const searchService = createMockSearchService({
      searchAllIssues: vi.fn().mockResolvedValue([]),
    });
    const config = makeConfig();
    const svc = new ReconciliationService(ctx, createMockIssueService(), searchService, config);

    await svc.reconcile("company-1");

    expect(ctx.entities.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "out_of_scope",
        data: expect.objectContaining({
          outOfScopeAt: expect.any(String),
        }),
      }),
    );
  });
});

// ─── Status drift detection ─────────────────────────────────────────────────

describe("ReconciliationService — status drift", () => {
  it("detects status drift between Paperclip and Jira", async () => {
    const jiraIssue = makeJiraIssue("TEST-1", "In Progress", "indeterminate");
    const tracked = makeTrackedEntity("TEST-1", "scope-1", "To Do");

    const ctx = createMockContext({
      entities: {
        list: vi.fn().mockResolvedValue([tracked]),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      issues: {
        get: vi.fn().mockResolvedValue({
          id: "scope-1",
          status: "todo",
          updatedAt: "2026-03-20T11:00:00.000Z",
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    });
    const searchService = createMockSearchService({
      searchAllIssues: vi.fn().mockResolvedValue([jiraIssue]),
    });
    const config = makeConfig();
    const svc = new ReconciliationService(ctx, createMockIssueService(), searchService, config);

    const result = await svc.reconcile("company-1");

    expect(result.drifted).toBe(1);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "Status drift detected",
      expect.objectContaining({
        jiraKey: "TEST-1",
        jiraStatus: "In Progress",
        paperclipStatus: "todo",
      }),
    );
  });

  it("marks synced when statuses already match", async () => {
    // Jira status "To Do" maps to paperclip "todo" via reverseStatusMapping
    const jiraIssue = makeJiraIssue("TEST-1", "To Do", "new");
    const tracked = makeTrackedEntity("TEST-1", "scope-1", "To Do");

    const ctx = createMockContext({
      entities: {
        list: vi.fn().mockResolvedValue([tracked]),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      issues: {
        get: vi.fn().mockResolvedValue({
          id: "scope-1",
          status: "todo",
          updatedAt: "2026-03-20T11:00:00.000Z",
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    });
    const searchService = createMockSearchService({
      searchAllIssues: vi.fn().mockResolvedValue([jiraIssue]),
    });
    const config = makeConfig();
    const svc = new ReconciliationService(ctx, createMockIssueService(), searchService, config);

    const result = await svc.reconcile("company-1");

    expect(result.drifted).toBe(0);
    expect(result.synced).toBe(1);
  });
});

// ─── Conflict resolution: jira wins ─────────────────────────────────────────

describe("ReconciliationService — jira wins", () => {
  it("updates Paperclip issue status when jira wins", async () => {
    const jiraIssue = makeJiraIssue("TEST-1", "Done", "done");
    // Jira was updated more recently
    (jiraIssue.fields as any).updated = "2026-03-20T14:00:00.000Z";
    const tracked = makeTrackedEntity("TEST-1", "scope-1", "In Progress", "2026-03-20T10:00:00.000Z");

    const ctx = createMockContext({
      entities: {
        list: vi.fn().mockResolvedValue([tracked]),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      issues: {
        get: vi.fn().mockResolvedValue({
          id: "scope-1",
          status: "in_progress",
          updatedAt: "2026-03-20T11:00:00.000Z",
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    });
    const searchService = createMockSearchService({
      searchAllIssues: vi.fn().mockResolvedValue([jiraIssue]),
    });
    const config = makeConfig({ conflictStrategy: "jira_wins" });
    const svc = new ReconciliationService(ctx, createMockIssueService(), searchService, config);

    await svc.reconcile("company-1");

    expect(ctx.issues.update).toHaveBeenCalledWith(
      "scope-1",
      { status: "done" },
      "company-1",
    );
  });
});

// ─── Conflict resolution: paperclip wins ────────────────────────────────────

describe("ReconciliationService — paperclip wins", () => {
  it("transitions Jira issue when paperclip wins", async () => {
    const jiraIssue = makeJiraIssue("TEST-1", "To Do", "new");
    // Jira was updated earlier
    (jiraIssue.fields as any).updated = "2026-03-20T11:00:00.000Z";
    const tracked = makeTrackedEntity("TEST-1", "scope-1", "To Do", "2026-03-20T10:00:00.000Z");

    const transition: JiraTransition = {
      id: "31",
      name: "Start Progress",
      to: {
        id: "3",
        name: "In Progress",
        statusCategory: { id: 4, key: "indeterminate", name: "In Progress", colorName: "blue" },
      },
      hasScreen: false,
      isGlobal: false,
      isInitial: false,
      isConditional: false,
    };

    const issueService = createMockIssueService({
      getTransitions: vi.fn().mockResolvedValue([transition]),
    });

    const ctx = createMockContext({
      entities: {
        list: vi.fn().mockResolvedValue([tracked]),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      issues: {
        get: vi.fn().mockResolvedValue({
          id: "scope-1",
          status: "in_progress",
          updatedAt: "2026-03-20T14:00:00.000Z",
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    });
    const searchService = createMockSearchService({
      searchAllIssues: vi.fn().mockResolvedValue([jiraIssue]),
    });
    const config = makeConfig({ conflictStrategy: "paperclip_wins" });
    const svc = new ReconciliationService(ctx, issueService, searchService, config);

    await svc.reconcile("company-1");

    expect(issueService.getTransitions).toHaveBeenCalledWith("TEST-1");
    expect(issueService.transitionIssue).toHaveBeenCalledWith("TEST-1", "31");
  });
});

// ─── Error handling ─────────────────────────────────────────────────────────

describe("ReconciliationService — error handling", () => {
  it("increments errors count when entity processing fails", async () => {
    const jiraIssue = makeJiraIssue("TEST-1", "In Progress", "indeterminate");
    const tracked = makeTrackedEntity("TEST-1", "scope-1", "To Do");

    const ctx = createMockContext({
      entities: {
        list: vi.fn().mockResolvedValue([tracked]),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      issues: {
        get: vi.fn().mockRejectedValue(new Error("Paperclip API unavailable")),
        update: vi.fn(),
      },
    });
    const searchService = createMockSearchService({
      searchAllIssues: vi.fn().mockResolvedValue([jiraIssue]),
    });
    const config = makeConfig();
    const svc = new ReconciliationService(ctx, createMockIssueService(), searchService, config);

    const result = await svc.reconcile("company-1");

    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it("increments errors when entity has no scopeId", async () => {
    const jiraIssue = makeJiraIssue("TEST-1", "In Progress", "indeterminate");
    const tracked = makeTrackedEntity("TEST-1", "", "To Do");
    // Empty scopeId triggers the missing-scopeId warning path

    const ctx = createMockContext({
      entities: {
        list: vi.fn().mockResolvedValue([tracked]),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      issues: {
        get: vi.fn(),
        update: vi.fn(),
      },
    });
    const searchService = createMockSearchService({
      searchAllIssues: vi.fn().mockResolvedValue([jiraIssue]),
    });
    const config = makeConfig();
    const svc = new ReconciliationService(ctx, createMockIssueService(), searchService, config);

    const result = await svc.reconcile("company-1");

    expect(result.errors).toBe(1);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "Tracked entity missing scopeId",
      expect.objectContaining({ key: "TEST-1" }),
    );
  });

  it("handles search service failure gracefully", async () => {
    const ctx = createMockContext();
    const searchService = createMockSearchService({
      searchAllIssues: vi.fn().mockRejectedValue(new Error("Network timeout")),
    });
    const config = makeConfig();
    const svc = new ReconciliationService(ctx, createMockIssueService(), searchService, config);

    const result = await svc.reconcile("company-1");

    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(ctx.logger.error).toHaveBeenCalled();
  });
});
