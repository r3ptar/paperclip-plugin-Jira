import { usePluginData, usePluginAction, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import { badge } from "./styles.js";
import type { SyncHealthData } from "./types.js";
import { useState } from "react";

export function JiraDashboardWidget(props: PluginWidgetProps) {
  const { context } = props;
  const { data, loading, error, refresh } = usePluginData<SyncHealthData>("sync-health", {
    companyId: context.companyId,
  });
  const triggerReconcile = usePluginAction("trigger-reconcile");
  const [reconciling, setReconciling] = useState(false);

  if (loading) return <div style={{ padding: "12px" }}>Loading sync health...</div>;
  if (error) return <div style={{ padding: "12px", color: "var(--destructive)" }}>Error loading health</div>;

  const health = data;
  const tokenOk = health?.health?.tokenHealthy ?? false;
  const statusColor = !health?.configured ? "#94a3b8" : tokenOk ? "#16a34a" : "#dc2626";
  const statusText = !health?.configured ? "Not configured" : tokenOk ? "Healthy" : "Unhealthy";

  const handleReconcile = async () => {
    setReconciling(true);
    try {
      await triggerReconcile({});
      refresh();
    } finally {
      setReconciling(false);
    }
  };

  return (
    <div style={{ padding: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <strong>Jira Sync</strong>
        <span style={badge(statusColor)}>{statusText}</span>
      </div>

      <div style={{ fontSize: "13px", display: "grid", gap: "6px" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Tracked Issues</span>
          <span style={{ fontWeight: 600 }}>{health?.trackedIssues ?? 0}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Last Reconcile</span>
          <span style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
            {health?.lastReconcile ? new Date(health.lastReconcile as string).toLocaleTimeString() : "Never"}
          </span>
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
          {health?.enableIssueSync && <span style={badge("#2563eb")}>Issues</span>}
          {health?.enableBoards && <span style={badge("#7c3aed")}>Boards</span>}
          {health?.enableSprints && <span style={badge("#0891b2")}>Sprints</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <button
          onClick={refresh}
          style={{ padding: "4px 12px", borderRadius: "4px", border: "1px solid var(--border)", fontSize: "12px", cursor: "pointer", backgroundColor: "var(--secondary)", color: "var(--secondary-foreground)" }}
        >
          Refresh
        </button>
        {health?.configured && (
          <button
            onClick={handleReconcile}
            disabled={reconciling}
            style={{ padding: "4px 12px", borderRadius: "4px", border: "1px solid var(--border)", fontSize: "12px", cursor: reconciling ? "not-allowed" : "pointer", backgroundColor: "var(--secondary)", color: "var(--secondary-foreground)", opacity: reconciling ? 0.6 : 1 }}
          >
            {reconciling ? "Syncing..." : "Sync Now"}
          </button>
        )}
      </div>
    </div>
  );
}
