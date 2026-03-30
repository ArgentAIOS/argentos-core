/**
 * JobsBoardWidget — Cron-based workloads, grouped by family agent.
 *
 * Data from gateway WebSocket RPC: cron.list, cron.run, family.members.
 * No Business pipeline dependencies.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useGateway } from "../../hooks/useGateway";

// ── Types ──────────────────────────────────────────────────────────

interface FamilyMember {
  id: string;
  name: string;
  role?: string;
  team?: string;
  status?: string;
  alive?: boolean;
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
  sessionTarget: "main" | "isolated";
  executionMode?: "simulate" | "live";
  state: CronJobState;
  createdAtMs: number;
}

interface AgentGroup {
  id: string;
  name: string;
  role: string;
  color: string;
  jobs: CronJob[];
}

// ── Agent Filtering ────────────────────────────────────────────────

const EXCLUDED_IDS = new Set(["main", "dumbo", "argent"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

function isOperational(a: { id: string; role?: string }): boolean {
  if (EXCLUDED_IDS.has(a.id.toLowerCase())) return false;
  if (a.id.startsWith("test-") || a.id.startsWith("test_")) return false;
  if (UUID_RE.test(a.id)) return false;
  if (a.role === "think_tank_panelist") return false;
  return true;
}

// ── Agent Colors ───────────────────────────────────────────────────

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

// ── Schedule Formatting ────────────────────────────────────────────

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
    return schedule.expr;
  }
  if (schedule.kind === "at" && schedule.at) {
    return `Once: ${new Date(schedule.at).toLocaleString()}`;
  }
  return "Unknown";
}

// ── Relative Time ──────────────────────────────────────────────────

function timeAgo(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60000) return "just now";
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)}h ago`;
  return `${Math.floor(delta / 86400000)}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Job Card ───────────────────────────────────────────────────────

function CronJobCard({
  job,
  onRunNow,
  runningTrigger,
}: {
  job: CronJob;
  onRunNow: (jobId: string) => void;
  runningTrigger: string | null;
}) {
  const isRunning = job.state.runningAtMs != null;
  const isTriggering = runningTrigger === job.id;
  const disabled = !job.enabled;

  return (
    <div
      className={`rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 p-2.5 backdrop-blur-sm ${
        disabled ? "opacity-40" : ""
      }`}
      style={{ width: 160, flexShrink: 0 }}
    >
      {/* Title */}
      <div
        className={`text-[11px] font-semibold leading-tight truncate mb-1 ${
          disabled
            ? "line-through text-[hsl(var(--muted-foreground))]"
            : "text-[hsl(var(--foreground))]"
        }`}
        title={job.name}
      >
        {job.name}
      </div>

      {/* Schedule */}
      <div
        className="text-[10px] text-[hsl(var(--muted-foreground))] mb-1.5 truncate"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
        title={formatSchedule(job.schedule)}
      >
        {formatSchedule(job.schedule)}
      </div>

      {/* Status line */}
      <div className="flex items-center gap-1 mb-1.5 min-h-[16px]">
        {isRunning ? (
          <span className="flex items-center gap-1 text-[10px] text-cyan-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Running...
          </span>
        ) : job.state.lastStatus === "ok" ? (
          <span
            className="text-[10px] text-emerald-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <span className="mr-0.5">&#x2705;</span>
            {job.state.lastRunAtMs ? timeAgo(job.state.lastRunAtMs) : ""}
            {job.state.lastDurationMs != null && (
              <span className="text-[hsl(var(--muted-foreground))]">
                {" "}
                &#183; {formatDuration(job.state.lastDurationMs)}
              </span>
            )}
          </span>
        ) : job.state.lastStatus === "error" ? (
          <span
            className="text-[10px] text-red-400 truncate"
            title={job.state.lastError ?? "Error"}
          >
            <span className="mr-0.5">&#x274C;</span>
            Failed
            {job.state.lastRunAtMs && (
              <span className="text-[hsl(var(--muted-foreground))]">
                {" "}
                ({timeAgo(job.state.lastRunAtMs)})
              </span>
            )}
          </span>
        ) : job.state.lastStatus === "skipped" ? (
          <span className="text-[10px] text-amber-400">
            <span className="mr-0.5">&#x23ED;&#xFE0F;</span>
            Skipped
          </span>
        ) : (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] opacity-50">
            &mdash;
          </span>
        )}
      </div>

      {/* Error detail */}
      {job.state.lastStatus === "error" && job.state.lastError && (
        <div
          className="text-[9px] text-red-400/70 truncate mb-1.5"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
          title={job.state.lastError}
        >
          {job.state.lastError.length > 40
            ? job.state.lastError.slice(0, 40) + "..."
            : job.state.lastError}
        </div>
      )}

      {/* Run Now button */}
      {!disabled && (
        <button
          onClick={() => onRunNow(job.id)}
          disabled={isRunning || isTriggering}
          className={`w-full rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
            isRunning || isTriggering
              ? "bg-white/5 text-[hsl(var(--muted-foreground))] cursor-not-allowed"
              : "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/25"
          }`}
        >
          {isTriggering ? "Triggering..." : "Run Now"}
        </button>
      )}
    </div>
  );
}

// ── Agent Group Row ────────────────────────────────────────────────

function AgentGroupRow({
  group,
  onRunNow,
  runningTrigger,
}: {
  group: AgentGroup;
  onRunNow: (jobId: string) => void;
  runningTrigger: string | null;
}) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/40 p-3">
      {/* Agent header */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: group.color, boxShadow: `0 0 6px ${group.color}40` }}
        />
        <span className="text-[12px] font-semibold text-[hsl(var(--foreground))] truncate">
          {group.name}
        </span>
        {group.role && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">
            &#183; {group.role}
          </span>
        )}
      </div>

      {/* Job cards row */}
      <div className="flex flex-wrap gap-2">
        {group.jobs.map((job) => (
          <CronJobCard key={job.id} job={job} onRunNow={onRunNow} runningTrigger={runningTrigger} />
        ))}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export function JobsBoardWidget() {
  const { request, connected } = useGateway();
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningTrigger, setRunningTrigger] = useState<string | null>(null);

  const cronIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const membersIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const membersCache = useRef<FamilyMember[]>([]);
  const membersFetchedAt = useRef(0);

  const fetchMembers = useCallback(async (): Promise<FamilyMember[]> => {
    // Cache for 60s
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

      const jobs: CronJob[] = cronRes?.jobs ?? [];

      // Build member lookup
      const memberMap = new Map<string, FamilyMember>();
      for (const m of members) memberMap.set(m.id, m);

      // Group jobs by agentId
      const jobsByAgent = new Map<string, CronJob[]>();
      for (const job of jobs) {
        const key = job.agentId ?? "__system__";
        const list = jobsByAgent.get(key) ?? [];
        list.push(job);
        jobsByAgent.set(key, list);
      }

      // Build groups
      const agentGroups: AgentGroup[] = [];

      for (const [agentId, agentJobs] of jobsByAgent) {
        if (agentId === "__system__") continue; // handle below

        const member = memberMap.get(agentId);
        // Filter same as WorkflowMapCanvas
        if (member && !isOperational(member)) continue;
        if (!member && !isOperational({ id: agentId, role: "agent" })) continue;

        agentGroups.push({
          id: agentId,
          name: member?.name ?? agentId,
          role: member?.role ?? "",
          color: agentColor(agentId),
          jobs: agentJobs.sort((a, b) => a.name.localeCompare(b.name)),
        });
      }

      // Sort agent groups: most jobs first, then alphabetical
      agentGroups.sort((a, b) => {
        if (a.jobs.length !== b.jobs.length) return b.jobs.length - a.jobs.length;
        return a.name.localeCompare(b.name);
      });

      // System group (no agentId) at the bottom
      const systemJobs = jobsByAgent.get("__system__");
      if (systemJobs && systemJobs.length > 0) {
        agentGroups.push({
          id: "__system__",
          name: "System",
          role: "Unassigned",
          color: "#6B7280",
          jobs: systemJobs.sort((a, b) => a.name.localeCompare(b.name)),
        });
      }

      setGroups(agentGroups);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch workloads");
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
        // Refresh immediately to show running state
        setTimeout(() => fetchData(), 500);
      } catch (err) {
        console.error("[JobsBoardWidget] cron.run failed:", err);
      } finally {
        setRunningTrigger(null);
      }
    },
    [connected, request, fetchData],
  );

  useEffect(() => {
    if (!connected) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchData();

    // Poll cron.list every 10s
    cronIntervalRef.current = setInterval(fetchData, 10_000);
    // Refresh members every 60s
    membersIntervalRef.current = setInterval(() => {
      membersFetchedAt.current = 0; // bust cache
    }, 60_000);

    return () => {
      if (cronIntervalRef.current) clearInterval(cronIntervalRef.current);
      if (membersIntervalRef.current) clearInterval(membersIntervalRef.current);
    };
  }, [connected, fetchData]);

  // ── Disconnected State ─────────────────────────────────────────

  if (!connected) {
    return (
      <div className="flex h-full flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
        <Header />
        <div className="flex flex-1 items-center justify-center text-[hsl(var(--muted-foreground))]">
          <div className="text-center">
            <div className="mb-2 text-2xl opacity-40">&#x26A0;</div>
            <div className="text-sm">Connect to gateway to view workloads</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading State ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
        <Header />
        <div className="flex flex-1 items-center justify-center text-[hsl(var(--muted-foreground))]">
          <div className="text-sm animate-pulse">Loading workloads...</div>
        </div>
      </div>
    );
  }

  // ── Error State ────────────────────────────────────────────────

  if (error && groups.length === 0) {
    return (
      <div className="flex h-full flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
        <Header />
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

  // ── Empty State ────────────────────────────────────────────────

  if (groups.length === 0) {
    return (
      <div className="flex h-full flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
        <Header />
        <div className="flex flex-1 items-center justify-center text-[hsl(var(--muted-foreground))]">
          <div className="text-center">
            <div className="text-sm">No scheduled workloads.</div>
            <div className="text-xs opacity-60 mt-1">Create one from the agent chat.</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main View ──────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 overflow-hidden">
      <Header />
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
        {groups.map((group) => (
          <AgentGroupRow
            key={group.id}
            group={group}
            onRunNow={handleRunNow}
            runningTrigger={runningTrigger}
          />
        ))}
      </div>
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────

function Header() {
  return (
    <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
      Workloads
    </div>
  );
}
