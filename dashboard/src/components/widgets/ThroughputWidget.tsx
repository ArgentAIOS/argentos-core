/**
 * ThroughputWidget — Task completion trends.
 * Think Tank Spec: "Tasks completed today/week, success rate trending.
 * Replace Tasks Today with Overdue Tasks for urgency."
 */

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface ThroughputStats {
  completedToday: number;
  completedThisWeek: number;
  successRate: number; // 0-100
  successRateTrend: "up" | "down" | "flat";
  overdueCount: number;
  avgCompletionMinutes: number;
}

export function ThroughputWidget() {
  const [stats, setStats] = useState<ThroughputStats>({
    completedToday: 0,
    completedThisWeek: 0,
    successRate: 0,
    successRateTrend: "flat",
    overdueCount: 0,
    avgCompletionMinutes: 0,
  });

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/throughput");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // API not available
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const TrendIcon =
    stats.successRateTrend === "up"
      ? TrendingUp
      : stats.successRateTrend === "down"
        ? TrendingDown
        : Minus;

  const trendColor =
    stats.successRateTrend === "up"
      ? "text-emerald-400"
      : stats.successRateTrend === "down"
        ? "text-red-400"
        : "text-[hsl(var(--muted-foreground))]";

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        Throughput
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 p-2 text-center">
          <div className="text-lg font-bold text-[hsl(var(--foreground))]">
            {stats.completedToday}
          </div>
          <div className="text-[9px] text-[hsl(var(--muted-foreground))]">Today</div>
        </div>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 p-2 text-center">
          <div className="text-lg font-bold text-[hsl(var(--foreground))]">
            {stats.completedThisWeek}
          </div>
          <div className="text-[9px] text-[hsl(var(--muted-foreground))]">This Week</div>
        </div>
      </div>

      {/* Success rate with trend */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 p-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            Success Rate
          </span>
          <div className="flex items-center gap-1">
            <TrendIcon className={`w-3 h-3 ${trendColor}`} />
          </div>
        </div>
        <div className="flex items-baseline gap-1 mt-1">
          <span
            className={`text-xl font-bold ${
              stats.successRate >= 90
                ? "text-emerald-400"
                : stats.successRate >= 70
                  ? "text-amber-400"
                  : "text-red-400"
            }`}
          >
            {stats.successRate}%
          </span>
        </div>
        {/* Progress bar */}
        <div className="w-full h-1 rounded-full bg-[hsl(var(--muted))] mt-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              stats.successRate >= 90
                ? "bg-emerald-400"
                : stats.successRate >= 70
                  ? "bg-amber-400"
                  : "bg-red-400"
            }`}
            style={{ width: `${stats.successRate}%` }}
          />
        </div>
      </div>

      {/* Overdue — forces urgency */}
      {stats.overdueCount > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 flex items-center justify-between">
          <span className="text-xs text-red-400 font-medium">Overdue</span>
          <span className="text-lg font-bold text-red-400">{stats.overdueCount}</span>
        </div>
      )}
    </div>
  );
}
