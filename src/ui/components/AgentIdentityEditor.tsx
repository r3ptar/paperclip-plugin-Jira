import { useState } from "react";
import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import { card, label, fieldRow, fieldLabel, textInput, selectInput, secondaryButton } from "../styles.js";

export interface AgentIdentityEditorProps {
  companyId: string | null;
  agentIdentityMap: Record<string, string>;
  defaultServiceAccountId: string;
  onMapChange: (map: Record<string, string>) => void;
  onDefaultChange: (accountId: string) => void;
}

export function AgentIdentityEditor(props: AgentIdentityEditorProps) {
  const { companyId, agentIdentityMap, defaultServiceAccountId, onMapChange, onDefaultChange } = props;
  const [newAgentId, setNewAgentId] = useState("");
  const [newAccountId, setNewAccountId] = useState("");

  const { data } = usePluginData<{ items: Array<{ id: string; name: string }> }>("paperclip-agents", {
    companyId: companyId ?? "",
  });

  const agents = data?.items ?? [];
  const mappings = Object.entries(agentIdentityMap);

  const handleAdd = () => {
    if (!newAgentId || !newAccountId) return;
    onMapChange({ ...agentIdentityMap, [newAgentId]: newAccountId });
    setNewAgentId("");
    setNewAccountId("");
  };

  const handleRemove = (agentId: string) => {
    const updated = { ...agentIdentityMap };
    delete updated[agentId];
    onMapChange(updated);
  };

  return (
    <div>
      <div style={card}>
        <div style={label}>Default Service Account</div>
        <div style={{ ...fieldRow, marginTop: "8px" }}>
          <div style={fieldLabel}>Jira Account ID</div>
          <input
            style={textInput}
            value={defaultServiceAccountId}
            onChange={(e) => onDefaultChange(e.target.value)}
            placeholder="e.g. 5b10ac8d82e05b22cc7d4ef5"
          />
          <div style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
            Fallback Jira account for unmapped agents and background jobs.
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={label}>Agent → Jira Account Mapping</div>
        <div style={{ marginTop: "8px" }}>
          {mappings.map(([agentId, accountId]) => {
            const agentName = agents.find((a) => a.id === agentId)?.name ?? agentId;
            return (
              <div key={agentId} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ flex: 1, fontSize: "13px" }}>{agentName}</span>
                <span style={{ flex: 1, fontSize: "13px", fontFamily: "monospace" }}>{accountId}</span>
                <button style={{ ...secondaryButton, padding: "2px 8px", fontSize: "12px" }} onClick={() => handleRemove(agentId)}>
                  Remove
                </button>
              </div>
            );
          })}

          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <select style={{ ...selectInput, flex: 1 }} value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)}>
              <option value="">Select agent...</option>
              {agents
                .filter((a) => !agentIdentityMap[a.id])
                .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input
              style={{ ...textInput, flex: 1 }}
              value={newAccountId}
              onChange={(e) => setNewAccountId(e.target.value)}
              placeholder="Jira Account ID"
            />
            <button style={secondaryButton} onClick={handleAdd} disabled={!newAgentId || !newAccountId}>
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
