/**
 * ErrorsWidget — Errors & Failures with compute anomalies folded in.
 * Think Tank Spec: "Includes compute anomalies (latency spikes, memory pressure).
 * Not a separate infra panel."
 */

import { AlertOctagon, Cpu, Zap, RefreshCw } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface ErrorEntry {
  id: string;
  type: "agent" | "compute" | "channel" | "task";
  severity: "warning" | "error" | "critical";
  message: string;
  source: string;
  timestamp: string;
}

const SEVERITY_STYLES = {
  warning: "border-amber-500/30 bg-amber-500/5",
  error: "border-red-500/30 bg-red-500/5",
  critical: "border-red-500/50 bg-red-500/10 animate-pulse",
};

const TYPE_ICONS = {
  agent: AlertOctagon,
  compute: Cpu,
  channel: Zap,
  task: AlertOctagon,
};

export function ErrorsWidget() {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchErrors = useCallback(async () => {
    try {
      const res = await fetch("/api/health/errors");
      if (res.ok) {
        const data = await res.json();
        setErrors(data.errors || []);
      }
    } catch {
      // No errors API yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchErrors();
    const interval = setInterval(fetchErrors, 15000);
    return () => clearInterval(interval);
  }, [fetchErrors]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="w-4 h-4 text-[hsl(var(--muted-foreground))] animate-spin" />
      </div>
    );
  }

  if (errors.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <AlertOctagon className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="text-xs text-[hsl(var(--muted-foreground))]">No active errors</div>
        <div className="text-[10px] text-emerald-400/60">Systems nominal</div>
      </div>
    );
  }

  // Anti-pattern: "Never optimize for green. Show the noise floor."
  return (
    <div className="h-full flex flex-col gap-2 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          Errors ({errors.length})
        </span>
        <button
          onClick={fetchErrors}
          className="p-1 rounded hover:bg-[hsl(var(--muted))] transition-colors"
        >
          <RefreshCw className="w-3 h-3 text-[hsl(var(--muted-foreground))]" />
        </button>
      </div>
      {errors.map((err) => {
        const Icon = TYPE_ICONS[err.type] || AlertOctagon;
        return (
          <div key={err.id} className={`rounded-lg border p-2 ${SEVERITY_STYLES[err.severity]}`}>
            <div className="flex items-start gap-2">
              <Icon
                className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${err.severity === "critical" ? "text-red-400" : err.severity === "error" ? "text-red-400" : "text-amber-400"}`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[hsl(var(--foreground))] leading-snug">
                  {err.message}
                </div>
                <div className="text-[9px] text-[hsl(var(--muted-foreground))] mt-0.5">
                  {err.source} &middot; {new Date(err.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
