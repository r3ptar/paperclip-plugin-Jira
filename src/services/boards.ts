import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { JiraBoard, JiraClient, JiraIssue } from "../jira/types.js";

function validateBoardId(boardId: number): void {
  if (!Number.isInteger(boardId) || boardId <= 0) {
    throw new Error(
      `Invalid board ID: ${boardId}. Expected a positive integer.`,
    );
  }
}

interface JiraBoardConfiguration {
  id: number;
  name: string;
  type: string;
  self: string;
  filter?: { id: string; self: string };
  columnConfig?: { columns: Array<{ name: string; statuses: Array<{ id: string }> }> };
  ranking?: { rankCustomFieldId: number };
}

/**
 * Board operations against the Jira Agile REST API.
 */
export class JiraBoardService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly client: JiraClient,
  ) {}

  async listBoards(
    projectKeyOrId?: string,
    type?: "scrum" | "kanban" | "simple",
    startAt?: number,
    maxResults?: number,
  ): Promise<JiraBoard[]> {
    this.ctx.logger.debug("Listing boards", { projectKeyOrId, type });

    const params: string[] = [];
    if (projectKeyOrId) params.push(`projectKeyOrId=${encodeURIComponent(projectKeyOrId)}`);
    if (type) params.push(`type=${type}`);
    if (startAt !== undefined) params.push(`startAt=${startAt}`);

    const path = `/board${params.length > 0 ? `?${params.join("&")}` : ""}`;

    return this.client.listAll<JiraBoard>(path, "values", {
      apiVersion: "agile",
      maxResults: maxResults ?? 50,
    });
  }

  async getBoard(boardId: number): Promise<JiraBoard> {
    validateBoardId(boardId);
    this.ctx.logger.debug("Fetching board", { boardId });
    return this.client.get<JiraBoard>(`/board/${boardId}`, { apiVersion: "agile" });
  }

  async getBoardConfiguration(boardId: number): Promise<JiraBoardConfiguration> {
    validateBoardId(boardId);
    this.ctx.logger.debug("Fetching board configuration", { boardId });
    return this.client.get<JiraBoardConfiguration>(
      `/board/${boardId}/configuration`,
      { apiVersion: "agile" },
    );
  }

  async getBacklog(
    boardId: number,
    startAt?: number,
    maxResults?: number,
  ): Promise<JiraIssue[]> {
    validateBoardId(boardId);
    this.ctx.logger.debug("Fetching board backlog", { boardId });

    const params: string[] = [];
    if (startAt !== undefined) params.push(`startAt=${startAt}`);

    const path = `/board/${boardId}/backlog${params.length > 0 ? `?${params.join("&")}` : ""}`;

    return this.client.listAll<JiraIssue>(path, "issues", {
      apiVersion: "agile",
      maxResults: maxResults ?? 50,
    });
  }
}
