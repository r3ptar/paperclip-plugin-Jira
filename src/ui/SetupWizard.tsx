import { useState, useCallback } from "react";
import { usePluginAction, usePluginData } from "@paperclipai/plugin-sdk/ui";
import { WizardStep } from "./components/WizardStep.js";
import { ConnectionStatus } from "./components/ConnectionStatus.js";
import { StatusMappingEditor } from "./components/StatusMappingEditor.js";
import { JqlPreview } from "./components/JqlPreview.js";
import {
  fieldRow,
  fieldLabel,
  textInput,
  selectInput,
  toggleRow,
  toggleLabel,
  successBanner,
  errorBanner,
} from "./styles.js";
import type { SaveConfigResult, JiraProjectItem } from "./types.js";
import type { PaperclipIssueStatus } from "../constants.js";

export interface SetupWizardProps {
  companyId: string | null;
  onComplete: () => void;
}

interface WizardState {
  step: number;
  deploymentMode: string;
  baseUrl: string;
  authMethod: string;
  cloudId: string;
  oauthClientId: string;
  oauthClientSecret: string;
  apiTokenRef: string;
  apiUserEmail: string;
  connectionTested: boolean;
  projectKey: string;
  syncJql: string;
  statusMapping: Record<PaperclipIssueStatus, string>;
  reverseStatusMapping: Record<string, string>;
  enableIssueSync: boolean;
  enableBoards: boolean;
  enableSprints: boolean;
  conflictStrategy: string;
  defaultServiceAccountId: string;
}

const initialState: WizardState = {
  step: 1,
  deploymentMode: "cloud",
  baseUrl: "",
  authMethod: "oauth2",
  cloudId: "",
  oauthClientId: "",
  oauthClientSecret: "",
  apiTokenRef: "",
  apiUserEmail: "",
  connectionTested: false,
  projectKey: "",
  syncJql: "",
  statusMapping: { backlog: "", todo: "", in_progress: "", in_review: "", done: "", blocked: "", cancelled: "" },
  reverseStatusMapping: {},
  enableIssueSync: true,
  enableBoards: false,
  enableSprints: false,
  conflictStrategy: "last_write_wins",
  defaultServiceAccountId: "",
};

const TOTAL_STEPS = 5;

export function SetupWizard(props: SetupWizardProps) {
  const { companyId, onComplete } = props;
  const [state, setState] = useState<WizardState>(initialState);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveConfigResult | null>(null);

  const saveConfig = usePluginAction("save-config");
  const { data: projectsData } = usePluginData<{ items: JiraProjectItem[] }>("jira-projects", {});

  const update = useCallback((patch: Partial<WizardState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  const goNext = () => update({ step: state.step + 1 });
  const goBack = () => update({ step: state.step - 1 });

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = (await saveConfig({
        deploymentMode: state.deploymentMode,
        baseUrl: state.baseUrl,
        authMethod: state.authMethod,
        cloudId: state.cloudId,
        oauthClientId: state.oauthClientId,
        apiTokenRef: state.apiTokenRef,
        apiUserEmail: state.apiUserEmail,
        enableIssueSync: state.enableIssueSync,
        enableBoards: state.enableBoards,
        enableSprints: state.enableSprints,
        projectKey: state.projectKey,
        syncJql: state.syncJql,
        conflictStrategy: state.conflictStrategy,
        statusMapping: state.statusMapping,
        reverseStatusMapping: state.reverseStatusMapping,
        defaultServiceAccountId: state.defaultServiceAccountId,
      })) as SaveConfigResult;
      setSaveResult(res);
      if (res.ok) onComplete();
    } catch (err) {
      setSaveResult({ ok: false, errors: [err instanceof Error ? err.message : "Save failed"] });
    } finally {
      setSaving(false);
    }
  };

  const projects = projectsData?.items ?? [];

  return (
    <div>
      {saveResult && !saveResult.ok && (
        <div style={errorBanner}>{saveResult.errors?.join(", ") ?? "Save failed"}</div>
      )}
      {saveResult?.ok && <div style={successBanner}>Configuration saved successfully!</div>}

      {state.step === 1 && (
        <WizardStep title="Connection" description="Configure your Jira instance connection." stepNumber={1} totalSteps={TOTAL_STEPS} canProceed={state.baseUrl.trim().length > 0} onNext={goNext}>
          <div style={fieldRow}>
            <div style={fieldLabel}>Deployment Mode</div>
            <select style={selectInput} value={state.deploymentMode} onChange={(e) => update({ deploymentMode: e.target.value })}>
              <option value="cloud">Cloud</option>
              <option value="server">Server</option>
              <option value="datacenter">Data Center</option>
            </select>
          </div>
          <div style={fieldRow}>
            <div style={fieldLabel}>Base URL</div>
            <input style={textInput} value={state.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} placeholder="https://myteam.atlassian.net" />
          </div>
          <div style={fieldRow}>
            <div style={fieldLabel}>Auth Method</div>
            <select style={selectInput} value={state.authMethod} onChange={(e) => update({ authMethod: e.target.value })}>
              <option value="oauth2">OAuth 2.0 (Cloud)</option>
              <option value="api_token">API Token (Cloud)</option>
              <option value="pat">Personal Access Token (Server/DC)</option>
            </select>
          </div>
          {state.authMethod === "api_token" && (
            <div style={fieldRow}>
              <div style={fieldLabel}>User Email</div>
              <input style={textInput} value={state.apiUserEmail} onChange={(e) => update({ apiUserEmail: e.target.value })} placeholder="user@example.com" />
            </div>
          )}
          {state.authMethod === "oauth2" && (
            <div style={fieldRow}>
              <div style={fieldLabel}>OAuth Client ID</div>
              <input style={textInput} value={state.oauthClientId} onChange={(e) => update({ oauthClientId: e.target.value })} />
            </div>
          )}
          <ConnectionStatus baseUrl={state.baseUrl} authMethod={state.authMethod} companyId={companyId} />
        </WizardStep>
      )}

      {state.step === 2 && (
        <WizardStep title="Project" description="Select the Jira project to sync with." stepNumber={2} totalSteps={TOTAL_STEPS} canProceed={state.projectKey.length > 0} onNext={goNext} onBack={goBack}>
          <div style={fieldRow}>
            <div style={fieldLabel}>Project</div>
            <select style={selectInput} value={state.projectKey} onChange={(e) => update({ projectKey: e.target.value })}>
              <option value="">Select a project...</option>
              {projects.map((p) => <option key={p.key} value={p.key}>{p.key}: {p.name}</option>)}
            </select>
          </div>
          <JqlPreview value={state.syncJql} onChange={(jql) => update({ syncJql: jql })} />
        </WizardStep>
      )}

      {state.step === 3 && (
        <WizardStep title="Status Mapping" description="Map Paperclip statuses to Jira workflow statuses." stepNumber={3} totalSteps={TOTAL_STEPS} canProceed={true} onNext={goNext} onBack={goBack}>
          <StatusMappingEditor
            projectKey={state.projectKey}
            statusMapping={state.statusMapping}
            reverseStatusMapping={state.reverseStatusMapping}
            onStatusMappingChange={(m) => update({ statusMapping: m as Record<PaperclipIssueStatus, string> })}
            onReverseStatusMappingChange={(m) => update({ reverseStatusMapping: m })}
          />
        </WizardStep>
      )}

      {state.step === 4 && (
        <WizardStep title="Features" description="Enable the features you need." stepNumber={4} totalSteps={TOTAL_STEPS} canProceed={true} onNext={goNext} onBack={goBack}>
          <div style={toggleRow}>
            <input type="checkbox" id="enableIssueSync" checked={state.enableIssueSync} onChange={(e) => update({ enableIssueSync: e.target.checked })} />
            <label htmlFor="enableIssueSync" style={toggleLabel}>Enable Issue Sync</label>
          </div>
          <div style={toggleRow}>
            <input type="checkbox" id="enableBoards" checked={state.enableBoards} onChange={(e) => update({ enableBoards: e.target.checked })} />
            <label htmlFor="enableBoards" style={toggleLabel}>Enable Boards</label>
          </div>
          <div style={toggleRow}>
            <input type="checkbox" id="enableSprints" checked={state.enableSprints} onChange={(e) => update({ enableSprints: e.target.checked })} />
            <label htmlFor="enableSprints" style={toggleLabel}>Enable Sprints</label>
          </div>
          <div style={{ ...fieldRow, marginTop: "16px" }}>
            <div style={fieldLabel}>Conflict Strategy</div>
            <select style={selectInput} value={state.conflictStrategy} onChange={(e) => update({ conflictStrategy: e.target.value })}>
              <option value="last_write_wins">Last Write Wins</option>
              <option value="paperclip_wins">Paperclip Wins</option>
              <option value="jira_wins">Jira Wins</option>
            </select>
          </div>
        </WizardStep>
      )}

      {state.step === 5 && (
        <WizardStep title="Review & Save" description="Review your configuration and save." stepNumber={5} totalSteps={TOTAL_STEPS} canProceed={!saving} onNext={handleSave} onBack={goBack}>
          <div style={{ fontSize: "13px", display: "grid", gap: "6px" }}>
            <div><strong>URL:</strong> {state.baseUrl}</div>
            <div><strong>Mode:</strong> {state.deploymentMode}</div>
            <div><strong>Auth:</strong> {state.authMethod}</div>
            <div><strong>Project:</strong> {state.projectKey}</div>
            <div><strong>Sync:</strong> {state.enableIssueSync ? "Issues" : ""} {state.enableBoards ? "Boards" : ""} {state.enableSprints ? "Sprints" : ""}</div>
            <div><strong>Conflict:</strong> {state.conflictStrategy}</div>
          </div>
        </WizardStep>
      )}
    </div>
  );
}
