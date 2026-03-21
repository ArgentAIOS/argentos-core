/**
 * Live Log Viewer — Real-time gateway log streaming with filtering.
 *
 * Polls the gateway `logs.tail` RPC endpoint at 1s intervals,
 * parses structured JSON log lines, and provides client-side
 * filtering by log level, subsystem group, and free-text search.
 */

import {
  Search,
  Pause,
  Play,
  Trash2,
  ChevronDown,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useGateway } from "../hooks/useGateway";

// ── Types ──

interface ParsedLogLine {
  id: number;
  time?: string;
  level?: string;
  subsystem?: string;
  message: string;
  raw: string;
}

interface LogsTailResponse {
  file?: string;
  cursor?: number;
  size?: number;
  lines?: string[];
  truncated?: boolean;
  reset?: boolean;
}

// LogViewer uses useGateway() internally — no props needed
export type LogViewerProps = Record<string, never>;

// ── Constants ──

const MAX_BUFFER_SIZE = 2000;
const POLL_INTERVAL_MS = 1000;
const INITIAL_LINES = 500;

const LEVEL_CONFIG = {
  error: { color: "text-red-400", bg: "bg-red-500/15", icon: AlertCircle, label: "Error" },
  warn: { color: "text-yellow-400", bg: "bg-yellow-500/15", icon: AlertTriangle, label: "Warn" },
  info: { color: "text-cyan-400", bg: "bg-cyan-500/15", icon: Info, label: "Info" },
  debug: { color: "text-zinc-500", bg: "bg-zinc-500/15", icon: Bug, label: "Debug" },
} as const;

type LogLevel = keyof typeof LEVEL_CONFIG;

const SUBSYSTEM_GROUPS: Record<
  string,
  { label: string; color: string; match: (s: string) => boolean }
> = {
  agent: {
    label: "Agent",
    color: "bg-purple-500/20 text-purple-400",
    match: (s) => s.startsWith("agent/") || s === "agent" || s.startsWith("agents/"),
  },
  gateway: {
    label: "Gateway",
    color: "bg-blue-500/20 text-blue-400",
    match: (s) => s.startsWith("gateway/") || s === "gateway",
  },
  diagnostic: {
    label: "Diagnostic",
    color: "bg-green-500/20 text-green-400",
    match: (s) => s === "diagnostic",
  },
  plugins: {
    label: "Plugins",
    color: "bg-orange-500/20 text-orange-400",
    match: (s) => s === "plugins" || s.startsWith("plugins/"),
  },
  cron: {
    label: "Cron",
    color: "bg-yellow-500/20 text-yellow-400",
    match: (s) =>
      s.startsWith("cron/") ||
      s === "cron" ||
      s.startsWith("gateway/contemplation") ||
      s.startsWith("gateway/heartbeat") ||
      s.startsWith("heartbeat/"),
  },
  skills: {
    label: "Skills",
    color: "bg-teal-500/20 text-teal-400",
    match: (s) => s.startsWith("skills") || s.startsWith("gateway/skills"),
  },
  data: {
    label: "Data",
    color: "bg-indigo-500/20 text-indigo-400",
    match: (s) => s.startsWith("data/"),
  },
  channels: {
    label: "Channels",
    color: "bg-pink-500/20 text-pink-400",
    match: (s) =>
      s.startsWith("discord") ||
      s.startsWith("telegram") ||
      s.startsWith("whatsapp") ||
      s.startsWith("slack") ||
      s.startsWith("channels/"),
  },
  memory: {
    label: "Memory",
    color: "bg-cyan-500/20 text-cyan-400",
    match: (s) => s.startsWith("memu") || s.startsWith("identity") || s.startsWith("memory"),
  },
  model: {
    label: "Model Router",
    color: "bg-emerald-500/20 text-emerald-400",
    match: (s) => s.startsWith("model-router") || s.startsWith("model-catalog"),
  },
};

// ── Log Parser ──

function parseLogLine(raw: string, id: number): ParsedLogLine | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const meta = parsed._meta as Record<string, unknown> | undefined;

    // Extract subsystem from _meta.name JSON
    let subsystem: string | undefined;
    if (typeof meta?.name === "string") {
      try {
        const nameObj = JSON.parse(meta.name) as Record<string, unknown>;
        subsystem = typeof nameObj.subsystem === "string" ? nameObj.subsystem : undefined;
      } catch {
        // not JSON
      }
    }

    const levelRaw = typeof meta?.logLevelName === "string" ? meta.logLevelName : undefined;

    // Extract message from numbered keys
    const parts: string[] = [];
    for (const key of Object.keys(parsed)) {
      if (!/^\d+$/.test(key)) continue;
      const item = parsed[key];
      if (typeof item === "string") parts.push(item);
      else if (item != null) parts.push(JSON.stringify(item));
    }

    return {
      id,
      time:
        typeof parsed.time === "string"
          ? parsed.time
          : typeof meta?.date === "string"
            ? (meta.date as string)
            : undefined,
      level: levelRaw ? levelRaw.toLowerCase() : undefined,
      subsystem,
      message: parts.join(" "),
      raw,
    };
  } catch {
    return null;
  }
}

function formatTime(timeStr?: string): string {
  if (!timeStr) return "";
  try {
    return new Date(timeStr).toISOString().slice(11, 23); // HH:MM:SS.mmm
  } catch {
    return timeStr.slice(11, 23) || timeStr;
  }
}

function getSubsystemGroup(subsystem?: string): string | null {
  if (!subsystem) return null;
  for (const [key, config] of Object.entries(SUBSYSTEM_GROUPS)) {
    if (config.match(subsystem)) return key;
  }
  return null;
}

function formatSubsystemDisplay(subsystem?: string): string {
  if (!subsystem) return "";
  // Drop redundant prefixes
  const parts = subsystem.split("/").filter(Boolean);
  const drop = new Set(["gateway", "channels", "providers"]);
  while (parts.length > 1 && drop.has(parts[0])) parts.shift();
  return parts.join("/");
}

// ── Component ──

export function LogViewer(_props: LogViewerProps) {
  const { request } = useGateway();
  const [lines, setLines] = useState<ParsedLogLine[]>([]);
  const [following, setFollowing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logFile, setLogFile] = useState<string | null>(null);

  // Filters
  const [levelFilters, setLevelFilters] = useState<Set<LogLevel>>(
    new Set(["error", "warn", "info", "debug"]),
  );
  const [subsystemFilter, setSubsystemFilter] = useState<string>("all");
  const [textFilter, setTextFilter] = useState("");

  const cursorRef = useRef<number | undefined>(undefined);
  const lineIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isUserScrolling = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll to bottom when following
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current && following && !isUserScrolling.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [following]);

  // Detect user scrolling up → pause follow
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (!atBottom && following) {
      isUserScrolling.current = true;
      setFollowing(false);
    } else if (atBottom) {
      isUserScrolling.current = false;
    }
  }, [following]);

  // Poll for new log lines
  const fetchLogs = useCallback(async () => {
    try {
      const isInitial = cursorRef.current === undefined;
      const res = await request<LogsTailResponse>("logs.tail", {
        cursor: cursorRef.current,
        limit: isInitial ? INITIAL_LINES : 500,
        maxBytes: 500_000,
      });

      if (res.file && !logFile) {
        setLogFile(res.file);
      }

      if (res.cursor !== undefined) {
        cursorRef.current = res.cursor;
      }

      if (res.lines && res.lines.length > 0) {
        const newLines: ParsedLogLine[] = [];
        for (const raw of res.lines) {
          if (!raw.trim()) continue;
          const parsed = parseLogLine(raw, lineIdRef.current++);
          if (parsed) newLines.push(parsed);
        }

        if (newLines.length > 0) {
          setLines((prev) => {
            const combined = [...prev, ...newLines];
            return combined.length > MAX_BUFFER_SIZE ? combined.slice(-MAX_BUFFER_SIZE) : combined;
          });
        }
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [request, logFile]);

  // Start/stop polling
  useEffect(() => {
    // Initial fetch
    fetchLogs();

    const poll = () => {
      if (!following) return;
      pollTimerRef.current = setTimeout(async () => {
        await fetchLogs();
        poll();
      }, POLL_INTERVAL_MS);
    };

    if (following) {
      poll();
    }

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [following, fetchLogs]);

  // Auto-scroll when new lines arrive
  useEffect(() => {
    scrollToBottom();
  }, [lines, scrollToBottom]);

  // Toggle level filter
  const toggleLevel = useCallback((level: LogLevel) => {
    setLevelFilters((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  // Resume following
  const resumeFollow = useCallback(() => {
    isUserScrolling.current = false;
    setFollowing(true);
    // Scroll to bottom immediately
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  // Clear buffer
  const clearLogs = useCallback(() => {
    setLines([]);
    lineIdRef.current = 0;
  }, []);

  // Filter lines
  const textFilterLower = textFilter.toLowerCase();
  const filteredLines = useMemo(() => {
    return lines.filter((line) => {
      // Level filter
      const level = line.level as LogLevel;
      if (level && !levelFilters.has(level)) return false;
      // Don't show trace/fatal if they're not in the set
      if (!level || !["error", "warn", "info", "debug"].includes(level)) {
        // Show unknown levels only if all main levels are enabled
        if (levelFilters.size < 4) return false;
      }

      // Subsystem filter
      if (subsystemFilter !== "all") {
        const group = getSubsystemGroup(line.subsystem);
        if (group !== subsystemFilter) return false;
      }

      // Text filter
      if (textFilterLower) {
        const searchable = `${line.message} ${line.subsystem || ""}`.toLowerCase();
        if (!searchable.includes(textFilterLower)) return false;
      }

      return true;
    });
  }, [lines, levelFilters, subsystemFilter, textFilterLower]);

  // Collect unique subsystem groups for the dropdown
  const activeGroups = useMemo(() => {
    const groups = new Set<string>();
    for (const line of lines) {
      const group = getSubsystemGroup(line.subsystem);
      if (group) groups.add(group);
    }
    return Array.from(groups).sort();
  }, [lines]);

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] min-h-[400px]">
      {/* Header with controls */}
      <div className="space-y-2 pb-3 flex-shrink-0">
        {/* Level filter toggles */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-zinc-500 text-[10px] uppercase tracking-wide mr-1">Level:</span>
          {(Object.entries(LEVEL_CONFIG) as [LogLevel, (typeof LEVEL_CONFIG)[LogLevel]][]).map(
            ([level, config]) => {
              const Icon = config.icon;
              const active = levelFilters.has(level);
              return (
                <button
                  key={level}
                  onClick={() => toggleLevel(level)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all ${
                    active
                      ? `${config.bg} ${config.color} ring-1 ring-current/20`
                      : "bg-zinc-800/50 text-zinc-600 hover:text-zinc-400"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {config.label}
                </button>
              );
            },
          )}

          <div className="flex-1" />

          {/* Follow/Pause */}
          <button
            onClick={following ? () => setFollowing(false) : resumeFollow}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all ${
              following
                ? "bg-green-500/15 text-green-400 ring-1 ring-green-500/20"
                : "bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/20"
            }`}
          >
            {following ? (
              <>
                <Play className="w-3 h-3" /> Following
              </>
            ) : (
              <>
                <Pause className="w-3 h-3" /> Paused
              </>
            )}
          </button>

          {/* Clear */}
          <button
            onClick={clearLogs}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-all"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {/* Subsystem filter + text search */}
        <div className="flex gap-2">
          <div className="relative">
            <select
              value={subsystemFilter}
              onChange={(e) => setSubsystemFilter(e.target.value)}
              className="appearance-none bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 pl-2.5 pr-7 py-1.5 focus:outline-none focus:border-purple-500/50 cursor-pointer"
            >
              <option value="all">All subsystems</option>
              {activeGroups.map((key) => (
                <option key={key} value={key}>
                  {SUBSYSTEM_GROUPS[key]?.label || key}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
          </div>

          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Filter logs..."
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50"
            />
          </div>

          {/* Line count badge */}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/50 rounded-lg text-[10px] text-zinc-500 font-mono">
            {filteredLines.length}
            {filteredLines.length !== lines.length && ` / ${lines.length}`}
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5 text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Log file info */}
        {logFile && (
          <div className="text-zinc-600 text-[10px] font-mono truncate" title={logFile}>
            {logFile}
          </div>
        )}
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden bg-zinc-950/80 rounded-lg border border-zinc-800 font-mono text-[11px] leading-[1.6]"
      >
        {filteredLines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            {lines.length === 0 ? "Waiting for logs..." : "No logs match filters"}
          </div>
        ) : (
          <div className="p-2 space-y-0">
            {filteredLines.map((line) => (
              <LogLine key={line.id} line={line} textFilter={textFilterLower} />
            ))}
          </div>
        )}
      </div>

      {/* Scroll-to-bottom indicator when paused */}
      {!following && lines.length > 0 && (
        <button
          onClick={resumeFollow}
          className="mt-2 mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-500/15 text-purple-400 text-xs font-medium hover:bg-purple-500/25 transition-all ring-1 ring-purple-500/20"
        >
          <Play className="w-3 h-3" />
          Resume following
        </button>
      )}
    </div>
  );
}

// ── Log Line Component ──

function LogLine({ line, textFilter }: { line: ParsedLogLine; textFilter: string }) {
  const level = line.level as LogLevel;
  const config = LEVEL_CONFIG[level];
  const levelColor = config?.color || "text-zinc-400";
  const subsystemGroup = getSubsystemGroup(line.subsystem);
  const subsystemConfig = subsystemGroup ? SUBSYSTEM_GROUPS[subsystemGroup] : null;

  return (
    <div
      className={`flex gap-1.5 px-1.5 py-0.5 rounded hover:bg-white/[0.02] transition-colors ${
        level === "error" ? "bg-red-500/[0.03]" : level === "warn" ? "bg-yellow-500/[0.02]" : ""
      }`}
    >
      {/* Time */}
      <span className="text-zinc-600 flex-shrink-0 w-[85px] select-all">
        {formatTime(line.time)}
      </span>

      {/* Level */}
      <span className={`flex-shrink-0 w-[38px] ${levelColor} uppercase text-[10px] font-semibold`}>
        {line.level?.slice(0, 5) || "???"}
      </span>

      {/* Subsystem badge */}
      {line.subsystem && (
        <span
          className={`flex-shrink-0 px-1 rounded text-[10px] ${
            subsystemConfig?.color || "bg-zinc-800 text-zinc-500"
          }`}
          title={line.subsystem}
        >
          {formatSubsystemDisplay(line.subsystem)}
        </span>
      )}

      {/* Message */}
      <span
        className={`break-all ${
          level === "error"
            ? "text-red-300"
            : level === "warn"
              ? "text-yellow-300/80"
              : level === "debug"
                ? "text-zinc-600"
                : "text-zinc-300"
        }`}
      >
        {textFilter ? highlightText(line.message, textFilter) : line.message}
      </span>
    </div>
  );
}

// ── Text Highlighting ──

function highlightText(text: string, filter: string): React.ReactNode {
  if (!filter) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(filter);
  if (idx === -1) return text;

  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">
        {text.slice(idx, idx + filter.length)}
      </span>
      {text.slice(idx + filter.length)}
    </>
  );
}
