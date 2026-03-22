import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraIssueService } from "../services/issues.js";

export interface JiraAddCommentParams {
  issueIdOrKey: string;
  body: string;
}

export async function handleJiraAddComment(
  params: unknown,
  _runCtx: ToolRunContext,
  issueService: JiraIssueService,
): Promise<ToolResult> {
  const { issueIdOrKey, body } = params as JiraAddCommentParams;

  if (!issueIdOrKey) return { error: "issueIdOrKey is required" };
  if (!body || body.trim().length === 0) return { error: "body is required" };

  try {
    const comment = await issueService.addComment(issueIdOrKey, body);

    return {
      content: `Added comment to ${issueIdOrKey} (comment ID: ${comment.id})`,
      data: { issueIdOrKey, commentId: comment.id },
    };
  } catch (err) {
    return { error: `Failed to add comment: ${(err as Error).message}` };
  }
}
