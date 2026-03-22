import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraIssueService } from "../services/issues.js";

export interface JiraCreateIssueParams {
  projectKey: string;
  summary: string;
  issueType: string;
  description?: string;
  priority?: string;
  labels?: string[];
  assigneeAccountId?: string;
}

export async function handleJiraCreateIssue(
  params: unknown,
  _runCtx: ToolRunContext,
  issueService: JiraIssueService,
): Promise<ToolResult> {
  const {
    projectKey,
    summary,
    issueType,
    description,
    priority,
    labels,
    assigneeAccountId,
  } = params as JiraCreateIssueParams;

  if (!projectKey) return { error: "projectKey is required" };
  if (!summary) return { error: "summary is required" };
  if (!issueType) return { error: "issueType is required" };

  try {
    const issue = await issueService.createIssue({
      projectKey,
      summary,
      issueType,
      description,
      priority,
      labels,
      assigneeAccountId,
    });

    return {
      content: `Created issue ${issue.key}: ${summary}`,
      data: { issueId: issue.id, issueKey: issue.key },
    };
  } catch (err) {
    return { error: `Failed to create issue: ${(err as Error).message}` };
  }
}
