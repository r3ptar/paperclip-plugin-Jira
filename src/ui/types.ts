import type { PaperclipIssueStatus } from "../constants.js";

export type SyncHealthData = {
  configured: boolean;
  enableIssueSync: boolean;
  enableBoards: boolean;
  enableSprints: boolean;
  health: { tokenHealthy?: boolean; checkedAt?: string } | null;
  lastReconcile: string | null;
  trackedIssues: number;
};

export type PluginConfigData = {
  deploymentMode: string;
  baseUrl: string;
  authMethod: string;
  hasCredentials: boolean;
  enableIssueSync: boolean;
  enableBoards: boolean;
  enableSprints: boolean;
  projectKey: string;
  syncJql: string;
  conflictStrategy: string;
  statusMapping: Record<string, string>;
  reverseStatusMapping: Record<string, string>;
  hasWebhookSecret: boolean;
  agentIdentityMap: Record<string, string>;
  defaultServiceAccountId: string;
};

export type ConfigFormState = {
  deploymentMode: string;
  baseUrl: string;
  authMethod: string;
  cloudId: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthClientSecretRef: string;
  oauthRefreshTokenRef: string;
  apiTokenRef: string;
  apiUserEmail: string;
  enableIssueSync: boolean;
  enableBoards: boolean;
  enableSprints: boolean;
  projectKey: string;
  syncJql: string;
  conflictStrategy: string;
  statusMapping: Record<PaperclipIssueStatus, string>;
  reverseStatusMapping: Record<string, string>;
  webhookSecretRef: string;
  agentIdentityMap: Record<string, string>;
  defaultServiceAccountId: string;
};

export type SaveConfigResult = {
  ok: boolean;
  errors?: string[];
  warnings?: string[];
};

export type TestConnectionResult = {
  ok: boolean;
  error?: string | null;
};

export type IssueJiraData = {
  jiraIssue: {
    id: string;
    title: string | null;
    status: string | null;
    externalId: string;
    data: {
      jiraIssueId?: string;
      jiraIssueKey?: string;
      lastSyncedAt?: string;
      jiraStatus?: string;
      assigneeId?: string;
    };
  } | null;
};

export type JiraProjectItem = {
  id: string;
  key: string;
  name: string;
};

export type JiraStatusItem = {
  id: string;
  name: string;
  categoryKey: string;
};
