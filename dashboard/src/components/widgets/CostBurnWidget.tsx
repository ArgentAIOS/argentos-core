/**
 * CostBurnWidget — API spend tracking by tier.
 * Think Tank Spec: "API spend today/month by tier. Token consumption."
 */

import { DollarSign } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface CostStats {
  today: number;
  thisMonth: number;
  byTier: Array<{
    tier: string;
    label: string;
    cost: number;
    tokens: number;
    color: string;
  }>;
}

function formatCost(cents: number): string {
  if (cents === 0) return "$0";
  if (cents < 100) return `$${(cents / 100).toFixed(2)}`;
  return `$${(cents / 100).toFixed(0)}`;
}

function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function CostBurnWidget() {
  const [stats, setStats] = useState<CostStats>({
    today: 0,
    thisMonth: 0,
    byTier: [
      { tier: "local", label: "Local", cost: 0, tokens: 0, color: "bg-emerald-400" },
      { tier: "fast", label: "Fast", cost: 0, tokens: 0, color: "bg-amber-400" },
      { tier: "balanced", label: "Balanced", cost: 0, tokens: 0, color: "bg-blue-400" },
      { tier: "powerful", label: "Powerful", cost: 0, tokens: 0, color: "bg-purple-400" },
    ],
  });

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/cost");
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

  const totalTokens = stats.byTier.reduce((sum, t) => sum + t.tokens, 0);
  const maxCost = Math.max(...stats.byTier.map((t) => t.cost), 1);

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        Cost Burn
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 p-2 text-center">
          <div className="flex items-center justify-center gap-1">
            <DollarSign className="w-3 h-3 text-[hsl(var(--primary))]" />
          </div>
          <div className="text-lg font-bold text-[hsl(var(--foreground))]">
            {formatCost(stats.today)}
          </div>
          <div className="text-[9px] text-[hsl(var(--muted-foreground))]">Today</div>
        </div>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 p-2 text-center">
          <div className="text-lg font-bold text-[hsl(var(--foreground))]">
            {formatCost(stats.thisMonth)}
          </div>
          <div className="text-[9px] text-[hsl(var(--muted-foreground))]">This Month</div>
        </div>
      </div>

      {/* Tier breakdown */}
      <div className="space-y-1.5">
        {stats.byTier.map((tier) => (
          <div key={tier.tier} className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${tier.color}`} />
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] w-16 flex-shrink-0">
              {tier.label}
            </span>
            <div className="flex-1 h-1 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
              <div
                className={`h-full rounded-full ${tier.color}`}
                style={{ width: `${(tier.cost / maxCost) * 100}%` }}
              />
            </div>
            <span className="text-[9px] text-[hsl(var(--muted-foreground))] w-10 text-right flex-shrink-0">
              {formatTokens(tier.tokens)}
            </span>
          </div>
        ))}
      </div>

      <div className="text-[9px] text-[hsl(var(--muted-foreground))] text-center">
        {formatTokens(totalTokens)} total tokens
      </div>
    </div>
  );
}
