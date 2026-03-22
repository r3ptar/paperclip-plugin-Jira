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
      parametersSchema: {
        type: "object",
        properties: {
          jql: { type: "string", description: "JQL query string" },
          maxResults: { type: "number", description: "Maximum results (default: 50)" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to include" },
        },
        required: ["jql"],
      },
    },
    {
      name: TOOL_NAMES.jiraGetIssue,
      displayName: "Jira Get Issue",
      description: "Get a Jira issue by ID or key. Returns issue details including status, assignee, and fields.",
      parametersSchema: {
        type: "object",
        properties: {
          issueIdOrKey: { type: "string", description: "Issue ID or key (e.g. PROJ-123)" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to include" },
        },
        required: ["issueIdOrKey"],
      },
    },
    {
      name: TOOL_NAMES.jiraCreateIssue,
      displayName: "Jira Create Issue",
      description: "Create a new Jira issue with summary, type, and optional fields.",
      parametersSchema: {
        type: "object",
        properties: {
          projectKey: { type: "string", description: "Project key (e.g. PROJ)" },
          summary: { type: "string", description: "Issue title" },
          issueType: { type: "string", description: "Issue type name (e.g. Task, Bug, Story)" },
          description: { type: "string", description: "Issue description" },
          priority: { type: "string", description: "Priority name (e.g. High, Medium, Low)" },
          labels: { type: "array", items: { type: "string" }, description: "Labels" },
          assigneeAccountId: { type: "string", description: "Jira account ID to assign" },
        },
        required: ["projectKey", "summary", "issueType"],
      },
    },
    {
      name: TOOL_NAMES.jiraUpdateIssue,
      displayName: "Jira Update Issue",
      description: "Update fields on an existing Jira issue.",
      parametersSchema: {
        type: "object",
        properties: {
          issueIdOrKey: { type: "string", description: "Issue ID or key" },
          summary: { type: "string", description: "New summary" },
          description: { type: "string", description: "New description" },
          priority: { type: "string", description: "New priority name" },
          labels: { type: "array", items: { type: "string" }, description: "New labels" },
        },
        required: ["issueIdOrKey"],
      },
    },
    {
      name: TOOL_NAMES.jiraTransitionIssue,
      displayName: "Jira Transition Issue",
      description: "Execute a workflow transition on a Jira issue. Use jira-list-transitions to find available transition IDs.",
      parametersSchema: {
        type: "object",
        properties: {
          issueIdOrKey: { type: "string", description: "Issue ID or key" },
          transitionId: { type: "string", description: "Transition ID (from jira-list-transitions)" },
          comment: { type: "string", description: "Optional comment during transition" },
          resolution: { type: "string", description: "Resolution name (e.g. Done, Won't Do)" },
        },
        required: ["issueIdOrKey", "transitionId"],
      },
    },
    {
      name: TOOL_NAMES.jiraAddComment,
      displayName: "Jira Add Comment",
      description: "Add a comment to a Jira issue.",
      parametersSchema: {
        type: "object",
        properties: {
          issueIdOrKey: { type: "string", description: "Issue ID or key" },
          body: { type: "string", description: "Comment text" },
        },
        required: ["issueIdOrKey", "body"],
      },
    },
    {
      name: TOOL_NAMES.jiraListProjects,
      displayName: "Jira List Projects",
      description: "List Jira projects visible to the authenticated user.",
      parametersSchema: {
        type: "object",
        properties: {
          maxResults: { type: "number", description: "Maximum results (default: 50)" },
        },
      },
    },
    {
      name: TOOL_NAMES.jiraGetProject,
      displayName: "Jira Get Project",
      description: "Get details of a Jira project by ID or key.",
      parametersSchema: {
        type: "object",
        properties: {
          projectIdOrKey: { type: "string", description: "Project ID or key" },
        },
        required: ["projectIdOrKey"],
      },
    },
    {
      name: TOOL_NAMES.jiraListBoards,
      displayName: "Jira List Boards",
      description: "List Jira boards, optionally filtered by project or type.",
      parametersSchema: {
        type: "object",
        properties: {
          projectKeyOrId: { type: "string", description: "Filter by project" },
          type: { type: "string", enum: ["scrum", "kanban", "simple"], description: "Board type filter" },
        },
      },
    },
    {
      name: TOOL_NAMES.jiraGetSprint,
      displayName: "Jira Get Sprints",
      description: "List sprints for a board, optionally filtered by state.",
      parametersSchema: {
        type: "object",
        properties: {
          boardId: { type: "number", description: "Board ID" },
          state: { type: "string", enum: ["active", "closed", "future"], description: "Sprint state filter" },
        },
        required: ["boardId"],
      },
    },
    {
      name: TOOL_NAMES.jiraMoveToSprint,
      displayName: "Jira Move to Sprint",
      description: "Move one or more issues into a sprint.",
      parametersSchema: {
        type: "object",
        properties: {
          sprintId: { type: "number", description: "Target sprint ID" },
          issueIds: { type: "array", items: { type: "string" }, description: "Issue IDs or keys to move" },
        },
        required: ["sprintId", "issueIds"],
      },
    },
    {
      name: TOOL_NAMES.jiraAssignIssue,
      displayName: "Jira Assign Issue",
      description: "Assign or unassign a Jira issue. Omit accountId to unassign.",
      parametersSchema: {
        type: "object",
        properties: {
          issueIdOrKey: { type: "string", description: "Issue ID or key" },
          accountId: { type: "string", description: "Jira account ID (omit to unassign)" },
        },
        required: ["issueIdOrKey"],
      },
    },
    {
      name: TOOL_NAMES.jiraLinkIssues,
      displayName: "Jira Link Issues",
      description: "Create a link between two Jira issues.",
      parametersSchema: {
        type: "object",
        properties: {
          inwardIssue: { type: "string", description: "Inward issue key (e.g. PROJ-1)" },
          outwardIssue: { type: "string", description: "Outward issue key (e.g. PROJ-2)" },
          linkType: { type: "string", description: "Link type (e.g. Blocks, Relates, Clones)" },
        },
        required: ["inwardIssue", "outwardIssue", "linkType"],
      },
    },
    {
      name: TOOL_NAMES.jiraListTransitions,
      displayName: "Jira List Transitions",
      description: "List available workflow transitions for an issue. Use this before transitioning an issue.",
      parametersSchema: {
        type: "object",
        properties: {
          issueIdOrKey: { type: "string", description: "Issue ID or key" },
        },
        required: ["issueIdOrKey"],
      },
    },
    {
      name: TOOL_NAMES.jiraGetUser,
      displayName: "Jira Get User",
      description: "Look up a Jira user by account ID or email address.",
      parametersSchema: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Jira account ID" },
          emailAddress: { type: "string", description: "Email address to search" },
        },
      },
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
