import type {
  AuthToken,
  CircuitState,
  JiraApiVersion,
  JiraClientConfig,
  JiraClient as JiraClientInterface,
  JiraErrorBody,
  JiraListOptions,
  JiraPaginatedResponse,
  JiraRequestOptions,
  TokenManager,
} from "./types.js";
import {
  API_BASE_PATHS,
  CIRCUIT_BREAKER_COOLDOWN_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  CircuitBreakerOpenError,
  JiraApiError,
} from "./types.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";

/**
 * Jira HTTP client with circuit breaker, rate-limit backoff, and auth refresh.
 *
 * Exported as `JiraHttpClient` to avoid name collision with the `JiraClient`
 * interface from types.ts.
 *
 * Mirrors the GraphClient pattern from plugin-microsoft-365 but adapted for:
 * - Bearer OR Basic auth (determined by TokenManager)
 * - PUT instead of PATCH for updates
 * - Offset-based pagination (startAt/maxResults/total) instead of @odata.nextLink
 * - Jira error body format (errorMessages + errors)
 */
export class JiraHttpClient implements JiraClientInterface {
  private readonly circuit: CircuitState = { failures: 0, openUntil: 0 };
  private readonly ctx: PluginContext;
  private readonly tokenManager: TokenManager;
  private readonly siteUrl: string;
  private readonly defaultApiVersion: JiraApiVersion;
  private readonly serviceName: string;

  /** Optional company ID for activity logging. May be null during wizard setup. */
  companyId: string | null = null;

  constructor(config: JiraClientConfig) {
    this.ctx = config.ctx;
    this.tokenManager = config.tokenManager;
    this.siteUrl = config.siteUrl.replace(/\/+$/, ""); // strip trailing slashes
    this.defaultApiVersion = config.defaultApiVersion ?? "cloud";
    this.serviceName = config.serviceName;
  }

  // ─── Core Request ────────────────────────────────────────────────────────

  async request<T>(
    path: string,
    options: JiraRequestOptions = {},
  ): Promise<T> {
    this.checkCircuit();

    const method = options.method ?? "GET";
    let token = await this.tokenManager.getToken();

    // Best-effort audit logging
    if (!options.silent && this.companyId) {
      try {
        await this.ctx.activity.log({
          companyId: this.companyId,
          message: `Jira API ${method} ${path}`,
          metadata: { service: this.serviceName, method, path },
        });
      } catch {
        // Activity logging is best-effort
      }
    }

    const doFetch = async (authToken: AuthToken): Promise<Response> => {
      const authPrefix =
        authToken.type === "basic" ? "Basic" : "Bearer";
      const headers: Record<string, string> = {
        ...options.headers,
        Authorization: `${authPrefix} ${authToken.token}`,
        "Content-Type":
          options.headers?.["Content-Type"] ?? "application/json",
        Accept: "application/json",
      };

      const apiVersion = options.apiVersion ?? this.defaultApiVersion;
      const url = path.startsWith("http")
        ? path
        : `${this.siteUrl}${API_BASE_PATHS[apiVersion]}${path}`;

      return this.ctx.http.fetch(url, {
        method,
        headers,
        body: options.body,
      });
    };

    let response = await doFetch(token);

    // Handle 401 -- refresh token once and retry
    if (response.status === 401) {
      this.ctx.logger.warn("Jira 401 -- refreshing token", { path });
      token = await this.tokenManager.forceRefresh();
      response = await doFetch(token);
    }

    // Handle 429 -- respect Retry-After (clamped to [1, 120]s), retry once
    if (response.status === 429) {
      const rawRetryAfter = Number(
        response.headers.get("Retry-After") ?? "10",
      );
      const retryAfter = Math.min(Math.max(rawRetryAfter, 1), 120);
      this.ctx.logger.warn("Jira 429 -- backing off", { path, retryAfter });
      await this.sleep(retryAfter * 1000);
      response = await doFetch(token);
    }

    if (!response.ok) {
      this.recordFailure();

      const errorBody = await response.text();
      let jiraError: JiraErrorBody | undefined;
      try {
        jiraError = JSON.parse(errorBody) as JiraErrorBody;
      } catch {
        // Response was not valid JSON
      }

      const message = this.extractErrorMessage(jiraError, errorBody);
      throw new JiraApiError(response.status, message, path, jiraError);
    }

    this.recordSuccess();

    // 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // ─── Convenience Methods ─────────────────────────────────────────────────

  async get<T>(path: string, options?: JiraRequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  async post<T>(
    path: string,
    body: unknown,
    options?: JiraRequestOptions,
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async put<T>(
    path: string,
    body: unknown,
    options?: JiraRequestOptions,
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async delete(path: string, options?: JiraRequestOptions): Promise<void> {
    await this.request<void>(path, { ...options, method: "DELETE" });
  }

  // ─── Pagination ──────────────────────────────────────────────────────────

  async listAll<T>(
    path: string,
    resultKey: string = "values",
    options: JiraListOptions = {},
  ): Promise<T[]> {
    const maxResults = options.maxResults ?? 50;
    const maxPages = options.maxPages ?? 50;
    const results: T[] = [];
    let startAt = 0;
    let pageCount = 0;

    while (pageCount < maxPages) {
      pageCount += 1;

      // Append pagination params to the URL
      const separator = path.includes("?") ? "&" : "?";
      const paginatedPath = `${path}${separator}startAt=${startAt}&maxResults=${maxResults}`;

      const page = await this.get<JiraPaginatedResponse<T, string>>(
        paginatedPath,
        options,
      );

      const items = (page as Record<string, unknown>)[resultKey];
      if (Array.isArray(items)) {
        results.push(...(items as T[]));
      }

      // Check termination conditions
      if (page.isLast === true) break;
      startAt += maxResults;
      if (startAt >= page.total) break;

      // Safety: if no items were returned, bail to avoid infinite loop
      if (!Array.isArray(items) || items.length === 0) break;
    }

    if (pageCount >= maxPages) {
      this.ctx.logger.warn(
        "listAll reached page limit -- results may be incomplete",
        { path, maxPages, fetched: results.length },
      );
    }

    return results;
  }

  // ─── Circuit Breaker ─────────────────────────────────────────────────────

  private checkCircuit(): void {
    if (this.circuit.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      if (Date.now() < this.circuit.openUntil) {
        throw new CircuitBreakerOpenError(
          this.serviceName,
          this.circuit.openUntil,
        );
      }
      // Cooldown expired -- half-open state, reset and allow probe
      this.circuit.failures = 0;
      this.circuit.openUntil = 0;
    }
  }

  private recordFailure(): void {
    this.circuit.failures += 1;
    if (this.circuit.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.circuit.openUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
      this.ctx.logger.error("Circuit breaker opened", {
        service: this.serviceName,
        failures: this.circuit.failures,
        cooldownMs: CIRCUIT_BREAKER_COOLDOWN_MS,
      });
    }
  }

  private recordSuccess(): void {
    if (this.circuit.failures > 0) {
      this.circuit.failures = 0;
      this.circuit.openUntil = 0;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private extractErrorMessage(
    jiraError: JiraErrorBody | undefined,
    rawBody: string,
  ): string {
    if (jiraError) {
      // Prefer errorMessages array
      if (jiraError.errorMessages && jiraError.errorMessages.length > 0) {
        return jiraError.errorMessages.join("; ");
      }
      // Fall back to errors object
      if (jiraError.errors) {
        const fieldErrors = Object.entries(jiraError.errors)
          .map(([field, msg]) => `${field}: ${msg}`)
          .join("; ");
        if (fieldErrors) return fieldErrors;
      }
    }
    return rawBody.slice(0, 500);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
