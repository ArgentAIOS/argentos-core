/**
 * ComposioSettingsPanel — slice 2.2.
 *
 * The dedicated settings surface for the Composio connector. Mounts inside
 * the dashboard's existing API Keys tab so it can sit alongside the other
 * service-key UIs without forcing a navigation change (App.tsx is frozen
 * since PR #135).
 *
 * Decision map:
 *   - Q1 user_id    -> all writes/reads carry the explicit `agentId` prop.
 *   - Q2 secret     -> POST/PATCH `/api/settings/service-keys` (existing).
 *   - Q3 overlap    -> `preferComposio` text input persists per-agent.
 *   - Q4 default-off-> per-agent enable + Tool Router toggles, both
 *     default-off, persisted via `/api/connectors/composio/flags`.
 *   - Q5 destructive-> NOT enforced here (slice 2.5 owns approval gating).
 */

import {
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COMPOSIO_DEFAULT_LEARN_MORE_URL,
  type ComposioConnectivityResultLike,
  type ComposioStatusResponse,
  deriveComposioBadge,
  emptyComposioStatus,
  formatPreferComposioForInput,
  loadComposioStatus,
  parsePreferComposioInput,
  replaceComposioApiKey,
  runComposioConnectivityProbe,
  saveComposioApiKey,
  saveComposioFlags,
} from "./composioSettings";

export interface ComposioSettingsPanelProps {
  /** Required — Q1: every Composio call is scoped to a single agent. */
  agentId: string;
  /** Optional fetch impl for tests / e2e harnesses. */
  fetchImpl?: typeof fetch;
  /** Called after a successful save so callers can refetch their key list. */
  onKeyChanged?: () => void;
}

type Toast = { tone: "success" | "error" | "info"; text: string } | null;

function badgeClasses(tone: ReturnType<typeof deriveComposioBadge>["tone"]): string {
  switch (tone) {
    case "ready":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "error":
      return "border-rose-500/30 bg-rose-500/10 text-rose-200";
    default:
      return "border-white/15 bg-white/5 text-white/70";
  }
}

function describeProbeResult(
  result: ComposioConnectivityResultLike | null,
): { tone: "success" | "error" | "info"; text: string } | null {
  if (!result) {
    return null;
  }
  if (result.ok) {
    return {
      tone: "success",
      text: `Composio reachable as user_id=${result.userId ?? "(unknown)"}${
        result.apiKeyTail ? ` · key ${result.apiKeyTail}` : ""
      }`,
    };
  }
  switch (result.reason) {
    case "feature-disabled":
      return { tone: "info", text: result.message || "Per-agent toggle is off." };
    case "missing-actor-identity":
      return { tone: "error", text: result.message || "No agent id available for the probe." };
    case "missing-api-key":
      return { tone: "error", text: result.message || "Save a Composio API key first." };
    case "auth-error":
      return {
        tone: "error",
        text: `Composio rejected the key (${result.message || "auth-error"}).`,
      };
    case "network-error":
      return {
        tone: "error",
        text: `Network error reaching Composio: ${result.message || "network-error"}`,
      };
    default:
      return {
        tone: "error",
        text: `Composio probe failed: ${result.message || "unknown-error"}`,
      };
  }
}

export function ComposioSettingsPanel(props: ComposioSettingsPanelProps): JSX.Element {
  const { agentId, fetchImpl, onKeyChanged } = props;
  const fetchRef = useRef(fetchImpl);
  fetchRef.current = fetchImpl;

  const [status, setStatus] = useState<ComposioStatusResponse>(() => emptyComposioStatus(agentId));
  const [statusLoading, setStatusLoading] = useState<boolean>(false);
  const [keyDraft, setKeyDraft] = useState<string>("");
  const [showKeyDraft, setShowKeyDraft] = useState<boolean>(false);
  const [keySaving, setKeySaving] = useState<boolean>(false);
  const [flagSaving, setFlagSaving] = useState<boolean>(false);
  const [probing, setProbing] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<ComposioConnectivityResultLike | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const [enabledDraft, setEnabledDraft] = useState<boolean>(false);
  const [toolRouterDraft, setToolRouterDraft] = useState<boolean>(false);
  const [preferComposioDraft, setPreferComposioDraft] = useState<string>("");

  const refresh = useCallback(async () => {
    if (!agentId.trim()) {
      setStatus(emptyComposioStatus());
      return;
    }
    setStatusLoading(true);
    try {
      const next = await loadComposioStatus({
        agentId,
        fetchImpl: fetchRef.current,
      });
      setStatus(next);
      setEnabledDraft(next.flags.enabled === true);
      setToolRouterDraft(next.flags.toolRouter?.enabled === true);
      setPreferComposioDraft(formatPreferComposioForInput(next.flags.preferComposio));
    } finally {
      setStatusLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const badge = useMemo(() => deriveComposioBadge(status), [status]);
  const probeBanner = useMemo(() => describeProbeResult(probeResult), [probeResult]);

  const handleSaveKey = useCallback(async () => {
    setKeySaving(true);
    setToast(null);
    try {
      const result = status.keyId
        ? await replaceComposioApiKey({
            keyId: status.keyId,
            value: keyDraft,
            agentId,
            fetchImpl: fetchRef.current,
          })
        : await saveComposioApiKey({
            value: keyDraft,
            agentId,
            fetchImpl: fetchRef.current,
          });
      if (!result.ok) {
        setToast({ tone: "error", text: result.error });
      } else {
        setToast({
          tone: "success",
          text: status.keyId ? "Composio API key replaced." : "Composio API key saved.",
        });
        setKeyDraft("");
        setShowKeyDraft(false);
        onKeyChanged?.();
        await refresh();
      }
    } finally {
      setKeySaving(false);
    }
  }, [agentId, keyDraft, onKeyChanged, refresh, status.keyId]);

  const handleSaveFlags = useCallback(async () => {
    setFlagSaving(true);
    setToast(null);
    try {
      const preferComposio = parsePreferComposioInput(preferComposioDraft);
      const result = await saveComposioFlags({
        agentId,
        enabled: enabledDraft,
        toolRouterEnabled: toolRouterDraft,
        preferComposio,
        fetchImpl: fetchRef.current,
      });
      if (!result.ok) {
        setToast({ tone: "error", text: result.error });
      } else {
        setToast({ tone: "success", text: "Composio flags saved." });
        await refresh();
      }
    } finally {
      setFlagSaving(false);
    }
  }, [agentId, enabledDraft, preferComposioDraft, refresh, toolRouterDraft]);

  const handleProbe = useCallback(async () => {
    setProbing(true);
    setProbeResult(null);
    try {
      const result = await runComposioConnectivityProbe({
        agentId,
        fetchImpl: fetchRef.current,
      });
      setProbeResult(result);
    } finally {
      setProbing(false);
    }
  }, [agentId]);

  const learnMoreUrl = status.learnMoreUrl || COMPOSIO_DEFAULT_LEARN_MORE_URL;

  return (
    <section
      data-testid="composio-settings-panel"
      className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-4"
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h3 className="text-white/90 text-sm font-medium flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-fuchsia-300" />
            Composio integration
          </h3>
          <p className="text-white/50 text-xs leading-relaxed max-w-xl">
            Per-agent BYO key for Composio's 1,000+ toolkits. Default-off — slice 2.2 wires the key
            store + per-agent toggle. Tool Router beta opt-in mirrors the
            <code className="mx-1 px-1 rounded bg-white/5 text-white/70">experimentalWrites</code>
            precedent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${badgeClasses(
              badge.tone,
            )}`}
            title={badge.detail}
            data-testid="composio-badge"
          >
            {badge.label}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={statusLoading}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 disabled:opacity-50"
            data-testid="composio-refresh"
          >
            {statusLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            Refresh
          </button>
        </div>
      </header>

      {toast ? (
        <div
          data-testid="composio-toast"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
            toast.tone === "success"
              ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : toast.tone === "error"
                ? "border border-rose-500/30 bg-rose-500/10 text-rose-200"
                : "border border-white/10 bg-white/5 text-white/70"
          }`}
        >
          {toast.tone === "success" ? (
            <CheckCircle className="w-4 h-4" />
          ) : toast.tone === "error" ? (
            <AlertTriangle className="w-4 h-4" />
          ) : null}
          <span>{toast.text}</span>
        </div>
      ) : null}

      {/* API key save block */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs text-white/70 font-medium">API key</div>
          <a
            href={learnMoreUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-fuchsia-300 hover:text-fuchsia-200"
          >
            Get an API key
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="text-[11px] text-white/55">
          Stored in the operator service-key store as
          <code className="mx-1 px-1 rounded bg-white/5 text-white/80">
            {status.apiKeyVariable || "COMPOSIO_API_KEY"}
          </code>
          . The browser never sees the raw value after save — only the masked tail.
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs text-white/70">
          <span className="text-white/50">Status:</span>
          {status.configured ? (
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <CheckCircle className="w-3.5 h-3.5" /> configured
              {status.apiKeyTail ? (
                <code className="ml-1 px-1 rounded bg-white/5 text-white/80">
                  {status.apiKeyTail}
                </code>
              ) : null}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5" /> not configured
            </span>
          )}
          {status.allowedAgents.length > 0 ? (
            <span
              className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/60"
              title="allowedAgents enforces per-agent isolation in service-keys.ts"
            >
              scoped: {status.allowedAgents.join(", ")}
            </span>
          ) : null}
        </div>
        <div className="relative">
          <input
            data-testid="composio-key-input"
            type={showKeyDraft ? "text" : "password"}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder={
              status.configured ? "Paste a new key to replace…" : "Paste your Composio API key…"
            }
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 pr-10 text-sm text-white font-mono placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50"
          />
          <button
            type="button"
            onClick={() => setShowKeyDraft((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
            aria-label={showKeyDraft ? "Hide value" : "Reveal value"}
          >
            {showKeyDraft ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            data-testid="composio-save-key"
            type="button"
            onClick={() => void handleSaveKey()}
            disabled={!keyDraft.trim() || keySaving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5 text-xs text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-50"
          >
            {keySaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {status.keyId ? "Replace key" : "Save key"}
          </button>
          <button
            data-testid="composio-test"
            type="button"
            onClick={() => void handleProbe()}
            disabled={!status.configured || probing}
            title={status.configured ? "Run the slice 2.1 connectivity probe" : "Save a key first"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            {probing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Test connectivity
          </button>
        </div>
        {probeBanner ? (
          <div
            data-testid="composio-probe-banner"
            className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
              probeBanner.tone === "success"
                ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : probeBanner.tone === "info"
                  ? "border border-white/10 bg-white/5 text-white/70"
                  : "border border-rose-500/30 bg-rose-500/10 text-rose-200"
            }`}
          >
            {probeBanner.tone === "success" ? (
              <CheckCircle className="w-3.5 h-3.5 mt-0.5" />
            ) : probeBanner.tone === "info" ? null : (
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />
            )}
            <span>{probeBanner.text}</span>
          </div>
        ) : null}
      </div>

      {/* Per-agent toggles + preferComposio */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs text-white/70 font-medium">Per-agent settings (Q3 / Q4)</div>
          {!status.flagsAvailable ? (
            <span className="text-[10px] text-amber-300">
              Runtime build missing — flags persist once <code>dist/</code> is rebuilt.
            </span>
          ) : null}
        </div>
        <label className="flex items-center justify-between gap-3 text-xs text-white/80">
          <div>
            <div>Enable Composio for this agent</div>
            <div className="text-[11px] text-white/50">
              Master gate (Q4). Default-off; flip per agent.
            </div>
          </div>
          <input
            data-testid="composio-flag-enabled"
            type="checkbox"
            checked={enabledDraft}
            onChange={(e) => setEnabledDraft(e.target.checked)}
            className="h-4 w-4 accent-fuchsia-400"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-xs text-white/80">
          <div>
            <div>Tool Router beta</div>
            <div className="text-[11px] text-white/50">
              Beta May 2026. Falls back to <code>session.tools()</code> when off.
            </div>
          </div>
          <input
            data-testid="composio-flag-tool-router"
            type="checkbox"
            checked={toolRouterDraft}
            disabled={!enabledDraft}
            onChange={(e) => setToolRouterDraft(e.target.checked)}
            className="h-4 w-4 accent-fuchsia-400 disabled:opacity-40"
          />
        </label>
        <div className="space-y-1">
          <label className="text-xs text-white/80" htmlFor="composio-prefer">
            preferComposio overrides (Q3)
          </label>
          <div className="text-[11px] text-white/50">
            Comma-separated toolkit slugs. Each listed slug flips the AOS-wins-Composio-fills-gaps
            default for this agent.
          </div>
          <input
            id="composio-prefer"
            data-testid="composio-flag-prefer"
            type="text"
            value={preferComposioDraft}
            onChange={(e) => setPreferComposioDraft(e.target.value)}
            placeholder="airtable, asana, github"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            data-testid="composio-save-flags"
            type="button"
            onClick={() => void handleSaveFlags()}
            disabled={flagSaving || !agentId.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5 text-xs text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-50"
          >
            {flagSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save flags
          </button>
          <button
            type="button"
            onClick={() => {
              setEnabledDraft(false);
              setToolRouterDraft(false);
              setPreferComposioDraft("");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Reset to defaults
          </button>
        </div>
      </div>
    </section>
  );
}
