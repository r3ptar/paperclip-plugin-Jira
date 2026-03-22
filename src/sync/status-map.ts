/**
 * Transition-aware bidirectional status mapping between Paperclip and Jira.
 *
 * Jira uses transition-based workflows: you cannot set a status field directly,
 * you must execute a valid workflow transition. This module handles:
 *
 * 1. Mapping Paperclip statuses to Jira status names (via config)
 * 2. Mapping Jira statuses back to Paperclip (via config + category fallback)
 * 3. Finding the correct transition to reach a target status
 * 4. Combining all of the above into a single `resolveTransition` call
 */

import type { PaperclipIssueStatus, JiraConfig } from "../constants.js";
import type { JiraStatus, JiraTransition } from "../jira/types.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Default mapping from Jira status category keys to Paperclip statuses.
 *
 * Every Jira status belongs to one of three meaningful categories:
 * - "new"            -> not started
 * - "indeterminate"  -> in progress
 * - "done"           -> completed
 *
 * Used as a fallback when no explicit reverse mapping is configured.
 */
export const DEFAULT_CATEGORY_MAP: Record<string, PaperclipIssueStatus> = {
  new: "todo",
  indeterminate: "in_progress",
  done: "done",
} as const;

// ─── Paperclip -> Jira ──────────────────────────────────────────────────────

/**
 * Look up the Jira status name that corresponds to a Paperclip issue status.
 *
 * Uses `config.statusMapping` (user-configured per-project). Returns null
 * if no mapping is configured for the given status (empty string counts as
 * unconfigured).
 */
export function mapPaperclipToJiraStatus(
  paperclipStatus: PaperclipIssueStatus,
  config: JiraConfig,
): string | null {
  const jiraStatusName = config.statusMapping[paperclipStatus];
  if (!jiraStatusName || jiraStatusName.trim().length === 0) {
    return null;
  }
  return jiraStatusName;
}

// ─── Jira -> Paperclip ──────────────────────────────────────────────────────

/**
 * Look up the Paperclip status that corresponds to a Jira status.
 *
 * Resolution order:
 * 1. Explicit match in `config.reverseStatusMapping` by status name
 * 2. Fallback to `DEFAULT_CATEGORY_MAP` using the status category key
 * 3. null if no match is found
 */
export function mapJiraStatusToPaperclip(
  jiraStatus: JiraStatus,
  config: JiraConfig,
): PaperclipIssueStatus | null {
  // 1. Explicit reverse mapping by name
  const explicit = config.reverseStatusMapping[jiraStatus.name];
  if (explicit) {
    return explicit;
  }

  // 2. Category fallback
  const categoryKey = jiraStatus.statusCategory?.key;
  if (categoryKey && categoryKey in DEFAULT_CATEGORY_MAP) {
    return DEFAULT_CATEGORY_MAP[categoryKey];
  }

  // 3. No match
  return null;
}

// ─── Transition Lookup ──────────────────────────────────────────────────────

/**
 * Find the transition that moves an issue to the target status.
 *
 * Resolution order:
 * 1. Exact match on `transition.to.name` (case-insensitive)
 * 2. Fallback: match by status category key (e.g. if target is "Done" and
 *    a transition leads to a status in the "done" category)
 * 3. null if no suitable transition is found
 *
 * @param targetStatusName     The desired Jira status name (e.g. "In Progress")
 * @param availableTransitions Transitions available from the issue's current status
 */
export function findTransitionForStatus(
  targetStatusName: string,
  availableTransitions: JiraTransition[],
): JiraTransition | null {
  const targetLower = targetStatusName.toLowerCase();

  // 1. Exact name match (case-insensitive)
  const exactMatch = availableTransitions.find(
    (t) => t.to.name.toLowerCase() === targetLower,
  );
  if (exactMatch) {
    return exactMatch;
  }

  // 2. Category fallback: find the target's expected category, then match
  //    a transition whose `to` status has that category
  const targetCategory = findCategoryForStatusName(targetStatusName);
  if (targetCategory) {
    const categoryMatch = availableTransitions.find(
      (t) => t.to.statusCategory?.key === targetCategory,
    );
    if (categoryMatch) {
      return categoryMatch;
    }
  }

  return null;
}

/**
 * Combines status mapping and transition lookup into a single call.
 *
 * This is the primary entry point that tools and sync code should use:
 * 1. Maps the Paperclip status to a Jira status name via config
 * 2. Finds the transition to reach that status from the available transitions
 *
 * Returns null if no mapping is configured or no valid transition exists.
 */
export function resolveTransition(
  paperclipStatus: PaperclipIssueStatus,
  availableTransitions: JiraTransition[],
  config: JiraConfig,
): JiraTransition | null {
  const targetStatusName = mapPaperclipToJiraStatus(paperclipStatus, config);
  if (!targetStatusName) {
    return null;
  }

  return findTransitionForStatus(targetStatusName, availableTransitions);
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Infer the Jira status category key from a status name.
 *
 * This is a heuristic used only for category-based fallback matching in
 * `findTransitionForStatus`. Common Jira status names are mapped to their
 * well-known categories. Returns null if the name is not recognized.
 */
function findCategoryForStatusName(statusName: string): string | null {
  const lower = statusName.toLowerCase();

  // "done" category statuses
  if (
    lower === "done" ||
    lower === "closed" ||
    lower === "resolved" ||
    lower === "complete" ||
    lower === "completed"
  ) {
    return "done";
  }

  // "new" category statuses
  if (
    lower === "to do" ||
    lower === "todo" ||
    lower === "open" ||
    lower === "new" ||
    lower === "backlog" ||
    lower === "created"
  ) {
    return "new";
  }

  // "indeterminate" (in progress) category statuses
  if (
    lower === "in progress" ||
    lower === "in review" ||
    lower === "in development" ||
    lower === "blocked" ||
    lower === "review" ||
    lower === "active"
  ) {
    return "indeterminate";
  }

  return null;
}
