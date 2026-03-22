import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATEGORY_MAP,
  findTransitionForStatus,
  mapJiraStatusToPaperclip,
  mapPaperclipToJiraStatus,
  resolveTransition,
} from "../src/sync/status-map.js";
import type { JiraConfig } from "../src/constants.js";
import type { JiraStatus, JiraStatusCategory, JiraTransition } from "../src/jira/types.js";
import { DEFAULT_CONFIG } from "../src/constants.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<JiraConfig> = {}): JiraConfig {
  return {
    ...DEFAULT_CONFIG,
    statusMapping: {
      backlog: "Backlog",
      todo: "To Do",
      in_progress: "In Progress",
      in_review: "In Review",
      done: "Done",
      blocked: "Blocked",
      cancelled: "Cancelled",
    },
    reverseStatusMapping: {
      "To Do": "todo",
      "In Progress": "in_progress",
      "In Review": "in_review",
      "Done": "done",
      "Backlog": "backlog",
      "Blocked": "blocked",
      "Cancelled": "cancelled",
    },
    ...overrides,
  };
}

function makeJiraStatus(
  name: string,
  categoryKey: string,
  categoryName: string = categoryKey,
): JiraStatus {
  return {
    id: "1",
    name,
    statusCategory: {
      id: 1,
      key: categoryKey,
      name: categoryName,
      colorName: "blue-gray",
    },
  };
}

function makeTransition(
  id: string,
  name: string,
  toStatus: JiraStatus,
): JiraTransition {
  return {
    id,
    name,
    to: toStatus,
    hasScreen: false,
    isGlobal: false,
    isInitial: false,
    isConditional: false,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("DEFAULT_CATEGORY_MAP", () => {
  it("maps new -> todo, indeterminate -> in_progress, done -> done", () => {
    expect(DEFAULT_CATEGORY_MAP).toEqual({
      new: "todo",
      indeterminate: "in_progress",
      done: "done",
    });
  });
});

describe("mapPaperclipToJiraStatus", () => {
  it("returns the configured Jira status name for a mapped Paperclip status", () => {
    const config = makeConfig();
    expect(mapPaperclipToJiraStatus("todo", config)).toBe("To Do");
    expect(mapPaperclipToJiraStatus("in_progress", config)).toBe("In Progress");
    expect(mapPaperclipToJiraStatus("done", config)).toBe("Done");
  });

  it("returns null when no mapping is configured (empty string)", () => {
    const config = makeConfig({
      statusMapping: {
        ...DEFAULT_CONFIG.statusMapping,
        blocked: "",
      },
    });
    expect(mapPaperclipToJiraStatus("blocked", config)).toBeNull();
  });

  it("returns null when mapping is whitespace-only", () => {
    const config = makeConfig({
      statusMapping: {
        ...DEFAULT_CONFIG.statusMapping,
        cancelled: "   ",
      },
    });
    expect(mapPaperclipToJiraStatus("cancelled", config)).toBeNull();
  });
});

describe("mapJiraStatusToPaperclip", () => {
  it("returns the explicit reverse mapping when configured", () => {
    const config = makeConfig();
    const jiraStatus = makeJiraStatus("In Review", "indeterminate");
    expect(mapJiraStatusToPaperclip(jiraStatus, config)).toBe("in_review");
  });

  it("falls back to category mapping when no explicit mapping exists", () => {
    const config = makeConfig({ reverseStatusMapping: {} });

    expect(
      mapJiraStatusToPaperclip(makeJiraStatus("Open", "new"), config),
    ).toBe("todo");

    expect(
      mapJiraStatusToPaperclip(makeJiraStatus("Doing", "indeterminate"), config),
    ).toBe("in_progress");

    expect(
      mapJiraStatusToPaperclip(makeJiraStatus("Closed", "done"), config),
    ).toBe("done");
  });

  it("returns null for an unknown category with no explicit mapping", () => {
    const config = makeConfig({ reverseStatusMapping: {} });
    const jiraStatus = makeJiraStatus("Mystery", "undefined");
    expect(mapJiraStatusToPaperclip(jiraStatus, config)).toBeNull();
  });

  it("prefers explicit mapping over category fallback", () => {
    const config = makeConfig({
      reverseStatusMapping: {
        "Done": "cancelled", // Override: "Done" -> cancelled instead of done
      },
    });
    const jiraStatus = makeJiraStatus("Done", "done");
    expect(mapJiraStatusToPaperclip(jiraStatus, config)).toBe("cancelled");
  });
});

describe("findTransitionForStatus", () => {
  const transitions: JiraTransition[] = [
    makeTransition("1", "Start Progress", makeJiraStatus("In Progress", "indeterminate")),
    makeTransition("2", "Mark Done", makeJiraStatus("Done", "done")),
    makeTransition("3", "Reopen", makeJiraStatus("To Do", "new")),
  ];

  it("finds an exact name match", () => {
    const result = findTransitionForStatus("Done", transitions);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("2");
    expect(result!.to.name).toBe("Done");
  });

  it("matches case-insensitively", () => {
    const result = findTransitionForStatus("in progress", transitions);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("1");
  });

  it("falls back to category match when no exact name match", () => {
    // "Closed" has no exact match, but falls back to "done" category
    const result = findTransitionForStatus("Closed", transitions);
    expect(result).not.toBeNull();
    expect(result!.to.statusCategory.key).toBe("done");
  });

  it("returns null when no match at all", () => {
    const result = findTransitionForStatus("SomeUnknownStatus", transitions);
    expect(result).toBeNull();
  });

  it("returns null for an empty transitions array", () => {
    const result = findTransitionForStatus("Done", []);
    expect(result).toBeNull();
  });
});

describe("resolveTransition", () => {
  const transitions: JiraTransition[] = [
    makeTransition("10", "Move to In Progress", makeJiraStatus("In Progress", "indeterminate")),
    makeTransition("20", "Close Issue", makeJiraStatus("Done", "done")),
    makeTransition("30", "Reopen", makeJiraStatus("To Do", "new")),
  ];

  it("resolves end-to-end: maps Paperclip status to config, then finds transition", () => {
    const config = makeConfig();
    const result = resolveTransition("done", transitions, config);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("20");
    expect(result!.to.name).toBe("Done");
  });

  it("resolves in_progress through config and transition lookup", () => {
    const config = makeConfig();
    const result = resolveTransition("in_progress", transitions, config);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("10");
  });

  it("returns null when no config mapping exists for the Paperclip status", () => {
    const config = makeConfig({
      statusMapping: { ...DEFAULT_CONFIG.statusMapping }, // all empty
    });
    const result = resolveTransition("todo", transitions, config);
    expect(result).toBeNull();
  });

  it("returns null when config maps to a status with no available transition", () => {
    const config = makeConfig({
      statusMapping: {
        ...DEFAULT_CONFIG.statusMapping,
        blocked: "SomeNonexistentStatus",
      },
    });
    // "SomeNonexistentStatus" won't match any transition name or category
    const result = resolveTransition("blocked", transitions, config);
    expect(result).toBeNull();
  });
});
