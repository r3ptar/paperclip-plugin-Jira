# Paperclip Plugin for Jira — Implementation Plan

## Context

We have a production Paperclip plugin for Microsoft 365 (`plugin-microsoft-365`) that integrates Planner, SharePoint, Outlook, Teams, People, and Meetings with the Paperclip platform. We want to build an equivalent plugin for Jira, following the exact same architecture, SDK patterns, and file structure. The M365 plugin serves as the blueprint — same SDK APIs, same patterns, adapted for Jira's REST API and workflow model.

The key architectural difference: Jira uses **transition-based workflows** (you can't just set a status field — you must execute a valid transition), and workflows vary per project. This makes status mapping and sync more complex than M365's Planner integration.

---

## Directory Structure

```
plugin-jira/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── CLAUDE.md
├── scripts/
│   └── build-ui.mjs
├── src/
│   ├── index.ts                        # Re-exports manifest + plugin
│   ├── manifest.ts                     # PaperclipPluginManifestV1
│   ├── worker.ts                       # definePlugin() / runWorker()
│   ├── constants.ts                    # All registries, JiraConfig type, defaults
│   ├── jira/
│   │   ├── auth.ts                     # TokenManager (OAuth 2.0 3LO, API token, PAT)
│   │   ├── client.ts                   # JiraClient (circuit breaker, 429 backoff, 401 refresh)
│   │   ├── types.ts                    # Jira REST API types
│   │   └── validate-id.ts             # isValidJiraId(), isValidJiraKey()
│   ├── services/
│   │   ├── identity.ts                 # AgentIdentityService (agent -> Jira accountId)
│   │   ├── issues.ts                   # JiraIssueService (CRUD, transitions, comments, links)
│   │   ├── projects.ts                 # JiraProjectService (projects, issue types, statuses)
│   │   ├── boards.ts                   # JiraBoardService (boards, backlog)
│   │   ├── sprints.ts                  # JiraSprintService (sprint CRUD, move issues)
│   │   ├── users.ts                    # JiraUserService (search, lookup, assignable)
│   │   └── search.ts                   # JiraSearchService (JQL, saved filters)
│   ├── sync/
│   │   ├── status-map.ts              # Transition-aware bidirectional status mapping
│   │   ├── conflict.ts                 # Three strategies (last_write_wins, paperclip_wins, jira_wins)
│   │   └── reconcile.ts               # JQL-based scheduled reconciliation
│   ├── tools/
│   │   ├── jira-search.ts             # JQL search
│   │   ├── jira-get-issue.ts          # Get issue details
│   │   ├── jira-create-issue.ts       # Create issue
│   │   ├── jira-update-issue.ts       # Update issue fields
│   │   ├── jira-transition-issue.ts   # Execute workflow transition
│   │   ├── jira-add-comment.ts        # Add comment
│   │   ├── jira-list-projects.ts      # List projects
│   │   ├── jira-get-project.ts        # Get project details
│   │   ├── jira-list-boards.ts        # List boards
│   │   ├── jira-get-sprint.ts         # Get sprint details
│   │   ├── jira-move-to-sprint.ts     # Move issues to sprint
│   │   ├── jira-assign-issue.ts       # Assign/unassign
│   │   ├── jira-link-issues.ts        # Create issue links
│   │   ├── jira-list-transitions.ts   # List available transitions
│   │   └── jira-get-user.ts           # User lookup
│   ├── webhooks/
│   │   └── jira-issue-webhook.ts      # issue:created, issue:updated, issue:deleted
│   └── ui/
│       ├── index.tsx                   # Re-exports 4 components
│       ├── SettingsPage.tsx            # Config form (wizard + edit mode)
│       ├── SetupWizard.tsx             # Step-by-step connection wizard
│       ├── DashboardWidget.tsx         # Sync health widget
│       ├── IssueTab.tsx                # Linked Jira issue on Paperclip issue
│       ├── ProjectTab.tsx              # Jira project overview on Paperclip project
│       ├── styles.ts                   # Shared CSS-in-JS styles
│       ├── types.ts                    # UI-layer types
│       └── components/
│           ├── AgentIdentityEditor.tsx
│           ├── ConnectionStatus.tsx
│           ├── StatusMappingEditor.tsx  # Paperclip <-> Jira workflow status mapper
│           ├── JqlPreview.tsx           # Live JQL preview for sync scope
│           └── WizardStep.tsx
└── tests/
    ├── conflict.spec.ts
    ├── status-map.spec.ts
    ├── transition-map.spec.ts
    ├── validation.spec.ts
    ├── identity.spec.ts
    ├── webhook-verification.spec.ts
    └── jql-builder.spec.ts
```

---

## Config Type

```typescript
type JiraConfig = {
  // Connection
  deploymentMode: "cloud" | "server" | "datacenter";
  baseUrl: string;                          // "https://myteam.atlassian.net"
  authMethod: "oauth2" | "api_token" | "pat";

  // OAuth 2.0 3LO (Cloud)
  cloudId: string;
  oauthClientId: string;
  oauthClientSecretRef: string;
  oauthRefreshTokenRef: string;

  // API Token (Cloud) / PAT (Server/DC)
  apiTokenRef: string;
  apiUserEmail: string;

  // Feature toggles
  enableIssueSync: boolean;
  enableBoards: boolean;
  enableSprints: boolean;

  // Sync
  projectKey: string;
  syncJql: string;                          // e.g. "project = PROJ AND type != Epic"
  conflictStrategy: "last_write_wins" | "paperclip_wins" | "jira_wins";

  // Status mapping (configurable — Jira workflows vary per project)
  statusMapping: Record<PaperclipIssueStatus, string>;        // paperclip -> jira status name
  reverseStatusMapping: Record<string, PaperclipIssueStatus>; // jira status name -> paperclip

  // Webhook
  webhookSecretRef: string;

  // Agentic Identity
  agentIdentityMap: Record<string, string>;   // agent ID -> Jira accountId
  defaultServiceAccountId: string;
};
```

---

## Key Design Decisions

### 1. Transition-aware sync (biggest difference from M365)

Jira status changes require executing workflow transitions, not setting a field. The sync engine:
- Fetches available transitions via `GET /issue/{key}/transitions`
- Finds the transition whose `to.name` matches the target status
- Falls back to matching by status category (`new`/`indeterminate`/`done`)
- Executes via `POST /issue/{key}/transitions`

### 2. Configurable status mapping

Jira workflows vary per project, so mappings are stored in config (not hardcoded). The `StatusMappingEditor` UI component fetches the project's workflow statuses and lets users map each Paperclip status to a Jira status.

Default fallback uses Jira's universal status categories: `new` -> todo, `indeterminate` -> in_progress, `done` -> done.

### 3. Auth: three methods

| Method | Target | Token type | Refresh? |
|--------|--------|-----------|----------|
| OAuth 2.0 3LO | Cloud | Bearer (access token) | Yes, via refresh token |
| API Token | Cloud | Basic (email:token) | No, static |
| PAT | Server/DC | Bearer (static) | No, static |

OAuth initial authorization (redirect flow) happens in the setup wizard. TokenManager only handles refresh.

### 4. Cloud vs Server API differences

- Cloud: `/rest/api/3` (uses ADF for rich text)
- Server/DC: `/rest/api/2` (uses wiki markup)
- Agile API: `/rest/agile/1.0` (same for both)
- `JiraClient` selects the base path from `config.deploymentMode`
- `JiraIssueService` handles description format differences in create/update

### 5. JQL as sync scope

Instead of syncing all issues, `config.syncJql` defines which issues to track. The reconciliation job uses this JQL directly for batch fetching.

---

## 15 Agent Tools

| Tool | Key Params | Service |
|------|-----------|---------|
| `jira-search` | `jql`, `maxResults?`, `fields?` | SearchService |
| `jira-get-issue` | `issueIdOrKey`, `fields?` | IssueService |
| `jira-create-issue` | `projectKey`, `summary`, `issueType`, `description?`, `priority?`, `labels?`, `assigneeAccountId?` | IssueService |
| `jira-update-issue` | `issueIdOrKey`, `summary?`, `description?`, `priority?`, `labels?` | IssueService |
| `jira-transition-issue` | `issueIdOrKey`, `transitionId`, `comment?`, `resolution?` | IssueService |
| `jira-add-comment` | `issueIdOrKey`, `body` | IssueService |
| `jira-list-projects` | `maxResults?` | ProjectService |
| `jira-get-project` | `projectIdOrKey` | ProjectService |
| `jira-list-boards` | `projectKeyOrId?`, `type?` | BoardService |
| `jira-get-sprint` | `boardId`, `state?` | SprintService |
| `jira-move-to-sprint` | `sprintId`, `issueIds` | SprintService |
| `jira-assign-issue` | `issueIdOrKey`, `accountId?` | IssueService |
| `jira-link-issues` | `inwardIssue`, `outwardIssue`, `linkType` | IssueService |
| `jira-list-transitions` | `issueIdOrKey` | IssueService |
| `jira-get-user` | `accountId?` or `emailAddress?` | UserService |

---

## Webhook Processing

Jira sends webhooks with:
```json
{
  "webhookEvent": "jira:issue_created" | "jira:issue_updated" | "jira:issue_deleted",
  "issue": { "id", "key", "fields": { "status", "summary", ... } },
  "changelog": { "items": [{ "field", "fromString", "toString" }] },
  "timestamp": number
}
```

Flow: verify secret -> parse event -> find tracked entity by externalId -> map status -> update Paperclip issue -> upsert entity tracking.

---

## UI Components

- **SetupWizard**: Cloud/Server selection -> credentials + test -> project selection -> status mapping -> feature toggles -> review
- **SettingsPage**: Dual view (wizard for first-time, form for editing). Feature-toggled sections.
- **StatusMappingEditor**: Two-column editor mapping each Paperclip status to a Jira workflow status (populated from project's workflow)
- **DashboardWidget**: Sync health, tracked issue count, last reconciliation, connection status
- **IssueTab**: Linked Jira issue key (clickable), status, assignee, last synced
- **ProjectTab**: Board overview, active sprint, issue counts by status

---

## Implementation Phases

### Phase 1: Scaffolding + HTTP Client
- Project setup (package.json, tsconfig, vitest, build script)
- `constants.ts` with all registries, `JiraConfig`, `DEFAULT_CONFIG`
- `jira/auth.ts` — TokenManager (all 3 auth methods)
- `jira/client.ts` — JiraClient (circuit breaker, rate limiting, pagination)
- `jira/types.ts` — Jira API types
- `jira/validate-id.ts` — ID/key validation

### Phase 2: Core Services
- `services/issues.ts` — CRUD, transitions, comments, links
- `services/projects.ts` — Projects, issue types, workflow statuses
- `services/users.ts` — User search/lookup
- `services/search.ts` — JQL search
- `services/identity.ts` — Agent identity mapping

### Phase 3: Sync Engine
- `sync/status-map.ts` — Transition-aware mapping with config overrides + category fallback
- `sync/conflict.ts` — Three-strategy conflict resolution
- `sync/reconcile.ts` — JQL-based scheduled reconciliation

### Phase 4: Tools + Webhooks
- All 15 tool handlers in `tools/`
- `webhooks/jira-issue-webhook.ts`

### Phase 5: Worker + Manifest
- `manifest.ts` — Full manifest with tools, jobs, webhooks, UI slots, config schema
- `worker.ts` — Service init, handler registration, lifecycle hooks, event handlers
- `index.ts` — Root exports

### Phase 6: Boards + Sprints
- `services/boards.ts` and `services/sprints.ts`
- Board/sprint tool handlers

### Phase 7: UI
- Settings page + setup wizard
- StatusMappingEditor, JqlPreview components
- Dashboard widget, issue tab, project tab

---

## Reference Files (M365 plugin)

These files serve as direct templates to adapt:

| Purpose | M365 File (absolute path) |
|---------|---------------------------|
| Constants/config registry | `/home/r3ptar/Projects/plugin-microsoft-365/src/constants.ts` |
| Worker lifecycle | `/home/r3ptar/Projects/plugin-microsoft-365/src/worker.ts` |
| HTTP client | `/home/r3ptar/Projects/plugin-microsoft-365/src/graph/client.ts` |
| OAuth token manager | `/home/r3ptar/Projects/plugin-microsoft-365/src/graph/auth.ts` |
| ID validation | `/home/r3ptar/Projects/plugin-microsoft-365/src/graph/validate-id.ts` |
| Service pattern | `/home/r3ptar/Projects/plugin-microsoft-365/src/services/planner.ts` |
| Identity service | `/home/r3ptar/Projects/plugin-microsoft-365/src/services/identity.ts` |
| Status mapping | `/home/r3ptar/Projects/plugin-microsoft-365/src/sync/status-map.ts` |
| Conflict resolution | `/home/r3ptar/Projects/plugin-microsoft-365/src/sync/conflict.ts` |
| Reconciliation | `/home/r3ptar/Projects/plugin-microsoft-365/src/sync/reconcile.ts` |
| Tool handler | `/home/r3ptar/Projects/plugin-microsoft-365/src/tools/sharepoint-search.ts` |
| Webhook handler | `/home/r3ptar/Projects/plugin-microsoft-365/src/webhooks/graph-notifications.ts` |
| Settings UI | `/home/r3ptar/Projects/plugin-microsoft-365/src/ui/SettingsPage.tsx` |
| Setup wizard | `/home/r3ptar/Projects/plugin-microsoft-365/src/ui/SetupWizard.tsx` |
| UI build script | `/home/r3ptar/Projects/plugin-microsoft-365/scripts/build-ui.mjs` |
| Manifest | `/home/r3ptar/Projects/plugin-microsoft-365/src/manifest.ts` |
| Package config | `/home/r3ptar/Projects/plugin-microsoft-365/package.json` |
| TypeScript config | `/home/r3ptar/Projects/plugin-microsoft-365/tsconfig.json` |
| Vitest config | `/home/r3ptar/Projects/plugin-microsoft-365/vitest.config.ts` |
| Root exports | `/home/r3ptar/Projects/plugin-microsoft-365/src/index.ts` |
| API types | `/home/r3ptar/Projects/plugin-microsoft-365/src/graph/types.ts` |

---

## Verification

1. `npm run typecheck` — No type errors
2. `npm test` — All unit tests pass (conflict, status mapping, transitions, validation, identity, webhook verification)
3. `npm run build` — Produces `dist/manifest.js`, `dist/worker.js`, `dist/ui/index.js`
4. Manual: Configure with a Jira Cloud test instance, verify connection test passes
5. Manual: Create a Paperclip issue, verify Jira issue is created with correct status
6. Manual: Transition Jira issue, verify Paperclip issue updates via webhook
7. Manual: Run reconciliation job, verify drift detection and correction
8. Manual: Test each agent tool via Paperclip agent interface
