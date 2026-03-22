import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraIssueService } from "../services/issues.js";

export interface JiraListTransitionsParams {
  issueIdOrKey: string;
}

export async function handleJiraListTransitions(
  params: unknown,
  _runCtx: ToolRunContext,
  issueService: JiraIssueService,
): Promise<ToolResult> {
  const { issueIdOrKey } = params as JiraListTransitionsParams;

  if (!issueIdOrKey) return { error: "issueIdOrKey is required" };

  try {
    const transitions = await issueService.getTransitions(issueIdOrKey);
    const list = transitions
      .map((t) => `${t.id}: ${t.name} -> ${t.to.name} (${t.to.statusCategory.key})`)
      .join("\n");

    return {
      content: `Available transitions for ${issueIdOrKey}:\n${list}`,
      data: { transitions },
    };
  } catch (err) {
    return { error: `Failed to list transitions: ${(err as Error).message}` };
  }
}
