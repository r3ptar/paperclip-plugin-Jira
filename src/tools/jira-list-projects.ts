import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraProjectService } from "../services/projects.js";

export interface JiraListProjectsParams {
  maxResults?: number;
}

export async function handleJiraListProjects(
  params: unknown,
  _runCtx: ToolRunContext,
  projectService: JiraProjectService,
): Promise<ToolResult> {
  const { maxResults } = params as JiraListProjectsParams;

  try {
    const projects = await projectService.listProjects(maxResults);
    const list = projects.map((p) => `${p.key}: ${p.name}`).join("\n");

    return {
      content: `Found ${projects.length} project(s).\n${list}`,
      data: { projects },
    };
  } catch (err) {
    return { error: `Failed to list projects: ${(err as Error).message}` };
  }
}
