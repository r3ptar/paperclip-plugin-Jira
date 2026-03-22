import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraSprintService } from "../services/sprints.js";

export interface JiraGetSprintParams {
  boardId: number;
  state?: "active" | "closed" | "future";
}

export async function handleJiraGetSprint(
  params: unknown,
  _runCtx: ToolRunContext,
  sprintService: JiraSprintService,
): Promise<ToolResult> {
  const { boardId, state } = params as JiraGetSprintParams;

  if (!boardId) return { error: "boardId is required" };

  try {
    const sprints = await sprintService.getSprintsForBoard(boardId, state);
    const list = sprints
      .map((s) => `${s.id}: ${s.name} (${s.state})${s.goal ? ` — ${s.goal}` : ""}`)
      .join("\n");

    return {
      content: `Found ${sprints.length} sprint(s) for board ${boardId}.\n${list}`,
      data: { sprints },
    };
  } catch (err) {
    return { error: `Failed to get sprints: ${(err as Error).message}` };
  }
}
