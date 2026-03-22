import type React from "react";
import {
  card,
  primaryButton,
  primaryButtonDisabled,
  secondaryButton,
} from "../styles.js";

export interface WizardStepProps {
  title: string;
  description?: string;
  stepNumber: number;
  totalSteps: number;
  canProceed: boolean;
  onNext: () => void;
  onBack?: () => void;
  children: React.ReactNode;
}

export function WizardStep(props: WizardStepProps) {
  const { title, description, stepNumber, totalSteps, canProceed, onNext, onBack, children } = props;
  const isLastStep = stepNumber === totalSteps;
  const progressPct = (stepNumber / totalSteps) * 100;

  return (
    <div style={card}>
      <div style={{ height: "4px", borderRadius: "2px", backgroundColor: "var(--muted)", marginBottom: "16px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progressPct}%`, backgroundColor: "#2563eb", borderRadius: "2px", transition: "width 0.3s ease" }} />
      </div>
      <div style={{ fontSize: "12px", color: "var(--muted-foreground)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
        Step {stepNumber} of {totalSteps}
      </div>
      <h3 style={{ fontSize: "18px", fontWeight: 600, color: "var(--foreground)", margin: "0 0 4px" }}>{title}</h3>
      {description && <p style={{ fontSize: "14px", color: "var(--muted-foreground)", margin: "0 0 16px" }}>{description}</p>}
      <div style={{ marginTop: description ? "0" : "12px" }}>{children}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
        <div>{onBack && <button style={secondaryButton} onClick={onBack}>Back</button>}</div>
        <button disabled={!canProceed} onClick={onNext} style={canProceed ? primaryButton : primaryButtonDisabled}>
          {isLastStep ? "Save & Activate" : "Next"}
        </button>
      </div>
    </div>
  );
}
