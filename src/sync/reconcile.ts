/**
 * JQL-based scheduled reconciliation service.
 *
 * Runs periodically to detect and correct drift between Paperclip and Jira.
 * Compares tracked entities against the current state in Jira (fetched via
 * the configured `syncJql`) and applies conflict resolution to any mismatches.
 *
 * Design reference: plugin-microsoft-365/src/sync/reconcile.ts
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { Issue } from "@paperclipai/shared";
import type { JiraConfig, PaperclipIssueStatus } from "../constants.js";
import { ENTITY_TYPES, STATE_KEYS } from "../constants.js";
import type { JiraIssue } from "../jira/types.js";
import type { JiraIssueService } from "../services/issues.js";
import type { JiraSearchService } from "../services/search.js";
import { mapJiraStatusToPaperclip, resolveTransition } from "./status-map.js";
import { resolveConflict } from "./conflict.js";
import type { SyncRecord } from "./conflict.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReconciliationResult {
  /** Total issues evaluated. */
  total: number;
  /** Issues confirmed in sync or successfully synced. */
  synced: number;
  /** New issues found in Jira but not yet tracked in Paperclip. */
  created: number;
  /** Issues tracked in Paperclip but no longer in Jira scope. */
  deleted: number;
  /** Issues where Paperclip and Jira status disagree. */
  drifted: number;
  /** Issues that failed during processing. */
  errors: number;
  /** Total reconciliation duration in milliseconds. */
  duration: number;
}

/** Shape of the entity data stored alongside tracked Jira issues. */
interface TrackedEntityData {
  jiraIssueId: string;
  jiraIssueKey: string;
  jiraStatusName: string;
  lastSyncedAt: string;
  lastWebhookAt?: string;
}

/** Shape returned by ctx.entities.list(). */
interface TrackedEntity {
  id: string;
  entityType: string;
  scopeKind: string;
  scopeId: string | null;
  externalId: string | null;
  title: string | null;
  status: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Service ────────────────────────────────────────────────────────────────

/**
 * Reconciliation service that detects and fixes drift between Paperclip
 * and Jira issues on a scheduled basis.
 */
export class ReconciliationService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly issueService: JiraIssueService,
    private readonly searchService: JiraSearchService,
    private readonly config: JiraConfig,
  ) {}

  /**
   * Run a full reconciliation cycle.
   *
   * 1. Fetch all tracked entities from Paperclip
   * 2. Fetch all matching Jira issues via the configured syncJql
   * 3. Compare and categorize: new, deleted, drifted, in-sync
   * 4. Resolve conflicts on drifted issues and apply winning state
   * 5. Update reconciliation timestamp and sync health
   */
  async reconcile(companyId: string): Promise<ReconciliationResult> {
    const startTime = Date.now();

    const result: ReconciliationResult = {
      total: 0,
      synced: 0,
      created: 0,
      deleted: 0,
      drifted: 0,
      errors: 0,
      duration: 0,
    };

    try {
      // ── Step 1: Fetch tracked entities ──────────────────────────────────
      const trackedEntities = await this.fetchAllTrackedEntities();

      // Build a lookup by Jira issue key for fast comparison
      const entityByJiraKey = new Map<string, { entity: TrackedEntity; data: TrackedEntityData }>();
      for (const entity of trackedEntities) {
        const data = entity.data as unknown as TrackedEntityData;
        if (data?.jiraIssueKey) {
          entityByJiraKey.set(data.jiraIssueKey, { entity, data });
        }
      }

      // ── Step 2: Fetch Jira issues via syncJql ───────────────────────────
      if (!this.config.syncJql || this.config.syncJql.trim().length === 0) {
        this.ctx.logger.warn("syncJql is empty -- skipping reconciliation");
        result.duration = Date.now() - startTime;
        return result;
      }

      // Incremental reconciliation: only fetch issues updated since last run
      let jql = this.config.syncJql;
      const lastReconcileAt = await this.ctx.state.get({
        scopeKind: "instance",
        stateKey: STATE_KEYS.lastReconcileAt,
      }) as string | null;

      if (lastReconcileAt) {
        // Subtract 5 minutes as safety margin for clock skew between worker and Jira
        const since = new Date(new Date(lastReconcileAt).getTime() - 5 * 60 * 1000);
        // Use UTC to avoid timezone mismatches. Jira JQL format: "yyyy-MM-dd HH:mm"
        const jqlDate = `${since.getUTCFullYear()}-${String(since.getUTCMonth() + 1).padStart(2, "0")}-${String(since.getUTCDate()).padStart(2, "0")} ${String(since.getUTCHours()).padStart(2, "0")}:${String(since.getUTCMinutes()).padStart(2, "0")}`;
        jql = `(${this.config.syncJql}) AND updated >= "${jqlDate}"`;
        this.ctx.logger.info("Incremental reconciliation", { since: jqlDate });
      }

      const jiraIssues = await this.searchService.searchAllIssues(
        jql,
        ["summary", "status", "updated", "assignee"],
      );

      const jiraIssuesByKey = new Map<string, JiraIssue>();
      for (const issue of jiraIssues) {
        jiraIssuesByKey.set(issue.key, issue);
      }

      // ── Step 3: Compare ─────────────────────────────────────────────────

      // 3a. Issues in Jira but not tracked (new) — create tracking records
      for (const [jiraKey, jiraIssue] of jiraIssuesByKey) {
        if (!entityByJiraKey.has(jiraKey)) {
          result.created += 1;
          try {
            await this.ctx.entities.upsert({
              entityType: ENTITY_TYPES.jiraIssue,
              scopeKind: "issue",
              scopeId: "",
              externalId: jiraIssue.id,
              title: jiraIssue.fields.summary,
              status: "pending",
              data: {
                jiraIssueId: jiraIssue.id,
                jiraIssueKey: jiraKey,
                companyId,
                jiraStatus: jiraIssue.fields.status.name,
                lastSyncedAt: new Date().toISOString(),
              },
            });
          } catch (err) {
            result.errors += 1;
            this.ctx.logger.error("Failed to create tracking for new Jira issue", {
              jiraKey,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      // 3b. Tracked but no longer in Jira scope (deleted/removed) — mark as out-of-scope
      // Only run on full reconciliation — incremental JQL only returns recently-updated
      // issues, so missing keys are expected (they just weren't modified recently).
      const isIncremental = Boolean(lastReconcileAt);
      for (const [trackedKey, tracked] of entityByJiraKey) {
        if (!isIncremental && !jiraIssuesByKey.has(trackedKey)) {
          result.deleted += 1;
          try {
            await this.ctx.entities.upsert({
              entityType: ENTITY_TYPES.jiraIssue,
              scopeKind: "issue",
              scopeId: tracked.entity.scopeId ?? "",
              externalId: tracked.data.jiraIssueId,
              title: tracked.entity.title ?? trackedKey,
              status: "out_of_scope",
              data: {
                ...tracked.data,
                outOfScopeAt: new Date().toISOString(),
              },
            });
          } catch (err) {
            result.errors += 1;
            this.ctx.logger.error("Failed to mark entity as out-of-scope", {
              trackedKey,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      // 3c. Present in both -- check for drift
      const overlappingKeys: string[] = [];
      for (const [trackedKey] of entityByJiraKey) {
        if (jiraIssuesByKey.has(trackedKey)) {
          overlappingKeys.push(trackedKey);
        }
      }

      result.total = jiraIssues.length + result.deleted;

      for (const key of overlappingKeys) {
        try {
          const jiraIssue = jiraIssuesByKey.get(key)!;
          const tracked = entityByJiraKey.get(key)!;

          // Race guard: skip issues that received a webhook update after
          // this reconciliation started — the webhook data is fresher
          const lastWebhookAt = tracked.data.lastWebhookAt;
          if (lastWebhookAt && new Date(lastWebhookAt).getTime() > startTime) {
            this.ctx.logger.debug("Skipping issue — webhook update is newer than reconciliation start", {
              key,
              lastWebhookAt,
            });
            result.synced += 1;
            continue;
          }

          // Map current Jira status to Paperclip status
          const currentJiraPaperclipStatus = mapJiraStatusToPaperclip(
            jiraIssue.fields.status,
            this.config,
          );

          // Get the Paperclip issue to compare
          const scopeId = tracked.entity.scopeId;
          if (!scopeId) {
            this.ctx.logger.warn("Tracked entity missing scopeId", { key });
            result.errors += 1;
            continue;
          }

          const paperclipIssue = await this.ctx.issues.get(scopeId, companyId);
          if (!paperclipIssue) {
            this.ctx.logger.warn("Paperclip issue not found for tracked entity", {
              key,
              scopeId,
            });
            result.errors += 1;
            continue;
          }

          const paperclipStatus = paperclipIssue.status;

          // Check if statuses are already aligned
          if (currentJiraPaperclipStatus === paperclipStatus) {
            result.synced += 1;
            continue;
          }

          // ── Status drift detected ─────────────────────────────────────
          result.drifted += 1;
          this.ctx.logger.warn("Status drift detected", {
            jiraKey: key,
            jiraStatus: jiraIssue.fields.status.name,
            paperclipStatus,
            expectedPaperclipStatus: currentJiraPaperclipStatus,
          });

          // Build sync records for conflict resolution
          const paperclipUpdatedAt =
            paperclipIssue.updatedAt instanceof Date
              ? paperclipIssue.updatedAt.toISOString()
              : String(paperclipIssue.updatedAt);

          const jiraUpdatedAt = jiraIssue.fields.updated;
          const lastSyncedAt = tracked.data.lastSyncedAt || new Date(0).toISOString();

          const paperclipRecord: SyncRecord = {
            paperclipUpdatedAt,
            jiraUpdatedAt,
            lastSyncedAt,
          };
          const jiraRecord: SyncRecord = {
            paperclipUpdatedAt,
            jiraUpdatedAt,
            lastSyncedAt,
          };

          const conflictResult = resolveConflict(
            this.config.conflictStrategy,
            paperclipRecord,
            jiraRecord,
          );

          this.ctx.logger.info("Conflict resolved", {
            jiraKey: key,
            winner: conflictResult.winner,
            reason: conflictResult.reason,
          });

          if (conflictResult.winner === "none") {
            result.synced += 1;
            continue;
          }

          // ── Apply the winning side ──────────────────────────────────────
          await this.applyResolution(
            conflictResult.winner,
            key,
            jiraIssue,
            paperclipIssue,
            companyId,
          );

          result.synced += 1;
        } catch (err) {
          result.errors += 1;
          this.ctx.logger.error("Error processing issue during reconciliation", {
            jiraKey: key,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // ── Step 5: Update state ────────────────────────────────────────────
      await this.ctx.state.set(
        { scopeKind: "instance", stateKey: STATE_KEYS.lastReconcileAt },
        new Date().toISOString(),
      );

      await this.ctx.state.set(
        { scopeKind: "instance", stateKey: STATE_KEYS.syncHealth },
        {
          tokenHealthy: result.errors === 0,
          status: result.errors > 0 ? "degraded" : "healthy",
          lastReconcileAt: new Date().toISOString(),
          trackedCount: entityByJiraKey.size,
          jiraCount: jiraIssues.length,
          driftedCount: result.drifted,
          errorCount: result.errors,
          checkedAt: new Date().toISOString(),
        },
      );
    } catch (err) {
      result.errors += 1;
      this.ctx.logger.error("Reconciliation failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    result.duration = Date.now() - startTime;

    this.ctx.logger.info("Reconciliation complete", {
      total: result.total,
      synced: result.synced,
      created: result.created,
      deleted: result.deleted,
      drifted: result.drifted,
      errors: result.errors,
      durationMs: result.duration,
    });

    return result;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Paginate through all tracked Jira issue entities.
   */
  private async fetchAllTrackedEntities(): Promise<TrackedEntity[]> {
    const allEntities: TrackedEntity[] = [];
    const PAGE_SIZE = 200;
    let offset = 0;
    let page: TrackedEntity[];

    do {
      page = await this.ctx.entities.list({
        entityType: ENTITY_TYPES.jiraIssue,
        limit: PAGE_SIZE,
        offset,
      });
      allEntities.push(...page);
      offset += PAGE_SIZE;
    } while (page.length === PAGE_SIZE);

    return allEntities;
  }

  /**
   * Apply the conflict resolution outcome.
   *
   * - "paperclip" wins: transition the Jira issue to match Paperclip status
   * - "jira" wins: update the Paperclip issue to match Jira status
   */
  private async applyResolution(
    winner: "paperclip" | "jira",
    jiraKey: string,
    jiraIssue: JiraIssue,
    paperclipIssue: Issue,
    companyId: string,
  ): Promise<void> {
    if (winner === "paperclip") {
      // Transition Jira to match Paperclip
      const paperclipStatus = paperclipIssue.status as PaperclipIssueStatus;
      const transitions = await this.issueService.getTransitions(jiraKey);
      const transition = resolveTransition(
        paperclipStatus,
        transitions,
        this.config,
      );

      if (transition) {
        await this.issueService.transitionIssue(jiraKey, transition.id);
        this.ctx.logger.info("Applied Paperclip status to Jira", {
          jiraKey,
          transitionId: transition.id,
          targetStatus: transition.to.name,
        });
      } else {
        this.ctx.logger.warn("No valid transition found to apply Paperclip status", {
          jiraKey,
          paperclipStatus,
        });
      }
    } else {
      // Update Paperclip to match Jira
      const newPaperclipStatus = mapJiraStatusToPaperclip(
        jiraIssue.fields.status,
        this.config,
      );

      if (newPaperclipStatus) {
        await this.ctx.issues.update(
          paperclipIssue.id,
          { status: newPaperclipStatus },
          companyId,
        );
        this.ctx.logger.info("Applied Jira status to Paperclip", {
          jiraKey,
          newPaperclipStatus,
        });
      } else {
        this.ctx.logger.warn("Could not map Jira status to Paperclip", {
          jiraKey,
          jiraStatus: jiraIssue.fields.status.name,
          jiraCategory: jiraIssue.fields.status.statusCategory?.key,
        });
      }
    }
  }
}
