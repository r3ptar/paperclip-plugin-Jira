# Jira Plugin HTTP Client -- Design Guidelines

## Architecture Overview

```
Service Layer (IssueService, BoardService, etc.)
        |
        v
   JiraClient  (single instance per connection)
        |   - auth header injection
        |   - 429 backoff / 401 refresh / circuit breaker
        |   - URL construction from apiVersion + path
        v
   TokenManager  (interface -- 3 implementations)
        |
        v
   ctx.http.fetch  (SDK-provided HTTP)
```

## URL Construction Strategy

A single `JiraClient` instance handles all three API families. The base URL
is composed at request time:

```
{siteUrl}{API_BASE_PATHS[apiVersion]}{path}
```

| `apiVersion` | Base Path          | Typical Use              |
| ------------ | ------------------ | ------------------------ |
| `"cloud"`    | `/rest/api/3`      | Issues, projects, users  |
| `"server"`   | `/rest/api/2`      | Server/DC deployments    |
| `"agile"`    | `/rest/agile/1.0`  | Boards, sprints, epics   |

A default is set at construction (usually `"cloud"` or `"server"` depending
on the connection type). Individual calls override with `{ apiVersion: "agile" }`.

**Why not multiple clients?** Circuit breaker state and token caching would
be fragmented. A single client keeps resilience logic unified.

## Authentication

### Three auth methods, one interface

| Method        | Header Format                  | Refresh Behavior                |
| ------------- | ------------------------------ | ------------------------------- |
| OAuth 2.0 3LO | `Authorization: Bearer <tok>` | Refresh via Atlassian endpoint. **New refresh token on every refresh -- must persist immediately.** |
| API Token     | `Authorization: Basic <b64>`   | Static. No refresh.             |
| PAT           | `Authorization: Bearer <tok>`  | Static. No refresh.             |

The `TokenManager` interface returns `{ token, type }` so the client builds
the correct `Authorization` header without knowing which method is in use.

### OAuth 2.0 refresh token rotation

This is the most critical auth implementation detail. Atlassian invalidates
the old refresh token the moment a new one is issued. If the plugin crashes
between receiving the new token and persisting it, the connection is
permanently broken (user must re-authorize).

Mitigation:
1. Persist the new refresh token **before** returning from `getToken()`.
2. Accept a `RefreshTokenPersister` callback at construction so the
   persistence mechanism is injected, not hard-coded.
3. Log a warning if persistence fails -- this is a critical error path.

## Pagination

Jira uses offset-based pagination with `startAt` / `maxResults` / `total`.
The result array key varies by endpoint:

| Endpoint Pattern         | Result Key  |
| ------------------------ | ----------- |
| `/search`                | `"issues"`  |
| `/board`                 | `"values"`  |
| `/sprint/{id}/issue`     | `"issues"`  |
| `/project`               | `"values"`  |
| `/board/{id}/sprint`     | `"values"`  |

The `listAll()` method accepts an explicit `resultKey` parameter (default:
`"values"`). This is simpler and more predictable than runtime heuristics
that inspect the response shape.

Some Agile endpoints also include `isLast: boolean`. The client should
terminate pagination when `startAt >= total` OR `isLast === true`.

## HTTP Method Conventions

- **Create** -- `POST`
- **Update** -- `PUT` (Jira does not use PATCH)
- **Delete** -- `DELETE`
- **Read**   -- `GET`

The client deliberately omits a `patch()` method to prevent misuse.

## Error Handling

### Jira error shape

```json
{
  "errorMessages": ["Issue Does Not Exist"],
  "errors": { "assignee": "User 'x' is not valid" }
}
```

`JiraApiError` carries:
- `status` -- HTTP status code
- `path` -- the requested path
- `jiraError` -- parsed `JiraErrorBody` when the response is valid JSON
- `message` -- first error message or truncated raw body

### Circuit breaker

Identical logic to the M365 plugin:
- 5 consecutive non-OK responses -> circuit opens for 5 minutes.
- During open state, all requests immediately throw `CircuitBreakerOpenError`.
- After cooldown, the next request is a "half-open" probe; success resets.

### 429 backoff

Jira returns `Retry-After` as seconds. The client sleeps for
`min(max(retryAfter, 1), 120)` seconds, then retries once.

### 401 refresh

On a 401, call `tokenManager.forceRefresh()` and retry once. If the retry
also fails, throw `JiraApiError`. For static auth (API Token, PAT),
`forceRefresh()` is a no-op, so the retry is essentially free.

## Required Headers

All requests include:
- `Authorization: Bearer <token>` or `Authorization: Basic <token>`
- `Content-Type: application/json` (unless overridden)
- `Accept: application/json`

## Example Request/Response

### GET an issue

```
GET /rest/api/3/issue/PROJ-123
Authorization: Bearer eyJhbG...
Accept: application/json
```

```json
{
  "id": "10001",
  "key": "PROJ-123",
  "fields": {
    "summary": "Fix login bug",
    "status": { "name": "In Progress" }
  }
}
```

### Search with pagination (listAll)

```ts
const issues = await client.listAll<JiraIssue>(
  "/search?jql=project=PROJ",
  "issues",
  { maxResults: 100 },
);
```

Internally issues pages like:
```
GET /rest/api/3/search?jql=project=PROJ&startAt=0&maxResults=100
GET /rest/api/3/search?jql=project=PROJ&startAt=100&maxResults=100
...until startAt >= total
```

## Rate Limit Headers

Jira Cloud does not consistently return rate-limit budget headers. The
plugin relies on 429 status + `Retry-After` for backoff. No proactive
throttling is implemented (same approach as the M365 plugin).

## Security Notes

- Secrets (client_secret, API token, PAT) are always resolved via
  `ctx.secrets.resolve()`, never stored in plain text in memory longer
  than the scope of a single token acquisition.
- OAuth refresh tokens are persisted through the SDK's connection storage,
  which should be encrypted at rest.
- The `Authorization` header is never logged. Activity logs include method
  and path only.
