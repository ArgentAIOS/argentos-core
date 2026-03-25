import { Plus, Trash2, MessageSquare, Search, X, Clock, FileSearch } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";

export interface SessionEntry {
  key: string;
  sessionId?: string;
  updatedAt?: number;
  kind?: "direct" | "group" | "global" | "unknown";
  surface?: string;
  channel?: string;
  label?: string;
  displayName?: string;
  subject?: string;
  lastMessage?: string;
  totalTokens?: number;
  contextTokens?: number;
}

export interface TranscriptHit {
  sessionKey: string;
  role: string;
  snippet: string;
  timestamp: number;
  sessionUpdatedAt: number;
}

interface SessionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentSessionKey: string;
  onSelectSession: (sessionKey: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionKey: string) => void;
  sessions: SessionEntry[];
  loading?: boolean;
  onRefresh: () => void;
  onSearchTranscripts?: (query: string) => Promise<{ count: number; hits: TranscriptHit[] }>;
}

function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return "";
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function getSessionTitle(session: SessionEntry): string {
  if (session.label) return session.label;
  if (session.displayName) return session.displayName;
  if (session.subject) return session.subject;
  if (session.lastMessage) {
    const text = session.lastMessage.replace(/\[.*?\]/g, "").trim();
    if (text.length > 50) return text.substring(0, 47) + "...";
    return text || "Untitled chat";
  }
  const parts = session.key.split(":");
  if (parts.length > 1) return parts.slice(1).join(":");
  return "Untitled chat";
}

function inferSessionSurface(sessionKey: string): string {
  const key = sessionKey.trim().toLowerCase();
  if (!key) return "";
  if (key === "global" || key === "unknown") return key;

  const agentMatch = /^agent:[^:]+:(.+)$/i.exec(key);
  const raw = (agentMatch?.[1] ?? key).trim();
  if (!raw) return "";

  const match = /^([a-z0-9_]+)(?:[:\-]|$)/i.exec(raw);
  return match?.[1]?.toLowerCase() ?? "";
}

function isOperatorSession(session: SessionEntry, currentSessionKey: string): boolean {
  const key = session.key.trim().toLowerCase();
  const current = currentSessionKey.trim().toLowerCase();
  if (!key) return false;
  if (key === current) return true;

  const channel = session.channel?.trim().toLowerCase();
  if (channel && channel !== "webchat") return false;

  const surface = (session.surface?.trim().toLowerCase() ?? inferSessionSurface(key)).toLowerCase();
  if (surface === "webchat" || surface === "main") return true;

  return (
    key === "main" ||
    key.endsWith(":main") ||
    key.startsWith("webchat-") ||
    key.includes(":webchat-") ||
    key.includes(":webchat:")
  );
}

export function SessionDrawer({
  isOpen,
  onClose,
  currentSessionKey,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  sessions,
  loading = false,
  onRefresh,
  onSearchTranscripts,
}: SessionDrawerProps) {
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [transcriptHits, setTranscriptHits] = useState<TranscriptHit[]>([]);
  const [searchingTranscripts, setSearchingTranscripts] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Refresh sessions when drawer opens
  useEffect(() => {
    if (isOpen) {
      onRefresh();
    }
  }, [isOpen, onRefresh]);

  // Debounced transcript search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!search.trim() || search.trim().length < 2 || !onSearchTranscripts) {
      setTranscriptHits([]);
      setSearchingTranscripts(false);
      return;
    }

    setSearchingTranscripts(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await onSearchTranscripts(search.trim());
        setTranscriptHits(result.hits ?? []);
      } catch {
        setTranscriptHits([]);
      } finally {
        setSearchingTranscripts(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, onSearchTranscripts]);

  // Filter sessions by search (instant local filter)
  const operatorSessions = sessions.filter((s) => isOperatorSession(s, currentSessionKey));
  const filtered = search
    ? operatorSessions.filter((s) => {
        const title = getSessionTitle(s).toLowerCase();
        const msg = (s.lastMessage || "").toLowerCase();
        const q = search.toLowerCase();
        return title.includes(q) || msg.includes(q);
      })
    : operatorSessions;

  const sorted = [...filtered].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const handleDelete = useCallback(
    (key: string) => {
      if (confirmDelete === key) {
        onDeleteSession(key);
        setConfirmDelete(null);
      } else {
        setConfirmDelete(key);
        setTimeout(() => setConfirmDelete(null), 3000);
      }
    },
    [confirmDelete, onDeleteSession],
  );

  // Group transcript hits by session
  const visibleSessionMap = new Map(operatorSessions.map((s) => [s.key, s]));
  const filteredTranscriptHits = transcriptHits.filter((candidate) =>
    isOperatorSession({ key: candidate.sessionKey }, currentSessionKey),
  );
  const groupedHits = new Map<string, TranscriptHit[]>();
  for (const hit of filteredTranscriptHits) {
    const group = groupedHits.get(hit.sessionKey) ?? [];
    group.push(hit);
    groupedHits.set(hit.sessionKey, group);
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Drawer */}
      <div
        className={`fixed top-0 left-0 h-full w-80 bg-gray-900/95 backdrop-blur border-r border-white/10 transform transition-transform duration-300 z-50 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4 h-full flex flex-col">
          {/* Header */}
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-white font-semibold">Sessions</h2>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onNewSession();
                  onClose();
                }}
                className="p-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 transition-all"
                title="New chat"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sessions & transcripts..."
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10 text-white/30 hover:text-white/60"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Session List */}
          <div className="flex-1 overflow-y-auto space-y-1">
            {loading && sorted.length === 0 && (
              <div className="text-center py-8 text-white/30 text-sm">Loading sessions...</div>
            )}

            {!loading && sorted.length === 0 && !search && (
              <div className="text-center py-8">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 text-white/20" />
                <div className="text-white/30 text-sm">No sessions yet</div>
              </div>
            )}

            {sorted.map((session) => {
              const isActive = session.key === currentSessionKey;
              const title = getSessionTitle(session);

              return (
                <div
                  key={session.key}
                  className={`group rounded-lg p-3 cursor-pointer transition-all ${
                    isActive
                      ? "bg-purple-500/20 border border-purple-500/30"
                      : "hover:bg-white/5 border border-transparent"
                  }`}
                  onClick={() => {
                    onSelectSession(session.key);
                    onClose();
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm font-medium truncate ${isActive ? "text-purple-300" : "text-white/80"}`}
                      >
                        {title}
                      </div>
                      {session.lastMessage && (
                        <div className="text-xs text-white/30 truncate mt-0.5">
                          {session.lastMessage
                            .replace(/\[.*?\]/g, "")
                            .trim()
                            .substring(0, 60)}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {session.updatedAt && (
                          <span className="text-[10px] text-white/20 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTimeAgo(session.updatedAt)}
                          </span>
                        )}
                        {session.totalTokens && session.totalTokens > 0 && (
                          <span className="text-[10px] text-white/20">
                            {Math.round(session.totalTokens / 1000)}k tokens
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Delete button */}
                    {!isActive && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(session.key);
                        }}
                        className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-all ${
                          confirmDelete === session.key
                            ? "bg-red-500/30 text-red-400 opacity-100"
                            : "hover:bg-white/10 text-white/30 hover:text-white/60"
                        }`}
                        title={
                          confirmDelete === session.key
                            ? "Click again to confirm"
                            : "Delete session"
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Transcript Search Results */}
            {search.trim().length >= 2 && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <FileSearch className="w-3.5 h-3.5 text-cyan-400/60" />
                  <span className="text-xs font-medium text-cyan-400/80">
                    {searchingTranscripts
                      ? "Searching transcripts..."
                      : filteredTranscriptHits.length > 0
                        ? `${filteredTranscriptHits.length} match${filteredTranscriptHits.length !== 1 ? "es" : ""} in transcripts`
                        : "No transcript matches"}
                  </span>
                </div>

                {searchingTranscripts && (
                  <div className="flex justify-center py-3">
                    <div className="w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                  </div>
                )}

                {!searchingTranscripts &&
                  Array.from(groupedHits.entries()).map(([sessionKey, hits]) => {
                    const matchedSession = visibleSessionMap.get(sessionKey);
                    const title = matchedSession ? getSessionTitle(matchedSession) : sessionKey;
                    return (
                      <div
                        key={sessionKey}
                        className="rounded-lg p-2.5 mb-1.5 bg-cyan-500/5 border border-cyan-500/10 hover:bg-cyan-500/10 cursor-pointer transition-all"
                        onClick={() => {
                          onSelectSession(sessionKey);
                          onClose();
                        }}
                      >
                        <div className="text-xs font-medium text-cyan-300/80 truncate mb-1">
                          {title}
                          <span className="text-white/20 ml-2">
                            {hits[0].sessionUpdatedAt
                              ? formatTimeAgo(hits[0].sessionUpdatedAt)
                              : ""}
                          </span>
                        </div>
                        {hits.slice(0, 3).map((hit, i) => (
                          <div key={i} className="text-[11px] text-white/40 mt-1 leading-relaxed">
                            <span className="text-white/20">
                              {hit.role === "user" ? "You" : "AI"}:
                            </span>{" "}
                            <HighlightSnippet text={hit.snippet} query={search} />
                          </div>
                        ))}
                        {hits.length > 3 && (
                          <div className="text-[10px] text-white/20 mt-1">
                            +{hits.length - 3} more matches
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-white/10">
            <div className="text-[10px] text-white/20 text-center">
              {sorted.length} session{sorted.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Highlight the search query within a snippet */
function HighlightSnippet({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);

  if (idx === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, idx)}
      <span className="text-cyan-300 bg-cyan-500/15 rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}
