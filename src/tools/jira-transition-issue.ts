import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraIssueService } from "../services/issues.js";

export interface JiraTransitionIssueParams {
  issueIdOrKey: string;
  transitionId: string;
  comment?: string;
  resolution?: string;
}

export async function handleJiraTransitionIssue(
  params: unknown,
  _runCtx: ToolRunContext,
  issueService: JiraIssueService,
): Promise<ToolResult> {
  const { issueIdOrKey, transitionId, comment, resolution } =
    params as JiraTransitionIssueParams;

  if (!issueIdOrKey) return { error: "issueIdOrKey is required" };
  if (!transitionId) return { error: "transitionId is required" };

  try {
    await issueService.transitionIssue(issueIdOrKey, transitionId, comment, resolution);

    return {
      content: `Transitioned ${issueIdOrKey} via transition ${transitionId}`,
      data: { issueIdOrKey, transitionId },
    };
  } catch (err) {
    return { error: `Failed to transition issue: ${(err as Error).message}` };
  }
}
