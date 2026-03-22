/**
 * Three-strategy conflict resolution for Paperclip <-> Jira sync.
 *
 * When both sides have changed since the last sync, a conflict must be
 * resolved. The strategy is configured per-instance in `config.conflictStrategy`.
 *
 * Strategies:
 * - `last_write_wins`  -- most recently updated side wins
 * - `paperclip_wins`   -- Paperclip wins unless only Jira changed
 * - `jira_wins`        -- Jira wins unless only Paperclip changed
 */

import type { ConflictStrategy } from "../constants.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SyncRecord {
  /** ISO 8601 timestamp of the Paperclip side's last update. */
  paperclipUpdatedAt: string;
  /** ISO 8601 timestamp of the Jira side's last update. */
  jiraUpdatedAt: string;
  /** ISO 8601 timestamp of the last successful sync. */
  lastSyncedAt: string;
}

export interface ConflictResult {
  /** Which side's state should be applied. "none" means no action needed. */
  winner: "paperclip" | "jira" | "none";
  /** Human-readable explanation of why this side won. */
  reason: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns true if `updatedAt` is strictly after `since`.
 *
 * Both arguments are ISO 8601 timestamp strings. Comparison is done via
 * epoch milliseconds for precision.
 */
export function hasChangedSince(updatedAt: string, since: string): boolean {
  return new Date(updatedAt).getTime() > new Date(since).getTime();
}

// ─── Resolver ───────────────────────────────────────────────────────────────

/**
 * Determine which side wins a sync conflict.
 *
 * @param strategy        The configured conflict resolution strategy
 * @param paperclipRecord Timestamps from the Paperclip side
 * @param jiraRecord      Timestamps from the Jira side
 */
export function resolveConflict(
  strategy: ConflictStrategy,
  paperclipRecord: SyncRecord,
  jiraRecord: SyncRecord,
): ConflictResult {
  switch (strategy) {
    case "last_write_wins":
      return resolveLastWriteWins(paperclipRecord, jiraRecord);

    case "paperclip_wins":
      return resolvePaperclipWins(paperclipRecord, jiraRecord);

    case "jira_wins":
      return resolveJiraWins(paperclipRecord, jiraRecord);

    default:
      return resolveLastWriteWins(paperclipRecord, jiraRecord);
  }
}

// ─── Strategy Implementations ───────────────────────────────────────────────

function resolveLastWriteWins(
  paperclipRecord: SyncRecord,
  jiraRecord: SyncRecord,
): ConflictResult {
  const pcTime = new Date(paperclipRecord.paperclipUpdatedAt).getTime();
  const jiraTime = new Date(jiraRecord.jiraUpdatedAt).getTime();

  if (pcTime > jiraTime) {
    return {
      winner: "paperclip",
      reason: "last_write_wins: Paperclip updated more recently",
    };
  }

  if (jiraTime > pcTime) {
    return {
      winner: "jira",
      reason: "last_write_wins: Jira updated more recently",
    };
  }

  return {
    winner: "none",
    reason: "last_write_wins: both sides updated at the same time",
  };
}

function resolvePaperclipWins(
  paperclipRecord: SyncRecord,
  jiraRecord: SyncRecord,
): ConflictResult {
  const pcChanged = hasChangedSince(
    paperclipRecord.paperclipUpdatedAt,
    paperclipRecord.lastSyncedAt,
  );

  // If Paperclip has not changed since last sync, Jira wins
  if (!pcChanged) {
    return {
      winner: "jira",
      reason: "paperclip_wins strategy: Paperclip unchanged since last sync, applying Jira changes",
    };
  }

  return {
    winner: "paperclip",
    reason: "paperclip_wins strategy",
  };
}

function resolveJiraWins(
  paperclipRecord: SyncRecord,
  jiraRecord: SyncRecord,
): ConflictResult {
  const jiraChanged = hasChangedSince(
    jiraRecord.jiraUpdatedAt,
    jiraRecord.lastSyncedAt,
  );

  // If Jira has not changed since last sync, Paperclip wins
  if (!jiraChanged) {
    return {
      winner: "paperclip",
      reason: "jira_wins strategy: Jira unchanged since last sync, applying Paperclip changes",
    };
  }

  return {
    winner: "jira",
    reason: "jira_wins strategy",
  };
}
