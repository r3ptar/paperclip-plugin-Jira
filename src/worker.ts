import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginEvent,
  type PluginHealthDiagnostics,
  type PluginJobContext,
  type PluginWebhookInput,
  type ToolResult,
} from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  ENTITY_TYPES,
  JOB_KEYS,
  STATE_KEYS,
  TOOL_NAMES,
  WEBHOOK_KEYS,
  type JiraConfig,
  type PaperclipIssueStatus,
} from "./constants.js";
import { createTokenManager } from "./jira/auth.js";
import { JiraHttpClient } from "./jira/client.js";
import type { TokenManager, JiraClient, JiraAuthConfig } from "./jira/types.js";
import { AgentIdentityService } from "./services/identity.js";
import { JiraIssueService } from "./services/issues.js";
import { JiraProjectService } from "./services/projects.js";
import { JiraSearchService } from "./services/search.js";
import { JiraUserService } from "./services/users.js";
import { JiraBoardService } from "./services/boards.js";
import { JiraSprintService } from "./services/sprints.js";
import { ReconciliationService } from "./sync/reconcile.js";
import { handleJiraIssueWebhook } from "./webhooks/jira-issue-webhook.js";
import { handleJiraSearch } from "./tools/jira-search.js";
import { handleJiraGetIssue } from "./tools/jira-get-issue.js";
import { handleJiraCreateIssue } from "./tools/jira-create-issue.js";
import { handleJiraUpdateIssue } from "./tools/jira-update-issue.js";
import { handleJiraTransitionIssue } from "./tools/jira-transition-issue.js";
import { handleJiraAddComment } from "./tools/jira-add-comment.js";
import { handleJiraListProjects } from "./tools/jira-list-projects.js";
import { handleJiraGetProject } from "./tools/jira-get-project.js";
import { handleJiraListBoards } from "./tools/jira-list-boards.js";
import { handleJiraGetSprint } from "./tools/jira-get-sprint.js";
import { handleJiraMoveToSprint } from "./tools/jira-move-to-sprint.js";
import { handleJiraAssignIssue } from "./tools/jira-assign-issue.js";
import { handleJiraLinkIssues } from "./tools/jira-link-issues.js";
import { handleJiraListTransitions } from "./tools/jira-list-transitions.js";
import { handleJiraGetUser } from "./tools/jira-get-user.js";

// ── Module-level state ───────────────────────────────────────────────────────

let pluginCtx: PluginContext | null = null;
let tokenManager: TokenManager | null = null;
let jiraClient: JiraClient | null = null;
let identityService: AgentIdentityService | null = null;
let issueService: JiraIssueService | null = null;
let projectService: JiraProjectService | null = null;
let searchService: JiraSearchService | null = null;
let userService: JiraUserService | null = null;
let boardService: JiraBoardService | null = null;
let sprintService: JiraSprintService | null = null;

// ── Config ───────────────────────────────────────────────────────────────────

async function getConfig(ctx: PluginContext): Promise<JiraConfig> {
  const raw = await ctx.config.get();
  const stateConfig = await ctx.state.get({
    scopeKind: "instance",
    stateKey: "plugin-config",
  }) as Partial<JiraConfig> | null;
  return { ...DEFAULT_CONFIG, ...(raw as Partial<JiraConfig>), ...(stateConfig ?? {}) };
}

// ── Service Initialization ───────────────────────────────────────────────────

async function initServices(ctx: PluginContext, config: JiraConfig): Promise<void> {
  tokenManager = null;
  jiraClient = null;
  identityService = null;
  issueService = null;
  projectService = null;
  searchService = null;
  userService = null;
  boardService = null;
  sprintService = null;

  if (!config.baseUrl) {
    ctx.logger.warn("Jira plugin: base URL not configured");
    return;
  }

  // Resolve OAuth2 refresh token from state (stored by persister on rotation)
  let resolvedRefreshToken: string | undefined;
  if (config.authMethod === "oauth2" && config.oauthRefreshTokenRef) {
    const storedToken = await ctx.state.get({
      scopeKind: "instance",
      stateKey: "oauth-refresh-token",
    }) as string | null;
    if (storedToken) {
      resolvedRefreshToken = storedToken;
    } else {
      // First time — resolve from the secret reference
      try {
        resolvedRefreshToken = await ctx.secrets.resolve(config.oauthRefreshTokenRef);
      } catch {
        ctx.logger.warn("Could not resolve OAuth refresh token ref");
      }
    }
  }

  // Build the auth config from the plugin config
  const authConfig = buildAuthConfig(config, resolvedRefreshToken);
  if (!authConfig) {
    ctx.logger.warn("Jira plugin: authentication not configured");
    return;
  }

  // OAuth2 requires a persister to save rotated refresh tokens
  const persister = authConfig.method === "oauth2"
    ? async (newRefreshToken: string) => {
        await ctx.state.set(
          { scopeKind: "instance", stateKey: "oauth-refresh-token" },
          newRefreshToken,
        );
      }
    : undefined;

  tokenManager = createTokenManager(ctx, authConfig, persister);
  const defaultApiVersion = config.deploymentMode === "cloud" ? "cloud" as const : "server" as const;

  jiraClient = new JiraHttpClient({
    ctx,
    tokenManager,
    siteUrl: config.baseUrl,
    defaultApiVersion,
    serviceName: "jira",
  });

  identityService = new AgentIdentityService(config);
  issueService = new JiraIssueService(ctx, jiraClient, config);
  projectService = new JiraProjectService(ctx, jiraClient);
  searchService = new JiraSearchService(ctx, jiraClient);
  userService = new JiraUserService(ctx, jiraClient);

  if (config.enableBoards) {
    boardService = new JiraBoardService(ctx, jiraClient);
  }

  if (config.enableSprints) {
    sprintService = new JiraSprintService(ctx, jiraClient);
  }
}

// buildAuthConfig is sync — for OAuth2, the refresh token is resolved
// asynchronously in initServices before calling this.
function buildAuthConfig(config: JiraConfig, resolvedRefreshToken?: string): JiraAuthConfig | null {
  switch (config.authMethod) {
    case "oauth2":
      if (!config.oauthClientId) return null;
      return {
        method: "oauth2",
        siteUrl: config.baseUrl,
        clientId: config.oauthClientId,
        clientSecretRef: config.oauthClientSecretRef,
        refreshToken: resolvedRefreshToken ?? "",
        cloudId: config.cloudId,
      };
    case "api_token":
      if (!config.apiTokenRef || !config.apiUserEmail) return null;
      return {
        method: "api_token",
        siteUrl: config.baseUrl,
        email: config.apiUserEmail,
        apiTokenRef: config.apiTokenRef,
      };
    case "pat":
      if (!config.apiTokenRef) return null;
      return {
        method: "pat",
        siteUrl: config.baseUrl,
        patRef: config.apiTokenRef,
      };
    default:
      return null;
  }
}

// ── Event Handlers ───────────────────────────────────────────────────────────

async function registerEventHandlers(ctx: PluginContext): Promise<void> {
  ctx.events.on("issue.created", async (event: PluginEvent) => {
    if (!event.companyId) return;
    const config = await getConfig(ctx);

    if (!config.enableIssueSync || !issueService) return;

    const payload = event.payload as { issueId?: string };
    if (!payload.issueId) return;

    const issue = await ctx.issues.get(payload.issueId, event.companyId);
    if (!issue) return;

    try {
      const jiraIssue = await issueService.createIssue({
        projectKey: config.projectKey,
        summary: issue.title,
        issueType: "Task",
      });

      await ctx.entities.upsert({
        entityType: ENTITY_TYPES.jiraIssue,
        scopeKind: "issue",
        scopeId: issue.id,
        externalId: jiraIssue.id,
        title: jiraIssue.fields.summary,
        status: "synced",
        data: {
          jiraIssueId: jiraIssue.id,
          jiraIssueKey: jiraIssue.key,
          companyId: event.companyId,
          lastSyncedAt: new Date().toISOString(),
        },
      });

      await ctx.metrics.write("jira.issue.created", 1);
    } catch (err) {
      ctx.logger.error("Failed to create Jira issue for new Paperclip issue", {
        issueId: issue.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  ctx.events.on("issue.updated", async (event: PluginEvent) => {
    if (!event.companyId) return;
    const config = await getConfig(ctx);

    if (!config.enableIssueSync || !issueService) return;

    const payload = event.payload as { issueId?: string };
    if (!payload.issueId) return;

    const issue = await ctx.issues.get(payload.issueId, event.companyId);
    if (!issue) return;

    const entities = await ctx.entities.list({
      entityType: ENTITY_TYPES.jiraIssue,
      scopeKind: "issue",
      scopeId: issue.id,
      limit: 1,
      offset: 0,
    });

    if (entities.length === 0) return;

    const entityData = entities[0]!.data as { jiraIssueKey?: string };
    if (!entityData?.jiraIssueKey) return;

    try {
      await issueService.updateIssue(entityData.jiraIssueKey, {
        summary: issue.title,
      });
      await ctx.metrics.write("jira.issue.updated", 1);
    } catch (err) {
      ctx.logger.error("Failed to update Jira issue", {
        issueId: issue.id,
        jiraKey: entityData.jiraIssueKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

// ── Job Handlers ─────────────────────────────────────────────────────────────

async function registerJobs(ctx: PluginContext): Promise<void> {
  ctx.jobs.register(JOB_KEYS.jiraReconcile, async (_job: PluginJobContext) => {
    const config = await getConfig(ctx);
    if (!config.enableIssueSync || !issueService || !searchService) {
      ctx.logger.info("Jira reconciliation skipped — not enabled");
      return;
    }

    const reconciler = new ReconciliationService(ctx, issueService, searchService, config);

    // Paginate through all companies
    let totalSynced = 0;
    let totalErrors = 0;
    let offset = 0;
    const PAGE_SIZE = 50;
    let page;

    do {
      page = await ctx.companies.list({ limit: PAGE_SIZE, offset });
      for (const company of page) {
        const stats = await reconciler.reconcile(company.id);
        totalSynced += stats.synced;
        totalErrors += stats.errors;
      }
      offset += PAGE_SIZE;
    } while (page.length === PAGE_SIZE);

    await ctx.metrics.write("jira.reconcile.synced", totalSynced);
    await ctx.metrics.write("jira.reconcile.errors", totalErrors);
  });

  ctx.jobs.register(JOB_KEYS.tokenHealthCheck, async (_job: PluginJobContext) => {
    if (!tokenManager) return;

    const result = await tokenManager.healthCheck();
    await ctx.state.set(
      { scopeKind: "instance", stateKey: STATE_KEYS.syncHealth },
      { tokenHealthy: result.ok, checkedAt: new Date().toISOString() },
    );
    await ctx.metrics.write("jira.token.health", result.ok ? 1 : 0);

    if (!result.ok) {
      ctx.logger.error("Token health check failed — Jira credentials may be invalid", {
        error: result.error,
      });
    }
  });
}

// ── Data Handlers ────────────────────────────────────────────────────────────

async function registerDataHandlers(ctx: PluginContext): Promise<void> {
  ctx.data.register("sync-health", async () => {
    const config = await getConfig(ctx);
    const health = await ctx.state.get({
      scopeKind: "instance",
      stateKey: STATE_KEYS.syncHealth,
    });
    const lastReconcile = await ctx.state.get({
      scopeKind: "instance",
      stateKey: STATE_KEYS.lastReconcileAt,
    });

    const issueCount = (await ctx.entities.list({
      entityType: ENTITY_TYPES.jiraIssue,
      limit: 500,
      offset: 0,
    })).length;

    return {
      configured: Boolean(config.baseUrl),
      enableIssueSync: config.enableIssueSync,
      enableBoards: config.enableBoards,
      enableSprints: config.enableSprints,
      health,
      lastReconcile,
      trackedIssues: issueCount,
    };
  });

  ctx.data.register("issue-jira", async (params) => {
    const issueId = typeof params.issueId === "string" ? params.issueId : "";
    if (!issueId) return { jiraIssue: null };

    const entities = await ctx.entities.list({
      entityType: ENTITY_TYPES.jiraIssue,
      scopeKind: "issue",
      scopeId: issueId,
      limit: 1,
      offset: 0,
    });

    return { jiraIssue: entities[0] ?? null };
  });

  ctx.data.register("plugin-config", async () => {
    const config = await getConfig(ctx);
    return {
      deploymentMode: config.deploymentMode,
      baseUrl: config.baseUrl,
      authMethod: config.authMethod,
      hasCredentials: Boolean(
        config.authMethod === "oauth2"
          ? config.oauthClientId
          : config.apiTokenRef,
      ),
      enableIssueSync: config.enableIssueSync,
      enableBoards: config.enableBoards,
      enableSprints: config.enableSprints,
      projectKey: config.projectKey,
      syncJql: config.syncJql,
      conflictStrategy: config.conflictStrategy,
      statusMapping: config.statusMapping,
      reverseStatusMapping: config.reverseStatusMapping,
      hasWebhookSecret: Boolean(config.webhookSecretRef),
      agentIdentityMap: config.agentIdentityMap,
      defaultServiceAccountId: config.defaultServiceAccountId,
    };
  });

  ctx.data.register("jira-projects", async () => {
    if (!projectService) return { error: "Jira not connected" };
    try {
      const projects = await projectService.listProjects(100);
      return {
        items: projects.map((p) => ({ id: p.id, key: p.key, name: p.name })),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ctx.data.register("jira-statuses", async (params) => {
    if (!projectService) return { error: "Jira not connected" };
    const projectKey = typeof params.projectKey === "string" ? params.projectKey : "";
    if (!projectKey) return { error: "projectKey is required" };
    try {
      const statuses = await projectService.getStatuses(projectKey);
      return {
        items: statuses.map((s) => ({
          id: s.id,
          name: s.name,
          categoryKey: s.statusCategory.key,
        })),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ctx.data.register("paperclip-agents", async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    if (!companyId) return { items: [] };
    try {
      const agents = await ctx.agents.list({ companyId, limit: 100, offset: 0 });
      return {
        items: agents.map((a) => ({
          id: a.id,
          name: `${a.name}${a.title ? ` — ${a.title}` : ""} (${a.role})`,
        })),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}

// ── Action Handlers ──────────────────────────────────────────────────────────

async function registerActionHandlers(ctx: PluginContext): Promise<void> {
  ctx.actions.register("test-connection", async () => {
    if (!tokenManager) {
      return { ok: false, error: "Jira credentials not configured" };
    }
    const result = await tokenManager.healthCheck();
    return { ok: result.ok, error: result.ok ? null : result.error ?? "Failed to authenticate" };
  });

  ctx.actions.register("trigger-reconcile", async () => {
    const config = await getConfig(ctx);
    if (!config.enableIssueSync || !issueService || !searchService) {
      return { ok: false, error: "Issue sync not enabled" };
    }
    const reconciler = new ReconciliationService(ctx, issueService, searchService, config);

    const allStats = [];
    let offset = 0;
    const PAGE_SIZE = 50;
    let page;

    do {
      page = await ctx.companies.list({ limit: PAGE_SIZE, offset });
      for (const company of page) {
        allStats.push(await reconciler.reconcile(company.id));
      }
      offset += PAGE_SIZE;
    } while (page.length === PAGE_SIZE);

    return { ok: true, stats: allStats };
  });

  ctx.actions.register("save-config", async (params) => {
    const incoming = params as Record<string, unknown>;

    // Whitelist accepted config fields to prevent injection of unexpected keys
    const ALLOWED_KEYS = new Set([
      "deploymentMode", "baseUrl", "authMethod",
      "cloudId", "oauthClientId", "oauthClientSecretRef", "oauthRefreshTokenRef",
      "apiTokenRef", "apiUserEmail",
      "enableIssueSync", "enableBoards", "enableSprints",
      "projectKey", "syncJql", "conflictStrategy",
      "statusMapping", "reverseStatusMapping",
      "webhookSecretRef",
      "agentIdentityMap", "defaultServiceAccountId",
    ]);

    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(incoming)) {
      if (ALLOWED_KEYS.has(key)) {
        sanitized[key] = incoming[key];
      }
    }

    // Validate required fields
    const errors: string[] = [];
    if (sanitized.baseUrl && typeof sanitized.baseUrl !== "string") {
      errors.push("baseUrl must be a string");
    }
    if (sanitized.deploymentMode && !["cloud", "server", "datacenter"].includes(sanitized.deploymentMode as string)) {
      errors.push("deploymentMode must be cloud, server, or datacenter");
    }
    if (sanitized.authMethod && !["oauth2", "api_token", "pat"].includes(sanitized.authMethod as string)) {
      errors.push("authMethod must be oauth2, api_token, or pat");
    }
    if (sanitized.conflictStrategy && !["last_write_wins", "paperclip_wins", "jira_wins"].includes(sanitized.conflictStrategy as string)) {
      errors.push("conflictStrategy must be last_write_wins, paperclip_wins, or jira_wins");
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }

    const merged = { ...DEFAULT_CONFIG, ...sanitized } as JiraConfig;

    await ctx.state.set({ scopeKind: "instance", stateKey: "plugin-config" }, merged);
    await initServices(ctx, merged);

    return { ok: true };
  });
}

// ── Tool Handlers ────────────────────────────────────────────────────────────

async function registerToolHandlers(ctx: PluginContext): Promise<void> {
  ctx.tools.register(TOOL_NAMES.jiraSearch, {
    displayName: "Jira Search",
    description: "Search Jira issues using JQL.",
    parametersSchema: { type: "object", properties: { jql: { type: "string" } }, required: ["jql"] },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!searchService) return { error: "Jira not connected" };
    return handleJiraSearch(params, runCtx, searchService);
  });

  ctx.tools.register(TOOL_NAMES.jiraGetIssue, {
    displayName: "Jira Get Issue",
    description: "Get a Jira issue by ID or key.",
    parametersSchema: { type: "object", properties: { issueIdOrKey: { type: "string" } }, required: ["issueIdOrKey"] },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!issueService) return { error: "Jira not connected" };
    return handleJiraGetIssue(params, runCtx, issueService);
  });

  ctx.tools.register(TOOL_NAMES.jiraCreateIssue, {
    displayName: "Jira Create Issue",
    description: "Create a new Jira issue.",
    parametersSchema: { type: "object", properties: { projectKey: { type: "string" }, summary: { type: "string" }, issueType: { type: "string" } }, required: ["projectKey", "summary", "issueType"] },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!issueService) return { error: "Jira not connected" };
    return handleJiraCreateIssue(params, runCtx, issueService);
  });

  ctx.tools.register(TOOL_NAMES.jiraUpdateIssue, {
    displayName: "Jira Update Issue",
    description: "Update fields on an existing Jira issue.",
    parametersSchema: { type: "object", properties: { issueIdOrKey: { type: "string" } }, required: ["issueIdOrKey"] },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!issueService) return { error: "Jira not connected" };
    return handleJiraUpdateIssue(params, runCtx, issueService);
  });

  ctx.tools.register(TOOL_NAMES.jiraTransitionIssue, {
    displayName: "Jira Transition Issue",
    description: "Execute a workflow transition.",
    parametersSchema: { type: "object", properties: { issueIdOrKey: { type: "string" }, transitionId: { type: "string" } }, required: ["issueIdOrKey", "transitionId"] },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!issueService) return { error: "Jira not connected" };
    return handleJiraTransitionIssue(params, runCtx, issueService);
  });

  ctx.tools.register(TOOL_NAMES.jiraAddComment, {
    displayName: "Jira Add Comment",
    description: "Add a comment to a Jira issue.",
    parametersSchema: { type: "object", properties: { issueIdOrKey: { type: "string" }, body: { type: "string" } }, required: ["issueIdOrKey", "body"] },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!issueService) return { error: "Jira not connected" };
    return handleJiraAddComment(params, runCtx, issueService);
  });

  ctx.tools.register(TOOL_NAMES.jiraListProjects, {
    displayName: "Jira List Projects",
    description: "List Jira projects.",
    parametersSchema: { type: "object", properties: {} },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!projectService) return { error: "Jira not connected" };
    return handleJiraListProjects(params, runCtx, projectService);
  });

  ctx.tools.register(TOOL_NAMES.jiraGetProject, {
    displayName: "Jira Get Project",
    description: "Get a Jira project by ID or key.",
    parametersSchema: { type: "object", properties: { projectIdOrKey: { type: "string" } }, required: ["projectIdOrKey"] },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!projectService) return { error: "Jira not connected" };
    return handleJiraGetProject(params, runCtx, projectService);
  });

  ctx.tools.register(TOOL_NAMES.jiraListBoards, {
    displayName: "Jira List Boards",
    description: "List Jira boards.",
    parametersSchema: { type: "object", properties: {} },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!boardService) return { error: "Boards not enabled" };
    return handleJiraListBoards(params, runCtx, boardService);
  });

  ctx.tools.register(TOOL_NAMES.jiraGetSprint, {
    displayName: "Jira Get Sprints",
    description: "List sprints for a board.",
    parametersSchema: { type: "object", properties: { boardId: { type: "number" } }, required: ["boardId"] },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!sprintService) return { error: "Sprints not enabled" };
    return handleJiraGetSprint(params, runCtx, sprintService);
  });

  ctx.tools.register(TOOL_NAMES.jiraMoveToSprint, {
    displayName: "Jira Move to Sprint",
    description: "Move issues to a sprint.",
    parametersSchema: { type: "object", properties: { sprintId: { type: "number" }, issueIds: { type: "array", items: { type: "string" } } }, required: ["sprintId", "issueIds"] },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!sprintService) return { error: "Sprints not enabled" };
    return handleJiraMoveToSprint(params, runCtx, sprintService);
  });

  ctx.tools.register(TOOL_NAMES.jiraAssignIssue, {
    displayName: "Jira Assign Issue",
    description: "Assign or unassign a Jira issue.",
    parametersSchema: { type: "object", properties: { issueIdOrKey: { type: "string" } }, required: ["issueIdOrKey"] },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!issueService) return { error: "Jira not connected" };
    return handleJiraAssignIssue(params, runCtx, issueService);
  });

  ctx.tools.register(TOOL_NAMES.jiraLinkIssues, {
    displayName: "Jira Link Issues",
    description: "Create a link between two issues.",
    parametersSchema: { type: "object", properties: { inwardIssue: { type: "string" }, outwardIssue: { type: "string" }, linkType: { type: "string" } }, required: ["inwardIssue", "outwardIssue", "linkType"] },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!issueService) return { error: "Jira not connected" };
    return handleJiraLinkIssues(params, runCtx, issueService);
  });

  ctx.tools.register(TOOL_NAMES.jiraListTransitions, {
    displayName: "Jira List Transitions",
    description: "List available transitions for an issue.",
    parametersSchema: { type: "object", properties: { issueIdOrKey: { type: "string" } }, required: ["issueIdOrKey"] },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!issueService) return { error: "Jira not connected" };
    return handleJiraListTransitions(params, runCtx, issueService);
  });

  ctx.tools.register(TOOL_NAMES.jiraGetUser, {
    displayName: "Jira Get User",
    description: "Look up a Jira user.",
    parametersSchema: { type: "object", properties: { accountId: { type: "string" }, emailAddress: { type: "string" } } },
  }, async (params, runCtx): Promise<ToolResult> => {
    if (!userService) return { error: "Jira not connected" };
    return handleJiraGetUser(params, runCtx, userService);
  });
}

// ── Plugin Definition ────────────────────────────────────────────────────────

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    pluginCtx = ctx;
    const config = await getConfig(ctx);

    initServices(ctx, config);

    await registerEventHandlers(ctx);
    await registerJobs(ctx);
    await registerDataHandlers(ctx);
    await registerActionHandlers(ctx);
    await registerToolHandlers(ctx);

    ctx.logger.info("Jira plugin setup complete", {
      issueSync: config.enableIssueSync,
      boards: config.enableBoards,
      sprints: config.enableSprints,
      agentMappings: Object.keys(config.agentIdentityMap).length,
    });
  },

  async onHealth(): Promise<PluginHealthDiagnostics> {
    const ctx = pluginCtx;
    if (!ctx) return { status: "error", message: "Plugin not initialized" };

    const config = await getConfig(ctx);
    if (!config.baseUrl) {
      return { status: "degraded", message: "Jira base URL not configured" };
    }

    const health = await ctx.state.get({
      scopeKind: "instance",
      stateKey: STATE_KEYS.syncHealth,
    }) as { tokenHealthy?: boolean } | null;

    if (health && !health.tokenHealthy) {
      return { status: "error", message: "Jira token health check failed" };
    }

    return {
      status: "ok",
      message: "Jira plugin ready",
      details: {
        issueSyncEnabled: config.enableIssueSync,
        boardsEnabled: config.enableBoards,
        sprintsEnabled: config.enableSprints,
      },
    };
  },

  async onConfigChanged() {
    if (!pluginCtx) return;
    const config = await getConfig(pluginCtx);
    await initServices(pluginCtx, config);
    pluginCtx.logger.info("Jira config updated — services reinitialized");
  },

  async onWebhook(input: PluginWebhookInput) {
    if (!pluginCtx) throw new Error("Plugin not initialized");

    if (input.endpointKey === WEBHOOK_KEYS.jiraIssueWebhook) {
      const config = await getConfig(pluginCtx);
      await handleJiraIssueWebhook(pluginCtx, input, config);
      return;
    }

    throw new Error(`Unsupported webhook endpoint: ${input.endpointKey}`);
  },

  async onShutdown() {
    pluginCtx?.logger.info("Jira plugin shutting down");
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
