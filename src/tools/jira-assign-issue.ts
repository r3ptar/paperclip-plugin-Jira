import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraIssueService } from "../services/issues.js";

export interface JiraAssignIssueParams {
  issueIdOrKey: string;
  accountId?: string;
}

export async function handleJiraAssignIssue(
  params: unknown,
  _runCtx: ToolRunContext,
  issueService: JiraIssueService,
): Promise<ToolResult> {
  const { issueIdOrKey, accountId } = params as JiraAssignIssueParams;

  if (!issueIdOrKey) return { error: "issueIdOrKey is required" };

  try {
    const resolvedAccountId = accountId ?? null;
    await issueService.assignIssue(issueIdOrKey, resolvedAccountId);

    const action = resolvedAccountId ? `assigned to ${resolvedAccountId}` : "unassigned";

    return {
      content: `${issueIdOrKey} ${action}`,
      data: { issueIdOrKey, accountId: resolvedAccountId },
    };
  } catch (err) {
    return { error: `Failed to assign issue: ${(err as Error).message}` };
  }
}
