/**
 * ExpressionEditor — Fixed/Expression toggle for workflow node fields.
 *
 * In Fixed mode, renders the child input as-is (pass-through).
 * In Expression mode, switches to a {{ }} expression textarea with
 * variable autocomplete and live preview.
 *
 * Storage convention (n8n):
 *   Expression: ={{ $json.firstName }} signed up
 *   Literal:    Hello world
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface ExpressionEditorProps {
  value: string;
  onChange: (value: string) => void;
  expressionEnabled: boolean;
  placeholder?: string;
  rows?: number;
  pipelineVariables?: Record<string, unknown>;
  lastExecutionData?: Record<string, unknown>;
  children?: React.ReactNode;
}

interface AutocompleteItem {
  label: string;
  insert: string;
  description: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** True if stored value is an expression (starts with =) */
function isExpression(val: string): boolean {
  return val.startsWith("=");
}

/** Strip the leading = from an expression value for editing */
function toEditable(val: string): string {
  return isExpression(val) ? val.slice(1) : val;
}

/** Prepend = to mark a value as an expression */
function toStored(val: string): string {
  return `=${val}`;
}

/** Resolve a simple dot-path on an object (e.g. "firstName" on {firstName:"Jo"}) */
function resolvePath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Attempt to resolve an expression for the live preview line */
function resolveExpression(
  expr: string,
  pipelineVars?: Record<string, unknown>,
  execData?: Record<string, unknown>,
): string | null {
  if (!execData && !pipelineVars) return null;

  // Replace each {{ ... }} token
  const resolved = expr.replace(/\{\{\s*(.+?)\s*\}\}/g, (_match, inner: string) => {
    const token = inner.trim();

    // $json.field
    if (token.startsWith("$json.") && execData) {
      const field = token.slice(6);
      const val = resolvePath(execData["$json"] ?? execData, field);
      return val !== undefined ? String(val) : `[${token}]`;
    }

    // $trigger.payload.field
    if (token.startsWith("$trigger.") && execData) {
      const field = token.slice(9);
      const val = resolvePath(execData["$trigger"], field);
      return val !== undefined ? String(val) : `[${token}]`;
    }

    // $context.field
    if (token.startsWith("$context.") && execData) {
      const field = token.slice(9);
      const val = resolvePath(execData["$context"], field);
      return val !== undefined ? String(val) : `[${token}]`;
    }

    // $variables.name
    if (token.startsWith("$variables.") && pipelineVars) {
      const name = token.slice(11);
      const val = pipelineVars[name];
      return val !== undefined ? String(val) : `[${token}]`;
    }

    // $steps["Name"].output.json.field
    if (token.startsWith("$steps[") && execData) {
      const val = resolvePath(
        execData,
        token.replace(/\["/g, ".").replace(/"]/g, "").replace("$steps.", "$steps."),
      );
      return val !== undefined ? String(val) : `[${token}]`;
    }

    return `[${token}]`;
  });

  return resolved;
}

/** Build autocomplete items from available context */
function buildAutocompleteItems(
  pipelineVars?: Record<string, unknown>,
  execData?: Record<string, unknown>,
): AutocompleteItem[] {
  const items: AutocompleteItem[] = [];

  // $json fields from last execution
  const json = execData?.["$json"] ?? execData;
  if (json && typeof json === "object") {
    for (const key of Object.keys(json as Record<string, unknown>)) {
      if (key.startsWith("$")) continue; // skip meta keys
      items.push({
        label: `$json.${key}`,
        insert: `$json.${key}`,
        description: "Previous node output",
      });
    }
  }

  // $trigger fields
  const trigger = execData?.["$trigger"];
  if (trigger && typeof trigger === "object") {
    for (const key of Object.keys(trigger as Record<string, unknown>)) {
      items.push({
        label: `$trigger.${key}`,
        insert: `$trigger.${key}`,
        description: "Trigger data",
      });
    }
  }

  // $context fields
  const ctx = execData?.["$context"];
  if (ctx && typeof ctx === "object") {
    for (const key of Object.keys(ctx as Record<string, unknown>)) {
      items.push({
        label: `$context.${key}`,
        insert: `$context.${key}`,
        description: "Run metadata",
      });
    }
  }

  // $variables
  if (pipelineVars) {
    for (const key of Object.keys(pipelineVars)) {
      items.push({
        label: `$variables.${key}`,
        insert: `$variables.${key}`,
        description: "Workflow variable",
      });
    }
  }

  // Always show base prefixes so there's something even with no data
  const prefixes = ["$json", "$steps", "$trigger", "$context", "$variables"];
  for (const p of prefixes) {
    if (!items.some((i) => i.insert.startsWith(p))) {
      items.push({
        label: p,
        insert: p,
        description:
          p === "$json"
            ? "Previous node output"
            : p === "$steps"
              ? "Specific step output"
              : p === "$trigger"
                ? "Trigger data"
                : p === "$context"
                  ? "Run metadata"
                  : "Workflow variable",
      });
    }
  }

  return items;
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = {
  wrapper: {
    position: "relative" as const,
  } as React.CSSProperties,

  toggleBar: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 4,
  } as React.CSSProperties,

  toggleGroup: {
    display: "inline-flex",
    borderRadius: 4,
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.1)",
  } as React.CSSProperties,

  toggleBtn: (active: boolean): React.CSSProperties => ({
    padding: "2px 10px",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.03em",
    border: "none",
    cursor: "pointer",
    transition: "all 0.15s",
    background: active ? "rgba(99,102,241,0.3)" : "rgba(0,0,0,0.2)",
    color: active ? "#a5b4fc" : "rgba(255,255,255,0.4)",
  }),

  textarea: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid rgba(99,102,241,0.3)",
    background: "rgba(0,0,0,0.35)",
    color: "#e0e0e0",
    fontSize: 13,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
    outline: "none",
    resize: "vertical" as const,
    boxSizing: "border-box" as const,
    lineHeight: 1.5,
    minHeight: 40,
  } as React.CSSProperties,

  fxBadge: {
    position: "absolute" as const,
    top: 30,
    right: 6,
    padding: "1px 5px",
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "monospace",
    borderRadius: 3,
    background: "rgba(99,102,241,0.25)",
    color: "#a5b4fc",
    cursor: "pointer",
    border: "1px solid rgba(99,102,241,0.3)",
    lineHeight: "16px",
    userSelect: "none" as const,
  } as React.CSSProperties,

  preview: {
    marginTop: 4,
    padding: "4px 8px",
    borderRadius: 4,
    background: "rgba(0,0,0,0.2)",
    border: "1px solid rgba(255,255,255,0.05)",
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    fontFamily: "monospace",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
  } as React.CSSProperties,

  previewLabel: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 10,
    marginRight: 6,
  } as React.CSSProperties,

  previewValue: {
    color: "#34d399",
  } as React.CSSProperties,

  previewNoData: {
    color: "rgba(255,255,255,0.25)",
    fontStyle: "italic" as const,
  } as React.CSSProperties,

  dropdown: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    zIndex: 100,
    maxHeight: 180,
    overflowY: "auto" as const,
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(20,20,30,0.98)",
    backdropFilter: "blur(12px)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    padding: "4px 0",
  } as React.CSSProperties,

  dropdownItem: (selected: boolean): React.CSSProperties => ({
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: "monospace",
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: selected ? "rgba(99,102,241,0.2)" : "transparent",
    color: selected ? "#a5b4fc" : "#e0e0e0",
    transition: "background 0.1s",
  }),

  dropdownDesc: {
    fontSize: 10,
    color: "rgba(255,255,255,0.35)",
    marginLeft: 12,
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
} as const;

// ── Component ──────────────────────────────────────────────────────────

export function ExpressionEditor({
  value,
  onChange,
  expressionEnabled,
  placeholder,
  rows = 2,
  pipelineVariables,
  lastExecutionData,
  children,
}: ExpressionEditorProps) {
  const [mode, setMode] = useState<"fixed" | "expression">(
    isExpression(value) ? "expression" : "fixed",
  );
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [cursorInsertPos, setCursorInsertPos] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync mode if value changes externally
  useEffect(() => {
    if (isExpression(value) && mode === "fixed") setMode("expression");
  }, [value, mode]);

  const autocompleteItems = useMemo(
    () => buildAutocompleteItems(pipelineVariables, lastExecutionData),
    [pipelineVariables, lastExecutionData],
  );

  const filteredItems = useMemo(() => {
    if (!filter) return autocompleteItems;
    const lower = filter.toLowerCase();
    return autocompleteItems.filter((item) => item.label.toLowerCase().includes(lower));
  }, [autocompleteItems, filter]);

  // Clamp selected index
  useEffect(() => {
    if (selectedIdx >= filteredItems.length) {
      setSelectedIdx(Math.max(0, filteredItems.length - 1));
    }
  }, [filteredItems.length, selectedIdx]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Mode switching ──────────────────────────────────────────────────

  const switchToExpression = useCallback(() => {
    setMode("expression");
    // If current value is literal, convert to expression with same text
    if (!isExpression(value)) {
      onChange(toStored(value));
    }
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [value, onChange]);

  const switchToFixed = useCallback(() => {
    setMode("fixed");
    setShowDropdown(false);
    // Strip expression prefix — keep the raw text
    if (isExpression(value)) {
      const raw = toEditable(value);
      // If the raw text has no {{ }}, keep it. Otherwise clear to empty.
      const hasExpr = /\{\{.*?\}\}/.test(raw);
      onChange(hasExpr ? "" : raw);
    }
  }, [value, onChange]);

  // ── Text input handling ─────────────────────────────────────────────

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    onChange(toStored(raw));

    // Check if user just typed {{ — open autocomplete
    const cursorPos = e.target.selectionStart;
    const textBefore = raw.slice(0, cursorPos);
    const lastOpen = textBefore.lastIndexOf("{{");
    const lastClose = textBefore.lastIndexOf("}}");

    if (lastOpen > lastClose) {
      // We're inside a {{ ... expression
      const partial = textBefore.slice(lastOpen + 2).trim();
      setFilter(partial);
      setShowDropdown(true);
      setSelectedIdx(0);
      setCursorInsertPos(cursorPos);
    } else {
      setShowDropdown(false);
      setFilter("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDropdown || filteredItems.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, filteredItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertAutocomplete(filteredItems[selectedIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowDropdown(false);
    }
  };

  const insertAutocomplete = (item: AutocompleteItem) => {
    const raw = toEditable(value);
    const cursorPos = cursorInsertPos ?? textareaRef.current?.selectionStart ?? raw.length;
    const textBefore = raw.slice(0, cursorPos);
    const lastOpen = textBefore.lastIndexOf("{{");

    if (lastOpen === -1) {
      setShowDropdown(false);
      return;
    }

    // Replace from {{ to cursor with the full expression + closing }}
    const textAfter = raw.slice(cursorPos);
    const hasClosing = textAfter.trimStart().startsWith("}}");
    const insertion = ` ${item.insert} }}`;
    const newValue =
      raw.slice(0, lastOpen) +
      "{{" +
      insertion +
      (hasClosing ? textAfter.replace(/^\s*\}\}/, "") : textAfter);

    onChange(toStored(newValue));
    setShowDropdown(false);
    setFilter("");

    // Restore cursor after insertion
    const newCursorPos = lastOpen + 2 + insertion.length;
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  // ── Live preview ────────────────────────────────────────────────────

  const previewValue = useMemo(() => {
    if (mode !== "expression" || !isExpression(value)) return null;
    const raw = toEditable(value);
    if (!raw.includes("{{")) return null;
    return resolveExpression(raw, pipelineVariables, lastExecutionData);
  }, [value, mode, pipelineVariables, lastExecutionData]);

  // ── Syntax-highlighted overlay (for display in the textarea region) ─

  // ── Render ──────────────────────────────────────────────────────────

  if (!expressionEnabled) {
    // No toggle available — just render children (the fixed input)
    return <>{children}</>;
  }

  return (
    <div style={styles.wrapper}>
      {/* Toggle bar */}
      <div style={styles.toggleBar}>
        <div style={styles.toggleGroup}>
          <button type="button" style={styles.toggleBtn(mode === "fixed")} onClick={switchToFixed}>
            Fixed
          </button>
          <button
            type="button"
            style={styles.toggleBtn(mode === "expression")}
            onClick={switchToExpression}
          >
            Expression
          </button>
        </div>
      </div>

      {mode === "fixed" ? (
        // Pass-through: render child input
        children
      ) : (
        // Expression editor
        <div style={{ position: "relative" }}>
          <textarea
            ref={textareaRef}
            style={{ ...styles.textarea, height: rows * 24 + 16 }}
            value={toEditable(value)}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? "={{ $json.field }} or literal text"}
            rows={rows}
            spellCheck={false}
          />

          {/* [fx] badge */}
          <span style={styles.fxBadge} onClick={switchToFixed} title="Switch to fixed value">
            fx
          </span>

          {/* Autocomplete dropdown */}
          {showDropdown && filteredItems.length > 0 && (
            <div
              ref={dropdownRef}
              style={{
                ...styles.dropdown,
                top: rows * 24 + 16 + 4,
              }}
            >
              {filteredItems.map((item, idx) => (
                <div
                  key={item.label}
                  style={styles.dropdownItem(idx === selectedIdx)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent textarea blur
                    insertAutocomplete(item);
                  }}
                >
                  <span>{item.label}</span>
                  <span style={styles.dropdownDesc}>{item.description}</span>
                </div>
              ))}
            </div>
          )}

          {/* Live preview */}
          <div style={styles.preview}>
            <span style={styles.previewLabel}>Preview:</span>
            {previewValue != null ? (
              <span style={styles.previewValue}>{previewValue}</span>
            ) : (
              <span style={styles.previewNoData}>No data</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
