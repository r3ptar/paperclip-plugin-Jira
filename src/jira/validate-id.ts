/**
 * Validates that a string is a valid Jira numeric ID.
 *
 * Jira IDs are strictly numeric (e.g., "10001").
 * Rejects empty strings, non-numeric characters, decimals, negative signs,
 * path traversal sequences, and whitespace.
 */
const JIRA_ID_RE = /^\d+$/;

export function isValidJiraId(id: string): boolean {
  return JIRA_ID_RE.test(id) && !id.includes("..");
}

/**
 * Validates that a string is a valid Jira issue key.
 *
 * Jira issue keys follow the pattern "PROJ-123" where the project prefix
 * is uppercase letters (optionally with digits and underscores after the
 * first character), followed by a dash and a numeric sequence number.
 *
 * Examples: "PROJ-1", "MY_PROJECT-123", "AB-99999"
 * Rejects: "proj-1", "123-ABC", "PROJ", "PROJ-", path traversal, spaces.
 */
const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;

export function isValidJiraKey(key: string): boolean {
  return JIRA_KEY_RE.test(key) && !key.includes("..");
}
