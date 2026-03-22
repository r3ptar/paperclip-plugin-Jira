import type { PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import { card, label } from "./styles.js";

export function JiraProjectTab(props: PluginDetailTabProps) {
  const { context } = props;

  return (
    <div style={{ padding: "16px" }}>
      <div style={card}>
        <div style={label}>Jira Project</div>
        <div style={{ marginTop: "8px", color: "var(--muted-foreground)", fontSize: "13px" }}>
          Use the <strong>jira-list-boards</strong> and <strong>jira-get-sprint</strong> agent tools to view boards and sprints, or configure the Jira project in the plugin settings.
        </div>
        <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--muted-foreground)" }}>
          Project: {context.entityId}
        </div>
      </div>
    </div>
  );
}
