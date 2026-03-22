import { useState, useCallback, useEffect } from "react";
import { usePluginAction, usePluginData, type PluginSettingsPageProps } from "@paperclipai/plugin-sdk/ui";
import {
  card,
  label,
  fieldRow,
  fieldLabel,
  textInput,
  selectInput,
  toggleRow,
  toggleLabel,
  successBanner,
  errorBanner,
  primaryButton,
  primaryButtonDisabled,
} from "./styles.js";
import type { PluginConfigData, ConfigFormState, SaveConfigResult } from "./types.js";
import { SetupWizard } from "./SetupWizard.js";
import { ConnectionStatus } from "./components/ConnectionStatus.js";
import { StatusMappingEditor } from "./components/StatusMappingEditor.js";
import { JqlPreview } from "./components/JqlPreview.js";
import { AgentIdentityEditor } from "./components/AgentIdentityEditor.js";
import type { PaperclipIssueStatus } from "../constants.js";

function configToFormState(cfg: PluginConfigData): ConfigFormState {
  return {
    deploymentMode: cfg.deploymentMode ?? "cloud",
    baseUrl: cfg.baseUrl ?? "",
    authMethod: cfg.authMethod ?? "oauth2",
    cloudId: "",
    oauthClientId: "",
    oauthClientSecret: "",
    oauthClientSecretRef: "",
    oauthRefreshTokenRef: "",
    apiTokenRef: "",
    apiUserEmail: "",
    enableIssueSync: cfg.enableIssueSync ?? false,
    enableBoards: cfg.enableBoards ?? false,
    enableSprints: cfg.enableSprints ?? false,
    projectKey: cfg.projectKey ?? "",
    syncJql: cfg.syncJql ?? "",
    conflictStrategy: cfg.conflictStrategy ?? "last_write_wins",
    statusMapping: (cfg.statusMapping ?? {}) as Record<PaperclipIssueStatus, string>,
    reverseStatusMapping: cfg.reverseStatusMapping ?? {},
    webhookSecretRef: "",
    agentIdentityMap: cfg.agentIdentityMap ?? {},
    defaultServiceAccountId: cfg.defaultServiceAccountId ?? "",
  };
}

export function JiraSettingsPage(props: PluginSettingsPageProps) {
  const { context } = props;
  const companyId = context.companyId;

  const { data: configData, loading, error: loadError } = usePluginData<PluginConfigData>("plugin-config", {});
  const saveConfigAction = usePluginAction("save-config");

  const [form, setForm] = useState<ConfigFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveConfigResult | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    if (configData && !form) {
      setForm(configToFormState(configData));
      if (!configData.baseUrl) setShowWizard(true);
    }
  }, [configData, form]);

  const updateForm = useCallback((patch: Partial<ConfigFormState>) => {
    setForm((f) => f ? { ...f, ...patch } : f);
  }, []);

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = (await saveConfigAction(form)) as SaveConfigResult;
      setSaveResult(res);
    } catch (err) {
      setSaveResult({ ok: false, errors: [err instanceof Error ? err.message : "Save failed"] });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: "20px" }}>Loading configuration...</div>;
  if (loadError) return <div style={{ padding: "20px", color: "var(--destructive)" }}>Failed to load config: {loadError.message}</div>;

  if (showWizard) {
    return (
      <div style={{ padding: "20px", maxWidth: "640px" }}>
        <SetupWizard companyId={companyId} onComplete={() => setShowWizard(false)} />
      </div>
    );
  }

  if (!form) return null;

  return (
    <div style={{ padding: "20px", maxWidth: "720px" }}>
      <h2 style={{ fontSize: "20px", fontWeight: 600, color: "var(--foreground)", marginTop: 0, marginBottom: "16px" }}>
        Jira Settings
      </h2>

      {saveResult && !saveResult.ok && <div style={errorBanner}>{saveResult.errors?.join(", ") ?? "Save failed"}</div>}
      {saveResult?.ok && <div style={successBanner}>Settings saved successfully!</div>}

      {/* Connection */}
      <div style={card}>
        <div style={label}>Connection</div>
        <div style={{ marginTop: "8px" }}>
          <div style={fieldRow}>
            <div style={fieldLabel}>Deployment Mode</div>
            <select style={selectInput} value={form.deploymentMode} onChange={(e) => updateForm({ deploymentMode: e.target.value })}>
              <option value="cloud">Cloud</option>
              <option value="server">Server</option>
              <option value="datacenter">Data Center</option>
            </select>
          </div>
          <div style={fieldRow}>
            <div style={fieldLabel}>Base URL</div>
            <input style={textInput} value={form.baseUrl} onChange={(e) => updateForm({ baseUrl: e.target.value })} />
          </div>
          <div style={fieldRow}>
            <div style={fieldLabel}>Auth Method</div>
            <select style={selectInput} value={form.authMethod} onChange={(e) => updateForm({ authMethod: e.target.value })}>
              <option value="oauth2">OAuth 2.0</option>
              <option value="api_token">API Token</option>
              <option value="pat">Personal Access Token</option>
            </select>
          </div>
          <ConnectionStatus baseUrl={form.baseUrl} authMethod={form.authMethod} companyId={companyId} />
        </div>
      </div>

      {/* Sync */}
      <div style={card}>
        <div style={label}>Sync Configuration</div>
        <div style={{ marginTop: "8px" }}>
          <div style={fieldRow}>
            <div style={fieldLabel}>Project Key</div>
            <input style={textInput} value={form.projectKey} onChange={(e) => updateForm({ projectKey: e.target.value })} placeholder="e.g. PROJ" />
          </div>
          <JqlPreview value={form.syncJql} onChange={(jql) => updateForm({ syncJql: jql })} />
          <div style={fieldRow}>
            <div style={fieldLabel}>Conflict Strategy</div>
            <select style={selectInput} value={form.conflictStrategy} onChange={(e) => updateForm({ conflictStrategy: e.target.value })}>
              <option value="last_write_wins">Last Write Wins</option>
              <option value="paperclip_wins">Paperclip Wins</option>
              <option value="jira_wins">Jira Wins</option>
            </select>
          </div>
        </div>
      </div>

      {/* Feature Toggles */}
      <div style={card}>
        <div style={label}>Features</div>
        <div style={{ marginTop: "8px" }}>
          <div style={toggleRow}>
            <input type="checkbox" id="settingsIssueSync" checked={form.enableIssueSync} onChange={(e) => updateForm({ enableIssueSync: e.target.checked })} />
            <label htmlFor="settingsIssueSync" style={toggleLabel}>Issue Sync</label>
          </div>
          <div style={toggleRow}>
            <input type="checkbox" id="settingsBoards" checked={form.enableBoards} onChange={(e) => updateForm({ enableBoards: e.target.checked })} />
            <label htmlFor="settingsBoards" style={toggleLabel}>Boards</label>
          </div>
          <div style={toggleRow}>
            <input type="checkbox" id="settingsSprints" checked={form.enableSprints} onChange={(e) => updateForm({ enableSprints: e.target.checked })} />
            <label htmlFor="settingsSprints" style={toggleLabel}>Sprints</label>
          </div>
        </div>
      </div>

      {/* Status Mapping */}
      {form.projectKey && (
        <div style={card}>
          <div style={label}>Status Mapping</div>
          <div style={{ marginTop: "8px" }}>
            <StatusMappingEditor
              projectKey={form.projectKey}
              statusMapping={form.statusMapping}
              reverseStatusMapping={form.reverseStatusMapping}
              onStatusMappingChange={(m) => updateForm({ statusMapping: m as Record<PaperclipIssueStatus, string> })}
              onReverseStatusMappingChange={(m) => updateForm({ reverseStatusMapping: m })}
            />
          </div>
        </div>
      )}

      {/* Agent Identity */}
      <div style={card}>
        <div style={label}>Agent Identity</div>
        <div style={{ marginTop: "8px" }}>
          <AgentIdentityEditor
            companyId={companyId}
            agentIdentityMap={form.agentIdentityMap}
            defaultServiceAccountId={form.defaultServiceAccountId}
            onMapChange={(m) => updateForm({ agentIdentityMap: m })}
            onDefaultChange={(id) => updateForm({ defaultServiceAccountId: id })}
          />
        </div>
      </div>

      {/* Save */}
      <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
        <button disabled={saving} onClick={handleSave} style={saving ? primaryButtonDisabled : primaryButton}>
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
