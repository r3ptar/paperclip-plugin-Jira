import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraProjectService } from "../services/projects.js";

export interface JiraGetProjectParams {
  projectIdOrKey: string;
}

export async function handleJiraGetProject(
  params: unknown,
  _runCtx: ToolRunContext,
  projectService: JiraProjectService,
): Promise<ToolResult> {
  const { projectIdOrKey } = params as JiraGetProjectParams;

  if (!projectIdOrKey) return { error: "projectIdOrKey is required" };

  try {
    const project = await projectService.getProject(projectIdOrKey);

    return {
      content:
        `${project.key}: ${project.name}\n` +
        `Type: ${project.projectTypeKey ?? "unknown"}\n` +
        `Lead: ${project.lead?.displayName ?? "None"}`,
      data: { project },
    };
  } catch (err) {
    return { error: `Failed to get project: ${(err as Error).message}` };
  }
}
