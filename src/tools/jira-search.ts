import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraSearchService } from "../services/search.js";

export interface JiraSearchParams {
  jql: string;
  maxResults?: number;
  fields?: string[];
}

export async function handleJiraSearch(
  params: unknown,
  _runCtx: ToolRunContext,
  searchService: JiraSearchService,
): Promise<ToolResult> {
  const { jql, maxResults, fields } = params as JiraSearchParams;

  if (!jql || jql.trim().length === 0) {
    return { error: "jql is required" };
  }

  try {
    const result = await searchService.searchIssues(jql, fields, maxResults);
    const issueList = result.issues
      .map((i) => `${i.key}: ${i.fields.summary}`)
      .join("\n");

    return {
      content: `Found ${result.total} issue(s).\n${issueList}`,
      data: { total: result.total, issues: result.issues },
    };
  } catch (err) {
    return { error: `Search failed: ${(err as Error).message}` };
  }
}
