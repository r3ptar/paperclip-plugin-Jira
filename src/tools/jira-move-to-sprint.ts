import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraSprintService } from "../services/sprints.js";

export interface JiraMoveToSprintParams {
  sprintId: number;
  issueIds: string[];
}

export async function handleJiraMoveToSprint(
  params: unknown,
  _runCtx: ToolRunContext,
  sprintService: JiraSprintService,
): Promise<ToolResult> {
  const { sprintId, issueIds } = params as JiraMoveToSprintParams;

  if (!sprintId) return { error: "sprintId is required" };
  if (!issueIds || !Array.isArray(issueIds) || issueIds.length === 0) {
    return { error: "issueIds must be a non-empty array" };
  }

  try {
    await sprintService.moveIssuesToSprint(sprintId, issueIds);

    return {
      content: `Moved ${issueIds.length} issue(s) to sprint ${sprintId}`,
      data: { sprintId, issueIds },
    };
  } catch (err) {
    return { error: `Failed to move issues to sprint: ${(err as Error).message}` };
  }
}
