import { TOOL_NAMES } from "./constants.js";

export type JsonSchema = {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
};

export const TOOL_SCHEMAS: Record<string, JsonSchema> = {
  [TOOL_NAMES.jiraSearch]: {
    type: "object",
    properties: {
      jql: { type: "string", description: "JQL query string" },
      maxResults: { type: "number", description: "Maximum results (default: 50)" },
      fields: { type: "array", items: { type: "string" }, description: "Fields to include" },
    },
    required: ["jql"],
  },

  [TOOL_NAMES.jiraGetIssue]: {
    type: "object",
    properties: {
      issueIdOrKey: { type: "string", description: "Issue ID or key (e.g. PROJ-123)" },
      fields: { type: "array", items: { type: "string" }, description: "Fields to include" },
    },
    required: ["issueIdOrKey"],
  },

  [TOOL_NAMES.jiraCreateIssue]: {
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

  [TOOL_NAMES.jiraUpdateIssue]: {
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

  [TOOL_NAMES.jiraTransitionIssue]: {
    type: "object",
    properties: {
      issueIdOrKey: { type: "string", description: "Issue ID or key" },
      transitionId: { type: "string", description: "Transition ID (from jira-list-transitions)" },
      comment: { type: "string", description: "Optional comment during transition" },
      resolution: { type: "string", description: "Resolution name (e.g. Done, Won't Do)" },
    },
    required: ["issueIdOrKey", "transitionId"],
  },

  [TOOL_NAMES.jiraAddComment]: {
    type: "object",
    properties: {
      issueIdOrKey: { type: "string", description: "Issue ID or key" },
      body: { type: "string", description: "Comment text" },
    },
    required: ["issueIdOrKey", "body"],
  },

  [TOOL_NAMES.jiraListProjects]: {
    type: "object",
    properties: {
      maxResults: { type: "number", description: "Maximum results (default: 50)" },
    },
  },

  [TOOL_NAMES.jiraGetProject]: {
    type: "object",
    properties: {
      projectIdOrKey: { type: "string", description: "Project ID or key" },
    },
    required: ["projectIdOrKey"],
  },

  [TOOL_NAMES.jiraListBoards]: {
    type: "object",
    properties: {
      projectKeyOrId: { type: "string", description: "Filter by project" },
      type: { type: "string", enum: ["scrum", "kanban", "simple"], description: "Board type filter" },
    },
  },

  [TOOL_NAMES.jiraGetSprint]: {
    type: "object",
    properties: {
      boardId: { type: "number", description: "Board ID" },
      state: { type: "string", enum: ["active", "closed", "future"], description: "Sprint state filter" },
    },
    required: ["boardId"],
  },

  [TOOL_NAMES.jiraMoveToSprint]: {
    type: "object",
    properties: {
      sprintId: { type: "number", description: "Target sprint ID" },
      issueIds: { type: "array", items: { type: "string" }, description: "Issue IDs or keys to move" },
    },
    required: ["sprintId", "issueIds"],
  },

  [TOOL_NAMES.jiraAssignIssue]: {
    type: "object",
    properties: {
      issueIdOrKey: { type: "string", description: "Issue ID or key" },
      accountId: { type: "string", description: "Jira account ID (omit to unassign)" },
    },
    required: ["issueIdOrKey"],
  },

  [TOOL_NAMES.jiraLinkIssues]: {
    type: "object",
    properties: {
      inwardIssue: { type: "string", description: "Inward issue key (e.g. PROJ-1)" },
      outwardIssue: { type: "string", description: "Outward issue key (e.g. PROJ-2)" },
      linkType: { type: "string", description: "Link type (e.g. Blocks, Relates, Clones)" },
    },
    required: ["inwardIssue", "outwardIssue", "linkType"],
  },

  [TOOL_NAMES.jiraListTransitions]: {
    type: "object",
    properties: {
      issueIdOrKey: { type: "string", description: "Issue ID or key" },
    },
    required: ["issueIdOrKey"],
  },

  [TOOL_NAMES.jiraGetUser]: {
    type: "object",
    properties: {
      accountId: { type: "string", description: "Jira account ID" },
      emailAddress: { type: "string", description: "Email address to search" },
    },
  },
};
