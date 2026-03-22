import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { JiraHttpClient } from "../src/jira/client.js";
import {
  CIRCUIT_BREAKER_THRESHOLD,
  CircuitBreakerOpenError,
  JiraApiError,
} from "../src/jira/types.js";
import type { TokenManager, AuthToken } from "../src/jira/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockTokenManager(): TokenManager {
  return {
    getToken: vi
      .fn()
      .mockResolvedValue({ token: "test-token", type: "bearer" } as AuthToken),
    forceRefresh: vi
      .fn()
      .mockResolvedValue({ token: "refreshed-token", type: "bearer" } as AuthToken),
    healthCheck: vi.fn().mockResolvedValue({ ok: true }),
  };
}

/** Build a minimal mock PluginContext with a mock http.fetch. */
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

/** Create a mock Response-like object. */
function mockResponse(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: vi.fn().mockResolvedValue(text),
    json: vi.fn().mockResolvedValue(typeof body === "string" && body ? JSON.parse(body) : body),
  } as unknown as Response;
}

function createClient(
  ctx: ReturnType<typeof createMockContext>,
  tokenManager?: TokenManager,
) {
  return new JiraHttpClient({
    ctx,
    tokenManager: tokenManager ?? createMockTokenManager(),
    siteUrl: "https://acme.atlassian.net",
    defaultApiVersion: "cloud",
    serviceName: "test-service",
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("JiraHttpClient", () => {
  let ctx: ReturnType<typeof createMockContext>;
  let tm: TokenManager;

  beforeEach(() => {
    vi.restoreAllMocks();
    ctx = createMockContext();
    tm = createMockTokenManager();
  });

  // ── URL construction ────────────────────────────────────────────────────

  describe("URL construction", () => {
    it("builds correct URL with cloud API base path for GET", async () => {
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(200, { id: "1" }));

      const client = createClient(ctx, tm);
      const result = await client.get<{ id: string }>("/issue/PROJ-1");

      expect(result).toEqual({ id: "1" });
      expect(ctx.http.fetch).toHaveBeenCalledWith(
        "https://acme.atlassian.net/rest/api/3/issue/PROJ-1",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("uses server API base path when apiVersion is server", async () => {
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(200, {}));

      const client = createClient(ctx, tm);
      await client.get("/issue/PROJ-1", { apiVersion: "server" });

      expect(ctx.http.fetch).toHaveBeenCalledWith(
        "https://acme.atlassian.net/rest/api/2/issue/PROJ-1",
        expect.anything(),
      );
    });

    it("uses agile API base path when apiVersion is agile", async () => {
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(200, {}));

      const client = createClient(ctx, tm);
      await client.get("/board", { apiVersion: "agile" });

      expect(ctx.http.fetch).toHaveBeenCalledWith(
        "https://acme.atlassian.net/rest/agile/1.0/board",
        expect.anything(),
      );
    });

    it("passes absolute URLs through without prepending base", async () => {
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(200, {}));

      const client = createClient(ctx, tm);
      await client.get("https://other.example.com/foo");

      expect(ctx.http.fetch).toHaveBeenCalledWith(
        "https://other.example.com/foo",
        expect.anything(),
      );
    });

    it("strips trailing slashes from siteUrl", async () => {
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(200, {}));

      const client = new JiraHttpClient({
        ctx,
        tokenManager: tm,
        siteUrl: "https://acme.atlassian.net///",
        defaultApiVersion: "cloud",
        serviceName: "test",
      });
      await client.get("/issue/X-1");

      expect(ctx.http.fetch).toHaveBeenCalledWith(
        "https://acme.atlassian.net/rest/api/3/issue/X-1",
        expect.anything(),
      );
    });
  });

  // ── Auth header ─────────────────────────────────────────────────────────

  describe("authorization header", () => {
    it("sends Bearer auth header when token type is bearer", async () => {
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(200, {}));

      const client = createClient(ctx, tm);
      await client.get("/test");

      const callArgs = ctx.http.fetch.mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBe("Bearer test-token");
    });

    it("sends Basic auth header when token type is basic", async () => {
      const basicTm = createMockTokenManager();
      (basicTm.getToken as ReturnType<typeof vi.fn>).mockResolvedValue({
        token: "dXNlcjpwYXNz",
        type: "basic",
      });
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(200, {}));

      const client = createClient(ctx, basicTm);
      await client.get("/test");

      const callArgs = ctx.http.fetch.mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBe("Basic dXNlcjpwYXNz");
    });
  });

  // ── POST body ───────────────────────────────────────────────────────────

  describe("POST", () => {
    it("sends JSON-serialized body", async () => {
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(201, { id: "10001" }));

      const client = createClient(ctx, tm);
      const payload = { fields: { summary: "New issue" } };
      const result = await client.post<{ id: string }>("/issue", payload);

      expect(result).toEqual({ id: "10001" });
      const callArgs = ctx.http.fetch.mock.calls[0];
      expect(callArgs[1].method).toBe("POST");
      expect(callArgs[1].body).toBe(JSON.stringify(payload));
    });
  });

  // ── 204 No Content ─────────────────────────────────────────────────────

  describe("204 No Content", () => {
    it("returns undefined for 204 responses", async () => {
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(204, ""));

      const client = createClient(ctx, tm);
      const result = await client.delete("/issue/PROJ-1");

      expect(result).toBeUndefined();
    });
  });

  // ── 401 token refresh ──────────────────────────────────────────────────

  describe("401 handling", () => {
    it("refreshes token and retries on 401", async () => {
      ctx.http.fetch
        .mockResolvedValueOnce(mockResponse(401, { errorMessages: ["Unauthorized"] }))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const client = createClient(ctx, tm);
      const result = await client.get<{ ok: boolean }>("/me");

      expect(result).toEqual({ ok: true });
      expect(tm.forceRefresh).toHaveBeenCalledOnce();
      expect(ctx.http.fetch).toHaveBeenCalledTimes(2);

      // Second call should use the refreshed token
      const secondCallHeaders = ctx.http.fetch.mock.calls[1][1].headers;
      expect(secondCallHeaders.Authorization).toBe("Bearer refreshed-token");
    });

    it("throws JiraApiError if retry after 401 still fails", async () => {
      ctx.http.fetch
        .mockResolvedValueOnce(mockResponse(401, { errorMessages: ["Unauthorized"] }))
        .mockResolvedValueOnce(
          mockResponse(403, { errorMessages: ["Forbidden"] }),
        );

      const client = createClient(ctx, tm);
      await expect(client.get("/me")).rejects.toThrow(JiraApiError);
    });
  });

  // ── 429 rate limit backoff ─────────────────────────────────────────────

  describe("429 handling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("waits for Retry-After header then retries on 429", async () => {
      ctx.http.fetch
        .mockResolvedValueOnce(
          mockResponse(429, {}, { "Retry-After": "2" }),
        )
        .mockResolvedValueOnce(mockResponse(200, { data: "ok" }));

      const client = createClient(ctx, tm);
      const promise = client.get<{ data: string }>("/search");

      // Advance past the 2-second backoff
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;
      expect(result).toEqual({ data: "ok" });
      expect(ctx.http.fetch).toHaveBeenCalledTimes(2);
    });

    it("clamps Retry-After to minimum of 1 second", async () => {
      ctx.http.fetch
        .mockResolvedValueOnce(
          mockResponse(429, {}, { "Retry-After": "0" }),
        )
        .mockResolvedValueOnce(mockResponse(200, {}));

      const client = createClient(ctx, tm);
      const promise = client.get("/search");

      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(ctx.http.fetch).toHaveBeenCalledTimes(2);
    });

    it("clamps Retry-After to maximum of 120 seconds", async () => {
      ctx.http.fetch
        .mockResolvedValueOnce(
          mockResponse(429, {}, { "Retry-After": "999" }),
        )
        .mockResolvedValueOnce(mockResponse(200, {}));

      const client = createClient(ctx, tm);
      const promise = client.get("/search");

      await vi.advanceTimersByTimeAsync(120_000);
      await promise;

      expect(ctx.http.fetch).toHaveBeenCalledTimes(2);
    });

    it("defaults Retry-After to 10 seconds when header is absent", async () => {
      ctx.http.fetch
        .mockResolvedValueOnce(mockResponse(429, {}))
        .mockResolvedValueOnce(mockResponse(200, {}));

      const client = createClient(ctx, tm);
      const promise = client.get("/search");

      // 9 seconds should not be enough
      await vi.advanceTimersByTimeAsync(9000);
      expect(ctx.http.fetch).toHaveBeenCalledTimes(1);

      // 10 seconds total should trigger the retry
      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(ctx.http.fetch).toHaveBeenCalledTimes(2);
    });
  });

  // ── Circuit breaker ────────────────────────────────────────────────────

  describe("circuit breaker", () => {
    it(`opens after ${CIRCUIT_BREAKER_THRESHOLD} consecutive failures`, async () => {
      const client = createClient(ctx, tm);

      // Fail CIRCUIT_BREAKER_THRESHOLD times
      for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
        ctx.http.fetch.mockResolvedValueOnce(
          mockResponse(500, { errorMessages: ["Internal error"] }),
        );
        await expect(client.get("/fail")).rejects.toThrow(JiraApiError);
      }

      // Next request should be rejected by the circuit breaker without making a fetch
      await expect(client.get("/fail")).rejects.toThrow(CircuitBreakerOpenError);
      // No additional fetch call was made
      expect(ctx.http.fetch).toHaveBeenCalledTimes(CIRCUIT_BREAKER_THRESHOLD);
    });

    it("rejects requests while circuit is open", async () => {
      const client = createClient(ctx, tm);

      // Open the circuit
      for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
        ctx.http.fetch.mockResolvedValueOnce(
          mockResponse(500, { errorMessages: ["fail"] }),
        );
        await expect(client.get("/fail")).rejects.toThrow(JiraApiError);
      }

      // Multiple calls should all be rejected without fetching
      await expect(client.get("/a")).rejects.toThrow(CircuitBreakerOpenError);
      await expect(client.get("/b")).rejects.toThrow(CircuitBreakerOpenError);
      await expect(client.post("/c", {})).rejects.toThrow(CircuitBreakerOpenError);
    });

    it("resets after a successful request", async () => {
      const client = createClient(ctx, tm);

      // Rack up failures (one less than threshold)
      for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD - 1; i++) {
        ctx.http.fetch.mockResolvedValueOnce(
          mockResponse(500, { errorMessages: ["fail"] }),
        );
        await expect(client.get("/fail")).rejects.toThrow(JiraApiError);
      }

      // A success should reset the counter
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(200, {}));
      await client.get("/ok");

      // Now fail again -- should need full threshold to trip
      for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD - 1; i++) {
        ctx.http.fetch.mockResolvedValueOnce(
          mockResponse(500, { errorMessages: ["fail"] }),
        );
        await expect(client.get("/fail")).rejects.toThrow(JiraApiError);
      }

      // Still one short of threshold -- should still make a fetch
      ctx.http.fetch.mockResolvedValueOnce(
        mockResponse(500, { errorMessages: ["fail"] }),
      );
      await expect(client.get("/fail")).rejects.toThrow(JiraApiError);

      // NOW the circuit should be open
      await expect(client.get("/nope")).rejects.toThrow(CircuitBreakerOpenError);
    });

    it("enters half-open state after cooldown expires", async () => {
      vi.useFakeTimers();

      const client = createClient(ctx, tm);

      // Trip the breaker
      for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
        ctx.http.fetch.mockResolvedValueOnce(
          mockResponse(500, { errorMessages: ["fail"] }),
        );
        await expect(client.get("/fail")).rejects.toThrow(JiraApiError);
      }

      // Advance past cooldown (5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      // Should allow a probe request (half-open)
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      const result = await client.get<{ ok: boolean }>("/probe");
      expect(result).toEqual({ ok: true });

      vi.useRealTimers();
    });
  });

  // ── Error parsing ──────────────────────────────────────────────────────

  describe("error parsing", () => {
    it("extracts errorMessages from Jira error body", async () => {
      ctx.http.fetch.mockResolvedValueOnce(
        mockResponse(404, {
          errorMessages: ["Issue does not exist"],
          errors: {},
        }),
      );

      const client = createClient(ctx, tm);
      try {
        await client.get("/issue/NOPE-999");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(JiraApiError);
        const apiErr = err as JiraApiError;
        expect(apiErr.status).toBe(404);
        expect(apiErr.path).toBe("/issue/NOPE-999");
        expect(apiErr.message).toContain("Issue does not exist");
      }
    });

    it("extracts field-level errors from Jira error body", async () => {
      ctx.http.fetch.mockResolvedValueOnce(
        mockResponse(400, {
          errorMessages: [],
          errors: { assignee: "User does not exist" },
        }),
      );

      const client = createClient(ctx, tm);
      try {
        await client.post("/issue", {});
        expect.unreachable("should have thrown");
      } catch (err) {
        const apiErr = err as JiraApiError;
        expect(apiErr.message).toContain("assignee: User does not exist");
      }
    });
  });

  // ── Pagination (listAll) ───────────────────────────────────────────────

  describe("listAll", () => {
    it("paginates through multiple pages", async () => {
      ctx.http.fetch
        .mockResolvedValueOnce(
          mockResponse(200, {
            startAt: 0,
            maxResults: 2,
            total: 5,
            values: [{ id: "1" }, { id: "2" }],
          }),
        )
        .mockResolvedValueOnce(
          mockResponse(200, {
            startAt: 2,
            maxResults: 2,
            total: 5,
            values: [{ id: "3" }, { id: "4" }],
          }),
        )
        .mockResolvedValueOnce(
          mockResponse(200, {
            startAt: 4,
            maxResults: 2,
            total: 5,
            values: [{ id: "5" }],
          }),
        );

      const client = createClient(ctx, tm);
      const results = await client.listAll<{ id: string }>("/board", "values", {
        maxResults: 2,
      });

      expect(results).toEqual([
        { id: "1" },
        { id: "2" },
        { id: "3" },
        { id: "4" },
        { id: "5" },
      ]);
      expect(ctx.http.fetch).toHaveBeenCalledTimes(3);
    });

    it("uses custom resultKey for search endpoint", async () => {
      ctx.http.fetch.mockResolvedValueOnce(
        mockResponse(200, {
          startAt: 0,
          maxResults: 50,
          total: 1,
          issues: [{ id: "10001", key: "PROJ-1" }],
        }),
      );

      const client = createClient(ctx, tm);
      const results = await client.listAll<{ id: string }>(
        "/search?jql=project=PROJ",
        "issues",
      );

      expect(results).toEqual([{ id: "10001", key: "PROJ-1" }]);
    });

    it("stops when isLast is true", async () => {
      ctx.http.fetch.mockResolvedValueOnce(
        mockResponse(200, {
          startAt: 0,
          maxResults: 50,
          total: 100,
          isLast: true,
          values: [{ id: "1" }],
        }),
      );

      const client = createClient(ctx, tm);
      const results = await client.listAll<{ id: string }>("/board");

      expect(results).toHaveLength(1);
      expect(ctx.http.fetch).toHaveBeenCalledTimes(1);
    });

    it("respects maxPages safety cap", async () => {
      // Return pages that always say there are more
      ctx.http.fetch.mockImplementation(() =>
        Promise.resolve(
          mockResponse(200, {
            startAt: 0,
            maxResults: 1,
            total: 9999,
            values: [{ id: "x" }],
          }),
        ),
      );

      const client = createClient(ctx, tm);
      const results = await client.listAll<{ id: string }>("/board", "values", {
        maxResults: 1,
        maxPages: 3,
      });

      expect(results).toHaveLength(3);
      expect(ctx.http.fetch).toHaveBeenCalledTimes(3);
    });

    it("stops when returned array is empty", async () => {
      ctx.http.fetch.mockResolvedValueOnce(
        mockResponse(200, {
          startAt: 0,
          maxResults: 50,
          total: 100,
          values: [],
        }),
      );

      const client = createClient(ctx, tm);
      const results = await client.listAll<{ id: string }>("/board");

      expect(results).toHaveLength(0);
      expect(ctx.http.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // ── Activity logging ───────────────────────────────────────────────────

  describe("activity logging", () => {
    it("logs activity when companyId is set", async () => {
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(200, {}));

      const client = createClient(ctx, tm);
      client.companyId = "company-123";
      await client.get("/test");

      expect(ctx.activity.log).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "company-123",
          message: "Jira API GET /test",
        }),
      );
    });

    it("skips activity logging when silent is true", async () => {
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(200, {}));

      const client = createClient(ctx, tm);
      client.companyId = "company-123";
      await client.get("/test", { silent: true });

      expect(ctx.activity.log).not.toHaveBeenCalled();
    });

    it("skips activity logging when companyId is null", async () => {
      ctx.http.fetch.mockResolvedValueOnce(mockResponse(200, {}));

      const client = createClient(ctx, tm);
      await client.get("/test");

      expect(ctx.activity.log).not.toHaveBeenCalled();
    });
  });
});
