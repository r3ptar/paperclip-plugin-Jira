import { useState, useCallback } from "react";
import { usePluginAction } from "@paperclipai/plugin-sdk/ui";
import { secondaryButton, secondaryButtonDisabled } from "../styles.js";
import type { TestConnectionResult } from "../types.js";

export interface ConnectionStatusProps {
  baseUrl: string;
  authMethod: string;
  companyId: string | null;
}

export function ConnectionStatus(props: ConnectionStatusProps) {
  const { baseUrl, companyId } = props;
  const testConnectionAction = usePluginAction("test-connection");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestConnectionResult | null>(null);

  const canTest = baseUrl.trim().length > 0;

  const handleTest = useCallback(async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = (await testConnectionAction({ companyId })) as TestConnectionResult;
      setResult(res);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setTesting(false);
    }
  }, [testConnectionAction, companyId]);

  return (
    <div style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "12px" }}>
      <button
        disabled={testing || !canTest}
        onClick={handleTest}
        style={testing || !canTest ? secondaryButtonDisabled : secondaryButton}
      >
        {testing ? "Testing..." : "Test Connection"}
      </button>
      {result && (
        <span style={{ color: result.ok ? "#16a34a" : "var(--destructive)", fontSize: "14px" }}>
          {result.ok ? "Connection successful" : result.error ?? "Connection failed"}
        </span>
      )}
    </div>
  );
}
