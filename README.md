# @paperclipai/plugin-jira

Paperclip Plugin SDK v2 integration for Jira -- bidirectional issue sync, workflow transitions, boards, sprints, and 15 agent tools. Supports Jira Cloud, Server, and Data Center.

## Features

- **Bidirectional issue sync** with transition-aware workflow mapping
- **Configurable status mapping** per project (Jira workflows vary)
- **15 agent tools** for search, CRUD, transitions, boards, sprints, and user management
- **Webhook processing** for real-time issue lifecycle events
- **Three auth methods**: OAuth 2.0 3LO, API Token, Personal Access Token
- **Cloud and Server/DC support** with automatic API version selection
- **JQL-based sync scope** -- sync only the issues that matter
- **Three conflict resolution strategies**: last_write_wins, paperclip_wins, jira_wins
- **Setup wizard UI** with guided connection, project selection, and status mapping
- **Dashboard widget** showing sync health, tracked issues, and connection status

## Architecture

```
src/
  jira/         HTTP client layer (JiraClient, TokenManager, types, validation)
  services/     Business logic (issues, projects, boards, sprints, users, search, identity)
  sync/         Sync engine (status mapping, conflict resolution, JQL reconciliation)
  tools/        15 agent tool handlers (one file per tool)
  webhooks/     Jira webhook handler for issue events
  ui/           React components (settings, wizard, dashboard, issue/project tabs)
  manifest.ts   Plugin manifest (tools, jobs, webhooks, UI slots, config schema)
  worker.ts     Plugin entrypoint (definePlugin / runWorker)
  constants.ts  Registries, JiraConfig type, defaults
```

### Transition-Based Workflow Sync

Jira does not allow setting status directly -- you must execute a valid workflow transition. The sync engine:

1. Fetches available transitions via `GET /issue/{key}/transitions`
2. Finds the transition whose `to.name` matches the target status
3. Falls back to matching by status category (`new` / `indeterminate` / `done`)
4. Executes via `POST /issue/{key}/transitions`

Status mappings are stored in config and editable via the `StatusMappingEditor` UI component.

### Cloud vs Server/Data Center

| Aspect | Cloud | Server / Data Center |
|--------|-------|---------------------|
| REST API | `/rest/api/3` | `/rest/api/2` |
| Rich text | ADF (Atlassian Document Format) | Wiki markup |
| Auth | OAuth 2.0 3LO or API Token | PAT (Bearer) |
| Agile API | `/rest/agile/1.0` | `/rest/agile/1.0` |

`JiraClient` selects the correct base path from `config.deploymentMode`. `JiraIssueService` handles description format differences automatically.

### Sync Scope

`config.syncJql` defines which issues are tracked. The reconciliation job uses this JQL directly for batch fetching rather than syncing all issues.

### Authentication

| Method | Deployment | Token Type | Auto-Refresh |
|--------|-----------|-----------|-------------|
| OAuth 2.0 3LO | Cloud | Bearer (access token) | Yes |
| API Token | Cloud | Basic (email:token) | No |
| PAT | Server / DC | Bearer (static) | No |

## Agent Tools

| Tool | Description |
|------|-------------|
| `jira-search` | Search issues using JQL |
| `jira-get-issue` | Get issue details by ID or key |
| `jira-create-issue` | Create a new issue with summary, type, and optional fields |
| `jira-update-issue` | Update fields on an existing issue |
| `jira-transition-issue` | Execute a workflow transition on an issue |
| `jira-add-comment` | Add a comment to an issue |
| `jira-list-projects` | List projects visible to the authenticated user |
| `jira-get-project` | Get project details by ID or key |
| `jira-list-boards` | List boards, optionally filtered by project or type |
| `jira-get-sprint` | List sprints for a board, optionally filtered by state |
| `jira-move-to-sprint` | Move issues into a sprint |
| `jira-assign-issue` | Assign or unassign an issue |
| `jira-link-issues` | Create a link between two issues |
| `jira-list-transitions` | List available workflow transitions for an issue |
| `jira-get-user` | Look up a user by account ID or email |

## Webhook Events

The plugin processes three Jira webhook events:

- `jira:issue_created` -- creates or links a Paperclip issue
- `jira:issue_updated` -- syncs field and status changes (with conflict resolution)
- `jira:issue_deleted` -- marks the tracked entity as removed

Flow: verify webhook secret, parse event, find tracked entity, map status, update Paperclip issue, upsert entity tracking.

## Scheduled Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| `jira-reconcile` | Every 15 minutes | Full bidirectional sync via JQL |
| `token-health-check` | Every 30 minutes | Verify auth credentials are functional |

## UI Components

| Component | Slot Type | Description |
|-----------|-----------|-------------|
| `SettingsPage` | Settings page | Config form (wizard for first-time, form for editing) |
| `SetupWizard` | (embedded) | Step-by-step: deployment mode, credentials, project, status mapping, toggles |
| `DashboardWidget` | Dashboard widget | Sync health, tracked issue count, last reconciliation |
| `IssueTab` | Detail tab (issue) | Linked Jira issue key, status, assignee, last synced |
| `ProjectTab` | Detail tab (project) | Board overview, active sprint, issue counts by status |

Sub-components: `StatusMappingEditor`, `AgentIdentityEditor`, `ConnectionStatus`, `JqlPreview`, `WizardStep`.

## Setup and Configuration

1. **Deployment mode** -- choose Cloud, Server, or Data Center
2. **Authentication** -- configure OAuth 2.0 (Cloud), API Token (Cloud), or PAT (Server/DC)
3. **Project selection** -- set the Jira project key to sync
4. **Status mapping** -- map each Paperclip status to a Jira workflow status using the StatusMappingEditor
5. **Sync scope** -- define a JQL filter for which issues to track
6. **Feature toggles** -- enable/disable issue sync, boards, and sprints independently
7. **Conflict strategy** -- choose `last_write_wins`, `paperclip_wins`, or `jira_wins`

## Build and Development

```bash
npm run build        # TypeScript compile + UI bundle (esbuild)
npm run typecheck    # tsc --noEmit
npm test             # vitest run (all tests)
npm run clean        # rm -rf dist
```

Run a single test file:

```bash
npx vitest run tests/status-map.spec.ts
```

Build output: `dist/manifest.js`, `dist/worker.js`, `dist/ui/index.js`

## Tests

9 test files, 180 tests covering:

| Test File | Coverage Area |
|-----------|--------------|
| `auth.spec.ts` | TokenManager (OAuth refresh, API token, PAT) |
| `client.spec.ts` | JiraClient (circuit breaker, 429 backoff, pagination) |
| `conflict.spec.ts` | Three-strategy conflict resolution |
| `identity.spec.ts` | Agent identity mapping |
| `reconcile.spec.ts` | JQL-based reconciliation engine |
| `status-map.spec.ts` | Bidirectional status mapping with category fallback |
| `tools.spec.ts` | Agent tool handlers |
| `validation.spec.ts` | Jira ID and key validation |
| `webhook-verification.spec.ts` | Webhook secret verification |

## Reference

This plugin follows the same architecture as `plugin-microsoft-365`, which serves as the reference blueprint for SDK patterns, file structure, and conventions. See `IMPLEMENTATION_PLAN.md` for the full 7-phase design document.

## License

MIT
