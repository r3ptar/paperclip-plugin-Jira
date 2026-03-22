import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import { card, label, fieldRow, fieldLabel, selectInput, badge } from "../styles.js";
import type { JiraStatusItem } from "../types.js";
import type { PaperclipIssueStatus } from "../../constants.js";

const PAPERCLIP_STATUSES: PaperclipIssueStatus[] = [
  "backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled",
];

const CATEGORY_COLORS: Record<string, string> = {
  new: "#64748b",
  indeterminate: "#2563eb",
  done: "#16a34a",
};

export interface StatusMappingEditorProps {
  projectKey: string;
  statusMapping: Record<string, string>;
  reverseStatusMapping: Record<string, string>;
  onStatusMappingChange: (mapping: Record<string, string>) => void;
  onReverseStatusMappingChange: (mapping: Record<string, string>) => void;
}

export function StatusMappingEditor(props: StatusMappingEditorProps) {
  const { projectKey, statusMapping, reverseStatusMapping, onStatusMappingChange, onReverseStatusMappingChange } = props;

  const { data, loading, error } = usePluginData<{ items: JiraStatusItem[] }>("jira-statuses", {
    projectKey,
  });

  const jiraStatuses = data?.items ?? [];

  if (!projectKey) {
    return <div style={{ color: "var(--muted-foreground)", fontSize: "13px" }}>Select a project first to configure status mapping.</div>;
  }

  if (loading) return <div>Loading project statuses...</div>;
  if (error) return <div style={{ color: "var(--destructive)" }}>Failed to load statuses: {error.message}</div>;

  const handleForwardChange = (pcStatus: string, jiraStatusName: string) => {
    const updated = { ...statusMapping, [pcStatus]: jiraStatusName };
    onStatusMappingChange(updated);
  };

  const handleReverseChange = (jiraStatusName: string, pcStatus: string) => {
    const updated = { ...reverseStatusMapping, [jiraStatusName]: pcStatus };
    onReverseStatusMappingChange(updated);
  };

  return (
    <div>
      <div style={card}>
        <div style={label}>Paperclip → Jira</div>
        <div style={{ marginTop: "8px" }}>
          {PAPERCLIP_STATUSES.map((pcStatus) => (
            <div key={pcStatus} style={fieldRow}>
              <div style={fieldLabel}>{pcStatus.replace(/_/g, " ")}</div>
              <select
                style={selectInput}
                value={statusMapping[pcStatus] ?? ""}
                onChange={(e) => handleForwardChange(pcStatus, e.target.value)}
              >
                <option value="">— Not mapped —</option>
                {jiraStatuses.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={label}>Jira → Paperclip</div>
        <div style={{ marginTop: "8px" }}>
          {jiraStatuses.map((jiraStatus) => (
            <div key={jiraStatus.id} style={{ ...fieldRow, flexDirection: "row", alignItems: "center", gap: "12px" }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
                <span>{jiraStatus.name}</span>
                <span style={badge(CATEGORY_COLORS[jiraStatus.categoryKey] ?? "#94a3b8")}>
                  {jiraStatus.categoryKey}
                </span>
              </div>
              <select
                style={{ ...selectInput, flex: 1 }}
                value={reverseStatusMapping[jiraStatus.name] ?? ""}
                onChange={(e) => handleReverseChange(jiraStatus.name, e.target.value)}
              >
                <option value="">— Auto (category fallback) —</option>
                {PAPERCLIP_STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
