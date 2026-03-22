import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraIssueService } from "../services/issues.js";

export interface JiraLinkIssuesParams {
  inwardIssue: string;
  outwardIssue: string;
  linkType: string;
}

export async function handleJiraLinkIssues(
  params: unknown,
  _runCtx: ToolRunContext,
  issueService: JiraIssueService,
): Promise<ToolResult> {
  const { inwardIssue, outwardIssue, linkType } = params as JiraLinkIssuesParams;

  if (!inwardIssue) return { error: "inwardIssue is required" };
  if (!outwardIssue) return { error: "outwardIssue is required" };
  if (!linkType) return { error: "linkType is required" };

  try {
    await issueService.linkIssues(inwardIssue, outwardIssue, linkType);

    return {
      content: `Linked ${inwardIssue} -> ${outwardIssue} (${linkType})`,
      data: { inwardIssue, outwardIssue, linkType },
    };
  } catch (err) {
    return { error: `Failed to link issues: ${(err as Error).message}` };
  }
}
