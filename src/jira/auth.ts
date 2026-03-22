import type { PluginContext } from "@paperclipai/plugin-sdk";
import type {
  AuthToken,
  JiraApiTokenConfig,
  JiraAuthConfig,
  JiraOAuth2Config,
  JiraOAuthTokenResponse,
  JiraPatConfig,
  RefreshTokenPersister,
  TokenManager,
} from "./types.js";
import { JIRA_OAUTH_TOKEN_URL } from "./types.js";

// ─── OAuth 2.0 3LO Token Manager ────────────────────────────────────────────

/**
 * Manages OAuth 2.0 3LO tokens for Jira Cloud.
 *
 * - Refreshes access tokens via the Atlassian token endpoint.
 * - Deduplicates concurrent refresh calls (refreshPromise pattern).
 * - Uses a 5-minute pre-expiry buffer to avoid serving stale tokens.
 * - Persists rotated refresh tokens via the injected persister callback.
 */
export class OAuth2TokenManager implements TokenManager {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshPromise: Promise<AuthToken> | null = null;
  private currentRefreshToken: string;

  constructor(
    private readonly ctx: PluginContext,
    private readonly config: JiraOAuth2Config,
    private readonly persister: RefreshTokenPersister,
  ) {
    this.currentRefreshToken = config.refreshToken;
  }

  async getToken(): Promise<AuthToken> {
    // Return cached token if still valid (with 5-min buffer)
    if (this.accessToken && Date.now() < this.expiresAt - 5 * 60 * 1000) {
      return { token: this.accessToken, type: "bearer" };
    }

    // Deduplicate concurrent refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.acquireToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async forceRefresh(): Promise<AuthToken> {
    this.accessToken = null;
    this.expiresAt = 0;
    this.refreshPromise = null;
    return this.getToken();
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.forceRefresh();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async acquireToken(): Promise<AuthToken> {
    const clientSecret = await this.ctx.secrets.resolve(
      this.config.clientSecretRef,
    );

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      client_secret: clientSecret,
      refresh_token: this.currentRefreshToken,
    });

    const response = await this.ctx.http.fetch(JIRA_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      this.ctx.logger.error("OAuth token refresh failed", {
        status: response.status,
        body: text.slice(0, 500),
      });
      throw new Error(`OAuth token refresh failed: ${response.status}`);
    }

    const data = (await response.json()) as JiraOAuthTokenResponse;

    // CRITICAL: Persist the rotated refresh token before caching the access token.
    // If this fails, the connection may become permanently broken.
    try {
      await this.persister(data.refresh_token);
      this.currentRefreshToken = data.refresh_token;
    } catch (err) {
      this.ctx.logger.error("Failed to persist rotated refresh token", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Still cache the access token -- the current session can proceed,
      // but the next restart may fail if the old token was already revoked.
    }

    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;

    this.ctx.logger.debug("OAuth token acquired", {
      expiresIn: data.expires_in,
    });

    return { token: this.accessToken, type: "bearer" };
  }
}

// ─── API Token Manager ───────────────────────────────────────────────────────

/**
 * Static Basic auth for Jira Cloud using email + API token.
 *
 * `getToken()` resolves the API token secret on first call and caches
 * the Base64-encoded credential. No refresh logic needed.
 */
export class ApiTokenManager implements TokenManager {
  private cachedToken: string | null = null;

  constructor(
    private readonly ctx: PluginContext,
    private readonly config: JiraApiTokenConfig,
  ) {}

  async getToken(): Promise<AuthToken> {
    if (this.cachedToken) {
      return { token: this.cachedToken, type: "basic" };
    }

    const apiToken = await this.ctx.secrets.resolve(this.config.apiTokenRef);
    this.cachedToken = Buffer.from(
      `${this.config.email}:${apiToken}`,
    ).toString("base64");

    return { token: this.cachedToken, type: "basic" };
  }

  async forceRefresh(): Promise<AuthToken> {
    // Static auth -- re-resolve the secret in case it was rotated externally.
    this.cachedToken = null;
    return this.getToken();
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.forceRefresh();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ─── PAT Token Manager ──────────────────────────────────────────────────────

/**
 * Static Bearer auth for Jira Server / Data Center using a Personal Access Token.
 *
 * `getToken()` resolves the PAT secret on first call and caches it.
 * No refresh logic needed.
 */
export class PatTokenManager implements TokenManager {
  private cachedToken: string | null = null;

  constructor(
    private readonly ctx: PluginContext,
    private readonly config: JiraPatConfig,
  ) {}

  async getToken(): Promise<AuthToken> {
    if (this.cachedToken) {
      return { token: this.cachedToken, type: "bearer" };
    }

    this.cachedToken = await this.ctx.secrets.resolve(this.config.patRef);
    return { token: this.cachedToken, type: "bearer" };
  }

  async forceRefresh(): Promise<AuthToken> {
    // Static auth -- re-resolve the secret in case it was rotated externally.
    this.cachedToken = null;
    return this.getToken();
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.forceRefresh();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates the appropriate TokenManager implementation based on the auth config.
 *
 * @param ctx       Plugin context (for secrets, HTTP, logging)
 * @param config    Discriminated auth config (oauth2 | api_token | pat)
 * @param persister Callback to persist rotated refresh tokens (required for OAuth 2.0)
 */
export function createTokenManager(
  ctx: PluginContext,
  config: JiraAuthConfig,
  persister?: RefreshTokenPersister,
): TokenManager {
  switch (config.method) {
    case "oauth2": {
      if (!persister) {
        throw new Error(
          "OAuth2 auth requires a RefreshTokenPersister callback",
        );
      }
      return new OAuth2TokenManager(ctx, config, persister);
    }
    case "api_token":
      return new ApiTokenManager(ctx, config);
    case "pat":
      return new PatTokenManager(ctx, config);
    default:
      throw new Error(
        `Unknown auth method: ${(config as { method: string }).method}`,
      );
  }
}
