import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraIssueService } from "../services/issues.js";

export interface JiraGetIssueParams {
  issueIdOrKey: string;
  fields?: string[];
}

export async function handleJiraGetIssue(
  params: unknown,
  _runCtx: ToolRunContext,
  issueService: JiraIssueService,
): Promise<ToolResult> {
  const { issueIdOrKey, fields } = params as JiraGetIssueParams;

  if (!issueIdOrKey) {
    return { error: "issueIdOrKey is required" };
  }

  try {
    const issue = await issueService.getIssue(issueIdOrKey, fields);
    const assignee = issue.fields.assignee?.displayName ?? "Unassigned";

    return {
      content:
        `${issue.key}: ${issue.fields.summary}\n` +
        `Status: ${issue.fields.status.name}\n` +
        `Assignee: ${assignee}`,
      data: { issue },
    };
  } catch (err) {
    return { error: `Failed to get issue: ${(err as Error).message}` };
  }
}
