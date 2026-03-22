// ─── Plugin Identity ─────────────────────────────────────────────────────────

export const PLUGIN_ID = "paperclip.jira";
export const PLUGIN_VERSION = "0.1.0";

// ─── UI Slot IDs ─────────────────────────────────────────────────────────────

export const SLOT_IDS = {
  settingsPage: "jira-settings-page",
  dashboardWidget: "jira-dashboard-widget",
  issueTab: "jira-issue-tab",
  projectTab: "jira-project-tab",
} as const;

// ─── UI Export Names ─────────────────────────────────────────────────────────

export const EXPORT_NAMES = {
  settingsPage: "JiraSettingsPage",
  dashboardWidget: "JiraDashboardWidget",
  issueTab: "JiraIssueTab",
  projectTab: "JiraProjectTab",
} as const;

// ─── Job Keys ────────────────────────────────────────────────────────────────

export const JOB_KEYS = {
  jiraReconcile: "jira-reconcile",
  tokenHealthCheck: "token-health-check",
} as const;

// ─── Webhook Keys ────────────────────────────────────────────────────────────

export const WEBHOOK_KEYS = {
  jiraIssueWebhook: "jira-issue-webhook",
} as const;

// ─── Tool Names ──────────────────────────────────────────────────────────────

export const TOOL_NAMES = {
  jiraSearch: "jira-search",
  jiraGetIssue: "jira-get-issue",
  jiraCreateIssue: "jira-create-issue",
  jiraUpdateIssue: "jira-update-issue",
  jiraTransitionIssue: "jira-transition-issue",
  jiraAddComment: "jira-add-comment",
  jiraListProjects: "jira-list-projects",
  jiraGetProject: "jira-get-project",
  jiraListBoards: "jira-list-boards",
  jiraGetSprint: "jira-get-sprint",
  jiraMoveToSprint: "jira-move-to-sprint",
  jiraAssignIssue: "jira-assign-issue",
  jiraLinkIssues: "jira-link-issues",
  jiraListTransitions: "jira-list-transitions",
  jiraGetUser: "jira-get-user",
} as const;

// ─── Entity Types ────────────────────────────────────────────────────────────

export const ENTITY_TYPES = {
  jiraIssue: "jira-issue",
} as const;

// ─── State Keys ──────────────────────────────────────────────────────────────

export const STATE_KEYS = {
  lastReconcileAt: "last-reconcile-at",
  syncHealth: "sync-health",
} as const;

// ─── Shared Domain Types ─────────────────────────────────────────────────────

export type PaperclipIssueStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked"
  | "cancelled";

export type ConflictStrategy = "last_write_wins" | "paperclip_wins" | "jira_wins";

// ─── Plugin Config ───────────────────────────────────────────────────────────

export type JiraConfig = {
  // Connection
  deploymentMode: "cloud" | "server" | "datacenter";
  baseUrl: string;
  authMethod: "oauth2" | "api_token" | "pat";

  // OAuth 2.0 3LO (Cloud)
  cloudId: string;
  oauthClientId: string;
  oauthClientSecretRef: string;
  oauthRefreshTokenRef: string;

  // API Token (Cloud) / PAT (Server/DC)
  apiTokenRef: string;
  apiUserEmail: string;

  // Feature toggles
  enableIssueSync: boolean;
  enableBoards: boolean;
  enableSprints: boolean;

  // Sync
  projectKey: string;
  syncJql: string;
  conflictStrategy: ConflictStrategy;

  // Status mapping (configurable -- Jira workflows vary per project)
  statusMapping: Record<PaperclipIssueStatus, string>;
  reverseStatusMapping: Record<string, PaperclipIssueStatus>;

  // Webhook
  webhookSecretRef: string;

  // Agentic Identity
  agentIdentityMap: Record<string, string>;
  defaultServiceAccountId: string;
};

// ─── Default Config ──────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: JiraConfig = {
  // Connection
  deploymentMode: "cloud",
  baseUrl: "",
  authMethod: "oauth2",

  // OAuth 2.0 3LO
  cloudId: "",
  oauthClientId: "",
  oauthClientSecretRef: "",
  oauthRefreshTokenRef: "",

  // API Token / PAT
  apiTokenRef: "",
  apiUserEmail: "",

  // Feature toggles
  enableIssueSync: false,
  enableBoards: false,
  enableSprints: false,

  // Sync
  projectKey: "",
  syncJql: "",
  conflictStrategy: "last_write_wins",

  // Status mapping
  statusMapping: {
    backlog: "",
    todo: "",
    in_progress: "",
    in_review: "",
    done: "",
    blocked: "",
    cancelled: "",
  },
  reverseStatusMapping: {},

  // Webhook
  webhookSecretRef: "",

  // Agentic Identity
  agentIdentityMap: {},
  defaultServiceAccountId: "",
};
