/**
 * QueueWidget — Task queue depth + Scale Horizon.
 * Think Tank Spec: "Queue depth, blocked count, overdue count.
 * Combined with Scale Horizon: X hours to capacity at current growth rate."
 */

import { Layers, Clock, AlertTriangle } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface QueueStats {
  total: number;
  blocked: number;
  overdue: number;
  avgCompletionMin: number;
  scaleHorizonHours: number | null; // null = not enough data
}

export function QueueWidget() {
  const [stats, setStats] = useState<QueueStats>({
    total: 0,
    blocked: 0,
    overdue: 0,
    avgCompletionMin: 0,
    scaleHorizonHours: null,
  });

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/queue-stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // API not available — show zeros
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        Task Queue
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-[hsl(var(--background))]/50 border border-[hsl(var(--border))] p-2 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Layers className="w-3 h-3 text-[hsl(var(--primary))]" />
          </div>
          <div className="text-lg font-bold text-[hsl(var(--foreground))]">{stats.total}</div>
          <div className="text-[9px] text-[hsl(var(--muted-foreground))]">Queued</div>
        </div>
        <div
          className={`rounded-lg border p-2 text-center ${stats.blocked > 0 ? "bg-amber-500/5 border-amber-500/30" : "bg-[hsl(var(--background))]/50 border-[hsl(var(--border))]"}`}
        >
          <div className="flex items-center justify-center gap-1 mb-1">
            <AlertTriangle
              className={`w-3 h-3 ${stats.blocked > 0 ? "text-amber-400" : "text-[hsl(var(--muted-foreground))]"}`}
            />
          </div>
          <div
            className={`text-lg font-bold ${stats.blocked > 0 ? "text-amber-400" : "text-[hsl(var(--foreground))]"}`}
          >
            {stats.blocked}
          </div>
          <div className="text-[9px] text-[hsl(var(--muted-foreground))]">Blocked</div>
        </div>
        <div
          className={`rounded-lg border p-2 text-center ${stats.overdue > 0 ? "bg-red-500/5 border-red-500/30" : "bg-[hsl(var(--background))]/50 border-[hsl(var(--border))]"}`}
        >
          <div className="flex items-center justify-center gap-1 mb-1">
            <Clock
              className={`w-3 h-3 ${stats.overdue > 0 ? "text-red-400" : "text-[hsl(var(--muted-foreground))]"}`}
            />
          </div>
          <div
            className={`text-lg font-bold ${stats.overdue > 0 ? "text-red-400" : "text-[hsl(var(--foreground))]"}`}
          >
            {stats.overdue}
          </div>
          <div className="text-[9px] text-[hsl(var(--muted-foreground))]">Overdue</div>
        </div>
      </div>

      {/* Scale Horizon */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 p-2">
        <div className="text-[9px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">
          Scale Horizon
        </div>
        {stats.scaleHorizonHours != null ? (
          <div className="flex items-baseline gap-1">
            <span
              className={`text-lg font-bold ${stats.scaleHorizonHours < 2 ? "text-red-400" : stats.scaleHorizonHours < 8 ? "text-amber-400" : "text-emerald-400"}`}
            >
              {stats.scaleHorizonHours.toFixed(1)}h
            </span>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">to capacity</span>
          </div>
        ) : (
          <div className="text-xs text-[hsl(var(--muted-foreground))]">Collecting data...</div>
        )}
      </div>
    </div>
  );
}
