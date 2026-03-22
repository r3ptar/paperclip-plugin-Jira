/**
 * Jira HTTP Client & Auth Layer -- Type Definitions
 *
 * Design reference: plugin-microsoft-365/src/graph/{client,auth,types}.ts
 * Adapted for Jira Cloud, Server, and Data Center APIs.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";

// ─── API Version & URL Construction ─────────────────────────────────────────
//
// DESIGN DECISION: Single client, explicit `apiVersion` per-call.
//
// Jira has three API families that a single plugin may need to hit:
//   - Cloud REST API v3:  /rest/api/3
//   - Server/DC REST API: /rest/api/2
//   - Agile (both):       /rest/agile/1.0
//
// Rather than spawning multiple client instances (which would duplicate circuit
// breaker state and token management), we use ONE JiraClient per connection and
// accept an `apiVersion` option on each request. The client concatenates:
//   `${siteUrl}${API_BASE_PATHS[apiVersion]}${path}`
//
// Services call it like:
//   client.get<Issue>("/issue/PROJ-1", { apiVersion: "cloud" })
//   client.get<Board[]>("/board", { apiVersion: "agile" })
//
// For the common case, a default apiVersion is set at construction time so
// callers only specify it when deviating.

/**
 * Which Jira REST API family to target.
 *
 * - `"cloud"` -- `/rest/api/3`  (Jira Cloud)
 * - `"server"` -- `/rest/api/2` (Server / Data Center)
 * - `"agile"` -- `/rest/agile/1.0` (Jira Software boards, sprints, epics)
 */
export type JiraApiVersion = "cloud" | "server" | "agile";

/** Maps each API version to its base path segment (appended to siteUrl). */
export const API_BASE_PATHS: Record<JiraApiVersion, string> = {
  cloud: "/rest/api/3",
  server: "/rest/api/2",
  agile: "/rest/agile/1.0",
} as const;

// ─── Auth Types ─────────────────────────────────────────────────────────────

/**
 * The resolved auth header payload.
 *
 * `"bearer"` -> `Authorization: Bearer <token>`
 * `"basic"`  -> `Authorization: Basic <token>`
 *
 * This lets the client build the header without knowing which auth method is
 * in use. The M365 plugin always returns a bare string and assumes Bearer;
 * we make it explicit because Jira has Basic auth flows.
 */
export interface AuthToken {
  token: string;
  type: "bearer" | "basic";
}

/**
 * Discriminated union of supported Jira auth configurations.
 * Stored in connection settings; passed to the TokenManager factory.
 */
export type JiraAuthConfig =
  | JiraOAuth2Config
  | JiraApiTokenConfig
  | JiraPatConfig;

export interface JiraOAuth2Config {
  method: "oauth2";
  /** Jira Cloud site URL, e.g. `https://acme.atlassian.net` */
  siteUrl: string;
  clientId: string;
  /** Reference to a stored secret (resolved via ctx.secrets.resolve). */
  clientSecretRef: string;
  /** The current refresh token. Will be rotated on every refresh. */
  refreshToken: string;
  /** Atlassian Cloud ID for the authorized site. */
  cloudId: string;
}

export interface JiraApiTokenConfig {
  method: "api_token";
  siteUrl: string;
  /** User email for the Basic auth pair. */
  email: string;
  /** Reference to stored API token secret. */
  apiTokenRef: string;
}

export interface JiraPatConfig {
  method: "pat";
  /** Server/DC base URL, e.g. `https://jira.corp.com` */
  siteUrl: string;
  /** Reference to stored PAT secret. */
  patRef: string;
}

/**
 * OAuth 2.0 token response from `https://auth.atlassian.com/oauth/token`.
 *
 * CRITICAL: Jira returns a NEW refresh_token on every refresh. The old one
 * becomes invalid immediately. The TokenManager MUST persist the new
 * refresh_token via ctx.connections (or equivalent) before returning.
 */
export interface JiraOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  /** Rotated refresh token -- must be persisted immediately. */
  refresh_token: string;
  scope: string;
}

// ─── TokenManager Interface ─────────────────────────────────────────────────
//
// DESIGN DECISION: Interface, not a concrete class.
//
// The M365 plugin exports a concrete TokenManager class. We define an
// interface instead so each auth method can have its own implementation
// without the consumer caring which one is active. A factory function
// `createTokenManager(ctx, config)` will return the right implementation.

/**
 * Abstracts Jira authentication across OAuth 2.0 3LO, API Token, and PAT.
 *
 * Implementations:
 * - `OAuth2TokenManager`  -- refreshable Bearer tokens, rotates refresh_token
 * - `ApiTokenManager`     -- static Basic auth (email:token)
 * - `PatTokenManager`     -- static Bearer auth
 *
 * Like the M365 TokenManager, concurrent calls to `getToken()` are
 * deduplicated (only one in-flight refresh at a time).
 */
export interface TokenManager {
  /**
   * Return a valid auth token, refreshing if necessary.
   * Implementations MUST deduplicate concurrent refresh calls.
   */
  getToken(): Promise<AuthToken>;

  /**
   * Invalidate the cached token and acquire a fresh one.
   * For static auth methods (API Token, PAT) this is a no-op that returns
   * the same token, since there is nothing to refresh.
   */
  forceRefresh(): Promise<AuthToken>;

  /**
   * Verify that the credentials can produce a valid token.
   * Used during connection setup wizard and periodic health checks.
   */
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
}

/**
 * Callback invoked by OAuth2TokenManager when a refresh yields a new
 * refresh_token. The host MUST persist this value before the callback
 * returns, otherwise a crash would leave the connection with a revoked token.
 *
 * Typical implementation: `ctx.connections.update(connId, { refreshToken })`.
 */
export type RefreshTokenPersister = (newRefreshToken: string) => Promise<void>;

// ─── Request Options ────────────────────────────────────────────────────────

export interface JiraRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;

  /**
   * Override the default API version for this request.
   * Useful when a single service needs both REST v3 and Agile endpoints.
   */
  apiVersion?: JiraApiVersion;

  /**
   * Skip audit logging for this call (health checks, token probes).
   * Mirrors the M365 `silent` option.
   */
  silent?: boolean;
}

// ─── Pagination ─────────────────────────────────────────────────────────────
//
// DESIGN DECISION: `listAll` accepts a `resultKey` parameter.
//
// Jira offset pagination always uses `startAt` / `maxResults` / `total`, but
// the array field name varies by endpoint:
//   - /search        -> `issues`
//   - /board         -> `values`
//   - /sprint/{id}/issue -> `issues`
//   - /project       -> (top-level array, no wrapper -- but paginated endpoints wrap)
//
// Rather than hard-coding heuristics, the caller specifies the key.
// We provide a default of "values" since that covers the majority of endpoints.

/**
 * Shape of Jira's paginated response envelope.
 * `K` is the key under which the array lives (e.g., "values" or "issues").
 */
export type JiraPaginatedResponse<T, K extends string = "values"> = {
  startAt: number;
  maxResults: number;
  total: number;
  isLast?: boolean; // present on some Agile endpoints
} & Record<K, T[]>;

export interface JiraListOptions extends JiraRequestOptions {
  /**
   * Maximum number of items per page. Jira default is usually 50.
   * The client appends `maxResults=<value>` to the query string.
   */
  maxResults?: number;

  /**
   * Safety cap on total pages fetched. Prevents runaway pagination.
   * Default: 50 (same as M365 reference).
   */
  maxPages?: number;
}

// ─── Error Types ────────────────────────────────────────────────────────────

/**
 * Jira's standard error response body.
 *
 * Example:
 * ```json
 * {
 *   "errorMessages": ["Issue does not exist or you do not have permission to see it."],
 *   "errors": { "assignee": "User 'x' does not exist." }
 * }
 * ```
 */
export interface JiraErrorBody {
  errorMessages: string[];
  errors: Record<string, string>;
}

// ─── JiraClient Interface ───────────────────────────────────────────────────
//
// DESIGN DECISION: Class shape mirrors GraphClient but uses PUT instead of
// PATCH, and adds the `listAll` result-key mechanism.
//
// We keep `request<T>()` as the low-level escape hatch (just like M365) and
// layer convenience methods on top. Services never construct URLs with base
// paths -- they pass relative paths like "/issue/PROJ-1".

/**
 * Public contract for the Jira HTTP client.
 *
 * Responsibilities (mirrors GraphClient):
 * - Auth header injection (Bearer or Basic, depending on TokenManager)
 * - 429 rate-limit backoff with Retry-After
 * - 401 automatic token refresh (once), then retry
 * - Circuit breaker (N consecutive failures -> cooldown pause)
 * - Audit logging via ctx.activity.log()
 *
 * URL construction:
 *   `${siteUrl}${API_BASE_PATHS[apiVersion]}${path}`
 *
 * The default `apiVersion` is set at construction. Individual calls can
 * override it via `options.apiVersion`.
 */
export interface JiraClient {
  /**
   * Optional company ID for activity logging.
   * May be null during wizard setup (same pattern as GraphClient).
   */
  companyId: string | null;

  /**
   * Low-level request method. All convenience methods delegate here.
   * Handles auth injection, 401 refresh, 429 backoff, circuit breaker.
   */
  request<T>(path: string, options?: JiraRequestOptions): Promise<T>;

  /** GET shorthand. */
  get<T>(path: string, options?: JiraRequestOptions): Promise<T>;

  /**
   * POST shorthand. Serializes `body` as JSON.
   * Used for creating resources and bulk operations.
   */
  post<T>(path: string, body: unknown, options?: JiraRequestOptions): Promise<T>;

  /**
   * PUT shorthand. Serializes `body` as JSON.
   *
   * NOTE: Jira uses PUT (not PATCH) for updates. There is no `patch()` method
   * by design -- adding one would invite accidental misuse against an API
   * that does not support it.
   */
  put<T>(path: string, body: unknown, options?: JiraRequestOptions): Promise<T>;

  /** DELETE shorthand. */
  delete(path: string, options?: JiraRequestOptions): Promise<void>;

  /**
   * Paginate through all pages of a Jira list endpoint.
   *
   * @param path      Relative API path, e.g. "/board" or "/search"
   * @param resultKey The JSON key containing the result array.
   *                  Use "values" for most endpoints, "issues" for /search.
   *                  Default: "values".
   * @param options   Pagination and request options.
   *
   * Internally appends `startAt` and `maxResults` query parameters,
   * incrementing `startAt` by `maxResults` on each page until
   * `startAt >= total` or `isLast === true` or `maxPages` is reached.
   *
   * @example
   * ```ts
   * // Fetch all boards (response key is "values")
   * const boards = await client.listAll<Board>("/board");
   *
   * // Fetch all issues via JQL (response key is "issues")
   * const issues = await client.listAll<Issue>(
   *   "/search?jql=project=PROJ",
   *   "issues",
   *   { maxResults: 100 },
   * );
   * ```
   */
  listAll<T>(
    path: string,
    resultKey?: string,
    options?: JiraListOptions,
  ): Promise<T[]>;
}

// ─── Constructor Config ─────────────────────────────────────────────────────

/**
 * Options passed when constructing a JiraClient instance.
 */
export interface JiraClientConfig {
  ctx: PluginContext;
  tokenManager: TokenManager;

  /**
   * Jira site base URL (no trailing slash).
   * e.g. "https://acme.atlassian.net" or "https://jira.corp.com"
   */
  siteUrl: string;

  /**
   * Default API version for all requests.
   * Individual calls can override via `options.apiVersion`.
   * Default: "cloud".
   */
  defaultApiVersion?: JiraApiVersion;

  /** Label used in circuit breaker logs and activity entries. */
  serviceName: string;
}

// ─── Circuit Breaker ────────────────────────────────────────────────────────

/** Internal state for the circuit breaker. Not exported from the public API. */
export interface CircuitState {
  failures: number;
  openUntil: number;
}

// ─── Error Classes ──────────────────────────────────────────────────────────

/**
 * Thrown when a Jira API call returns a non-OK status after retry logic.
 *
 * Carries the HTTP status, the requested path, and the parsed Jira error
 * body (if the response was valid JSON).
 */
export class JiraApiError extends Error {
  public readonly name = "JiraApiError";

  constructor(
    public readonly status: number,
    message: string,
    public readonly path: string,
    /** Parsed Jira error body, when available. */
    public readonly jiraError?: JiraErrorBody,
  ) {
    super(`Jira API error ${status} on ${path}: ${message}`);
  }
}

/**
 * Thrown when the circuit breaker is open and a request is attempted.
 * Callers should catch this and surface a user-friendly "service temporarily
 * unavailable" message.
 */
export class CircuitBreakerOpenError extends Error {
  public readonly name = "CircuitBreakerOpenError";

  constructor(
    public readonly service: string,
    public readonly openUntil: number,
  ) {
    super(
      `Circuit breaker open for ${service} until ${new Date(openUntil).toISOString()}`,
    );
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Atlassian OAuth 2.0 token endpoint (Cloud only). */
export const JIRA_OAUTH_TOKEN_URL = "https://auth.atlassian.com/oauth/token";

/** Circuit breaker: consecutive failures before opening. */
export const CIRCUIT_BREAKER_THRESHOLD = 5;

/** Circuit breaker: how long to stay open (5 minutes). */
export const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// Jira Domain Types -- REST API resource shapes
// ═══════════════════════════════════════════════════════════════════════════

// ─── Status & Category ───────────────────────────────────────────────────────

/**
 * Jira status category. Every status belongs to one of these four categories,
 * which provide a universal fallback for status mapping across workflows.
 */
export interface JiraStatusCategory {
  id: number;
  key: string; // "new" | "indeterminate" | "done" | "undefined"
  name: string; // "To Do" | "In Progress" | "Done" | "No Category"
  colorName: string;
}

export interface JiraStatus {
  id: string;
  name: string;
  description?: string;
  statusCategory: JiraStatusCategory;
}

// ─── Issue Type & Priority ───────────────────────────────────────────────────

export interface JiraIssueType {
  id: string;
  name: string;
  description?: string;
  subtask: boolean;
  iconUrl?: string;
}

export interface JiraPriority {
  id: string;
  name: string;
  iconUrl?: string;
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
  active: boolean;
  accountType?: string; // "atlassian" | "app" | "customer"
}

// ─── Project ─────────────────────────────────────────────────────────────────

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  description?: string;
  lead?: JiraUser;
  projectTypeKey?: string; // "software" | "business" | "service_desk"
  avatarUrls?: Record<string, string>;
  issueTypes?: JiraIssueType[];
}

// ─── Issue ───────────────────────────────────────────────────────────────────

export interface JiraIssueFields {
  summary: string;
  description?: unknown; // ADF (v3) or string (v2)
  status: JiraStatus;
  issuetype: JiraIssueType;
  priority?: JiraPriority;
  assignee?: JiraUser | null;
  reporter?: JiraUser;
  creator?: JiraUser;
  project: JiraProject;
  labels?: string[];
  created: string; // ISO 8601
  updated: string; // ISO 8601
  resolutiondate?: string | null;
  resolution?: { id: string; name: string } | null;
  components?: Array<{ id: string; name: string }>;
  fixVersions?: Array<{ id: string; name: string }>;
  parent?: { id: string; key: string; fields?: { summary: string } };
  subtasks?: Array<{ id: string; key: string; fields?: { summary: string; status: JiraStatus } }>;
  issuelinks?: JiraIssueLink[];
  comment?: { comments: JiraComment[]; total: number };
  worklog?: { worklogs: unknown[]; total: number };
  timetracking?: {
    originalEstimate?: string;
    remainingEstimate?: string;
    timeSpent?: string;
  };
  sprint?: JiraSprint | null;
  [key: string]: unknown; // custom fields
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
  changelog?: JiraChangelog;
}

// ─── Transitions ─────────────────────────────────────────────────────────────

export interface JiraTransition {
  id: string;
  name: string;
  to: JiraStatus;
  hasScreen: boolean;
  isGlobal: boolean;
  isInitial: boolean;
  isConditional: boolean;
  fields?: Record<string, unknown>;
}

// ─── Comments ────────────────────────────────────────────────────────────────

export interface JiraComment {
  id: string;
  self: string;
  author: JiraUser;
  body: unknown; // ADF (v3) or string (v2)
  created: string;
  updated: string;
  updateAuthor?: JiraUser;
}

// ─── Issue Links ─────────────────────────────────────────────────────────────

export interface JiraIssueLinkType {
  id: string;
  name: string;
  inward: string; // e.g. "is blocked by"
  outward: string; // e.g. "blocks"
}

export interface JiraIssueLink {
  id: string;
  type: JiraIssueLinkType;
  inwardIssue?: { id: string; key: string; fields?: { summary: string; status: JiraStatus } };
  outwardIssue?: { id: string; key: string; fields?: { summary: string; status: JiraStatus } };
}

// ─── Boards ──────────────────────────────────────────────────────────────────

export interface JiraBoard {
  id: number;
  self: string;
  name: string;
  type: string; // "scrum" | "kanban" | "simple"
  location?: {
    projectId: number;
    projectKey: string;
    projectName: string;
  };
}

// ─── Sprints ─────────────────────────────────────────────────────────────────

export interface JiraSprint {
  id: number;
  self: string;
  state: string; // "future" | "active" | "closed"
  name: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  originBoardId?: number;
  goal?: string;
}

// ─── Changelog ───────────────────────────────────────────────────────────────

export interface JiraChangelogItem {
  field: string;
  fieldtype: string;
  from: string | null;
  fromString: string | null;
  to: string | null;
  toString: string | null;
}

export interface JiraChangelogHistory {
  id: string;
  author: JiraUser;
  created: string;
  items: JiraChangelogItem[];
}

export interface JiraChangelog {
  startAt: number;
  maxResults: number;
  total: number;
  histories: JiraChangelogHistory[];
}

// ─── Webhook Payload ─────────────────────────────────────────────────────────

export interface JiraWebhookPayload {
  webhookEvent:
    | "jira:issue_created"
    | "jira:issue_updated"
    | "jira:issue_deleted";
  timestamp: number;
  user?: JiraUser;
  issue?: JiraIssue;
  changelog?: {
    id: string;
    items: JiraChangelogItem[];
  };
}
