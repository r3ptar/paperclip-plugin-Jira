import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { JiraClient, JiraIssue, JiraSprint } from "../jira/types.js";

function validateSprintId(sprintId: number): void {
  if (!Number.isInteger(sprintId) || sprintId <= 0) {
    throw new Error(
      `Invalid sprint ID: ${sprintId}. Expected a positive integer.`,
    );
  }
}

function validateBoardId(boardId: number): void {
  if (!Number.isInteger(boardId) || boardId <= 0) {
    throw new Error(
      `Invalid board ID: ${boardId}. Expected a positive integer.`,
    );
  }
}

/**
 * Sprint operations against the Jira Agile REST API.
 */
export class JiraSprintService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly client: JiraClient,
  ) {}

  async getSprintsForBoard(
    boardId: number,
    state?: "active" | "closed" | "future",
    startAt?: number,
    maxResults?: number,
  ): Promise<JiraSprint[]> {
    validateBoardId(boardId);
    this.ctx.logger.debug("Fetching sprints for board", { boardId, state });

    const params: string[] = [];
    if (state) params.push(`state=${state}`);
    if (startAt !== undefined) params.push(`startAt=${startAt}`);

    const path = `/board/${boardId}/sprint${params.length > 0 ? `?${params.join("&")}` : ""}`;

    return this.client.listAll<JiraSprint>(path, "values", {
      apiVersion: "agile",
      maxResults: maxResults ?? 50,
    });
  }

  async getSprint(sprintId: number): Promise<JiraSprint> {
    validateSprintId(sprintId);
    this.ctx.logger.debug("Fetching sprint", { sprintId });
    return this.client.get<JiraSprint>(`/sprint/${sprintId}`, { apiVersion: "agile" });
  }

  async getSprintIssues(
    sprintId: number,
    startAt?: number,
    maxResults?: number,
  ): Promise<JiraIssue[]> {
    validateSprintId(sprintId);
    this.ctx.logger.debug("Fetching sprint issues", { sprintId });

    const params: string[] = [];
    if (startAt !== undefined) params.push(`startAt=${startAt}`);

    const path = `/sprint/${sprintId}/issue${params.length > 0 ? `?${params.join("&")}` : ""}`;

    return this.client.listAll<JiraIssue>(path, "issues", {
      apiVersion: "agile",
      maxResults: maxResults ?? 50,
    });
  }

  async moveIssuesToSprint(
    sprintId: number,
    issueIds: string[],
  ): Promise<void> {
    validateSprintId(sprintId);

    if (!issueIds || issueIds.length === 0) {
      throw new Error("issueIds must be a non-empty array.");
    }

    this.ctx.logger.info("Moving issues to sprint", {
      sprintId,
      issueCount: issueIds.length,
    });

    await this.client.post(
      `/sprint/${sprintId}/issue`,
      { issues: issueIds },
      { apiVersion: "agile" },
    );
  }
}
