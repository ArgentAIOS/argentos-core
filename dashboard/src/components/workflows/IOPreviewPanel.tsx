/**
 * IOPreviewPanel — Input/Output data preview for connector node panels.
 *
 * Two halves side-by-side:
 *   LEFT  — Input preview: data shape from previous node's output,
 *           collapsible JSON preview from last execution or mock data.
 *   RIGHT — Output preview: standard output ports for this operation,
 *           [Execute Step] and [Set Mock Data] buttons.
 */

import { useState, useMemo, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface OutputPort {
  portId: string;
  kind: string; // "object" | "array" | "string" | etc.
  description: string;
}

export interface IOPreviewPanelProps {
  inputData?: Record<string, unknown>;
  outputPorts: OutputPort[];
  onExecuteStep?: () => void;
  onSetMockData?: (data: Record<string, unknown>) => void;
  lastExecutionOutput?: Record<string, unknown>;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Infer a simple type label for a value */
function typeLabel(val: unknown): string {
  if (val === null) return "null";
  if (Array.isArray(val)) return "array";
  return typeof val;
}

/** Extract field names + types from an object for the shape display */
function extractShape(data: Record<string, unknown>): Array<{ name: string; type: string }> {
  return Object.entries(data).map(([name, val]) => ({
    name,
    type: typeLabel(val),
  }));
}

/** Truncate a JSON string for inline preview */
function truncateJson(val: unknown, maxLen = 120): string {
  const str = JSON.stringify(val);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = {
  container: {
    display: "flex",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    overflow: "hidden",
    minHeight: 140,
  } as React.CSSProperties,

  half: {
    flex: 1,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    minWidth: 0,
  } as React.CSSProperties,

  divider: {
    width: 1,
    background: "rgba(255,255,255,0.08)",
    flexShrink: 0,
  } as React.CSSProperties,

  sectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: "rgba(255,255,255,0.4)",
    marginBottom: 2,
  } as React.CSSProperties,

  fieldRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "2px 0",
  } as React.CSSProperties,

  fieldName: {
    fontSize: 12,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    color: "#e0e0e0",
  } as React.CSSProperties,

  fieldType: {
    fontSize: 10,
    fontFamily: "monospace",
    padding: "1px 6px",
    borderRadius: 3,
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.4)",
  } as React.CSSProperties,

  emptyHint: {
    fontSize: 11,
    color: "rgba(255,255,255,0.25)",
    fontStyle: "italic" as const,
    padding: "8px 0",
  } as React.CSSProperties,

  collapseBtn: {
    fontSize: 10,
    color: "rgba(255,255,255,0.35)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "2px 0",
    textAlign: "left" as const,
    fontFamily: "monospace",
  } as React.CSSProperties,

  jsonBlock: {
    fontSize: 11,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    color: "rgba(255,255,255,0.5)",
    background: "rgba(0,0,0,0.25)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 4,
    padding: "6px 8px",
    maxHeight: 120,
    overflowY: "auto" as const,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    lineHeight: 1.4,
  } as React.CSSProperties,

  portRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 0",
  } as React.CSSProperties,

  portDot: (kind: string): React.CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
    background:
      kind === "object"
        ? "#a5b4fc"
        : kind === "array"
          ? "#34d399"
          : kind === "string"
            ? "#fbbf24"
            : "rgba(255,255,255,0.3)",
  }),

  portName: {
    fontSize: 12,
    fontFamily: "monospace",
    color: "#e0e0e0",
    fontWeight: 600,
  } as React.CSSProperties,

  portDesc: {
    fontSize: 10,
    color: "rgba(255,255,255,0.35)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    minWidth: 0,
  } as React.CSSProperties,

  portValue: {
    fontSize: 10,
    fontFamily: "monospace",
    color: "rgba(52,211,153,0.8)",
    marginLeft: "auto",
    maxWidth: 120,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  } as React.CSSProperties,

  buttonRow: {
    display: "flex",
    gap: 6,
    marginTop: "auto",
    paddingTop: 6,
  } as React.CSSProperties,

  button: (variant: "primary" | "ghost"): React.CSSProperties => ({
    flex: 1,
    padding: "5px 10px",
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
    border:
      variant === "primary" ? "1px solid rgba(99,102,241,0.4)" : "1px solid rgba(255,255,255,0.1)",
    background: variant === "primary" ? "rgba(99,102,241,0.2)" : "transparent",
    color: variant === "primary" ? "#a5b4fc" : "rgba(255,255,255,0.45)",
    textAlign: "center" as const,
  }),

  mockTextarea: {
    width: "100%",
    minHeight: 80,
    padding: "6px 8px",
    borderRadius: 5,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(0,0,0,0.3)",
    color: "#e0e0e0",
    fontSize: 11,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    resize: "vertical" as const,
    outline: "none",
    boxSizing: "border-box" as const,
    lineHeight: 1.4,
  } as React.CSSProperties,

  mockActions: {
    display: "flex",
    gap: 6,
    marginTop: 4,
  } as React.CSSProperties,

  mockError: {
    fontSize: 10,
    color: "#ef4444",
    marginTop: 2,
  } as React.CSSProperties,
} as const;

// ── Component ──────────────────────────────────────────────────────────

export function IOPreviewPanel({
  inputData,
  outputPorts,
  onExecuteStep,
  onSetMockData,
  lastExecutionOutput,
}: IOPreviewPanelProps) {
  const [jsonExpanded, setJsonExpanded] = useState(false);
  const [showMockEditor, setShowMockEditor] = useState(false);
  const [mockJson, setMockJson] = useState("{\n  \n}");
  const [mockError, setMockError] = useState<string | null>(null);

  // ── Input shape ─────────────────────────────────────────────────────

  const inputShape = useMemo(() => {
    if (!inputData) return [];
    return extractShape(inputData);
  }, [inputData]);

  const inputJsonStr = useMemo(() => {
    if (!inputData) return null;
    try {
      return JSON.stringify(inputData, null, 2);
    } catch {
      return null;
    }
  }, [inputData]);

  // ── Mock data handling ──────────────────────────────────────────────

  const handleMockSubmit = useCallback(() => {
    try {
      const parsed = JSON.parse(mockJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setMockError("Must be a JSON object");
        return;
      }
      setMockError(null);
      setShowMockEditor(false);
      onSetMockData?.(parsed);
    } catch (err) {
      setMockError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }, [mockJson, onSetMockData]);

  // ── Render: Left (Input) ────────────────────────────────────────────

  const renderInput = () => (
    <div style={styles.half}>
      <div style={styles.sectionLabel}>Input</div>

      {inputShape.length > 0 ? (
        <>
          {/* Field shape list */}
          {inputShape.map((field) => (
            <div key={field.name} style={styles.fieldRow}>
              <span style={styles.fieldName}>{field.name}</span>
              <span style={styles.fieldType}>{field.type}</span>
            </div>
          ))}

          {/* Collapsible raw JSON */}
          {inputJsonStr && (
            <>
              <button
                type="button"
                style={styles.collapseBtn}
                onClick={() => setJsonExpanded((p) => !p)}
              >
                {jsonExpanded ? "\u25BC" : "\u25B6"} Raw JSON
              </button>
              {jsonExpanded && <div style={styles.jsonBlock}>{inputJsonStr}</div>}
            </>
          )}
        </>
      ) : (
        <div style={styles.emptyHint}>No input data available</div>
      )}
    </div>
  );

  // ── Render: Right (Output) ──────────────────────────────────────────

  const renderOutput = () => (
    <div style={styles.half}>
      <div style={styles.sectionLabel}>Output</div>

      {/* Output ports */}
      {outputPorts.length > 0 ? (
        outputPorts.map((port) => {
          const execVal = lastExecutionOutput?.[port.portId];
          return (
            <div key={port.portId} style={styles.portRow}>
              <span style={styles.portDot(port.kind)} />
              <span style={styles.portName}>{port.portId}</span>
              {execVal !== undefined ? (
                <span style={styles.portValue} title={truncateJson(execVal, 300)}>
                  {truncateJson(execVal, 40)}
                </span>
              ) : (
                <span style={styles.portDesc}>{port.description}</span>
              )}
            </div>
          );
        })
      ) : (
        <div style={styles.emptyHint}>No output ports defined</div>
      )}

      {/* Mock data editor */}
      {showMockEditor && (
        <div style={{ marginTop: 4 }}>
          <textarea
            style={styles.mockTextarea}
            value={mockJson}
            onChange={(e) => {
              setMockJson(e.target.value);
              setMockError(null);
            }}
            spellCheck={false}
            placeholder='{"field": "value"}'
          />
          {mockError && <div style={styles.mockError}>{mockError}</div>}
          <div style={styles.mockActions}>
            <button type="button" style={styles.button("primary")} onClick={handleMockSubmit}>
              Apply
            </button>
            <button
              type="button"
              style={styles.button("ghost")}
              onClick={() => {
                setShowMockEditor(false);
                setMockError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={styles.buttonRow}>
        {onExecuteStep && (
          <button type="button" style={styles.button("primary")} onClick={onExecuteStep}>
            Execute Step
          </button>
        )}
        {onSetMockData && (
          <button
            type="button"
            style={styles.button("ghost")}
            onClick={() => setShowMockEditor((p) => !p)}
          >
            Set Mock Data
          </button>
        )}
      </div>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      {renderInput()}
      <div style={styles.divider} />
      {renderOutput()}
    </div>
  );
}
