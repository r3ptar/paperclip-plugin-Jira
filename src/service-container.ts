/**
 * Immutable service container for the Jira plugin.
 *
 * All service instances are constructed once during initialization and
 * bundled into a frozen object. The worker holds a single mutable
 * reference (`let services: ServiceContainer | null`) that is atomically
 * swapped when configuration changes. Each async handler captures the
 * reference into a local `const` on entry, so an in-flight operation is
 * never disrupted by a concurrent config change.
 */

import type { TokenManager, JiraClient } from "./jira/types.js";
import type { AgentIdentityService } from "./services/identity.js";
import type { JiraIssueService } from "./services/issues.js";
import type { JiraProjectService } from "./services/projects.js";
import type { JiraSearchService } from "./services/search.js";
import type { JiraUserService } from "./services/users.js";
import type { JiraBoardService } from "./services/boards.js";
import type { JiraSprintService } from "./services/sprints.js";

export interface ServiceContainer {
  readonly tokenManager: TokenManager;
  readonly client: JiraClient;
  readonly identity: AgentIdentityService;
  readonly issues: JiraIssueService;
  readonly projects: JiraProjectService;
  readonly search: JiraSearchService;
  readonly users: JiraUserService;
  readonly boards: JiraBoardService | null;
  readonly sprints: JiraSprintService | null;
}
