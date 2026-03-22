import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraBoardService } from "../services/boards.js";

export interface JiraListBoardsParams {
  projectKeyOrId?: string;
  type?: "scrum" | "kanban" | "simple";
}

export async function handleJiraListBoards(
  params: unknown,
  _runCtx: ToolRunContext,
  boardService: JiraBoardService,
): Promise<ToolResult> {
  const { projectKeyOrId, type } = params as JiraListBoardsParams;

  try {
    const boards = await boardService.listBoards(projectKeyOrId, type);
    const list = boards.map((b) => `${b.id}: ${b.name} (${b.type})`).join("\n");

    return {
      content: `Found ${boards.length} board(s).\n${list}`,
      data: { boards },
    };
  } catch (err) {
    return { error: `Failed to list boards: ${(err as Error).message}` };
  }
}
