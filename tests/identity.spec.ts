import { describe, expect, it } from "vitest";
import { AgentIdentityService } from "../src/services/identity.js";
import type { JiraConfig } from "../src/constants.js";
import { DEFAULT_CONFIG } from "../src/constants.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<JiraConfig> = {}): JiraConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

function makeServiceWithMappings(
  map: Record<string, string>,
  defaultAccountId = "",
): AgentIdentityService {
  return new AgentIdentityService(
    makeConfig({ agentIdentityMap: map, defaultServiceAccountId: defaultAccountId }),
  );
}

// ─── resolveJiraAccountId ───────────────────────────────────────────────────

describe("resolveJiraAccountId", () => {
  it("returns mapped account for known agent", () => {
    const svc = makeServiceWithMappings({ "agent-1": "jira-account-abc" });
    expect(svc.resolveJiraAccountId("agent-1")).toBe("jira-account-abc");
  });

  it("returns null for unknown agent", () => {
    const svc = makeServiceWithMappings({ "agent-1": "jira-account-abc" });
    expect(svc.resolveJiraAccountId("agent-unknown")).toBeNull();
  });
});

// ─── getDefaultAccountId ────────────────────────────────────────────────────

describe("getDefaultAccountId", () => {
  it("returns configured default", () => {
    const svc = makeServiceWithMappings({}, "default-account-xyz");
    expect(svc.getDefaultAccountId()).toBe("default-account-xyz");
  });

  it("returns empty string when not configured", () => {
    const svc = makeServiceWithMappings({}, "");
    expect(svc.getDefaultAccountId()).toBe("");
  });
});

// ─── hasIdentity ────────────────────────────────────────────────────────────

describe("hasIdentity", () => {
  it("returns true for mapped agents", () => {
    const svc = makeServiceWithMappings({ "agent-1": "jira-account-abc" });
    expect(svc.hasIdentity("agent-1")).toBe(true);
  });

  it("returns false for unmapped agents", () => {
    const svc = makeServiceWithMappings({ "agent-1": "jira-account-abc" });
    expect(svc.hasIdentity("agent-2")).toBe(false);
  });
});

// ─── listMappings ───────────────────────────────────────────────────────────

describe("listMappings", () => {
  it("returns all agent-to-account pairs", () => {
    const svc = makeServiceWithMappings({
      "agent-1": "jira-account-aaa",
      "agent-2": "jira-account-bbb",
    });

    const mappings = svc.listMappings();
    expect(mappings).toHaveLength(2);
    expect(mappings).toEqual(
      expect.arrayContaining([
        { agentId: "agent-1", jiraAccountId: "jira-account-aaa" },
        { agentId: "agent-2", jiraAccountId: "jira-account-bbb" },
      ]),
    );
  });

  it("returns empty array when no mappings exist", () => {
    const svc = makeServiceWithMappings({});
    expect(svc.listMappings()).toEqual([]);
  });
});

// ─── resolveActingAccountId ─────────────────────────────────────────────────

describe("resolveActingAccountId", () => {
  it("returns mapped account when agent has one", () => {
    const svc = makeServiceWithMappings(
      { "agent-1": "jira-account-abc" },
      "default-account-xyz",
    );
    expect(svc.resolveActingAccountId("agent-1")).toBe("jira-account-abc");
  });

  it("falls back to default when agent has no mapping", () => {
    const svc = makeServiceWithMappings(
      { "agent-1": "jira-account-abc" },
      "default-account-xyz",
    );
    expect(svc.resolveActingAccountId("agent-unknown")).toBe("default-account-xyz");
  });

  it("returns null when no mapping and no default", () => {
    const svc = makeServiceWithMappings({}, "");
    expect(svc.resolveActingAccountId("agent-unknown")).toBeNull();
  });

  it("returns default when agentId is undefined", () => {
    const svc = makeServiceWithMappings({}, "default-account-xyz");
    expect(svc.resolveActingAccountId(undefined)).toBe("default-account-xyz");
  });

  it("returns null when agentId is undefined and no default", () => {
    const svc = makeServiceWithMappings({}, "");
    expect(svc.resolveActingAccountId(undefined)).toBeNull();
  });
});
