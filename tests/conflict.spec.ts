import { describe, expect, it } from "vitest";
import { hasChangedSince, resolveConflict } from "../src/sync/conflict.js";
import type { SyncRecord } from "../src/sync/conflict.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

const BASE_TIME = "2026-03-20T12:00:00.000Z";
const EARLIER = "2026-03-20T11:00:00.000Z";
const LATER = "2026-03-20T13:00:00.000Z";
const MUCH_LATER = "2026-03-20T14:00:00.000Z";

function makeSyncRecord(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    paperclipUpdatedAt: BASE_TIME,
    jiraUpdatedAt: BASE_TIME,
    lastSyncedAt: EARLIER,
    ...overrides,
  };
}

// ─── hasChangedSince ────────────────────────────────────────────────────────

describe("hasChangedSince", () => {
  it("returns true when updatedAt is after since", () => {
    expect(hasChangedSince(LATER, BASE_TIME)).toBe(true);
  });

  it("returns false when updatedAt is before since", () => {
    expect(hasChangedSince(EARLIER, BASE_TIME)).toBe(false);
  });

  it("returns false when updatedAt equals since", () => {
    expect(hasChangedSince(BASE_TIME, BASE_TIME)).toBe(false);
  });
});

// ─── last_write_wins ────────────────────────────────────────────────────────

describe("resolveConflict — last_write_wins", () => {
  it("Paperclip wins when it was updated more recently", () => {
    const pcRecord = makeSyncRecord({ paperclipUpdatedAt: LATER });
    const jiraRecord = makeSyncRecord({ jiraUpdatedAt: BASE_TIME });

    const result = resolveConflict("last_write_wins", pcRecord, jiraRecord);
    expect(result.winner).toBe("paperclip");
    expect(result.reason).toContain("Paperclip updated more recently");
  });

  it("Jira wins when it was updated more recently", () => {
    const pcRecord = makeSyncRecord({ paperclipUpdatedAt: BASE_TIME });
    const jiraRecord = makeSyncRecord({ jiraUpdatedAt: LATER });

    const result = resolveConflict("last_write_wins", pcRecord, jiraRecord);
    expect(result.winner).toBe("jira");
    expect(result.reason).toContain("Jira updated more recently");
  });

  it("returns none when both updated at the same time", () => {
    const pcRecord = makeSyncRecord({ paperclipUpdatedAt: BASE_TIME });
    const jiraRecord = makeSyncRecord({ jiraUpdatedAt: BASE_TIME });

    const result = resolveConflict("last_write_wins", pcRecord, jiraRecord);
    expect(result.winner).toBe("none");
    expect(result.reason).toContain("same time");
  });
});

// ─── paperclip_wins ─────────────────────────────────────────────────────────

describe("resolveConflict — paperclip_wins", () => {
  it("Paperclip wins when both sides have changed since last sync", () => {
    const pcRecord = makeSyncRecord({
      paperclipUpdatedAt: LATER,
      lastSyncedAt: BASE_TIME,
    });
    const jiraRecord = makeSyncRecord({
      jiraUpdatedAt: MUCH_LATER,
      lastSyncedAt: BASE_TIME,
    });

    const result = resolveConflict("paperclip_wins", pcRecord, jiraRecord);
    expect(result.winner).toBe("paperclip");
    expect(result.reason).toContain("paperclip_wins strategy");
  });

  it("Jira wins when only Jira has changed (Paperclip unchanged since last sync)", () => {
    const pcRecord = makeSyncRecord({
      paperclipUpdatedAt: EARLIER,
      lastSyncedAt: BASE_TIME, // Paperclip updated BEFORE last sync
    });
    const jiraRecord = makeSyncRecord({
      jiraUpdatedAt: LATER,
      lastSyncedAt: BASE_TIME,
    });

    const result = resolveConflict("paperclip_wins", pcRecord, jiraRecord);
    expect(result.winner).toBe("jira");
    expect(result.reason).toContain("Paperclip unchanged since last sync");
  });
});

// ─── jira_wins ──────────────────────────────────────────────────────────────

describe("resolveConflict — jira_wins", () => {
  it("Jira wins when both sides have changed since last sync", () => {
    const pcRecord = makeSyncRecord({
      paperclipUpdatedAt: MUCH_LATER,
      lastSyncedAt: BASE_TIME,
    });
    const jiraRecord = makeSyncRecord({
      jiraUpdatedAt: LATER,
      lastSyncedAt: BASE_TIME,
    });

    const result = resolveConflict("jira_wins", pcRecord, jiraRecord);
    expect(result.winner).toBe("jira");
    expect(result.reason).toContain("jira_wins strategy");
  });

  it("Paperclip wins when only Paperclip has changed (Jira unchanged since last sync)", () => {
    const pcRecord = makeSyncRecord({
      paperclipUpdatedAt: LATER,
      lastSyncedAt: BASE_TIME,
    });
    const jiraRecord = makeSyncRecord({
      jiraUpdatedAt: EARLIER,
      lastSyncedAt: BASE_TIME, // Jira updated BEFORE last sync
    });

    const result = resolveConflict("jira_wins", pcRecord, jiraRecord);
    expect(result.winner).toBe("paperclip");
    expect(result.reason).toContain("Jira unchanged since last sync");
  });
});
