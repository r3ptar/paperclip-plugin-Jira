import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraIssueService } from "../services/issues.js";

export interface JiraUpdateIssueParams {
  issueIdOrKey: string;
  summary?: string;
  description?: string;
  priority?: string;
  labels?: string[];
}

export async function handleJiraUpdateIssue(
  params: unknown,
  _runCtx: ToolRunContext,
  issueService: JiraIssueService,
): Promise<ToolResult> {
  const { issueIdOrKey, summary, description, priority, labels } =
    params as JiraUpdateIssueParams;

  if (!issueIdOrKey) return { error: "issueIdOrKey is required" };

  if (
    summary === undefined &&
    description === undefined &&
    priority === undefined &&
    labels === undefined
  ) {
    return { error: "At least one field to update is required (summary, description, priority, or labels)" };
  }

  try {
    await issueService.updateIssue(issueIdOrKey, { summary, description, priority, labels });

    const updatedFields = [
      summary !== undefined && "summary",
      description !== undefined && "description",
      priority !== undefined && "priority",
      labels !== undefined && "labels",
    ].filter(Boolean);

    return {
      content: `Updated ${issueIdOrKey}: ${updatedFields.join(", ")}`,
      data: { issueIdOrKey, updatedFields },
    };
  } catch (err) {
    return { error: `Failed to update issue: ${(err as Error).message}` };
  }
}
