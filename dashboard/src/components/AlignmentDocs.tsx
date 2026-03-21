/**
 * AlignmentDocs — View & edit agent markdown alignment documents.
 *
 * Shows tabbed docs (SOUL.md, IDENTITY.md, etc.) with a textarea editor.
 * Save requires explicit confirmation. Includes workspace backup button.
 */

import {
  Save,
  Check,
  AlertCircle,
  ChevronDown,
  FileText,
  RefreshCw,
  Download,
  X,
  GitBranch,
  Upload,
  Settings2,
  Clock,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";

// ── Types ──

interface AgentEntry {
  id: string;
  label: string;
}

interface AlignmentDoc {
  file: string;
  label: string;
  description: string;
}

interface AlignmentState {
  agents: AgentEntry[];
  docs: AlignmentDoc[];
}

// ── Confirmation Modal ──

function ConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <h3 className="text-white font-semibold text-base mb-2">{title}</h3>
        <p className="text-zinc-400 text-sm mb-6 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm text-white bg-purple-600 hover:bg-purple-500 transition-colors font-medium"
          >
            Yes, save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Component ──

export function AlignmentDocs() {
  const [state, setState] = useState<AlignmentState | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [activeDoc, setActiveDoc] = useState<string>("SOUL.md");
  const [content, setContent] = useState<string>("");
  const [savedContent, setSavedContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isDirty = content !== savedContent;

  // Git backup state
  const [gitStatus, setGitStatus] = useState<{
    initialized: boolean;
    remote: string | null;
    lastCommit: { hash: string; date: string; message: string } | null;
    dirty: { status: string; file: string }[];
    ahead: number;
    behind: number;
    autoEnabled: boolean;
  } | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitMsg, setGitMsg] = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const [remoteInput, setRemoteInput] = useState("");
  const [showGitPanel, setShowGitPanel] = useState(false);

  // Load agents list
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings/alignment");
        const data = await res.json();
        setState(data);
        if (data.agents.length > 0 && !selectedAgent) {
          setSelectedAgent(data.agents[0].id);
        }
      } catch (err) {
        setError("Failed to load agents");
        console.error(err);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load doc content when agent or doc changes
  useEffect(() => {
    if (!selectedAgent || !activeDoc) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/settings/alignment/${encodeURIComponent(selectedAgent)}/${encodeURIComponent(activeDoc)}`,
        );
        const data = await res.json();
        if (!cancelled) {
          setContent(data.content || "");
          setSavedContent(data.content || "");
          setSaveStatus("idle");
        }
      } catch (err) {
        if (!cancelled) setError("Failed to load document");
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAgent, activeDoc]);

  // Actual save (called after confirmation)
  const doSave = useCallback(async () => {
    if (!selectedAgent || !activeDoc || !isDirty) return;
    setShowConfirm(false);
    setSaving(true);
    setSaveStatus("idle");
    try {
      const res = await fetch(
        `/api/settings/alignment/${encodeURIComponent(selectedAgent)}/${encodeURIComponent(activeDoc)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      if (res.ok) {
        setSavedContent(content);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  }, [selectedAgent, activeDoc, content, isDirty]);

  // Show confirmation dialog
  const requestSave = useCallback(() => {
    if (!isDirty) return;
    setShowConfirm(true);
  }, [isDirty]);

  // Cmd+S shows confirm dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        requestSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestSave]);

  // Warn on tab/agent switch with unsaved changes
  const handleAgentChange = (newAgent: string) => {
    if (isDirty && !window.confirm("You have unsaved changes. Switch agent anyway?")) return;
    setSelectedAgent(newAgent);
  };

  const handleDocChange = (newDoc: string) => {
    if (isDirty && !window.confirm("You have unsaved changes. Switch document anyway?")) return;
    setActiveDoc(newDoc);
  };

  // Backup workspace
  const backupWorkspace = async () => {
    setBackingUp(true);
    setBackupStatus(null);
    try {
      const res = await fetch("/api/settings/alignment/backup", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setBackupStatus(`Backup saved: ${data.filename}`);
        setTimeout(() => setBackupStatus(null), 5000);
      } else {
        setBackupStatus(`Backup failed: ${data.error}`);
      }
    } catch {
      setBackupStatus("Backup failed: network error");
    } finally {
      setBackingUp(false);
    }
  };

  // ── Git backup helpers ──

  const fetchGitStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/alignment/git/status");
      const data = await res.json();
      setGitStatus(data);
      if (data.remote && !remoteInput) setRemoteInput(data.remote);
    } catch {
      /* ignore */
    }
  }, [remoteInput]);

  // Load git status on mount
  useEffect(() => {
    fetchGitStatus();
  }, [fetchGitStatus]);

  const gitCommit = async () => {
    setGitLoading(true);
    setGitMsg(null);
    try {
      const res = await fetch("/api/settings/alignment/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setGitMsg({
          text: data.committed
            ? `Committed ${data.fileCount} file(s) — ${data.hash}`
            : data.message,
          type: "ok",
        });
      } else {
        setGitMsg({ text: data.error, type: "err" });
      }
      await fetchGitStatus();
    } catch {
      setGitMsg({ text: "Commit failed", type: "err" });
    } finally {
      setGitLoading(false);
    }
  };

  const gitPush = async () => {
    setGitLoading(true);
    setGitMsg(null);
    try {
      const res = await fetch("/api/settings/alignment/git/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setGitMsg({ text: `Pushed to ${data.remote} (${data.branch}@${data.hash})`, type: "ok" });
      } else {
        setGitMsg({ text: data.error, type: "err" });
      }
      await fetchGitStatus();
    } catch {
      setGitMsg({ text: "Push failed", type: "err" });
    } finally {
      setGitLoading(false);
    }
  };

  const gitSetRemote = async () => {
    if (!remoteInput.trim()) return;
    setGitLoading(true);
    setGitMsg(null);
    try {
      const res = await fetch("/api/settings/alignment/git/remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: remoteInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setGitMsg({ text: `Remote set: ${data.remote}`, type: "ok" });
      } else {
        setGitMsg({ text: data.error, type: "err" });
      }
      await fetchGitStatus();
    } catch {
      setGitMsg({ text: "Failed to set remote", type: "err" });
    } finally {
      setGitLoading(false);
    }
  };

  const gitToggleAuto = async (enabled: boolean) => {
    setGitLoading(true);
    setGitMsg(null);
    try {
      const res = await fetch("/api/settings/alignment/git/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, intervalHours: 4 }),
      });
      const data = await res.json();
      if (res.ok) {
        setGitMsg({
          text: enabled ? `Auto-backup enabled (every 4h)` : "Auto-backup disabled",
          type: "ok",
        });
      } else {
        setGitMsg({ text: data.error, type: "err" });
      }
      await fetchGitStatus();
    } catch {
      setGitMsg({ text: "Failed to toggle auto-backup", type: "err" });
    } finally {
      setGitLoading(false);
    }
  };

  if (!state) {
    return (
      <div className="flex items-center justify-center h-40 text-white/40 text-sm">
        Loading alignment documents...
      </div>
    );
  }

  if (state.agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-white/40 text-sm">
        No agents found. Start a conversation to create an agent.
      </div>
    );
  }

  const activeDocMeta = state.docs.find((d) => d.file === activeDoc);
  const selectedAgentLabel =
    state.agents.find((a) => a.id === selectedAgent)?.label || selectedAgent;

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] min-h-[400px]">
      {/* Save confirmation modal */}
      <ConfirmModal
        open={showConfirm}
        title="Save changes?"
        message={`You are about to overwrite ${activeDocMeta?.label || activeDoc} for "${selectedAgentLabel}". This will modify the agent's alignment file on disk. Are you sure?`}
        onConfirm={doSave}
        onCancel={() => setShowConfirm(false)}
      />

      {/* Header */}
      <div className="space-y-3 pb-3 flex-shrink-0">
        {/* Agent selector + actions */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={selectedAgent}
              onChange={(e) => handleAgentChange(e.target.value)}
              className="appearance-none bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 pl-3 pr-8 py-2 focus:outline-none focus:border-purple-500/50 cursor-pointer font-medium"
            >
              {state.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
          </div>

          <div className="flex-1" />

          {/* Git Backup toggle */}
          <button
            onClick={() => setShowGitPanel(!showGitPanel)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              showGitPanel
                ? "bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/30"
                : "bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
            }`}
            title="Git-based workspace backup"
          >
            <GitBranch className="w-3.5 h-3.5" />
            Git Backup
            {gitStatus?.dirty && gitStatus.dirty.length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            )}
          </button>

          {/* Zip Backup button */}
          <button
            onClick={backupWorkspace}
            disabled={backingUp}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-all"
            title="Backup agent workspace to zip"
          >
            {backingUp ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {backingUp ? "..." : "Zip"}
          </button>

          {/* Save button */}
          <button
            onClick={requestSave}
            disabled={!isDirty || saving}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              isDirty
                ? "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 ring-1 ring-purple-500/30"
                : saveStatus === "saved"
                  ? "bg-green-500/15 text-green-400"
                  : saveStatus === "error"
                    ? "bg-red-500/15 text-red-400"
                    : "bg-zinc-800/50 text-zinc-600"
            }`}
          >
            {saving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : saveStatus === "saved" ? (
              <Check className="w-3.5 h-3.5" />
            ) : saveStatus === "error" ? (
              <AlertCircle className="w-3.5 h-3.5" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {saving
              ? "Saving..."
              : saveStatus === "saved"
                ? "Saved"
                : saveStatus === "error"
                  ? "Error"
                  : isDirty
                    ? "Save (⌘S)"
                    : "Saved"}
          </button>
        </div>

        {/* Backup status */}
        {backupStatus && (
          <div
            className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${
              backupStatus.startsWith("Backup saved")
                ? "bg-green-500/10 border border-green-500/20 text-green-400"
                : "bg-red-500/10 border border-red-500/20 text-red-400"
            }`}
          >
            {backupStatus.startsWith("Backup saved") ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5" />
            )}
            {backupStatus}
            <button onClick={() => setBackupStatus(null)} className="ml-auto">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Git Backup Panel */}
        {showGitPanel && (
          <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <GitBranch className="w-4 h-4 text-purple-400" />
              Git Backup — workspace-main
            </div>

            {/* Remote URL */}
            <div className="flex gap-2">
              <input
                type="text"
                value={remoteInput}
                onChange={(e) => setRemoteInput(e.target.value)}
                placeholder="git@github.com:user/argent-workspace.git"
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50 font-mono"
              />
              <button
                onClick={gitSetRemote}
                disabled={gitLoading || !remoteInput.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 disabled:opacity-30 transition-all"
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Actions row */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={gitCommit}
                disabled={gitLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-30 transition-all"
              >
                {gitLoading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Commit All
              </button>
              <button
                onClick={gitPush}
                disabled={gitLoading || !gitStatus?.remote}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 disabled:opacity-30 transition-all"
              >
                <Upload className="w-3.5 h-3.5" />
                Push
              </button>
              <button
                onClick={() => {
                  gitCommit().then(() => gitPush());
                }}
                disabled={gitLoading || !gitStatus?.remote}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 disabled:opacity-30 transition-all"
              >
                <GitBranch className="w-3.5 h-3.5" />
                Commit & Push
              </button>

              <div className="flex-1" />

              {/* Auto-backup toggle */}
              <button
                onClick={() => gitToggleAuto(!gitStatus?.autoEnabled)}
                disabled={gitLoading}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  gitStatus?.autoEnabled
                    ? "bg-green-500/15 text-green-400 ring-1 ring-green-500/30"
                    : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                {gitStatus?.autoEnabled ? "Auto: ON (4h)" : "Auto: OFF"}
              </button>
            </div>

            {/* Status line */}
            <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono flex-wrap">
              {gitStatus?.lastCommit && (
                <span title={gitStatus.lastCommit.date}>
                  Last: <span className="text-zinc-400">{gitStatus.lastCommit.hash}</span>{" "}
                  {gitStatus.lastCommit.message.slice(0, 40)}
                </span>
              )}
              {gitStatus?.dirty && gitStatus.dirty.length > 0 && (
                <span className="text-yellow-500/80">{gitStatus.dirty.length} uncommitted</span>
              )}
              {gitStatus && gitStatus.ahead > 0 && (
                <span className="text-blue-400/80">↑{gitStatus.ahead} ahead</span>
              )}
              {gitStatus?.remote && (
                <span className="text-zinc-600 truncate max-w-[200px]" title={gitStatus.remote}>
                  → {gitStatus.remote.replace(/^.*[:/]/, "").replace(/\.git$/, "")}
                </span>
              )}
              {!gitStatus?.remote && <span className="text-zinc-600">No remote configured</span>}
            </div>

            {/* Git message */}
            {gitMsg && (
              <div
                className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 ${
                  gitMsg.type === "ok"
                    ? "bg-green-500/10 border border-green-500/20 text-green-400"
                    : "bg-red-500/10 border border-red-500/20 text-red-400"
                }`}
              >
                {gitMsg.type === "ok" ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5" />
                )}
                {gitMsg.text}
                <button onClick={() => setGitMsg(null)} className="ml-auto">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Doc tabs */}
        <div className="flex gap-1 flex-wrap">
          {state.docs.map((doc) => (
            <button
              key={doc.file}
              onClick={() => handleDocChange(doc.file)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeDoc === doc.file
                  ? "bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/30"
                  : "bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              }`}
              title={doc.description}
            >
              <FileText className="w-3 h-3" />
              {doc.label}
            </button>
          ))}
        </div>

        {/* Doc description */}
        {activeDocMeta && (
          <div className="text-zinc-500 text-[11px]">
            {activeDocMeta.description} — {selectedAgentLabel}/{activeDocMeta.file}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5 text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 rounded-lg border border-zinc-800">
            <RefreshCw className="w-5 h-5 text-zinc-500 animate-spin" />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="w-full h-full resize-none bg-zinc-950/80 rounded-lg border border-zinc-800 p-4 font-mono text-[13px] leading-relaxed text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-purple-500/30 transition-colors"
            placeholder="Empty document — start writing..."
          />
        )}

        {/* Dirty indicator */}
        {isDirty && !loading && (
          <div className="absolute top-2 right-3 w-2 h-2 rounded-full bg-yellow-400/80 animate-pulse" />
        )}
      </div>

      {/* Footer stats */}
      <div className="flex items-center gap-3 pt-2 text-[10px] text-zinc-600 font-mono">
        <span>{content.length.toLocaleString()} chars</span>
        <span>{content.split("\n").length} lines</span>
        {isDirty && <span className="text-yellow-500/70">• unsaved changes</span>}
      </div>
    </div>
  );
}
