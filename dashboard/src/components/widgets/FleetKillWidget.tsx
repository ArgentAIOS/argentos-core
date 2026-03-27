/**
 * FleetKillWidget — Emergency controls. Global stop button.
 * Think Tank Spec: "Global Fleet Kill button — always visible, never buried."
 */

import { OctagonX, AlertTriangle } from "lucide-react";
import { useState } from "react";

export function FleetKillWidget() {
  const [confirming, setConfirming] = useState(false);
  const [killing, setKilling] = useState(false);

  const handleKill = async () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 5000); // auto-reset after 5s
      return;
    }
    setKilling(true);
    try {
      await fetch("/api/workers/kill-all", { method: "POST" });
    } catch {
      // Best effort
    }
    setKilling(false);
    setConfirming(false);
  };

  return (
    <div className="h-full flex flex-col items-center justify-center gap-3">
      <button
        onClick={handleKill}
        disabled={killing}
        className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
          confirming
            ? "bg-red-600 text-white border-2 border-red-400 shadow-[0_0_20px_rgba(239,68,68,0.4)] animate-pulse"
            : killing
              ? "bg-red-800 text-red-200 border-2 border-red-600 cursor-wait"
              : "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50"
        }`}
      >
        <div className="flex items-center justify-center gap-2">
          <OctagonX className="w-5 h-5" />
          {killing ? "Stopping all..." : confirming ? "CONFIRM KILL ALL" : "Fleet Kill"}
        </div>
      </button>
      {confirming && (
        <div className="flex items-center gap-1 text-[10px] text-red-400">
          <AlertTriangle className="w-3 h-3" />
          This will stop ALL active workers immediately
        </div>
      )}
      {!confirming && !killing && (
        <div className="text-[9px] text-[hsl(var(--muted-foreground))] text-center">
          Emergency stop all workers and pending tasks
        </div>
      )}
    </div>
  );
}
