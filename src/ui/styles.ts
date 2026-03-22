import type React from "react";

export const card: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "12px",
};

export const label: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--muted-foreground)",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

export const badge = (color: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: "4px",
  fontSize: "12px",
  fontWeight: 600,
  backgroundColor: color,
  color: "#fff",
});

export const fieldRow: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  marginBottom: "12px",
};

export const fieldLabel: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 500,
  color: "var(--foreground)",
};

export const textInput: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "6px",
  border: "1px solid var(--input)",
  fontSize: "14px",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
  color: "var(--foreground)",
  backgroundColor: "var(--background)",
};

export const selectInput: React.CSSProperties = {
  ...textInput,
  appearance: "auto",
};

export const numberInput: React.CSSProperties = {
  ...textInput,
  width: "180px",
};

export const toggleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "8px",
};

export const toggleLabel: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 500,
  color: "var(--foreground)",
  cursor: "pointer",
  userSelect: "none",
};

export const errorText: React.CSSProperties = {
  color: "#dc2626",
  fontSize: "13px",
  margin: "4px 0",
};

export const successBanner: React.CSSProperties = {
  backgroundColor: "#f0fdf4",
  border: "1px solid #bbf7d0",
  borderRadius: "6px",
  padding: "10px 14px",
  color: "#166534",
  fontSize: "14px",
  marginBottom: "12px",
};

export const warningBanner: React.CSSProperties = {
  backgroundColor: "#fffbeb",
  border: "1px solid #fde68a",
  borderRadius: "6px",
  padding: "10px 14px",
  color: "#92400e",
  fontSize: "14px",
  marginBottom: "12px",
};

export const errorBanner: React.CSSProperties = {
  backgroundColor: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: "6px",
  padding: "10px 14px",
  color: "#991b1b",
  fontSize: "14px",
  marginBottom: "12px",
};

export const primaryButton: React.CSSProperties = {
  padding: "8px 20px",
  borderRadius: "6px",
  border: "none",
  backgroundColor: "#2563eb",
  color: "#fff",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
};

export const primaryButtonDisabled: React.CSSProperties = {
  ...primaryButton,
  backgroundColor: "#93c5fd",
  cursor: "not-allowed",
};

export const secondaryButton: React.CSSProperties = {
  padding: "6px 16px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  backgroundColor: "var(--secondary)",
  color: "var(--secondary-foreground)",
  fontSize: "14px",
  cursor: "pointer",
};

export const secondaryButtonDisabled: React.CSSProperties = {
  ...secondaryButton,
  cursor: "not-allowed",
  opacity: 0.6,
};
