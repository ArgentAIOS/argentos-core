/**
 * ActiveWorkersWidget — Live view of running agents/workers.
 * Think Tank Spec: "Per-worker: task name, duration, confidence/uncertainty signal,
 * reversal cost radiation badge."
 * Scales: 3 agents = cards, 30 = grouped, 300+ = clusters.
 */

import { useState, useEffect, useCallback } from "react";

interface Worker {
  id: string;
  name: string;
  role?: string;
  status: "active" | "idle" | "paused" | "error";
  currentTask?: string;
  duration?: number; // seconds
  reversalCost?: "low" | "medium" | "high";
  confidence?: number; // 0-1
}

const REVERSAL_COLORS = {
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-red-500",
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function ActiveWorkersWidget() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWorkers = useCallback(async () => {
    try {
      const res = await fetch("/api/workers/active");
      if (res.ok) {
        const data = await res.json();
        setWorkers(data.workers || []);
      }
    } catch {
      // Fallback: show main agent as the only worker
      setWorkers([
        {
          id: "main",
          name: "Argent",
          role: "Main Agent",
          status: "active",
          currentTask: "Monitoring",
          reversalCost: "low",
          confidence: 0.95,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 15000);
    return () => clearInterval(interval);
  }, [fetchWorkers]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[hsl(var(--muted-foreground))] text-xs">Loading workers...</div>
      </div>
    );
  }

  // Scale: cluster view at 30+ workers
  if (workers.length > 30) {
    const active = workers.filter((w) => w.status === "active").length;
    const errored = workers.filter((w) => w.status === "error").length;
    const paused = workers.filter((w) => w.status === "paused").length;
    return (
      <div className="h-full flex flex-col gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          Fleet: {workers.length} workers
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2 text-center">
            <div className="text-lg font-bold text-emerald-400">{active}</div>
            <div className="text-[9px] text-emerald-400/70">Active</div>
          </div>
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2 text-center">
            <div className="text-lg font-bold text-amber-400">{paused}</div>
            <div className="text-[9px] text-amber-400/70">Paused</div>
          </div>
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-center">
            <div className="text-lg font-bold text-red-400">{errored}</div>
            <div className="text-[9px] text-red-400/70">Errors</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-2 overflow-y-auto">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        Workers ({workers.length})
      </div>
      {workers.map((worker) => (
        <div
          key={worker.id}
          className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 p-2"
        >
          {/* Status dot */}
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              worker.status === "active"
                ? "bg-emerald-400 animate-pulse"
                : worker.status === "error"
                  ? "bg-red-400"
                  : worker.status === "paused"
                    ? "bg-amber-400"
                    : "bg-[hsl(var(--muted-foreground))]"
            }`}
          />

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-[hsl(var(--foreground))] truncate">
              {worker.name}
              {worker.role && (
                <span className="text-[hsl(var(--muted-foreground))] font-normal">
                  {" "}
                  &middot; {worker.role}
                </span>
              )}
            </div>
            {worker.currentTask && (
              <div className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">
                {worker.currentTask}
                {worker.duration != null && (
                  <span className="text-[hsl(var(--muted-foreground))]/60">
                    {" "}
                    &middot; {formatDuration(worker.duration)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Reversal cost radiation badge */}
          {worker.reversalCost && (
            <div
              className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${REVERSAL_COLORS[worker.reversalCost]}`}
              title={`Undo risk: ${worker.reversalCost}`}
            />
          )}

          {/* Confidence bar */}
          {worker.confidence != null && (
            <div
              className="w-8 h-1 rounded-full bg-[hsl(var(--muted))] flex-shrink-0 overflow-hidden"
              title={`Confidence: ${Math.round(worker.confidence * 100)}%`}
            >
              <div
                className={`h-full rounded-full ${worker.confidence > 0.8 ? "bg-emerald-400" : worker.confidence > 0.5 ? "bg-amber-400" : "bg-red-400"}`}
                style={{ width: `${worker.confidence * 100}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
