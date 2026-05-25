import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, RefreshCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  addDashboardAuthLostListener,
  addDashboardAuthRecoveredListener,
  type DashboardAuthLostReason,
  persistDashboardApiToken,
} from "../utils/localApiFetch";

/**
 * Banner shown when the dashboard can no longer authenticate against the
 * local api-server — issue #400. Triggered by `fetchLocalApi` when a 401
 * comes back, or when token resolution fails for a recoverable reason
 * (quota exceeded, parse error, malformed entry).
 *
 * Recovery paths offered to the user:
 *   1. Paste a fresh gateway token from `~/.argent/argent.json` — persisted
 *      to localStorage and broadcast via `argent:gateway-token-updated` so
 *      the WS connection picks it up without a page reload.
 *   2. Reopen the dashboard via the CLI — `argent dashboard` emits a
 *      tokenized URL that App.tsx auto-persists on load.
 *
 * The banner self-dismisses on the first successful 2xx from `fetchLocalApi`
 * after the token is restored.
 */

interface BannerState {
  visible: boolean;
  reason: DashboardAuthLostReason;
  path: string;
}

const REASON_COPY: Record<DashboardAuthLostReason, { headline: string; body: string }> = {
  ok: {
    headline: "Dashboard auth lost",
    body: "The api-server refused this connection. Reconnect to continue.",
  },
  rejected: {
    headline: "Dashboard auth token rejected",
    body: "The api-server returned 401. Your token was likely rotated by argent update — paste the fresh one or reopen via argent dashboard.",
  },
  absent: {
    headline: "No dashboard auth token",
    body: "This tab has no saved gateway token. Paste one from ~/.argent/argent.json or reopen the dashboard via argent dashboard to get a tokenized URL.",
  },
  "storage-error": {
    headline: "Dashboard storage error",
    body: "Browser localStorage is unavailable or full, so the dashboard can't read its saved token. Paste a fresh one to continue this session.",
  },
  "parse-error": {
    headline: "Dashboard auth state corrupted",
    body: "The saved settings blob couldn't be parsed. Paste a fresh gateway token to restore access.",
  },
  malformed: {
    headline: "Dashboard auth state corrupted",
    body: "The saved token entry is invalid. Paste a fresh gateway token to restore access.",
  },
};

export function AuthLostBanner() {
  const [state, setState] = useState<BannerState>({
    visible: false,
    reason: "ok",
    path: "",
  });
  const [pasteValue, setPasteValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const disposeLost = addDashboardAuthLostListener((event) => {
      setState({ visible: true, reason: event.reason, path: event.path });
    });
    const disposeRecovered = addDashboardAuthRecoveredListener(() => {
      setState((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      setPasteValue("");
      setSubmitting(false);
    });
    return () => {
      disposeLost();
      disposeRecovered();
    };
  }, []);

  const dismiss = () => {
    setState((prev) => ({ ...prev, visible: false }));
  };

  const submit = () => {
    const token = pasteValue.trim();
    if (!token) {
      return;
    }
    setSubmitting(true);
    persistDashboardApiToken(token);
    // The next successful 2xx fires auth-recovered and self-dismisses the
    // banner. If the pasted token is also stale the next 401 will reappear
    // it. Either way the user gets immediate visible feedback.
  };

  const copy = REASON_COPY[state.reason] ?? REASON_COPY.ok;

  return (
    <AnimatePresence>
      {state.visible && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[300] w-[560px] max-w-[92vw]"
          role="alert"
          aria-live="assertive"
        >
          <div className="bg-[#1a1a2e]/95 backdrop-blur-md border border-red-500/40 rounded-xl p-4 shadow-2xl shadow-red-500/10">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <KeyRound className="w-4 h-4 text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-medium text-sm mb-1">{copy.headline}</div>
                <p className="text-white/60 text-xs leading-relaxed mb-3">{copy.body}</p>
                {state.path && (
                  <p className="text-white/30 text-[10px] font-mono mb-3 truncate">
                    First failure: {state.path}
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={pasteValue}
                      onChange={(event) => setPasteValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          submit();
                        }
                      }}
                      placeholder="Paste gateway.auth.token from ~/.argent/argent.json"
                      className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs font-mono placeholder:text-white/20 focus:outline-none focus:border-red-400/60"
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      data-testid="auth-lost-banner-input"
                    />
                    <button
                      type="button"
                      onClick={submit}
                      disabled={!pasteValue.trim() || submitting}
                      className="px-4 py-1.5 bg-red-500/20 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-red-300 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <RefreshCcw className="w-3 h-3" />
                      Restore
                    </button>
                  </div>
                  <div className="text-white/30 text-[11px]">
                    Or close this tab and reopen via{" "}
                    <span className="font-mono text-white/50">argent dashboard</span> to load a
                    fresh tokenized URL.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={dismiss}
                className="text-white/20 hover:text-white/50 transition-colors flex-shrink-0"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
