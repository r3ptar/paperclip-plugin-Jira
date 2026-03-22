import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ApiTokenManager,
  PatTokenManager,
  OAuth2TokenManager,
  createTokenManager,
} from "../src/jira/auth.js";
import { JIRA_OAUTH_TOKEN_URL } from "../src/jira/types.js";
import type {
  JiraOAuth2Config,
  JiraApiTokenConfig,
  JiraPatConfig,
  JiraOAuthTokenResponse,
} from "../src/jira/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockContext() {
  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    activity: { log: vi.fn() },
    http: { fetch: vi.fn() },
    secrets: { resolve: vi.fn() },
  } as any;
}

function mockTokenResponse(
  overrides: Partial<JiraOAuthTokenResponse> = {},
): Response {
  const body: JiraOAuthTokenResponse = {
    access_token: "new-access-token",
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: "new-refresh-token",
    scope: "read:jira-work",
    ...overrides,
  };
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const oauthConfig: JiraOAuth2Config = {
  method: "oauth2",
  siteUrl: "https://acme.atlassian.net",
  clientId: "client-id-123",
  clientSecretRef: "secret://jira/client-secret",
  refreshToken: "initial-refresh-token",
  cloudId: "cloud-id-abc",
};

const apiTokenConfig: JiraApiTokenConfig = {
  method: "api_token",
  siteUrl: "https://acme.atlassian.net",
  email: "user@example.com",
  apiTokenRef: "secret://jira/api-token",
};

const patConfig: JiraPatConfig = {
  method: "pat",
  siteUrl: "https://jira.corp.com",
  patRef: "secret://jira/pat",
};

// ─── ApiTokenManager ─────────────────────────────────────────────────────────

describe("ApiTokenManager", () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
    ctx.secrets.resolve.mockResolvedValue("my-api-token");
  });

  it("returns Basic auth with base64-encoded email:token", async () => {
    const manager = new ApiTokenManager(ctx, apiTokenConfig);
    const token = await manager.getToken();

    expect(token.type).toBe("basic");

    const decoded = Buffer.from(token.token, "base64").toString("utf-8");
    expect(decoded).toBe("user@example.com:my-api-token");
  });

  it("resolves the secret reference via ctx.secrets.resolve", async () => {
    const manager = new ApiTokenManager(ctx, apiTokenConfig);
    await manager.getToken();

    expect(ctx.secrets.resolve).toHaveBeenCalledWith("secret://jira/api-token");
  });

  it("caches the token after first call", async () => {
    const manager = new ApiTokenManager(ctx, apiTokenConfig);

    await manager.getToken();
    await manager.getToken();
    await manager.getToken();

    // Secret should only be resolved once
    expect(ctx.secrets.resolve).toHaveBeenCalledTimes(1);
  });

  it("re-resolves secret on forceRefresh", async () => {
    const manager = new ApiTokenManager(ctx, apiTokenConfig);

    await manager.getToken();
    ctx.secrets.resolve.mockResolvedValue("rotated-api-token");
    const refreshed = await manager.forceRefresh();

    expect(ctx.secrets.resolve).toHaveBeenCalledTimes(2);
    const decoded = Buffer.from(refreshed.token, "base64").toString("utf-8");
    expect(decoded).toBe("user@example.com:rotated-api-token");
  });

  it("healthCheck returns ok: true on success", async () => {
    const manager = new ApiTokenManager(ctx, apiTokenConfig);
    const health = await manager.healthCheck();
    expect(health).toEqual({ ok: true });
  });

  it("healthCheck returns ok: false with error message on failure", async () => {
    ctx.secrets.resolve.mockRejectedValue(new Error("secret not found"));

    const manager = new ApiTokenManager(ctx, apiTokenConfig);
    const health = await manager.healthCheck();

    expect(health.ok).toBe(false);
    expect(health.error).toBe("secret not found");
  });
});

// ─── PatTokenManager ─────────────────────────────────────────────────────────

describe("PatTokenManager", () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
    ctx.secrets.resolve.mockResolvedValue("pat-secret-value");
  });

  it("returns Bearer auth with the PAT value", async () => {
    const manager = new PatTokenManager(ctx, patConfig);
    const token = await manager.getToken();

    expect(token.type).toBe("bearer");
    expect(token.token).toBe("pat-secret-value");
  });

  it("resolves the PAT secret reference", async () => {
    const manager = new PatTokenManager(ctx, patConfig);
    await manager.getToken();

    expect(ctx.secrets.resolve).toHaveBeenCalledWith("secret://jira/pat");
  });

  it("caches the token after first call", async () => {
    const manager = new PatTokenManager(ctx, patConfig);

    await manager.getToken();
    await manager.getToken();

    expect(ctx.secrets.resolve).toHaveBeenCalledTimes(1);
  });

  it("re-resolves secret on forceRefresh", async () => {
    const manager = new PatTokenManager(ctx, patConfig);

    await manager.getToken();
    ctx.secrets.resolve.mockResolvedValue("new-pat-value");
    const refreshed = await manager.forceRefresh();

    expect(ctx.secrets.resolve).toHaveBeenCalledTimes(2);
    expect(refreshed.token).toBe("new-pat-value");
  });

  it("healthCheck returns ok: true on success", async () => {
    const manager = new PatTokenManager(ctx, patConfig);
    const health = await manager.healthCheck();
    expect(health).toEqual({ ok: true });
  });
});

// ─── OAuth2TokenManager ──────────────────────────────────────────────────────

describe("OAuth2TokenManager", () => {
  let ctx: ReturnType<typeof createMockContext>;
  let persister: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = createMockContext();
    ctx.secrets.resolve.mockResolvedValue("client-secret-value");
    persister = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches access token from Atlassian token endpoint", async () => {
    ctx.http.fetch.mockResolvedValueOnce(mockTokenResponse());

    const manager = new OAuth2TokenManager(ctx, oauthConfig, persister);
    const token = await manager.getToken();

    expect(token.type).toBe("bearer");
    expect(token.token).toBe("new-access-token");
    expect(ctx.http.fetch).toHaveBeenCalledWith(
      JIRA_OAUTH_TOKEN_URL,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
  });

  it("sends correct OAuth2 parameters in the request body", async () => {
    ctx.http.fetch.mockResolvedValueOnce(mockTokenResponse());

    const manager = new OAuth2TokenManager(ctx, oauthConfig, persister);
    await manager.getToken();

    const fetchCall = ctx.http.fetch.mock.calls[0];
    const body = new URLSearchParams(fetchCall[1].body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("client-id-123");
    expect(body.get("client_secret")).toBe("client-secret-value");
    expect(body.get("refresh_token")).toBe("initial-refresh-token");
  });

  it("persists the rotated refresh token", async () => {
    ctx.http.fetch.mockResolvedValueOnce(
      mockTokenResponse({ refresh_token: "rotated-token" }),
    );

    const manager = new OAuth2TokenManager(ctx, oauthConfig, persister);
    await manager.getToken();

    expect(persister).toHaveBeenCalledWith("rotated-token");
  });

  it("uses the rotated refresh token for subsequent refreshes", async () => {
    ctx.http.fetch
      .mockResolvedValueOnce(
        mockTokenResponse({ refresh_token: "second-refresh-token" }),
      )
      .mockResolvedValueOnce(
        mockTokenResponse({ refresh_token: "third-refresh-token" }),
      );

    const manager = new OAuth2TokenManager(ctx, oauthConfig, persister);

    // First call uses initial refresh token
    await manager.getToken();
    let body = new URLSearchParams(ctx.http.fetch.mock.calls[0][1].body);
    expect(body.get("refresh_token")).toBe("initial-refresh-token");

    // Force a refresh to trigger a second token exchange
    await manager.forceRefresh();
    body = new URLSearchParams(ctx.http.fetch.mock.calls[1][1].body);
    expect(body.get("refresh_token")).toBe("second-refresh-token");
  });

  it("caches access token and returns it without re-fetching", async () => {
    ctx.http.fetch.mockResolvedValueOnce(
      mockTokenResponse({ expires_in: 3600 }),
    );

    const manager = new OAuth2TokenManager(ctx, oauthConfig, persister);

    const first = await manager.getToken();
    const second = await manager.getToken();

    expect(first.token).toBe(second.token);
    // Only one HTTP call -- second was served from cache
    expect(ctx.http.fetch).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when token is within 5-minute expiry buffer", async () => {
    ctx.http.fetch
      .mockResolvedValueOnce(mockTokenResponse({ expires_in: 3600 }))
      .mockResolvedValueOnce(
        mockTokenResponse({
          access_token: "second-access-token",
          expires_in: 3600,
        }),
      );

    const manager = new OAuth2TokenManager(ctx, oauthConfig, persister);

    await manager.getToken();

    // Advance to 5 minutes before expiry (3600 - 300 = 3300 seconds)
    vi.advanceTimersByTime(3300 * 1000);

    const token = await manager.getToken();
    expect(token.token).toBe("second-access-token");
    expect(ctx.http.fetch).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent refresh calls", async () => {
    // Make the fetch take a moment to resolve
    let resolveRefresh: (value: Response) => void;
    ctx.http.fetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const manager = new OAuth2TokenManager(ctx, oauthConfig, persister);

    // Fire 3 concurrent getToken calls
    const p1 = manager.getToken();
    const p2 = manager.getToken();
    const p3 = manager.getToken();

    // Resolve the single HTTP call
    resolveRefresh!(mockTokenResponse());

    const [t1, t2, t3] = await Promise.all([p1, p2, p3]);

    // All should return the same token
    expect(t1.token).toBe("new-access-token");
    expect(t2.token).toBe("new-access-token");
    expect(t3.token).toBe("new-access-token");

    // Only one HTTP request was made
    expect(ctx.http.fetch).toHaveBeenCalledTimes(1);
  });

  it("throws when token endpoint returns an error", async () => {
    ctx.http.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue('{"error":"invalid_grant"}'),
    } as unknown as Response);

    const manager = new OAuth2TokenManager(ctx, oauthConfig, persister);

    await expect(manager.getToken()).rejects.toThrow(
      "OAuth token refresh failed: 400",
    );
  });

  it("still caches access token if persister fails", async () => {
    ctx.http.fetch.mockResolvedValueOnce(mockTokenResponse());
    persister.mockRejectedValueOnce(new Error("storage unavailable"));

    const manager = new OAuth2TokenManager(ctx, oauthConfig, persister);
    const token = await manager.getToken();

    // Token should still be returned
    expect(token.token).toBe("new-access-token");
    // Error should be logged
    expect(ctx.logger.error).toHaveBeenCalledWith(
      "Failed to persist rotated refresh token",
      expect.objectContaining({ error: "storage unavailable" }),
    );
  });

  it("forceRefresh invalidates cache and re-acquires", async () => {
    ctx.http.fetch
      .mockResolvedValueOnce(
        mockTokenResponse({ access_token: "token-1" }),
      )
      .mockResolvedValueOnce(
        mockTokenResponse({ access_token: "token-2" }),
      );

    const manager = new OAuth2TokenManager(ctx, oauthConfig, persister);

    const first = await manager.getToken();
    expect(first.token).toBe("token-1");

    const refreshed = await manager.forceRefresh();
    expect(refreshed.token).toBe("token-2");
    expect(ctx.http.fetch).toHaveBeenCalledTimes(2);
  });

  it("healthCheck returns ok: true when token refresh succeeds", async () => {
    ctx.http.fetch.mockResolvedValueOnce(mockTokenResponse());

    const manager = new OAuth2TokenManager(ctx, oauthConfig, persister);
    const health = await manager.healthCheck();

    expect(health).toEqual({ ok: true });
  });

  it("healthCheck returns ok: false when token refresh fails", async () => {
    ctx.http.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue("Unauthorized"),
    } as unknown as Response);

    const manager = new OAuth2TokenManager(ctx, oauthConfig, persister);
    const health = await manager.healthCheck();

    expect(health.ok).toBe(false);
    expect(health.error).toContain("401");
  });
});

// ─── createTokenManager factory ──────────────────────────────────────────────

describe("createTokenManager", () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("returns ApiTokenManager for api_token method", () => {
    const manager = createTokenManager(ctx, apiTokenConfig);
    expect(manager).toBeInstanceOf(ApiTokenManager);
  });

  it("returns PatTokenManager for pat method", () => {
    const manager = createTokenManager(ctx, patConfig);
    expect(manager).toBeInstanceOf(PatTokenManager);
  });

  it("returns OAuth2TokenManager for oauth2 method with persister", () => {
    const persister = vi.fn();
    const manager = createTokenManager(ctx, oauthConfig, persister);
    expect(manager).toBeInstanceOf(OAuth2TokenManager);
  });

  it("throws for oauth2 method without persister", () => {
    expect(() => createTokenManager(ctx, oauthConfig)).toThrow(
      "OAuth2 auth requires a RefreshTokenPersister callback",
    );
  });

  it("throws for unknown auth method", () => {
    const badConfig = { method: "kerberos" } as any;
    expect(() => createTokenManager(ctx, badConfig)).toThrow(
      "Unknown auth method: kerberos",
    );
  });
});
