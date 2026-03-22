/**
 * Jira Issue Webhook Handler
 *
 * Receives Jira webhook events (issue created, updated, deleted) and syncs
 * changes back to Paperclip. Follows the same pattern as the M365 plugin's
 * `handleGraphNotification` handler, adapted for Jira's webhook format.
 *
 * Jira webhooks deliver a single event per request (unlike Graph which batches
 * notifications). The payload includes the full issue object and an optional
 * changelog describing which fields changed.
 */

import { timingSafeEqual } from "node:crypto";
import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { ENTITY_TYPES, type JiraConfig, type PaperclipIssueStatus } from "../constants.js";
import { mapJiraStatusToPaperclip } from "../sync/status-map.js";
import type { JiraWebhookPayload, JiraChangelogItem } from "../jira/types.js";

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Handle incoming Jira issue webhook events.
 *
 * Verifies the webhook secret (when configured), parses the event payload,
 * and dispatches to the appropriate handler based on `webhookEvent`.
 */
export async function handleJiraIssueWebhook(
  ctx: PluginContext,
  input: PluginWebhookInput,
  config: JiraConfig,
): Promise<void> {
  // ── Step 1: Verify webhook authenticity ──────────────────────────────────
  if (!(await verifyWebhook(ctx, input, config))) {
    return;
  }

  // ── Step 2: Parse the event payload ──────────────────────────────────────
  const body = input.parsedBody as JiraWebhookPayload;

  if (!body || !body.webhookEvent) {
    ctx.logger.warn("Received Jira webhook with missing or empty payload");
    return;
  }

  ctx.logger.info("Processing Jira webhook event", {
    webhookEvent: body.webhookEvent,
    issueKey: body.issue?.key,
    timestamp: body.timestamp,
  });

  // ── Step 3: Dispatch by event type ───────────────────────────────────────
  try {
    switch (body.webhookEvent) {
      case "jira:issue_created":
        await handleIssueCreated(ctx, body, config);
        break;

      case "jira:issue_updated":
        await handleIssueUpdated(ctx, body, config);
        break;

      case "jira:issue_deleted":
        await handleIssueDeleted(ctx, body);
        break;

      default:
        ctx.logger.debug("Ignoring unhandled Jira webhook event", {
          webhookEvent: (body as unknown as Record<string, unknown>).webhookEvent,
        });
    }
  } catch (err) {
    ctx.logger.error("Error processing Jira webhook event", {
      error: err instanceof Error ? err.message : String(err),
      webhookEvent: body.webhookEvent,
      issueKey: body.issue?.key,
    });
  }
}

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Verify webhook authenticity using the configured shared secret.
 *
 * If no `webhookSecretRef` is configured, logs a warning and accepts the
 * request (same lenient pattern as M365). If a secret IS configured, compares
 * it against a shared-secret field in the webhook body.
 *
 * Additionally checks for the `x-atlassian-webhook-identifier` header as
 * basic validation that the request originates from Atlassian.
 *
 * Returns true if the webhook should be processed, false if rejected.
 */
async function verifyWebhook(
  ctx: PluginContext,
  input: PluginWebhookInput,
  config: JiraConfig,
): Promise<boolean> {
  // Basic header check: Atlassian-sourced webhooks include an identifier header
  const atlassianId = input.headers?.["x-atlassian-webhook-identifier"];
  if (!atlassianId) {
    ctx.logger.debug(
      "Jira webhook missing x-atlassian-webhook-identifier header — proceeding anyway",
    );
  }

  if (!config.webhookSecretRef) {
    ctx.logger.warn(
      "webhookSecretRef is not configured — accepting webhook without secret verification. " +
        "Set a webhook secret in plugin settings to enable verification.",
    );
    return true;
  }

  // Resolve the configured secret and compare against the shared secret field
  // in the webhook body. Jira Cloud can include a user-defined secret in the
  // webhook registration; it is echoed back in the payload body.
  const bodySecret = (input.parsedBody as Record<string, unknown>)?.webhookSecret;

  if (typeof bodySecret !== "string" || bodySecret.length === 0) {
    ctx.logger.error(
      "Jira webhook secret is configured but the incoming webhook does not include a " +
        "webhookSecret field — rejecting. Ensure the Jira webhook registration includes " +
        "the shared secret.",
    );
    return false;
  }

  const expectedSecret = await ctx.secrets.resolve(config.webhookSecretRef);

  const secretBuf = Buffer.from(bodySecret);
  const expectedBuf = Buffer.from(expectedSecret);
  if (secretBuf.length !== expectedBuf.length || !timingSafeEqual(secretBuf, expectedBuf)) {
    ctx.logger.error("Jira webhook secret mismatch — rejecting", {
      hint: "The webhookSecret in the incoming payload does not match the configured secret.",
    });
    return false;
  }

  return true;
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

/**
 * Handle `jira:issue_created` events.
 *
 * Checks whether the created issue falls within the configured sync scope
 * (by project key) and creates an entity tracking record if so.
 */
async function handleIssueCreated(
  ctx: PluginContext,
  payload: JiraWebhookPayload,
  config: JiraConfig,
): Promise<void> {
  const issue = payload.issue;
  if (!issue) {
    ctx.logger.warn("jira:issue_created webhook missing issue data");
    return;
  }

  // Only track issues from the configured project
  if (config.projectKey && issue.fields.project.key !== config.projectKey) {
    ctx.logger.debug("Ignoring issue_created for untracked project", {
      issueKey: issue.key,
      projectKey: issue.fields.project.key,
      configuredProject: config.projectKey,
    });
    return;
  }

  ctx.logger.info("Jira issue created — tracking", {
    issueId: issue.id,
    issueKey: issue.key,
  });

  // Upsert entity tracking so subsequent updates and sync reconciliation
  // are aware of this issue.
  await ctx.entities.upsert({
    entityType: ENTITY_TYPES.jiraIssue,
    scopeKind: "issue",
    scopeId: "", // Will be linked when a Paperclip issue is associated
    externalId: issue.id,
    title: issue.fields.summary,
    status: "pending",
    data: {
      issueKey: issue.key,
      projectKey: issue.fields.project.key,
      jiraStatus: issue.fields.status.name,
      jiraStatusCategory: issue.fields.status.statusCategory?.key ?? null,
      assigneeId: issue.fields.assignee?.accountId ?? null,
      priority: issue.fields.priority?.name ?? null,
      labels: issue.fields.labels ?? [],
      lastWebhookAt: new Date().toISOString(),
    },
  });
}

/**
 * Handle `jira:issue_updated` events.
 *
 * Looks up the tracked entity by Jira issue ID, determines what changed
 * (from the changelog), maps status changes via the configured status mapping,
 * and updates the corresponding Paperclip issue.
 */
async function handleIssueUpdated(
  ctx: PluginContext,
  payload: JiraWebhookPayload,
  config: JiraConfig,
): Promise<void> {
  const issue = payload.issue;
  if (!issue) {
    ctx.logger.warn("jira:issue_updated webhook missing issue data");
    return;
  }

  // Look up the tracked entity by external ID (Jira issue ID)
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.jiraIssue,
    externalId: issue.id,
    limit: 1,
    offset: 0,
  });

  if (entities.length === 0) {
    ctx.logger.debug("No tracked entity for Jira issue — skipping update", {
      issueId: issue.id,
      issueKey: issue.key,
    });
    return;
  }

  const entity = entities[0]!;

  // If entity is not linked to a Paperclip issue yet, just update tracking data
  if (!entity.scopeId) {
    ctx.logger.debug("Tracked entity has no linked Paperclip issue — updating tracking only", {
      issueKey: issue.key,
    });
    await upsertEntityTracking(ctx, entity.scopeId ?? "", issue, payload);
    return;
  }

  // Fetch the current Paperclip issue using companyId from entity data
  const entityData = entity.data as Record<string, unknown> | undefined;
  const companyId = (entityData?.companyId as string) ?? "";
  const paperclipIssue = await ctx.issues.get(entity.scopeId, companyId);
  if (!paperclipIssue) {
    ctx.logger.warn("Linked Paperclip issue not found — updating tracking only", {
      scopeId: entity.scopeId,
      issueKey: issue.key,
    });
    await upsertEntityTracking(ctx, entity.scopeId, issue, payload);
    return;
  }

  // Determine what changed
  const changelogItems = payload.changelog?.items ?? [];
  const statusChange = findChangelogField(changelogItems, "status");
  const summaryChange = findChangelogField(changelogItems, "summary");

  // Build the update patch
  const patch: { status?: PaperclipIssueStatus; title?: string } = {};

  // Map Jira status to Paperclip status if status changed
  if (statusChange) {
    const mappedStatus = mapJiraStatusToPaperclip(issue.fields.status, config);
    if (mappedStatus && mappedStatus !== paperclipIssue.status) {
      patch.status = mappedStatus;
    } else if (!mappedStatus) {
      ctx.logger.warn("Could not map Jira status to Paperclip status", {
        jiraStatus: issue.fields.status.name,
        categoryKey: issue.fields.status.statusCategory?.key,
        issueKey: issue.key,
      });
    }
  }

  // Update title if summary changed
  if (summaryChange && issue.fields.summary !== paperclipIssue.title) {
    patch.title = issue.fields.summary;
  }

  // Apply the update if anything changed
  if (Object.keys(patch).length > 0) {
    await ctx.issues.update(
      paperclipIssue.id,
      patch,
      paperclipIssue.companyId,
    );

    ctx.logger.info("Updated Paperclip issue from Jira webhook", {
      issueId: paperclipIssue.id,
      issueKey: issue.key,
      changes: Object.keys(patch),
    });
  }

  // Always update entity tracking with latest Jira data
  await upsertEntityTracking(ctx, entity.scopeId, issue, payload);
}

/**
 * Handle `jira:issue_deleted` events.
 *
 * Marks the tracked entity as deleted. Does not delete the Paperclip issue —
 * that decision is left to the user or a separate reconciliation process.
 */
async function handleIssueDeleted(
  ctx: PluginContext,
  payload: JiraWebhookPayload,
): Promise<void> {
  const issue = payload.issue;
  if (!issue) {
    ctx.logger.warn("jira:issue_deleted webhook missing issue data");
    return;
  }

  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.jiraIssue,
    externalId: issue.id,
    limit: 1,
    offset: 0,
  });

  if (entities.length === 0) {
    ctx.logger.debug("No tracked entity for deleted Jira issue — nothing to do", {
      issueId: issue.id,
      issueKey: issue.key,
    });
    return;
  }

  const entity = entities[0]!;

  await ctx.entities.upsert({
    entityType: ENTITY_TYPES.jiraIssue,
    scopeKind: "issue",
    scopeId: entity.scopeId ?? "",
    externalId: issue.id,
    title: issue.fields.summary,
    status: "deleted",
    data: {
      issueKey: issue.key,
      projectKey: issue.fields.project.key,
      deletedAt: new Date().toISOString(),
      lastWebhookAt: new Date().toISOString(),
    },
  });

  ctx.logger.info("Marked entity as deleted from Jira webhook", {
    issueId: issue.id,
    issueKey: issue.key,
    scopeId: entity.scopeId,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Upsert the entity tracking record with the latest Jira issue data.
 */
async function upsertEntityTracking(
  ctx: PluginContext,
  scopeId: string,
  issue: NonNullable<JiraWebhookPayload["issue"]>,
  payload: JiraWebhookPayload,
): Promise<void> {
  await ctx.entities.upsert({
    entityType: ENTITY_TYPES.jiraIssue,
    scopeKind: "issue",
    scopeId,
    externalId: issue.id,
    title: issue.fields.summary,
    status: "synced",
    data: {
      issueKey: issue.key,
      projectKey: issue.fields.project.key,
      jiraStatus: issue.fields.status.name,
      jiraStatusCategory: issue.fields.status.statusCategory?.key ?? null,
      assigneeId: issue.fields.assignee?.accountId ?? null,
      priority: issue.fields.priority?.name ?? null,
      labels: issue.fields.labels ?? [],
      lastWebhookAt: new Date().toISOString(),
      lastChangelogId: payload.changelog?.id ?? null,
    },
  });
}

/**
 * Find a specific field change in the webhook changelog items.
 *
 * Returns the first changelog item matching the given field name,
 * or undefined if the field was not changed in this event.
 */
function findChangelogField(
  items: JiraChangelogItem[],
  fieldName: string,
): JiraChangelogItem | undefined {
  return items.find((item) => item.field === fieldName);
}
