/**
 * ScheduleWidget — Cron job definitions control panel (table view).
 *
 * Paired with JobsBoardWidget which shows grouped results.
 * Data from gateway WebSocket RPC: cron.list, cron.run, family.members.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useGateway } from "../../hooks/useGateway";

// ── Types ──────────────────────────────────────────────────────────

interface FamilyMember {
  id: string;
  name: string;
  role?: string;
}

interface CronSchedule {
  kind: "cron" | "every" | "at";
  expr?: string;
  everyMs?: number;
  at?: string;
  tz?: string;
}

interface CronJobState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
  runningAtMs?: number;
}

interface CronJob {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: { kind: string; message?: string; text?: string };
  sessionTarget?: "main" | "isolated";
  executionMode?: "simulate" | "live";
  state: CronJobState;
  createdAtMs: number;
}

// ── System Job Detection ──────────────────────────────────────────

const SYSTEM_PAYLOAD_KINDS = new Set(["nudge", "vipEmailScan", "slackSignalScan", "systemEvent"]);

function isSystemJob(job: CronJob): boolean {
  if (SYSTEM_PAYLOAD_KINDS.has(job.payload.kind)) return true;
  if (!job.agentId) return true;
  return false;
}

// ── Agent Colors ──────────────────────────────────────────────────

const AGENT_COLORS = [
  "#00AAFF",
  "#FF6B6B",
  "#4ECDC4",
  "#FFA726",
  "#AB47BC",
  "#66BB6A",
  "#EF5350",
  "#42A5F5",
  "#FFCA28",
  "#26C6DA",
  "#8D6E63",
  "#EC407A",
  "#7E57C2",
  "#26A69A",
  "#D4E157",
];

function agentColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

// ── Schedule Formatting ───────────────────────────────────────────

function formatSchedule(schedule: CronSchedule): string {
  if (schedule.kind === "every" && schedule.everyMs) {
    const mins = schedule.everyMs / 60000;
    if (mins < 60) return `Every ${mins}m`;
    const hrs = mins / 60;
    if (hrs < 24) return hrs === Math.floor(hrs) ? `Every ${hrs}h` : `Every ${hrs.toFixed(1)}h`;
    const days = hrs / 24;
    return days === Math.floor(days) ? `Every ${days}d` : `Every ${days.toFixed(1)}d`;
  }
  if (schedule.kind === "cron" && schedule.expr) {
    return humanizeCron(schedule.expr);
  }
  if (schedule.kind === "at" && schedule.at) {
    return `Once: ${new Date(schedule.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  }
  return "Unknown";
}

/** Best-effort human-readable cron. Falls back to raw expression. */
function humanizeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  // Daily at HH:MM
  if (dom === "*" && mon === "*" && dow === "*" && hour !== "*" && min !== "*") {
    const h = parseInt(hour!, 10);
    const m = parseInt(min!, 10);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const mStr = m.toString().padStart(2, "0");
    return `Daily at ${h12}:${mStr} ${ampm}`;
  }

  // Every N hours (0 */N * * *)
  if (min === "0" && hour?.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
    return `Every ${hour.slice(2)}h`;
  }

  // Every N minutes (*/N * * * *)
  if (min?.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return `Every ${min.slice(2)}m`;
  }

  return expr;
}

// ── Relative Time ─────────────────────────────────────────────────

function timeAgo(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 0) return "just now";
  if (delta < 60000) return "just now";
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)}h ago`;
  return `${Math.floor(delta / 86400000)}d ago`;
}

function timeUntil(ms: number): string {
  const delta = ms - Date.now();
  if (delta < 0) return "overdue";
  if (delta < 60000) return "< 1m";
  if (delta < 3600000) return `in ${Math.floor(delta / 60000)}m`;
  if (delta < 86400000) return `in ${Math.floor(delta / 3600000)}h`;
  return `in ${Math.floor(delta / 86400000)}d`;
}

// ── Row Component ─────────────────────────────────────────────────

function ScheduleRow({
  job,
  agentName,
  onRunNow,
  onEdit,
  runningTrigger,
  isEven,
}: {
  job: CronJob;
  agentName: string | null;
  onRunNow: (jobId: string) => void;
  onEdit: (jobId: string) => void;
  runningTrigger: string | null;
  isEven: boolean;
}) {
  const isRunning = job.state.runningAtMs != null;
  const isTriggering = runningTrigger === job.id;
  const color = job.agentId ? agentColor(job.agentId) : "#6B7280";

  return (
    <tr
      className={`text-[11px] ${isEven ? "bg-white/[0.02]" : ""} ${
        !job.enabled ? "opacity-40" : ""
      }`}
    >
      {/* Enabled indicator */}
      <td className="px-2 py-1.5 text-center w-[40px]">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{
            backgroundColor: job.enabled ? "#34D399" : "#6B7280",
            boxShadow: job.enabled ? "0 0 4px #34D39960" : "none",
          }}
          title={job.enabled ? "Enabled" : "Disabled"}
        />
      </td>

      {/* Name + description */}
      <td className="px-2 py-1.5 max-w-[180px]">
        <div
          className={`font-medium truncate ${
            job.enabled
              ? "text-[hsl(var(--foreground))]"
              : "line-through text-[hsl(var(--muted-foreground))]"
          }`}
          title={job.name}
        >
          {job.name}
        </div>
        {job.description && (
          <div
            className="text-[10px] text-[hsl(var(--muted-foreground))] truncate mt-0.5"
            title={job.description}
          >
            {job.description}
          </div>
        )}
      </td>

      {/* Agent badge */}
      <td className="px-2 py-1.5">
        {agentName ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: `${color}20`,
              color,
              border: `1px solid ${color}30`,
            }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            {agentName}
          </span>
        ) : (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] opacity-50">
            &mdash;
          </span>
        )}
      </td>

      {/* Schedule */}
      <td
        className="px-2 py-1.5 text-[hsl(var(--muted-foreground))]"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        {formatSchedule(job.schedule)}
      </td>

      {/* Status */}
      <td className="px-2 py-1.5">
        {isRunning ? (
          <span className="inline-flex items-center gap-1 text-cyan-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Running
          </span>
        ) : job.state.lastStatus === "ok" ? (
          <span
            className="text-emerald-400"
            title={
              job.state.lastRunAtMs
                ? `Last: ${new Date(job.state.lastRunAtMs).toLocaleString()}`
                : undefined
            }
          >
            &#x2705; {job.state.lastRunAtMs ? timeAgo(job.state.lastRunAtMs) : "OK"}
          </span>
        ) : job.state.lastStatus === "error" ? (
          <span className="text-red-400" title={job.state.lastError ?? "Error"}>
            &#x274C; {job.state.lastRunAtMs ? timeAgo(job.state.lastRunAtMs) : "Error"}
          </span>
        ) : job.state.lastStatus === "skipped" ? (
          <span className="text-amber-400">&#x23ED;&#xFE0F; Skip</span>
        ) : (
          <span className="text-[hsl(var(--muted-foreground))] opacity-50">&mdash;</span>
        )}
      </td>

      {/* Next run */}
      <td className="px-2 py-1.5 text-[hsl(var(--muted-foreground))]">
        {job.enabled && job.state.nextRunAtMs ? (
          <span title={new Date(job.state.nextRunAtMs).toLocaleString()}>
            {timeUntil(job.state.nextRunAtMs)}
          </span>
        ) : (
          <span className="opacity-50">&mdash;</span>
        )}
      </td>

      {/* Actions */}
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(job.id)}
            className="rounded px-1.5 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-white/5 transition-colors"
            title="Edit schedule"
          >
            Edit
          </button>
          <button
            onClick={() => onRunNow(job.id)}
            disabled={isRunning || isTriggering || !job.enabled}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              isRunning || isTriggering || !job.enabled
                ? "text-[hsl(var(--muted-foreground))] opacity-40 cursor-not-allowed"
                : "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/25"
            }`}
          >
            {isTriggering ? "..." : "Run Now"}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Main Component ────────────────────────────────────────────────

export function ScheduleWidget() {
  const { request, connected } = useGateway();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [memberMap, setMemberMap] = useState<Map<string, FamilyMember>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningTrigger, setRunningTrigger] = useState<string | null>(null);
  const [showSystem, setShowSystem] = useState(false);

  const cronIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const membersFetchedAt = useRef(0);
  const membersCache = useRef<FamilyMember[]>([]);

  const fetchMembers = useCallback(async (): Promise<FamilyMember[]> => {
    if (Date.now() - membersFetchedAt.current < 60_000 && membersCache.current.length > 0) {
      return membersCache.current;
    }
    try {
      const res = await request<{ members: FamilyMember[] }>("family.members");
      const members = res?.members ?? [];
      membersCache.current = members;
      membersFetchedAt.current = Date.now();
      return members;
    } catch {
      return membersCache.current;
    }
  }, [request]);

  const fetchData = useCallback(async () => {
    if (!connected) return;
    try {
      const [cronRes, members] = await Promise.all([
        request<{ jobs: CronJob[] }>("cron.list"),
        fetchMembers(),
      ]);

      const allJobs: CronJob[] = cronRes?.jobs ?? [];
      // Sort: enabled first, then by name
      allJobs.sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      setJobs(allJobs);

      const map = new Map<string, FamilyMember>();
      for (const m of members) map.set(m.id, m);
      setMemberMap(map);

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch schedules");
    } finally {
      setLoading(false);
    }
  }, [connected, request, fetchMembers]);

  const handleRunNow = useCallback(
    async (jobId: string) => {
      if (!connected) return;
      setRunningTrigger(jobId);
      try {
        await request("cron.run", { jobId, mode: "force" });
        setTimeout(() => fetchData(), 500);
      } catch (err) {
        console.error("[ScheduleWidget] cron.run failed:", err);
      } finally {
        setRunningTrigger(null);
      }
    },
    [connected, request, fetchData],
  );

  const handleEdit = useCallback((jobId: string) => {
    console.log("[ScheduleWidget] Edit schedule:", jobId);
  }, []);

  const handleCreate = useCallback(() => {
    console.log("[ScheduleWidget] Create new schedule");
  }, []);

  useEffect(() => {
    if (!connected) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchData();

    cronIntervalRef.current = setInterval(fetchData, 10_000);

    return () => {
      if (cronIntervalRef.current) clearInterval(cronIntervalRef.current);
    };
  }, [connected, fetchData]);

  // ── Filter jobs ───────────────────────────────────────────────

  const visibleJobs = showSystem ? jobs : jobs.filter((j) => !isSystemJob(j));
  const systemCount = jobs.filter(isSystemJob).length;

  // ── Resolve agent name ────────────────────────────────────────

  function resolveAgentName(job: CronJob): string | null {
    if (!job.agentId) return null;
    const member = memberMap.get(job.agentId);
    return member?.name ?? job.agentId;
  }

  // ── Disconnected ──────────────────────────────────────────────

  if (!connected) {
    return (
      <div className="flex h-full flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
        <Header onCreateNew={handleCreate} />
        <div className="flex flex-1 items-center justify-center text-[hsl(var(--muted-foreground))]">
          <div className="text-center">
            <div className="mb-2 text-2xl opacity-40">&#x26A0;</div>
            <div className="text-sm">Connect to gateway to view schedules</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
        <Header onCreateNew={handleCreate} />
        <div className="flex flex-1 items-center justify-center text-[hsl(var(--muted-foreground))]">
          <div className="text-sm animate-pulse">Loading schedules...</div>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────

  if (error && jobs.length === 0) {
    return (
      <div className="flex h-full flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
        <Header onCreateNew={handleCreate} />
        <div className="flex flex-1 items-center justify-center text-[hsl(var(--muted-foreground))]">
          <div className="text-center">
            <div className="mb-1 text-sm text-red-400">Failed to load</div>
            <div className="text-xs opacity-60 mb-2">{error}</div>
            <button
              onClick={() => {
                setLoading(true);
                setError(null);
                fetchData();
              }}
              className="rounded px-3 py-1 text-[11px] font-medium bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/25"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────

  if (visibleJobs.length === 0 && !showSystem) {
    return (
      <div className="flex h-full flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 overflow-hidden">
        <Header onCreateNew={handleCreate} />
        <div className="flex flex-1 items-center justify-center text-[hsl(var(--muted-foreground))]">
          <div className="text-center">
            <div className="text-sm">No agent schedules defined.</div>
            {systemCount > 0 && (
              <button
                onClick={() => setShowSystem(true)}
                className="text-xs mt-1 text-[hsl(var(--primary))] hover:underline"
              >
                Show {systemCount} system job{systemCount !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main View ─────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 overflow-hidden">
      <Header onCreateNew={handleCreate} />

      {/* System toggle */}
      <div className="flex items-center justify-between mb-2 text-[10px] text-[hsl(var(--muted-foreground))]">
        <span>
          {visibleJobs.length} job{visibleJobs.length !== 1 ? "s" : ""}
          {!showSystem && systemCount > 0 && (
            <span className="opacity-60"> ({systemCount} system hidden)</span>
          )}
        </span>
        {systemCount > 0 && (
          <button
            onClick={() => setShowSystem((v) => !v)}
            className="hover:text-[hsl(var(--foreground))] transition-colors"
          >
            {showSystem ? "Hide system" : "Show system"}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))]">
              <th className="px-2 py-1.5 font-medium w-[40px]">On</th>
              <th className="px-2 py-1.5 font-medium">Name</th>
              <th className="px-2 py-1.5 font-medium">Agent</th>
              <th className="px-2 py-1.5 font-medium">Schedule</th>
              <th className="px-2 py-1.5 font-medium">Status</th>
              <th className="px-2 py-1.5 font-medium">Next Run</th>
              <th className="px-2 py-1.5 font-medium w-[100px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleJobs.map((job, idx) => (
              <ScheduleRow
                key={job.id}
                job={job}
                agentName={resolveAgentName(job)}
                onRunNow={handleRunNow}
                onEdit={handleEdit}
                runningTrigger={runningTrigger}
                isEven={idx % 2 === 0}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────

function Header({ onCreateNew }: { onCreateNew?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
        Schedule
      </div>
      {onCreateNew && (
        <button
          onClick={onCreateNew}
          className="rounded px-2 py-0.5 text-[10px] font-medium bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/25 transition-colors"
        >
          + Create
        </button>
      )}
    </div>
  );
}
