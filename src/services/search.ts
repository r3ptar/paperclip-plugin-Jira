import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { JiraClient, JiraIssue } from "../jira/types.js";

// ─── Response Types ─────────────────────────────────────────────────────────

/** Shape of the POST /search response. */
interface JiraSearchResponse {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * JQL-based search against the Jira REST API.
 *
 * Uses POST /search (instead of GET) to avoid URL length limits with
 * complex JQL queries. Supports both single-page and paginated-all modes.
 */
export class JiraSearchService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly client: JiraClient,
  ) {}

  /**
   * Execute a JQL search and return a single page of results.
   *
   * @param jql         The JQL query string.
   * @param fields      Optional list of field names to include.
   * @param maxResults  Maximum issues per page. Defaults to 50.
   * @param startAt     Offset for pagination. Defaults to 0.
   * @returns           The matching issues and total count.
   */
  async searchIssues(
    jql: string,
    fields?: string[],
    maxResults?: number,
    startAt?: number,
  ): Promise<{ issues: JiraIssue[]; total: number }> {
    if (!jql || jql.trim().length === 0) {
      throw new Error("JQL query must not be empty.");
    }

    this.ctx.logger.debug("Searching issues", {
      jql: jql.slice(0, 200),
      maxResults,
      startAt,
    });

    const body: Record<string, unknown> = {
      jql,
      maxResults: maxResults ?? 50,
      startAt: startAt ?? 0,
    };

    if (fields && fields.length > 0) {
      body.fields = fields;
    }

    const response = await this.client.post<JiraSearchResponse>(
      "/search",
      body,
    );

    return {
      issues: response.issues,
      total: response.total,
    };
  }

  /**
   * Execute a JQL search and paginate through ALL matching results.
   *
   * Uses POST /search for each page to avoid URL length limits.
   * Respects the client's maxPages safety cap (default 50 pages).
   *
   * @param jql     The JQL query string.
   * @param fields  Optional list of field names to include.
   * @returns       All matching issues.
   */
  async searchAllIssues(
    jql: string,
    fields?: string[],
  ): Promise<JiraIssue[]> {
    if (!jql || jql.trim().length === 0) {
      throw new Error("JQL query must not be empty.");
    }

    this.ctx.logger.debug("Searching all issues (paginated)", {
      jql: jql.slice(0, 200),
    });

    const pageSize = 100;
    const maxPages = 50;
    const allIssues: JiraIssue[] = [];
    let startAt = 0;
    let pageCount = 0;

    while (pageCount < maxPages) {
      pageCount += 1;

      const body: Record<string, unknown> = {
        jql,
        maxResults: pageSize,
        startAt,
      };

      if (fields && fields.length > 0) {
        body.fields = fields;
      }

      const response = await this.client.post<JiraSearchResponse>(
        "/search",
        body,
      );

      allIssues.push(...response.issues);

      // Check if we have fetched everything
      startAt += pageSize;
      if (startAt >= response.total) break;
      if (response.issues.length === 0) break;
    }

    if (pageCount >= maxPages) {
      this.ctx.logger.warn(
        "searchAllIssues reached page limit -- results may be incomplete",
        { jql: jql.slice(0, 200), maxPages, fetched: allIssues.length },
      );
    }

    this.ctx.logger.debug("searchAllIssues complete", {
      total: allIssues.length,
    });

    return allIssues;
  }
}
