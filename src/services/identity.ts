import type { JiraConfig } from "../constants.js";

/**
 * Resolves which Jira account an agent should act as.
 *
 * Each Paperclip agent can be mapped to a dedicated Jira user account
 * (via accountId). When no mapping exists, falls back to the default
 * service account ID.
 */
export class AgentIdentityService {
  private readonly map: ReadonlyMap<string, string>;
  private readonly defaultAccountId: string;

  constructor(config: JiraConfig) {
    this.map = new Map(Object.entries(config.agentIdentityMap));
    this.defaultAccountId = config.defaultServiceAccountId;
  }

  /**
   * Resolve which Jira accountId a Paperclip agent should act as.
   * Returns the mapped accountId, or null if no mapping exists.
   */
  resolveJiraAccountId(agentId: string): string | null {
    return this.map.get(agentId) ?? null;
  }

  /** Get the fallback service account for non-agent operations. */
  getDefaultAccountId(): string {
    return this.defaultAccountId;
  }

  /** Check if an agent has a mapped Jira identity. */
  hasIdentity(agentId: string): boolean {
    return this.map.has(agentId);
  }

  /** List all mapped agents. */
  listMappings(): Array<{ agentId: string; jiraAccountId: string }> {
    return Array.from(this.map.entries()).map(([agentId, jiraAccountId]) => ({
      agentId,
      jiraAccountId,
    }));
  }

  /**
   * Resolve the acting Jira account for a tool call.
   * Returns the mapped account for the agent, or the default service account
   * as fallback. Returns null if no identity can be resolved.
   */
  resolveActingAccountId(agentId?: string): string | null {
    if (agentId) {
      const mapped = this.resolveJiraAccountId(agentId);
      if (mapped) return mapped;
    }
    return this.defaultAccountId || null;
  }
}
