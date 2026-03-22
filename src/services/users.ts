import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { JiraClient, JiraUser } from "../jira/types.js";

/**
 * User search and lookup operations against the Jira REST API.
 */
export class JiraUserService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly client: JiraClient,
  ) {}

  /**
   * Search for users by display name or email.
   *
   * Uses GET /user/search?query=... which performs a substring match
   * against display name and email address.
   *
   * @param query  The search string (minimum 1 character).
   */
  async findUser(query: string): Promise<JiraUser[]> {
    if (!query || query.trim().length === 0) {
      throw new Error("User search query must not be empty.");
    }

    this.ctx.logger.debug("Searching users", { query });

    const encodedQuery = encodeURIComponent(query);
    return this.client.get<JiraUser[]>(
      `/user/search?query=${encodedQuery}`,
    );
  }

  /**
   * Fetch a single user by Jira accountId.
   *
   * @param accountId  The Jira accountId (e.g. "5b10ac8d82e05b22cc7d4ef5").
   */
  async getUser(accountId: string): Promise<JiraUser> {
    if (!accountId || accountId.trim().length === 0) {
      throw new Error("accountId must not be empty.");
    }

    this.ctx.logger.debug("Fetching user", { accountId });

    const encodedId = encodeURIComponent(accountId);
    return this.client.get<JiraUser>(`/user?accountId=${encodedId}`);
  }

  /**
   * Find users who can be assigned to issues in a project.
   *
   * Uses GET /user/assignable/search?project=...&query=... which returns
   * only users who have the "Assignable User" project permission.
   *
   * @param projectKey  The project key (e.g. "PROJ").
   * @param query       Optional search string to filter results.
   */
  async getAssignableUsers(
    projectKey: string,
    query?: string,
  ): Promise<JiraUser[]> {
    if (!projectKey || projectKey.trim().length === 0) {
      throw new Error("projectKey must not be empty.");
    }

    this.ctx.logger.debug("Fetching assignable users", { projectKey, query });

    const encodedProject = encodeURIComponent(projectKey);
    let path = `/user/assignable/search?project=${encodedProject}`;

    if (query && query.trim().length > 0) {
      path += `&query=${encodeURIComponent(query)}`;
    }

    return this.client.get<JiraUser[]>(path);
  }
}
