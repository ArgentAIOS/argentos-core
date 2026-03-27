/**
 * SafetyPanel — Bottom section of every connector node panel.
 *
 * Shows side-effect classification badge, human-readable risk label,
 * approval status, and three action buttons (Test Node, Check Auth, Dry Run).
 * Spec: AOS_CANVAS_NODE_SPEC_FINAL.md §9 (Side-Effect Classification) + §15 (Panel Layout).
 */

import { useState, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface SafetyPanelProps {
  sideEffectLevel: "none" | "external_mutation" | "outbound_delivery";
  operationId: string;
  connectorId: string;
  credentialId?: string;
  onTestNode?: () => void;
  onCheckAuth?: () => void;
  onDryRun?: () => void;
}

type ActionStatus = "idle" | "running" | "success" | "error";

// ── Config maps ────────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<
  SafetyPanelProps["sideEffectLevel"],
  {
    dot: string | null;
    dotColor: string;
    label: string;
    badgeLabel: string;
    approval: string;
  }
> = {
  none: {
    dot: null,
    dotColor: "",
    label: "Safe read operation",
    badgeLabel: "Read Only",
    approval: "Not required (policy: none)",
  },
  external_mutation: {
    dot: "\u{1F7E0}", // 🟠
    dotColor: "#f59e0b",
    label: "Modifies external data",
    badgeLabel: "External Mutation",
    approval: "Optional (policy-driven)",
  },
  outbound_delivery: {
    dot: "\u{1F534}", // 🔴
    dotColor: "#ef4444",
    label: "Sends messages outside ArgentOS",
    badgeLabel: "Outbound Delivery",
    approval: "Recommended",
  },
};

// ── Styles ─────────────────────────────────────────────────────────────

const styles = {
  container: {
    padding: "12px 14px",
    borderRadius: 8,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    backdropFilter: "blur(12px)",
    marginBottom: 12,
  } as React.CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "rgba(255,255,255,0.5)",
    marginBottom: 10,
  } as React.CSSProperties,

  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
    fontSize: 13,
    color: "rgba(255,255,255,0.8)",
  } as React.CSSProperties,

  sideEffectBadge: (color: string): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    background: color
      ? `${color}18` // ~10% opacity hex suffix
      : "rgba(255,255,255,0.06)",
    border: `1px solid ${color || "rgba(255,255,255,0.1)"}40`,
    color: color || "rgba(255,255,255,0.5)",
  }),

  dot: (color: string): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: color,
    boxShadow: `0 0 6px ${color}80`,
    flexShrink: 0,
  }),

  approvalRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "rgba(255,255,255,0.45)",
    marginBottom: 12,
  } as React.CSSProperties,

  buttonRow: {
    display: "flex",
    gap: 6,
    marginTop: 10,
  } as React.CSSProperties,

  actionButton: (status: ActionStatus, disabled: boolean): React.CSSProperties => ({
    padding: "5px 12px",
    borderRadius: 6,
    border: `1px solid ${
      status === "success"
        ? "rgba(52,211,153,0.4)"
        : status === "error"
          ? "rgba(239,68,68,0.4)"
          : "rgba(255,255,255,0.12)"
    }`,
    background:
      status === "success"
        ? "rgba(52,211,153,0.1)"
        : status === "error"
          ? "rgba(239,68,68,0.1)"
          : status === "running"
            ? "rgba(99,102,241,0.15)"
            : "rgba(255,255,255,0.04)",
    color: status === "success" ? "#34d399" : status === "error" ? "#ef4444" : "#c4c4cc",
    fontSize: 11,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "all 0.15s",
    whiteSpace: "nowrap" as const,
  }),

  divider: {
    height: 1,
    background: "rgba(255,255,255,0.06)",
    margin: "8px 0",
  } as React.CSSProperties,

  noCredHint: {
    fontSize: 11,
    color: "rgba(255,255,255,0.3)",
    fontStyle: "italic" as const,
  } as React.CSSProperties,
} as const;

// ── Component ──────────────────────────────────────────────────────────

export function SafetyPanel({
  sideEffectLevel,
  operationId,
  connectorId,
  credentialId,
  onTestNode,
  onCheckAuth,
  onDryRun,
}: SafetyPanelProps) {
  const config = LEVEL_CONFIG[sideEffectLevel];

  const [testStatus, setTestStatus] = useState<ActionStatus>("idle");
  const [authStatus, setAuthStatus] = useState<ActionStatus>("idle");
  const [dryRunStatus, setDryRunStatus] = useState<ActionStatus>("idle");

  const hasCredential = !!credentialId;
  const anyRunning =
    testStatus === "running" || authStatus === "running" || dryRunStatus === "running";

  const runAction = useCallback(
    async (handler: (() => void) | undefined, setStatus: (s: ActionStatus) => void) => {
      if (!handler) return;
      setStatus("running");
      try {
        await Promise.resolve(handler());
        setStatus("success");
      } catch {
        setStatus("error");
      }
      // Reset after 3s
      setTimeout(() => setStatus("idle"), 3000);
    },
    [],
  );

  const buttonLabel = (base: string, status: ActionStatus): string => {
    switch (status) {
      case "running":
        return `${base}...`;
      case "success":
        return `\u2713 ${base}`;
      case "error":
        return `\u2717 ${base}`;
      default:
        return base;
    }
  };

  return (
    <div style={styles.container}>
      {/* Section label */}
      <div style={styles.header}>
        <span style={{ fontSize: 13 }}>&#128737;</span>
        Safety
      </div>

      {/* Side-effect badge */}
      <div style={styles.row}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Side-effect:</span>
        <span style={styles.sideEffectBadge(config.dotColor)}>
          {config.dotColor && <span style={styles.dot(config.dotColor)} />}
          {config.badgeLabel}
        </span>
      </div>

      {/* Human-readable label */}
      <div
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.55)",
          marginBottom: 4,
          paddingLeft: 2,
        }}
      >
        {config.label}
      </div>

      <div style={styles.divider} />

      {/* Approval status */}
      <div style={styles.approvalRow}>
        <span style={{ fontSize: 12 }}>&#128203;</span>
        <span>
          Approval: <strong style={{ color: "rgba(255,255,255,0.65)" }}>{config.approval}</strong>
        </span>
      </div>

      {/* Action buttons */}
      <div style={styles.buttonRow}>
        <button
          type="button"
          style={styles.actionButton(testStatus, !hasCredential || anyRunning)}
          disabled={!hasCredential || anyRunning}
          onClick={() => runAction(onTestNode, setTestStatus)}
          title={
            hasCredential
              ? `Execute ${operationId} on ${connectorId} with real credentials`
              : "Bind a credential first"
          }
        >
          {buttonLabel("Test Node", testStatus)}
        </button>

        <button
          type="button"
          style={styles.actionButton(authStatus, !hasCredential || anyRunning)}
          disabled={!hasCredential || anyRunning}
          onClick={() => runAction(onCheckAuth, setAuthStatus)}
          title={
            hasCredential
              ? "Validate credential against connector health check"
              : "Bind a credential first"
          }
        >
          {buttonLabel("Check Auth", authStatus)}
        </button>

        <button
          type="button"
          style={styles.actionButton(dryRunStatus, !hasCredential || anyRunning)}
          disabled={!hasCredential || anyRunning}
          onClick={() => runAction(onDryRun, setDryRunStatus)}
          title={
            hasCredential
              ? "Execute with dryRun flag — shows what would happen without side effects"
              : "Bind a credential first"
          }
        >
          {buttonLabel("Dry Run", dryRunStatus)}
        </button>
      </div>

      {/* Hint when no credential bound */}
      {!hasCredential && (
        <div style={{ ...styles.noCredHint, marginTop: 8 }}>
          Bind a credential above to enable testing
        </div>
      )}
    </div>
  );
}
