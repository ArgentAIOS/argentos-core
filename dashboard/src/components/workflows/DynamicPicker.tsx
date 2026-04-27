/**
 * DynamicPicker — Searchable dropdown populated from connector read commands.
 *
 * Resolves a `pickerHint` key against the normalized manifest `pickerHints`
 * or raw manifest `scope.pickerHints`, calls the connector's source command using the bound
 * credential, and renders a filterable dropdown showing `name` / storing `id`.
 *
 * Caches results per credentialId — invalidates when the credential changes.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface DynamicPickerProps {
  connectorId: string;
  credentialId: string;
  pickerHint: string; // Key into manifest.pickerHints or manifest.scope.pickerHints
  manifest: Record<string, unknown>; // The loaded connector manifest
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** gateway.request from useGateway() — passed in by parent */
  gatewayRequest: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
}

interface PickerHintDef {
  kind?: string;
  sourceCommand: string;
  sourceFields: string[];
  selection_surface?: string;
  resource?: string;
}

interface PickerItem {
  id: string;
  name: string;
  meta?: Record<string, unknown>;
}

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; items: PickerItem[] }
  | { status: "error"; message: string };

// ── Result cache (module-level, survives re-renders) ───────────────────

const resultCache = new Map<string, PickerItem[]>();

function cacheKey(connectorId: string, credentialId: string, hint: string): string {
  return `${connectorId}::${credentialId}::${hint}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function normalizePickerHint(raw: unknown): PickerHintDef | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const sourceCommand =
    typeof record.sourceCommand === "string"
      ? record.sourceCommand
      : typeof record.source_command === "string"
        ? record.source_command
        : "";
  const sourceFields =
    asStringArray(record.sourceFields).length > 0
      ? asStringArray(record.sourceFields)
      : asStringArray(record.source_fields);

  if (!sourceCommand || sourceFields.length === 0) {
    return null;
  }

  return {
    kind: typeof record.kind === "string" ? record.kind : undefined,
    sourceCommand,
    sourceFields,
    selection_surface:
      typeof record.selection_surface === "string" ? record.selection_surface : undefined,
    resource: typeof record.resource === "string" ? record.resource : undefined,
  };
}

function resolvePickerHint(
  manifest: Record<string, unknown>,
  pickerHint: string,
): PickerHintDef | null {
  const normalizedHints = asRecord(manifest.pickerHints);
  const normalized = normalizePickerHint(normalizedHints?.[pickerHint]);
  if (normalized) {
    return normalized;
  }

  const scope = asRecord(manifest.scope);
  const rawHints = asRecord(scope?.pickerHints);
  return normalizePickerHint(rawHints?.[pickerHint]);
}

function recordArray(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
}

function extractConnectorItems(result: unknown): Array<Record<string, unknown>> {
  const root = asRecord(result);
  const data = asRecord(root?.data);
  const envelope = asRecord(root?.envelope);
  const envelopeData = asRecord(envelope?.data);
  const candidates = [
    root?.items,
    root?.data,
    data?.items,
    data?.data,
    data?.records,
    envelopeData?.items,
    envelopeData?.data,
    envelopeData?.records,
  ];

  for (const candidate of candidates) {
    const items = recordArray(candidate);
    if (items) {
      return items;
    }
  }
  return [];
}

function displayString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = {
  container: {
    position: "relative" as const,
    width: "100%",
  } as React.CSSProperties,

  input: {
    width: "100%",
    padding: "8px 30px 8px 10px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.3)",
    color: "#e0e0e0",
    fontSize: 13,
    outline: "none",
    cursor: "text",
  } as React.CSSProperties,

  inputFocused: {
    borderColor: "rgba(99,102,241,0.5)",
  } as React.CSSProperties,

  chevron: {
    position: "absolute" as const,
    right: 10,
    top: "50%",
    transform: "translateY(-50%)",
    pointerEvents: "none" as const,
    color: "rgba(255,255,255,0.35)",
    fontSize: 10,
  } as React.CSSProperties,

  dropdown: {
    position: "absolute" as const,
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    maxHeight: 220,
    overflowY: "auto" as const,
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(20,20,28,0.95)",
    backdropFilter: "blur(16px)",
    zIndex: 50,
    padding: "4px 0",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  } as React.CSSProperties,

  option: (highlighted: boolean): React.CSSProperties => ({
    width: "100%",
    padding: "7px 12px",
    background: highlighted ? "rgba(99,102,241,0.15)" : "transparent",
    border: "none",
    color: "#e0e0e0",
    fontSize: 13,
    textAlign: "left" as const,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
    transition: "background 0.1s",
  }),

  optionName: {
    fontWeight: 500,
  } as React.CSSProperties,

  optionMeta: {
    fontSize: 11,
    color: "rgba(255,255,255,0.4)",
    marginLeft: "auto",
  } as React.CSSProperties,

  empty: {
    padding: "12px 14px",
    fontSize: 12,
    color: "rgba(255,255,255,0.35)",
    textAlign: "center" as const,
  } as React.CSSProperties,

  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "12px 14px",
    fontSize: 12,
    color: "rgba(255,255,255,0.45)",
  } as React.CSSProperties,

  error: {
    padding: "10px 14px",
    fontSize: 12,
    color: "#f87171",
    background: "rgba(239,68,68,0.08)",
    borderRadius: 6,
    marginTop: 4,
  } as React.CSSProperties,

  spinner: {
    width: 14,
    height: 14,
    border: "2px solid rgba(255,255,255,0.15)",
    borderTopColor: "rgba(99,102,241,0.7)",
    borderRadius: "50%",
    animation: "dp-spin 0.6s linear infinite",
  } as React.CSSProperties,
};

// ── Highlight helper ───────────────────────────────────────────────────

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) {
    return text;
  }
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return text;
  }
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: "#a5b4fc", fontWeight: 600 }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Component ──────────────────────────────────────────────────────────

export default function DynamicPicker({
  connectorId,
  credentialId,
  pickerHint,
  manifest,
  value,
  onChange,
  placeholder,
  gatewayRequest,
}: DynamicPickerProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Resolve picker hint from manifest ──────────────────────────────

  const hintDef = useMemo<PickerHintDef | null>(() => {
    return resolvePickerHint(manifest, pickerHint);
  }, [manifest, pickerHint]);

  // ── Fetch items ────────────────────────────────────────────────────

  const fetchItems = useCallback(async () => {
    if (!hintDef || !credentialId) {
      return;
    }

    const key = cacheKey(connectorId, credentialId, pickerHint);
    const cached = resultCache.get(key);
    if (cached) {
      setFetchState({ status: "loaded", items: cached });
      return;
    }

    setFetchState({ status: "loading" });
    try {
      const result = await gatewayRequest("workflows.connectorCommand", {
        connectorId,
        command: hintDef.sourceCommand,
        credentialId,
      });

      const rawItems = extractConnectorItems(result);
      const nameField =
        hintDef.sourceFields.find((f) => f === "name" || f === "fullName" || f === "real_name") ??
        hintDef.sourceFields[1] ??
        "name";

      const items: PickerItem[] = rawItems.map((raw) => ({
        id: displayString(raw.id ?? raw.ID),
        name: displayString(raw[nameField] ?? raw.name ?? raw.label ?? raw.id),
        meta: raw,
      }));

      resultCache.set(key, items);
      setFetchState({ status: "loaded", items });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[DynamicPicker] Failed to fetch ${pickerHint}:`, msg);
      setFetchState({
        status: "error",
        message: `Could not load ${hintDef.kind ?? pickerHint} — check credentials`,
      });
    }
  }, [connectorId, credentialId, pickerHint, hintDef, gatewayRequest]);

  // Fetch on mount and when credentialId changes
  useEffect(() => {
    let cancelled = false;
    if (!hintDef || !credentialId) {
      queueMicrotask(() => {
        if (!cancelled) {
          setFetchState({ status: "idle" });
        }
      });
      return () => {
        cancelled = true;
      };
    }
    queueMicrotask(() => {
      if (!cancelled) {
        void fetchItems();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [credentialId, fetchItems, hintDef]);

  // ── Close on outside click ─────────────────────────────────────────

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Filter items ───────────────────────────────────────────────────

  const items = useMemo(
    () => (fetchState.status === "loaded" ? fetchState.items : []),
    [fetchState],
  );
  const filtered = useMemo(() => {
    if (!search) {
      return items;
    }
    const q = search.toLowerCase();
    return items.filter(
      (item) => item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q),
    );
  }, [items, search]);

  // ── Keyboard navigation ────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "Enter") {
          setOpen(true);
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIdx((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIdx((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (focusedIdx >= 0 && focusedIdx < filtered.length) {
            onChange(filtered[focusedIdx].id);
            setSearch("");
            setOpen(false);
          }
          break;
        case "Escape":
          setOpen(false);
          break;
      }
    },
    [open, filtered, focusedIdx, onChange],
  );

  // ── Selected item label ────────────────────────────────────────────

  const selectedLabel = useMemo(() => {
    if (!value) {
      return "";
    }
    const found = items.find((i) => i.id === value);
    return found?.name ?? value;
  }, [value, items]);

  // ── No hint definition — render nothing ────────────────────────────

  if (!hintDef) {
    return (
      <div style={styles.error}>
        Unknown picker hint: <code>{pickerHint}</code>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={styles.container}>
      {/* Keyframe for spinner */}
      <style>{`@keyframes dp-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Search input */}
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          type="text"
          value={open ? search : selectedLabel || search}
          onChange={(e) => {
            setSearch(e.target.value);
            setFocusedIdx(-1);
            if (!open) {
              setOpen(true);
            }
          }}
          onFocus={() => {
            setOpen(true);
            // Clear to show all options when focusing with a selection
            if (value && !search) {
              setSearch("");
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? `Select ${hintDef.kind ?? pickerHint}...`}
          style={{
            ...styles.input,
            ...(open ? styles.inputFocused : {}),
          }}
        />
        <span style={styles.chevron}>{open ? "\u25B2" : "\u25BC"}</span>
      </div>

      {/* Error state */}
      {fetchState.status === "error" && (
        <div style={styles.error}>
          {fetchState.message}
          <button
            onClick={fetchItems}
            style={{
              marginLeft: 8,
              background: "none",
              border: "none",
              color: "#f87171",
              textDecoration: "underline",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div style={styles.dropdown}>
          {fetchState.status === "loading" ? (
            <div style={styles.loading}>
              <div style={styles.spinner} />
              Loading {hintDef.kind ?? pickerHint}...
            </div>
          ) : filtered.length === 0 ? (
            <div style={styles.empty}>
              {items.length === 0 && fetchState.status === "loaded"
                ? `No ${hintDef.kind ?? pickerHint} found`
                : "No results"}
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                style={styles.option(idx === focusedIdx)}
                onMouseEnter={() => setFocusedIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent blur before click fires
                  onChange(item.id);
                  setSearch("");
                  setOpen(false);
                }}
              >
                <span style={styles.optionName}>{highlightMatch(item.name, search)}</span>
                {item.name !== item.id && <span style={styles.optionMeta}>{item.id}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
