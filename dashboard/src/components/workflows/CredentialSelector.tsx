/**
 * CredentialSelector — First field in every connector node panel.
 *
 * Fetches stored credentials via gateway RPC, shows a dropdown filtered
 * by connector type, validates on selection, and supports inline creation
 * for service-key auth types. Nothing renders below this component in
 * the node panel until a credential is bound.
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface CredentialSelectorProps {
  connectorId: string;
  authKind: "service-key" | "oauth2" | "oauth-service-key" | "oauth-local";
  requiredSecrets: string[];
  selectedCredentialId?: string;
  onChange: (credentialId: string | null) => void;
  /** gateway.request from useGateway() — passed in by parent */
  gatewayRequest: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
  gatewayConnected: boolean;
}

interface StoredCredential {
  id: string;
  name: string;
  type: string;
  connectorId?: string;
  createdAt?: string;
  updatedAt?: string;
}

type ValidationState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "valid"; message: string }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

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

  label: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "rgba(255,255,255,0.5)",
    marginBottom: 8,
  } as React.CSSProperties,

  select: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.3)",
    color: "#e0e0e0",
    fontSize: 13,
    outline: "none",
    cursor: "pointer",
    appearance: "none" as const,
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E\")",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center",
    paddingRight: 28,
  } as React.CSSProperties,

  badge: (valid: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 10,
    background: valid ? "rgba(52,211,153,0.15)" : "rgba(239,68,68,0.15)",
    color: valid ? "#34d399" : "#ef4444",
    fontWeight: 500,
  }),

  statusRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    minHeight: 22,
  } as React.CSSProperties,

  button: (variant: "primary" | "ghost"): React.CSSProperties => ({
    padding: variant === "primary" ? "6px 14px" : "4px 10px",
    borderRadius: 6,
    border:
      variant === "primary" ? "1px solid rgba(99,102,241,0.5)" : "1px solid rgba(255,255,255,0.1)",
    background: variant === "primary" ? "rgba(99,102,241,0.2)" : "transparent",
    color: variant === "primary" ? "#a5b4fc" : "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.15s",
  }),

  secretForm: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 6,
    background: "rgba(0,0,0,0.2)",
    border: "1px solid rgba(255,255,255,0.06)",
  } as React.CSSProperties,

  secretInput: {
    width: "100%",
    padding: "7px 10px",
    borderRadius: 5,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(0,0,0,0.25)",
    color: "#e0e0e0",
    fontSize: 12,
    fontFamily: "monospace",
    outline: "none",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,

  secretLabel: {
    fontSize: 11,
    color: "rgba(255,255,255,0.45)",
    fontFamily: "monospace",
  } as React.CSSProperties,

  nameInput: {
    width: "100%",
    padding: "7px 10px",
    borderRadius: 5,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(0,0,0,0.25)",
    color: "#e0e0e0",
    fontSize: 12,
    outline: "none",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,

  spinner: {
    display: "inline-block",
    width: 12,
    height: 12,
    border: "2px solid rgba(255,255,255,0.1)",
    borderTopColor: "#a5b4fc",
    borderRadius: "50%",
    animation: "credential-spin 0.6s linear infinite",
  } as React.CSSProperties,

  emptyHint: {
    fontSize: 12,
    color: "rgba(255,255,255,0.35)",
    textAlign: "center" as const,
    padding: "8px 0",
  } as React.CSSProperties,
} as const;

// ── Keyframe injection (once) ──────────────────────────────────────────

let injected = false;
function injectKeyframes() {
  if (injected) return;
  injected = true;
  const sheet = document.createElement("style");
  sheet.textContent = `@keyframes credential-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(sheet);
}

// ── Component ──────────────────────────────────────────────────────────

export function CredentialSelector({
  connectorId,
  authKind,
  requiredSecrets,
  selectedCredentialId,
  onChange,
  gatewayRequest,
  gatewayConnected,
}: CredentialSelectorProps) {
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [validation, setValidation] = useState<ValidationState>({ status: "idle" });
  const [showManualForm, setShowManualForm] = useState(false);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [credName, setCredName] = useState("");
  const [creating, setCreating] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    injectKeyframes();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Fetch credentials ─────────────────────────────────────────────

  const fetchCredentials = useCallback(async () => {
    if (!gatewayConnected) return;
    setLoading(true);
    try {
      const res = await gatewayRequest<{ credentials?: StoredCredential[] }>("credentials.list", {
        connectorId,
      });
      if (mountedRef.current && res?.credentials) {
        // Filter to credentials matching this connector type
        const filtered = res.credentials.filter(
          (c) => c.connectorId === connectorId || c.type === connectorId,
        );
        setCredentials(filtered);
      }
    } catch {
      // Gateway unavailable — show empty state
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [gatewayConnected, gatewayRequest, connectorId]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  // ── Validate credential ───────────────────────────────────────────

  const validateCredential = useCallback(
    async (credentialId: string) => {
      setValidation({ status: "validating" });
      try {
        const res = await gatewayRequest<{ valid?: boolean; message?: string }>(
          "credentials.validate",
          { credentialId },
        );
        if (!mountedRef.current) return;
        if (res?.valid) {
          setValidation({ status: "valid", message: res.message ?? "Validated" });
        } else {
          setValidation({
            status: "invalid",
            message: res?.message ?? "Validation failed",
          });
        }
      } catch (err) {
        if (!mountedRef.current) return;
        setValidation({
          status: "error",
          message: err instanceof Error ? err.message : "Validation error",
        });
      }
    },
    [gatewayRequest],
  );

  // Auto-validate when credential is selected
  useEffect(() => {
    if (selectedCredentialId) {
      validateCredential(selectedCredentialId);
    } else {
      setValidation({ status: "idle" });
    }
  }, [selectedCredentialId, validateCredential]);

  // ── Create credential (service-key) ───────────────────────────────

  const handleCreate = useCallback(async () => {
    const name = credName.trim();
    if (!name) return;
    const missing = requiredSecrets.filter((k) => !secretValues[k]?.trim());
    if (missing.length > 0) return;

    setCreating(true);
    try {
      const secrets: Record<string, string> = {};
      for (const k of requiredSecrets) {
        secrets[k] = secretValues[k].trim();
      }
      const res = await gatewayRequest<{ id?: string; name?: string }>("credentials.create", {
        name,
        type: connectorId,
        connectorId,
        secrets,
      });
      if (mountedRef.current && res?.id) {
        setShowManualForm(false);
        setSecretValues({});
        setCredName("");
        await fetchCredentials();
        onChange(res.id);
      }
    } catch {
      // creation failed — user can retry
    } finally {
      if (mountedRef.current) setCreating(false);
    }
  }, [
    credName,
    requiredSecrets,
    secretValues,
    gatewayRequest,
    connectorId,
    fetchCredentials,
    onChange,
  ]);

  // ── Handlers ──────────────────────────────────────────────────────

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "__new__") {
      setShowManualForm(true);
      return;
    }
    setShowManualForm(false);
    onChange(val || null);
  };

  const handleOAuthConnect = () => {
    // OAuth flow: open popup or redirect. For now, placeholder that triggers
    // the same manual form — real OAuth will be wired in Phase 2.
    setShowManualForm(true);
  };

  // ── Render helpers ────────────────────────────────────────────────

  const renderValidationBadge = () => {
    switch (validation.status) {
      case "validating":
        return <span style={styles.spinner} title="Validating..." />;
      case "valid":
        return (
          <span style={styles.badge(true)} title={validation.message}>
            &#10003; Verified
          </span>
        );
      case "invalid":
        return (
          <span style={styles.badge(false)} title={validation.message}>
            &#10007; {validation.message}
          </span>
        );
      case "error":
        return (
          <span style={styles.badge(false)} title={validation.message}>
            &#10007; Error
          </span>
        );
      default:
        return null;
    }
  };

  const isOAuth =
    authKind === "oauth2" || authKind === "oauth-service-key" || authKind === "oauth-local";

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      <div style={styles.label}>
        <span style={{ fontSize: 13 }}>&#128268;</span>
        Credential
      </div>

      {loading ? (
        <div style={styles.emptyHint}>
          <span style={styles.spinner} /> Loading credentials...
        </div>
      ) : (
        <>
          {/* Dropdown */}
          <select style={styles.select} value={selectedCredentialId ?? ""} onChange={handleSelect}>
            <option value="">Select a credential...</option>
            {credentials.map((cred) => (
              <option key={cred.id} value={cred.id}>
                {cred.name}
              </option>
            ))}
            <option value="__new__">+ Add new credential</option>
          </select>

          {/* Validation status row */}
          <div style={styles.statusRow}>
            <div>{renderValidationBadge()}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {!selectedCredentialId && !showManualForm && isOAuth && (
                <button type="button" style={styles.button("primary")} onClick={handleOAuthConnect}>
                  Connect
                </button>
              )}
              {!selectedCredentialId && !showManualForm && !isOAuth && (
                <button
                  type="button"
                  style={styles.button("ghost")}
                  onClick={() => setShowManualForm(true)}
                >
                  Setup manually
                </button>
              )}
            </div>
          </div>

          {/* Manual secret entry form */}
          {showManualForm && (
            <div style={styles.secretForm}>
              <div>
                <div style={styles.secretLabel}>Credential Name</div>
                <input
                  type="text"
                  style={styles.nameInput}
                  placeholder="e.g. Acme Corp Slack"
                  value={credName}
                  onChange={(e) => setCredName(e.target.value)}
                />
              </div>
              {requiredSecrets.map((key) => (
                <div key={key}>
                  <div style={styles.secretLabel}>{key}</div>
                  <input
                    type="password"
                    style={styles.secretInput}
                    placeholder={`Enter ${key}`}
                    value={secretValues[key] ?? ""}
                    onChange={(e) =>
                      setSecretValues((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                  />
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  style={{
                    ...styles.button("primary"),
                    opacity: creating ? 0.6 : 1,
                  }}
                  disabled={creating || !credName.trim()}
                  onClick={handleCreate}
                >
                  {creating ? "Saving..." : "Save Credential"}
                </button>
                <button
                  type="button"
                  style={styles.button("ghost")}
                  onClick={() => {
                    setShowManualForm(false);
                    setSecretValues({});
                    setCredName("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Gate message when no credential selected */}
          {!selectedCredentialId && !showManualForm && (
            <div style={styles.emptyHint}>Select a credential to configure this node</div>
          )}
        </>
      )}
    </div>
  );
}
