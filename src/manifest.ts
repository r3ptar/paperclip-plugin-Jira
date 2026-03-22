import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  EXPORT_NAMES,
  JOB_KEYS,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
  TOOL_NAMES,
  WEBHOOK_KEYS,
} from "./constants.js";
import { TOOL_SCHEMAS } from "./tool-schemas.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Jira",
  description:
    "Connects Paperclip with Jira for bidirectional issue sync, workflow transitions, boards, sprints, and agent-driven issue management. Supports Jira Cloud, Server, and Data Center.",
  author: "Paperclip",
  categories: ["connector", "automation"],

  capabilities: [
    "companies.read",
    "projects.read",
    "issues.read",
    "issues.create",
    "issues.update",
    "agents.read",
    "activity.log.write",
    "metrics.write",
    "plugin.state.read",
    "plugin.state.write",
    "events.subscribe",
    "events.emit",
    "jobs.schedule",
    "webhooks.receive",
    "http.outbound",
    "secrets.read-ref",
    "agent.tools.register",
    "instance.settings.register",
    "ui.detailTab.register",
    "ui.dashboardWidget.register",
  ],

  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },

  instanceConfigSchema: {
    type: "object",
    properties: {
      deploymentMode: {
        type: "string",
        title: "Deployment Mode",
        enum: ["cloud", "server", "datacenter"],
        default: DEFAULT_CONFIG.deploymentMode,
      },
      baseUrl: {
        type: "string",
        title: "Jira Base URL",
        description: "e.g. https://myteam.atlassian.net",
      },
      authMethod: {
        type: "string",
        title: "Authentication Method",
        enum: ["oauth2", "api_token", "pat"],
        default: DEFAULT_CONFIG.authMethod,
      },
      cloudId: {
        type: "string",
        title: "Atlassian Cloud ID",
      },
      oauthClientId: {
        type: "string",
        title: "OAuth Client ID",
      },
      oauthClientSecretRef: {
        type: "string",
        format: "secret-ref",
        title: "OAuth Client Secret",
      },
      oauthRefreshTokenRef: {
        type: "string",
        format: "secret-ref",
        title: "OAuth Refresh Token",
      },
      apiTokenRef: {
        type: "string",
        format: "secret-ref",
        title: "API Token / PAT",
      },
      apiUserEmail: {
        type: "string",
        title: "API User Email",
        description: "Email for Basic auth (API Token method)",
      },
      enableIssueSync: {
        type: "boolean",
        title: "Enable Issue Sync",
        default: DEFAULT_CONFIG.enableIssueSync,
      },
      enableBoards: {
        type: "boolean",
        title: "Enable Boards",
        default: DEFAULT_CONFIG.enableBoards,
      },
      enableSprints: {
        type: "boolean",
        title: "Enable Sprints",
        default: DEFAULT_CONFIG.enableSprints,
      },
      projectKey: {
        type: "string",
        title: "Jira Project Key",
        description: "The project to sync (e.g. PROJ)",
      },
      syncJql: {
        type: "string",
        title: "Sync JQL Filter",
        description: 'JQL query defining which issues to sync (e.g. "project = PROJ AND type != Epic")',
      },
      conflictStrategy: {
        type: "string",
        title: "Conflict Resolution Strategy",
        enum: ["last_write_wins", "paperclip_wins", "jira_wins"],
        default: DEFAULT_CONFIG.conflictStrategy,
      },
      statusMapping: {
        type: "object",
        title: "Status Mapping (Paperclip -> Jira)",
        description: "Maps Paperclip statuses to Jira status names",
        additionalProperties: { type: "string" },
        default: DEFAULT_CONFIG.statusMapping,
      },
      reverseStatusMapping: {
        type: "object",
        title: "Reverse Status Mapping (Jira -> Paperclip)",
        description: "Maps Jira status names to Paperclip statuses",
        additionalProperties: { type: "string" },
        default: DEFAULT_CONFIG.reverseStatusMapping,
      },
      webhookSecretRef: {
        type: "string",
        format: "secret-ref",
        title: "Webhook Secret",
      },
      agentIdentityMap: {
        type: "object",
        title: "Agent Identity Map",
        description: "Maps Paperclip agent IDs to Jira account IDs",
        additionalProperties: { type: "string" },
        default: DEFAULT_CONFIG.agentIdentityMap,
      },
      defaultServiceAccountId: {
        type: "string",
        title: "Default Service Account ID",
        description: "Fallback Jira account ID for unmapped agents",
      },
    },
  },

  jobs: [
    {
      jobKey: JOB_KEYS.jiraReconcile,
      displayName: "Jira Reconciliation",
      description: "Full bidirectional sync between Paperclip issues and Jira issues",
      schedule: "*/15 * * * *",
    },
    {
      jobKey: JOB_KEYS.tokenHealthCheck,
      displayName: "Token Health Check",
      description: "Verifies Jira authentication credentials are functional",
      schedule: "*/30 * * * *",
    },
  ],

  webhooks: [
    {
      endpointKey: WEBHOOK_KEYS.jiraIssueWebhook,
      displayName: "Jira Issue Webhook",
      description: "Receives Jira webhook events for issue created, updated, and deleted",
    },
  ],

  tools: [
    {
      name: TOOL_NAMES.jiraSearch,
      displayName: "Jira Search",
      description: "Search Jira issues using JQL. Returns matching issues with key, summary, and status.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraSearch],
    },
    {
      name: TOOL_NAMES.jiraGetIssue,
      displayName: "Jira Get Issue",
      description: "Get a Jira issue by ID or key. Returns issue details including status, assignee, and fields.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraGetIssue],
    },
    {
      name: TOOL_NAMES.jiraCreateIssue,
      displayName: "Jira Create Issue",
      description: "Create a new Jira issue with summary, type, and optional fields.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraCreateIssue],
    },
    {
      name: TOOL_NAMES.jiraUpdateIssue,
      displayName: "Jira Update Issue",
      description: "Update fields on an existing Jira issue.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraUpdateIssue],
    },
    {
      name: TOOL_NAMES.jiraTransitionIssue,
      displayName: "Jira Transition Issue",
      description: "Execute a workflow transition on a Jira issue. Use jira-list-transitions to find available transition IDs.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraTransitionIssue],
    },
    {
      name: TOOL_NAMES.jiraAddComment,
      displayName: "Jira Add Comment",
      description: "Add a comment to a Jira issue.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraAddComment],
    },
    {
      name: TOOL_NAMES.jiraListProjects,
      displayName: "Jira List Projects",
      description: "List Jira projects visible to the authenticated user.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraListProjects],
    },
    {
      name: TOOL_NAMES.jiraGetProject,
      displayName: "Jira Get Project",
      description: "Get details of a Jira project by ID or key.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraGetProject],
    },
    {
      name: TOOL_NAMES.jiraListBoards,
      displayName: "Jira List Boards",
      description: "List Jira boards, optionally filtered by project or type.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraListBoards],
    },
    {
      name: TOOL_NAMES.jiraGetSprint,
      displayName: "Jira Get Sprints",
      description: "List sprints for a board, optionally filtered by state.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraGetSprint],
    },
    {
      name: TOOL_NAMES.jiraMoveToSprint,
      displayName: "Jira Move to Sprint",
      description: "Move one or more issues into a sprint.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraMoveToSprint],
    },
    {
      name: TOOL_NAMES.jiraAssignIssue,
      displayName: "Jira Assign Issue",
      description: "Assign or unassign a Jira issue. Omit accountId to unassign.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraAssignIssue],
    },
    {
      name: TOOL_NAMES.jiraLinkIssues,
      displayName: "Jira Link Issues",
      description: "Create a link between two Jira issues.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraLinkIssues],
    },
    {
      name: TOOL_NAMES.jiraListTransitions,
      displayName: "Jira List Transitions",
      description: "List available workflow transitions for an issue. Use this before transitioning an issue.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraListTransitions],
    },
    {
      name: TOOL_NAMES.jiraGetUser,
      displayName: "Jira Get User",
      description: "Look up a Jira user by account ID or email address.",
      parametersSchema: TOOL_SCHEMAS[TOOL_NAMES.jiraGetUser],
    },
  ],

  ui: {
    slots: [
      {
        type: "settingsPage",
        id: SLOT_IDS.settingsPage,
        displayName: "Jira Settings",
        exportName: EXPORT_NAMES.settingsPage,
      },
      {
        type: "dashboardWidget",
        id: SLOT_IDS.dashboardWidget,
        displayName: "Jira Sync Health",
        exportName: EXPORT_NAMES.dashboardWidget,
      },
      {
        type: "detailTab",
        id: SLOT_IDS.issueTab,
        displayName: "Jira",
        exportName: EXPORT_NAMES.issueTab,
        entityTypes: ["issue"],
      },
      {
        type: "detailTab",
        id: SLOT_IDS.projectTab,
        displayName: "Jira Project",
        exportName: EXPORT_NAMES.projectTab,
        entityTypes: ["project"],
      },
    ],
  },
};

export default manifest;
