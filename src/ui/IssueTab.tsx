import { usePluginData, type PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import { card, label, badge } from "./styles.js";
import type { IssueJiraData } from "./types.js";

export function JiraIssueTab(props: PluginDetailTabProps) {
  const { context } = props;
  const { data, loading, error } = usePluginData<IssueJiraData>("issue-jira", {
    companyId: context.companyId,
    issueId: context.entityId,
  });

  if (loading) return <div style={{ padding: "16px" }}>Loading Jira data...</div>;
  if (error) return <div style={{ padding: "16px", color: "var(--destructive)" }}>Error: {error.message}</div>;

  const jiraIssue = data?.jiraIssue;

  return (
    <div style={{ padding: "16px" }}>
      <div style={card}>
        <div style={label}>Linked Jira Issue</div>
        {jiraIssue ? (
          <div style={{ marginTop: "8px" }}>
            <div style={{ fontWeight: 600, fontSize: "15px", color: "var(--foreground)" }}>
              {jiraIssue.data?.jiraIssueKey ?? jiraIssue.externalId}
            </div>
            <div style={{ color: "var(--foreground)", marginTop: "4px" }}>
              {jiraIssue.title ?? "Untitled"}
            </div>
            <div style={{ fontSize: "13px", color: "var(--muted-foreground)", marginTop: "8px", display: "flex", gap: "12px", alignItems: "center" }}>
              <span>
                Status: <span style={badge("#2563eb")}>{jiraIssue.data?.jiraStatus ?? jiraIssue.status ?? "unknown"}</span>
              </span>
              {jiraIssue.data?.assigneeId && (
                <span>Assignee: {jiraIssue.data.assigneeId}</span>
              )}
            </div>
            <div style={{ fontSize: "12px", color: "var(--muted-foreground)", marginTop: "8px" }}>
              Last synced: {jiraIssue.data?.lastSyncedAt
                ? new Date(jiraIssue.data.lastSyncedAt).toLocaleString()
                : "Unknown"}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: "8px", color: "var(--muted-foreground)", fontSize: "13px" }}>
            No linked Jira issue
          </div>
        )}
      </div>
    </div>
  );
}
