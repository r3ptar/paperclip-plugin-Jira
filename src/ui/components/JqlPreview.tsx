import { fieldRow, fieldLabel, textInput } from "../styles.js";

export interface JqlPreviewProps {
  value: string;
  onChange: (jql: string) => void;
}

export function JqlPreview(props: JqlPreviewProps) {
  const { value, onChange } = props;

  return (
    <div style={fieldRow}>
      <div style={fieldLabel}>Sync JQL Filter</div>
      <textarea
        style={{ ...textInput, minHeight: "60px", resize: "vertical", fontFamily: "monospace", fontSize: "13px" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='e.g. project = PROJ AND type != Epic'
      />
      <div style={{ fontSize: "12px", color: "var(--muted-foreground)", marginTop: "2px" }}>
        Only issues matching this JQL query will be synced. Leave empty to sync all issues in the project.
      </div>
    </div>
  );
}
