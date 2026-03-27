/**
 * ApprovalsWidget — Pending approvals requiring human action.
 * Think Tank Spec: "#1 priority. Each shows Undo Risk. Deliberate friction on high-stakes."
 */

import { AlertTriangle, Check, X, Shield } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface Approval {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  undoRisk: "low" | "medium" | "high";
  category: string;
  createdAt: string;
  context?: string;
}

const UNDO_RISK_COLORS = {
  low: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  high: "text-red-400 bg-red-500/10 border-red-500/30",
};

export function ApprovalsWidget() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch("/api/exec-approvals/pending");
      if (res.ok) {
        const data = await res.json();
        setApprovals(data.approvals || []);
      }
    } catch {
      // API not available yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 10000);
    return () => clearInterval(interval);
  }, [fetchApprovals]);

  const handleApprove = async (id: string) => {
    try {
      await fetch(`/api/exec-approvals/${id}/approve`, { method: "POST" });
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch {}
  };

  const handleReject = async (id: string) => {
    try {
      await fetch(`/api/exec-approvals/${id}/reject`, { method: "POST" });
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch {}
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[hsl(var(--muted-foreground))] text-xs">Loading approvals...</div>
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <Shield className="w-6 h-6 text-emerald-400/50" />
        <div className="text-xs text-[hsl(var(--muted-foreground))]">No pending approvals</div>
        <div className="text-[10px] text-emerald-400/60">All clear</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-2 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          Pending ({approvals.length})
        </span>
      </div>
      {approvals.map((approval) => (
        <div
          key={approval.id}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 p-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-[hsl(var(--foreground))] truncate">
                {approval.title}
              </div>
              <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                {approval.agentName} &middot; {approval.category}
              </div>
            </div>
            {/* Undo Risk radiation badge */}
            <span
              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${UNDO_RISK_COLORS[approval.undoRisk]}`}
            >
              {approval.undoRisk}
            </span>
          </div>

          {/* Expanded context — deliberate friction for high-stakes */}
          {expanded === approval.id && approval.context && (
            <div className="mt-2 p-2 rounded bg-[hsl(var(--muted))]/30 text-[10px] text-[hsl(var(--muted-foreground))]">
              {approval.context}
            </div>
          )}

          <div className="flex items-center gap-1 mt-2">
            {approval.undoRisk === "high" && expanded !== approval.id ? (
              <button
                onClick={() => setExpanded(approval.id)}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
              >
                <AlertTriangle className="w-3 h-3" />
                Review context first
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleApprove(approval.id)}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                >
                  <Check className="w-3 h-3" />
                  Approve
                </button>
                <button
                  onClick={() => handleReject(approval.id)}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Reject
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
