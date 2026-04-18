import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  RefreshCw,
  Route,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useGateway } from "../hooks/useGateway";

type PersonalSkillRow = {
  id: string;
  title: string;
  summary: string;
  scope: string;
  state: string;
  confidence: number;
  strength: number;
  usageCount: number;
  successCount: number;
  failureCount: number;
  contradictionCount: number;
  operatorNotes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastUsedAt?: string | null;
  lastReviewedAt?: string | null;
  lastReinforcedAt?: string | null;
  lastContradictedAt?: string | null;
  executionReady: boolean;
  demotionRisk: "low" | "medium" | "high";
  preconditions: string[];
  executionSteps: string[];
  expectedOutcomes: string[];
  relatedTools: string[];
  supersedes: string[];
  supersedesEntries?: Array<{ id: string; title: string; state?: string }>;
  supersededBy?: string | null;
  supersededByEntry?: { id: string; title: string; state?: string } | null;
  conflicts: string[];
  conflictEntries?: Array<{ id: string; title: string; state?: string }>;
  reviewHistory?: Array<{
    id: string;
    actorType: string;
    action: string;
    reason?: string | null;
    createdAt: string;
  }>;
};

type PersonalSkillsResponse = {
  agentId: string;
  generatedAt: string;
  rows: PersonalSkillRow[];
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function metricTone(value: "low" | "medium" | "high"): string {
  if (value === "high") return "text-red-300 border-red-500/30 bg-red-500/10";
  if (value === "medium") return "text-amber-300 border-amber-500/30 bg-amber-500/10";
  return "text-emerald-300 border-emerald-500/30 bg-emerald-500/10";
}

export function PersonalSkillsPanel(props: {
  gatewayRequest?: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
}) {
  const gateway = useGateway();
  const request = props.gatewayRequest ?? gateway.request;
  const [data, setData] = useState<PersonalSkillsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await request<PersonalSkillsResponse>("skills.personal", {});
      setData(response);
      setNoteDrafts((prev) => {
        const next = { ...prev };
        for (const row of response.rows) {
          if (!(row.id in next)) {
            next[row.id] = row.operatorNotes ?? "";
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateState = async (row: PersonalSkillRow, state: string) => {
    setActionBusy(`${row.id}:${state}`);
    try {
      await request("skills.personal.update", { id: row.id, state });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(null);
    }
  };

  const resolveConflict = async (winnerId: string, loserId: string) => {
    setActionBusy(`${winnerId}:resolve:${loserId}`);
    try {
      await request("skills.personal.resolveConflict", { winnerId, loserId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(null);
    }
  };

  const saveNotes = async (row: PersonalSkillRow) => {
    const draft = noteDrafts[row.id] ?? "";
    setActionBusy(`${row.id}:notes`);
    try {
      await request("skills.personal.update", {
        id: row.id,
        state: row.state,
        operatorNotes: draft,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(null);
    }
  };

  const deleteSkill = async (row: PersonalSkillRow) => {
    const confirmed = window.confirm(`Delete Personal Skill "${row.title}"?`);
    if (!confirmed) return;
    setActionBusy(`${row.id}:delete`);
    try {
      await request("skills.personal.delete", { id: row.id });
      setExpandedId((current) => (current === row.id ? null : current));
      setNoteDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(null);
    }
  };

  const grouped = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      promoted: rows.filter((row) => row.state === "promoted"),
      incubating: rows.filter((row) => row.state === "incubating"),
      candidate: rows.filter((row) => row.state === "candidate"),
      deprecated: rows.filter((row) => row.state === "deprecated"),
    };
  }, [data]);

  const renderRow = (row: PersonalSkillRow) => {
    const expanded = expandedId === row.id;
    return (
      <div key={row.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-white font-medium">{row.title}</div>
              <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                {row.scope}
              </span>
              {row.executionReady && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
                  <Route className="w-3 h-3" />
                  Procedure Ready
                </span>
              )}
            </div>
            <div className="text-white/65 text-sm mt-1">{row.summary}</div>
            <div className="text-white/35 text-[11px] mt-2">
              updated {formatTimestamp(row.updatedAt)} · created {formatTimestamp(row.createdAt)}
            </div>
          </div>
          <button
            onClick={() => setExpandedId(expanded ? null : row.id)}
            className="text-xs px-2.5 py-1 rounded-lg border border-white/10 bg-white/[0.04] text-white/70 hover:text-white"
          >
            {expanded ? "Hide" : "Inspect"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded-lg border border-white/10 bg-white/[0.04] text-white/70">
            confidence {row.confidence.toFixed(2)}
          </span>
          <span className="px-2 py-1 rounded-lg border border-white/10 bg-white/[0.04] text-white/70">
            strength {row.strength.toFixed(2)}
          </span>
          <span className="px-2 py-1 rounded-lg border border-white/10 bg-white/[0.04] text-white/70">
            usage {row.usageCount}
          </span>
          <span className="px-2 py-1 rounded-lg border border-white/10 bg-white/[0.04] text-white/70">
            success {row.successCount}
          </span>
          <span className="px-2 py-1 rounded-lg border border-white/10 bg-white/[0.04] text-white/70">
            failure {row.failureCount}
          </span>
          <span className={`px-2 py-1 rounded-lg border ${metricTone(row.demotionRisk)}`}>
            demotion risk {row.demotionRisk}
          </span>
          {row.contradictionCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300">
              <ShieldAlert className="w-3 h-3" />
              contradictions {row.contradictionCount}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {row.state !== "promoted" && (
            <button
              onClick={() => void updateState(row, "promoted")}
              disabled={Boolean(actionBusy)}
              className="text-xs px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {actionBusy === `${row.id}:promoted` ? "Promoting..." : "Promote"}
            </button>
          )}
          {row.state !== "incubating" && row.state !== "deprecated" && (
            <button
              onClick={() => void updateState(row, "incubating")}
              disabled={Boolean(actionBusy)}
              className="text-xs px-2.5 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {actionBusy === `${row.id}:incubating` ? "Updating..." : "Move To Incubating"}
            </button>
          )}
          {row.state !== "deprecated" && (
            <button
              onClick={() => void updateState(row, "deprecated")}
              disabled={Boolean(actionBusy)}
              className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            >
              {actionBusy === `${row.id}:deprecated` ? "Deprecating..." : "Deprecate"}
            </button>
          )}
          <button
            onClick={() => void deleteSkill(row)}
            disabled={Boolean(actionBusy)}
            className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 bg-red-950/30 text-red-200 hover:bg-red-500/20 disabled:opacity-50"
          >
            {actionBusy === `${row.id}:delete` ? "Deleting..." : "Delete"}
          </button>
        </div>

        {expanded && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 text-sm">
            <div className="space-y-3">
              <div>
                <div className="text-white/45 text-[11px] uppercase tracking-[0.16em] mb-1">
                  Preconditions
                </div>
                <div className="text-white/75">
                  {row.preconditions.length > 0 ? row.preconditions.join(" • ") : "—"}
                </div>
              </div>
              <div>
                <div className="text-white/45 text-[11px] uppercase tracking-[0.16em] mb-1">
                  Procedure
                </div>
                {row.executionSteps.length > 0 ? (
                  <ol className="space-y-1 text-white/80 list-decimal list-inside">
                    {row.executionSteps.map((step, index) => (
                      <li key={`${row.id}-step-${index}`}>{step}</li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-white/45">—</div>
                )}
              </div>
              <div>
                <div className="text-white/45 text-[11px] uppercase tracking-[0.16em] mb-1">
                  Expected Outcomes
                </div>
                <div className="text-white/75">
                  {row.expectedOutcomes.length > 0 ? row.expectedOutcomes.join(" • ") : "—"}
                </div>
              </div>
              <div>
                <div className="text-white/45 text-[11px] uppercase tracking-[0.16em] mb-1">
                  Operator Review Notes
                </div>
                <textarea
                  value={noteDrafts[row.id] ?? ""}
                  onChange={(event) =>
                    setNoteDrafts((prev) => ({
                      ...prev,
                      [row.id]: event.target.value,
                    }))
                  }
                  className="w-full min-h-[110px] rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white/80 text-sm outline-none focus:border-cyan-400/40"
                  placeholder="Add operator review notes, warnings, or context for this skill..."
                />
                <div className="flex justify-end mt-2">
                  <button
                    onClick={() => void saveNotes(row)}
                    disabled={Boolean(actionBusy)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
                  >
                    {actionBusy === `${row.id}:notes` ? "Saving..." : "Save Notes"}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-white/45 text-[11px] uppercase tracking-[0.16em] mb-1">
                  Lineage
                </div>
                <div className="text-white/75 flex flex-wrap gap-2">
                  {row.supersedesEntries && row.supersedesEntries.length > 0 ? (
                    row.supersedesEntries.map((item) => (
                      <span
                        key={`${row.id}-supersedes-${item.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-cyan-200"
                      >
                        <GitBranch className="w-3 h-3" />
                        supersedes {item.title}
                      </span>
                    ))
                  ) : row.supersededByEntry ? (
                    <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1">
                      superseded by {row.supersededByEntry.title}
                    </span>
                  ) : (
                    "—"
                  )}
                </div>
              </div>

              <div>
                <div className="text-white/45 text-[11px] uppercase tracking-[0.16em] mb-1">
                  Conflicts
                </div>
                <div className="text-white/75 space-y-2">
                  {row.conflictEntries && row.conflictEntries.length > 0
                    ? row.conflictEntries.map((conflict) => (
                        <div
                          key={`${row.id}-conflict-${conflict.id}`}
                          className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-red-200">{conflict.title}</div>
                              <div className="text-red-100/45 text-[11px] uppercase tracking-[0.16em] mt-1">
                                {conflict.state ?? "unknown"}
                              </div>
                            </div>
                            <button
                              onClick={() => void resolveConflict(row.id, conflict.id)}
                              disabled={Boolean(actionBusy)}
                              className="text-[11px] px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                            >
                              {actionBusy === `${row.id}:resolve:${conflict.id}`
                                ? "Resolving..."
                                : "Prefer This"}
                            </button>
                          </div>
                        </div>
                      ))
                    : "—"}
                </div>
              </div>

              <div>
                <div className="text-white/45 text-[11px] uppercase tracking-[0.16em] mb-1">
                  Related Tools
                </div>
                <div className="text-white/75">
                  {row.relatedTools.length > 0 ? row.relatedTools.join(" • ") : "—"}
                </div>
              </div>

              <div>
                <div className="text-white/45 text-[11px] uppercase tracking-[0.16em] mb-1">
                  Review History
                </div>
                {row.reviewHistory && row.reviewHistory.length > 0 ? (
                  <div className="space-y-2">
                    {row.reviewHistory.map((entry) => (
                      <div
                        key={`${row.id}-review-${entry.id}`}
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <div className="text-white/75">
                            {entry.action.replaceAll("_", " ")} · {entry.actorType}
                          </div>
                          <div className="text-white/35">{formatTimestamp(entry.createdAt)}</div>
                        </div>
                        {entry.reason && (
                          <div className="text-white/60 text-xs mt-1">{entry.reason}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-white/45">—</div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-white/35">updated</div>
                  <div className="text-white/75 mt-1">{formatTimestamp(row.updatedAt)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-white/35">created</div>
                  <div className="text-white/75 mt-1">{formatTimestamp(row.createdAt)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-white/35">last used</div>
                  <div className="text-white/75 mt-1">{formatTimestamp(row.lastUsedAt)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-white/35">last reinforced</div>
                  <div className="text-white/75 mt-1">{formatTimestamp(row.lastReinforcedAt)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-white/35">last contradicted</div>
                  <div className="text-white/75 mt-1">
                    {formatTimestamp(row.lastContradictedAt)}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-white/35">last reviewed</div>
                  <div className="text-white/75 mt-1">{formatTimestamp(row.lastReviewedAt)}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-white font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            Personal Skills Review
          </div>
          <div className="text-white/55 text-sm mt-1">
            Inspect promoted procedures, conflicts, lineage, demotion pressure, and execution
            readiness.
          </div>
          {data?.generatedAt && (
            <div className="text-white/35 text-xs mt-2">
              Refreshed {formatTimestamp(data.generatedAt)}
            </div>
          )}
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white/80 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      {!error && data && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            ["Promoted", grouped.promoted.length, "text-emerald-300"],
            ["Incubating", grouped.incubating.length, "text-amber-300"],
            ["Candidate", grouped.candidate.length, "text-cyan-300"],
            ["Deprecated", grouped.deprecated.length, "text-red-300"],
          ].map(([label, count, tone]) => (
            <div
              key={String(label)}
              className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
            >
              <div className="text-white/45 text-xs uppercase tracking-[0.18em]">{label}</div>
              <div className={`text-2xl font-semibold mt-2 ${tone}`}>{count}</div>
            </div>
          ))}
        </div>
      )}

      {data && data.rows.length > 0 ? (
        <div className="space-y-3">{data.rows.map(renderRow)}</div>
      ) : !loading && !error ? (
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-6 text-center text-white/45 text-sm">
          No Personal Skills found yet.
        </div>
      ) : null}

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-amber-100/80 text-xs leading-relaxed">
        <div className="font-medium mb-1 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          Review guidance
        </div>
        Treat high contradiction count, low strength, and rising failure count as real review
        pressure. Do not promote or keep executing a Personal Skill just because it exists; use the
        lineage and conflict signals here to decide whether it still deserves authority.
      </div>
    </div>
  );
}
