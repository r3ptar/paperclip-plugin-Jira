import { vi, describe, it, expect } from "vitest";
import { handleJiraSearch } from "../src/tools/jira-search.js";
import { handleJiraGetIssue } from "../src/tools/jira-get-issue.js";
import { handleJiraCreateIssue } from "../src/tools/jira-create-issue.js";
import { handleJiraAssignIssue } from "../src/tools/jira-assign-issue.js";
import { handleJiraUpdateIssue } from "../src/tools/jira-update-issue.js";
import { handleJiraLinkIssues } from "../src/tools/jira-link-issues.js";
import { handleJiraTransitionIssue } from "../src/tools/jira-transition-issue.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const runCtx = {} as any;

function createMockIssueService() {
  return {
    getIssue: vi.fn(),
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    assignIssue: vi.fn(),
    linkIssues: vi.fn(),
    transitionIssue: vi.fn(),
  } as any;
}

function createMockSearchService() {
  return {
    searchIssues: vi.fn(),
  } as any;
}

// ─── jira-search ────────────────────────────────────────────────────────────

describe("handleJiraSearch", () => {
  it("returns error when jql is empty", async () => {
    const search = createMockSearchService();

    const result = await handleJiraSearch({ jql: "" }, runCtx, search);

    expect(result.error).toBe("jql is required");
    expect(search.searchIssues).not.toHaveBeenCalled();
  });

  it("returns error when jql is whitespace-only", async () => {
    const search = createMockSearchService();

    const result = await handleJiraSearch({ jql: "   " }, runCtx, search);

    expect(result.error).toBe("jql is required");
  });

  it("returns formatted results on success", async () => {
    const search = createMockSearchService();
    search.searchIssues.mockResolvedValue({
      total: 2,
      issues: [
        { key: "PROJ-1", fields: { summary: "First issue" } },
        { key: "PROJ-2", fields: { summary: "Second issue" } },
      ],
    });

    const result = await handleJiraSearch(
      { jql: "project = PROJ" },
      runCtx,
      search,
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toContain("Found 2 issue(s)");
    expect(result.content).toContain("PROJ-1: First issue");
    expect(result.content).toContain("PROJ-2: Second issue");
    expect(result.data).toEqual({ total: 2, issues: expect.any(Array) });
  });

  it("passes maxResults and fields to the service", async () => {
    const search = createMockSearchService();
    search.searchIssues.mockResolvedValue({ total: 0, issues: [] });

    await handleJiraSearch(
      { jql: "status = Open", maxResults: 5, fields: ["summary", "status"] },
      runCtx,
      search,
    );

    expect(search.searchIssues).toHaveBeenCalledWith(
      "status = Open",
      ["summary", "status"],
      5,
    );
  });

  it("returns error message when service throws", async () => {
    const search = createMockSearchService();
    search.searchIssues.mockRejectedValue(new Error("Invalid JQL"));

    const result = await handleJiraSearch(
      { jql: "bad jql" },
      runCtx,
      search,
    );

    expect(result.error).toBe("Search failed: Invalid JQL");
  });
});

// ─── jira-get-issue ─────────────────────────────────────────────────────────

describe("handleJiraGetIssue", () => {
  it("returns error when issueIdOrKey is missing", async () => {
    const service = createMockIssueService();

    const result = await handleJiraGetIssue({}, runCtx, service);

    expect(result.error).toBe("issueIdOrKey is required");
    expect(service.getIssue).not.toHaveBeenCalled();
  });

  it("returns issue data on success", async () => {
    const service = createMockIssueService();
    service.getIssue.mockResolvedValue({
      key: "PROJ-1",
      fields: {
        summary: "A bug",
        status: { name: "Open" },
        assignee: { displayName: "Jane Doe" },
      },
    });

    const result = await handleJiraGetIssue(
      { issueIdOrKey: "PROJ-1" },
      runCtx,
      service,
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toContain("PROJ-1: A bug");
    expect(result.content).toContain("Status: Open");
    expect(result.content).toContain("Assignee: Jane Doe");
    expect(result.data).toEqual({ issue: expect.any(Object) });
  });

  it("shows Unassigned when no assignee", async () => {
    const service = createMockIssueService();
    service.getIssue.mockResolvedValue({
      key: "PROJ-2",
      fields: {
        summary: "No assignee",
        status: { name: "Backlog" },
        assignee: null,
      },
    });

    const result = await handleJiraGetIssue(
      { issueIdOrKey: "PROJ-2" },
      runCtx,
      service,
    );

    expect(result.content).toContain("Assignee: Unassigned");
  });
});

// ─── jira-create-issue ──────────────────────────────────────────────────────

describe("handleJiraCreateIssue", () => {
  it("returns error when projectKey is missing", async () => {
    const service = createMockIssueService();

    const result = await handleJiraCreateIssue(
      { summary: "Hello", issueType: "Task" },
      runCtx,
      service,
    );

    expect(result.error).toBe("projectKey is required");
  });

  it("returns error when summary is missing", async () => {
    const service = createMockIssueService();

    const result = await handleJiraCreateIssue(
      { projectKey: "PROJ", issueType: "Task" },
      runCtx,
      service,
    );

    expect(result.error).toBe("summary is required");
  });

  it("returns error when issueType is missing", async () => {
    const service = createMockIssueService();

    const result = await handleJiraCreateIssue(
      { projectKey: "PROJ", summary: "Hello" },
      runCtx,
      service,
    );

    expect(result.error).toBe("issueType is required");
  });

  it("returns created issue key on success", async () => {
    const service = createMockIssueService();
    service.createIssue.mockResolvedValue({ id: "10001", key: "PROJ-42" });

    const result = await handleJiraCreateIssue(
      { projectKey: "PROJ", summary: "New feature", issueType: "Story" },
      runCtx,
      service,
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toContain("Created issue PROJ-42");
    expect(result.data).toEqual({ issueId: "10001", issueKey: "PROJ-42" });
  });

  it("passes optional fields to the service", async () => {
    const service = createMockIssueService();
    service.createIssue.mockResolvedValue({ id: "10002", key: "PROJ-43" });

    await handleJiraCreateIssue(
      {
        projectKey: "PROJ",
        summary: "With extras",
        issueType: "Bug",
        description: "A detailed description",
        priority: "High",
        labels: ["urgent"],
        assigneeAccountId: "user-123",
      },
      runCtx,
      service,
    );

    expect(service.createIssue).toHaveBeenCalledWith({
      projectKey: "PROJ",
      summary: "With extras",
      issueType: "Bug",
      description: "A detailed description",
      priority: "High",
      labels: ["urgent"],
      assigneeAccountId: "user-123",
    });
  });
});

// ─── jira-assign-issue ──────────────────────────────────────────────────────

describe("handleJiraAssignIssue", () => {
  it("returns error when issueIdOrKey is missing", async () => {
    const service = createMockIssueService();

    const result = await handleJiraAssignIssue({}, runCtx, service);

    expect(result.error).toBe("issueIdOrKey is required");
  });

  it("assigns issue to the given accountId", async () => {
    const service = createMockIssueService();
    service.assignIssue.mockResolvedValue(undefined);

    const result = await handleJiraAssignIssue(
      { issueIdOrKey: "PROJ-1", accountId: "user-456" },
      runCtx,
      service,
    );

    expect(service.assignIssue).toHaveBeenCalledWith("PROJ-1", "user-456");
    expect(result.content).toContain("assigned to user-456");
  });

  it("passes null accountId for unassign when accountId is omitted", async () => {
    const service = createMockIssueService();
    service.assignIssue.mockResolvedValue(undefined);

    const result = await handleJiraAssignIssue(
      { issueIdOrKey: "PROJ-1" },
      runCtx,
      service,
    );

    expect(service.assignIssue).toHaveBeenCalledWith("PROJ-1", null);
    expect(result.content).toContain("unassigned");
  });
});

// ─── jira-update-issue ──────────────────────────────────────────────────────

describe("handleJiraUpdateIssue", () => {
  it("returns error when issueIdOrKey is missing", async () => {
    const service = createMockIssueService();

    const result = await handleJiraUpdateIssue(
      { summary: "New title" },
      runCtx,
      service,
    );

    expect(result.error).toBe("issueIdOrKey is required");
  });

  it("rejects when no update fields are provided", async () => {
    const service = createMockIssueService();

    const result = await handleJiraUpdateIssue(
      { issueIdOrKey: "PROJ-1" },
      runCtx,
      service,
    );

    expect(result.error).toContain("At least one field to update is required");
    expect(service.updateIssue).not.toHaveBeenCalled();
  });

  it("updates issue and reports which fields were changed", async () => {
    const service = createMockIssueService();
    service.updateIssue.mockResolvedValue(undefined);

    const result = await handleJiraUpdateIssue(
      { issueIdOrKey: "PROJ-1", summary: "Updated title", priority: "High" },
      runCtx,
      service,
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toContain("Updated PROJ-1");
    expect(result.content).toContain("summary");
    expect(result.content).toContain("priority");
    expect(result.data?.updatedFields).toEqual(
      expect.arrayContaining(["summary", "priority"]),
    );
  });
});

// ─── jira-link-issues ───────────────────────────────────────────────────────

describe("handleJiraLinkIssues", () => {
  it("returns error when inwardIssue is missing", async () => {
    const service = createMockIssueService();

    const result = await handleJiraLinkIssues(
      { outwardIssue: "PROJ-2", linkType: "Blocks" },
      runCtx,
      service,
    );

    expect(result.error).toBe("inwardIssue is required");
  });

  it("returns error when outwardIssue is missing", async () => {
    const service = createMockIssueService();

    const result = await handleJiraLinkIssues(
      { inwardIssue: "PROJ-1", linkType: "Blocks" },
      runCtx,
      service,
    );

    expect(result.error).toBe("outwardIssue is required");
  });

  it("returns error when linkType is missing", async () => {
    const service = createMockIssueService();

    const result = await handleJiraLinkIssues(
      { inwardIssue: "PROJ-1", outwardIssue: "PROJ-2" },
      runCtx,
      service,
    );

    expect(result.error).toBe("linkType is required");
  });

  it("links issues and returns confirmation on success", async () => {
    const service = createMockIssueService();
    service.linkIssues.mockResolvedValue(undefined);

    const result = await handleJiraLinkIssues(
      { inwardIssue: "PROJ-1", outwardIssue: "PROJ-2", linkType: "Blocks" },
      runCtx,
      service,
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toContain("Linked PROJ-1 -> PROJ-2 (Blocks)");
    expect(service.linkIssues).toHaveBeenCalledWith("PROJ-1", "PROJ-2", "Blocks");
  });
});

// ─── jira-transition-issue ──────────────────────────────────────────────────

describe("handleJiraTransitionIssue", () => {
  it("returns error when issueIdOrKey is missing", async () => {
    const service = createMockIssueService();

    const result = await handleJiraTransitionIssue(
      { transitionId: "31" },
      runCtx,
      service,
    );

    expect(result.error).toBe("issueIdOrKey is required");
  });

  it("returns error when transitionId is missing", async () => {
    const service = createMockIssueService();

    const result = await handleJiraTransitionIssue(
      { issueIdOrKey: "PROJ-1" },
      runCtx,
      service,
    );

    expect(result.error).toBe("transitionId is required");
  });

  it("passes through to service correctly with all parameters", async () => {
    const service = createMockIssueService();
    service.transitionIssue.mockResolvedValue(undefined);

    const result = await handleJiraTransitionIssue(
      {
        issueIdOrKey: "PROJ-1",
        transitionId: "31",
        comment: "Moving to done",
        resolution: "Done",
      },
      runCtx,
      service,
    );

    expect(service.transitionIssue).toHaveBeenCalledWith(
      "PROJ-1",
      "31",
      "Moving to done",
      "Done",
    );
    expect(result.error).toBeUndefined();
    expect(result.content).toContain("Transitioned PROJ-1 via transition 31");
  });

  it("passes undefined for optional comment and resolution", async () => {
    const service = createMockIssueService();
    service.transitionIssue.mockResolvedValue(undefined);

    await handleJiraTransitionIssue(
      { issueIdOrKey: "PROJ-1", transitionId: "21" },
      runCtx,
      service,
    );

    expect(service.transitionIssue).toHaveBeenCalledWith(
      "PROJ-1",
      "21",
      undefined,
      undefined,
    );
  });
});
