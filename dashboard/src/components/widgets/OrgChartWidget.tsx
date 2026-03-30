/**
 * OrgChartWidget — Family agent hierarchy grouped by department/team.
 *
 * Shows live status (alive/idle), role, and team for each operational agent.
 * Data from gateway WebSocket RPC: family.members (polled every 30s).
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

interface TeamGroup {
  key: string;
  displayName: string;
  color: string;
  members: FamilyMember[];
  aliveCount: number;
}

interface OrgChartWidgetProps {
  operatorName?: string;
}

// ── Agent Filtering ────────────────────────────────────────────────

const EXCLUDED_IDS = new Set(["dumbo", "argent"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

function isOperational(a: { id: string; role?: string }): boolean {
  if (EXCLUDED_IDS.has(a.id.toLowerCase())) return false;
  if (a.id.startsWith("test-") || a.id.startsWith("test_")) return false;
  if (UUID_RE.test(a.id)) return false;
  if (a.role === "think_tank_panelist") return false;
  if (!a.role) return false;
  return true;
}

// ── Team Normalization ─────────────────────────────────────────────

function normalizeTeam(team: string): string {
  const t = team.toLowerCase().trim();
  if (t === "think-tank") return "__skip__";
  if (t === "unassigned" || t === "") return "core";
  if (t.includes("support") || t === "msp team" || t === "msp-team") return "support";
  if (t.includes("office")) return "office";
  if (t === "dev-team" || t === "development") return "development";
  if (t === "marketing-team" || t === "marketing") return "marketing";
  return team;
}

const TEAM_DISPLAY: Record<string, { name: string; color: string }> = {
  core: { name: "Core", color: "#60a5fa" },
  development: { name: "Development", color: "#00FFD1" },
  marketing: { name: "Marketing", color: "#84cc16" },
  support: { name: "Support", color: "#f97316" },
  office: { name: "Office", color: "#ec4899" },
};

// ── Helpers ────────────────────────────────────────────────────────

/** "qa_engineer" → "QA Engineer" */
function formatRole(role: string): string {
  return role
    .split(/[_-]+/)
    .map((w) => {
      const upper = w.toUpperCase();
      // Keep common abbreviations uppercase
      if (
        ["qa", "seo", "sem", "it", "ai", "ml", "hr", "pr", "ui", "ux"].includes(w.toLowerCase())
      ) {
        return upper;
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function buildTeamGroups(members: FamilyMember[]): TeamGroup[] {
  const grouped: Record<string, FamilyMember[]> = {};

  for (const m of members) {
    if (!isOperational(m)) continue;
    const team = normalizeTeam(m.team || "");
    if (team === "__skip__") continue;
    if (!grouped[team]) grouped[team] = [];
    grouped[team].push(m);
  }

  // Sort teams by display order, then alphabetically
  const order = ["core", "development", "marketing", "support", "office"];

  return Object.entries(grouped)
    .sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    })
    .map(([key, mems]) => {
      // Sort members: alive first, then alphabetically
      const sorted = [...mems].sort((a, b) => {
        if (a.alive && !b.alive) return -1;
        if (!a.alive && b.alive) return 1;
        return (a.name || a.id).localeCompare(b.name || b.id);
      });
      const display = TEAM_DISPLAY[key];
      return {
        key,
        displayName: display?.name || key.charAt(0).toUpperCase() + key.slice(1),
        color: display?.color || "#64748b",
        members: sorted,
        aliveCount: sorted.filter((m) => m.alive).length,
      };
    });
}

// ── Styles ─────────────────────────────────────────────────────────

const styles = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    borderRadius: "16px",
    border: "1px solid var(--border-color, rgba(255,255,255,0.1))",
    background: "var(--panel-bg, rgba(255,255,255,0.03))",
    padding: "24px",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "16px",
    flexShrink: 0,
  },
  title: {
    fontSize: "11px",
    fontWeight: 500,
    textTransform: "uppercase" as const,
    letterSpacing: "0.18em",
    color: "var(--text-muted, rgba(255,255,255,0.45))",
  },
  summary: {
    fontSize: "11px",
    color: "var(--text-muted, rgba(255,255,255,0.4))",
    letterSpacing: "0.04em",
  },
  scrollArea: {
    flex: 1,
    overflowY: "auto" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
    paddingRight: "4px",
  },
  teamCard: (color: string) => ({
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)",
    backdropFilter: "blur(12px)",
    borderLeft: `3px solid ${color}`,
    overflow: "hidden",
  }),
  teamHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    cursor: "pointer",
    userSelect: "none" as const,
    transition: "background 0.15s ease",
  },
  teamName: (color: string) => ({
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.12em",
    color,
  }),
  teamCount: {
    fontSize: "11px",
    color: "rgba(255,255,255,0.35)",
    fontWeight: 400,
    marginLeft: "8px",
    letterSpacing: "0.02em",
  },
  chevron: (expanded: boolean) => ({
    fontSize: "10px",
    color: "rgba(255,255,255,0.3)",
    transition: "transform 0.2s ease",
    transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
  }),
  agentList: (expanded: boolean) => ({
    maxHeight: expanded ? "600px" : "0px",
    overflow: "hidden",
    transition: "max-height 0.25s ease",
    padding: expanded ? "0 16px 12px" : "0 16px",
  }),
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "6px 0",
    borderBottom: "1px solid rgba(255,255,255,0.03)",
  },
  statusDot: (alive: boolean, color: string) => ({
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    flexShrink: 0,
    background: alive ? color : "rgba(255,255,255,0.15)",
    boxShadow: alive ? `0 0 6px ${color}80` : "none",
    transition: "all 0.3s ease",
  }),
  agentName: (alive: boolean) => ({
    fontSize: "13px",
    fontWeight: alive ? 600 : 400,
    color: alive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)",
    whiteSpace: "nowrap" as const,
  }),
  agentRole: {
    fontSize: "12px",
    color: "rgba(255,255,255,0.3)",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  separator: {
    fontSize: "12px",
    color: "rgba(255,255,255,0.15)",
  },
  emptyState: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    color: "rgba(255,255,255,0.3)",
    fontSize: "13px",
  },
  loadingDot: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: "rgba(255,255,255,0.3)",
    animation: "orgPulse 1.2s ease-in-out infinite",
    marginRight: "4px",
  },
  // ── View Toggle ──
  viewToggle: {
    display: "flex",
    gap: "2px",
    background: "rgba(255,255,255,0.05)",
    borderRadius: "6px",
    padding: "2px",
  },
  viewBtn: (active: boolean) => ({
    padding: "4px 10px",
    fontSize: "11px",
    fontWeight: active ? 600 : 400,
    color: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
    background: active ? "rgba(255,255,255,0.1)" : "transparent",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    transition: "all 0.15s ease",
    letterSpacing: "0.02em",
  }),
  // ── Tree View ──
  treeScroll: {
    flex: 1,
    overflowX: "auto" as const,
    overflowY: "auto" as const,
    paddingBottom: "16px",
  },
  treeRoot: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    minWidth: "max-content",
    padding: "0 24px",
  },
  treePill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "8px 18px",
    borderRadius: "20px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(12px)",
    fontSize: "13px",
    fontWeight: 600,
    color: "rgba(255,255,255,0.85)",
    letterSpacing: "0.02em",
  },
  treeConnectorV: {
    width: "1px",
    height: "20px",
    background: "rgba(255,255,255,0.12)",
    margin: "0 auto",
  },
  treeOwnerCard: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: "2px",
    padding: "12px 24px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(12px)",
    minWidth: "180px",
  },
  treeArgentCard: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: "2px",
    padding: "12px 24px",
    borderRadius: "12px",
    border: "1px solid rgba(0,255,209,0.2)",
    background: "rgba(0,255,209,0.04)",
    backdropFilter: "blur(12px)",
    minWidth: "180px",
  },
  treeNodeName: {
    fontSize: "14px",
    fontWeight: 700,
    color: "rgba(255,255,255,0.9)",
  },
  treeNodeSub: {
    fontSize: "11px",
    color: "rgba(255,255,255,0.4)",
  },
  treeBadge: (active: boolean) => ({
    display: "inline-block",
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    padding: "2px 6px",
    borderRadius: "4px",
    marginLeft: "6px",
    background: active ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.08)",
    color: active ? "#34d399" : "rgba(255,255,255,0.4)",
  }),
  treeConnectorH: {
    height: "1px",
    background: "rgba(255,255,255,0.12)",
    alignSelf: "stretch" as const,
    margin: "0 32px",
  },
  treeDeptColumns: {
    display: "flex",
    justifyContent: "center",
    gap: "16px",
    width: "100%",
  },
  treeDeptCol: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: "6px",
    minWidth: "160px",
  },
  treeDeptStem: {
    width: "1px",
    height: "16px",
    background: "rgba(255,255,255,0.12)",
  },
  treeDeptLabel: (color: string) => ({
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
    color,
    padding: "4px 12px",
    borderRadius: "6px",
    border: `1px solid ${color}33`,
    background: `${color}0D`,
  }),
  treeAgentCard: {
    width: "160px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)",
    backdropFilter: "blur(8px)",
  },
  treeAgentName: (alive: boolean) => ({
    fontSize: "13px",
    fontWeight: alive ? 600 : 400,
    color: alive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)",
  }),
  treeAgentRole: {
    fontSize: "11px",
    color: "rgba(255,255,255,0.3)",
    marginTop: "2px",
  },
};

// ── Component ──────────────────────────────────────────────────────

type ViewMode = "list" | "tree";

export function OrgChartWidget({ operatorName }: OrgChartWidgetProps) {
  const { request, connected } = useGateway();
  const [teams, setTeams] = useState<TeamGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<ViewMode>("list");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const operatorLabel = operatorName?.trim() || "Operator";

  const fetchMembers = useCallback(async () => {
    if (!connected) return;
    try {
      const res = await request<{ members: FamilyMember[] }>("family.members");
      const members = res?.members ?? [];
      setTeams(buildTeamGroups(members));
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, [request, connected]);

  // Initial load + 30s polling
  useEffect(() => {
    fetchMembers();
    intervalRef.current = setInterval(fetchMembers, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchMembers]);

  const toggleTeam = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Totals
  const totalAgents = teams.reduce((sum, t) => sum + t.members.length, 0);
  const totalAlive = teams.reduce((sum, t) => sum + t.aliveCount, 0);
  const totalTeams = teams.length;

  return (
    <div style={styles.container}>
      {/* Keyframes for pulse animation */}
      <style>{`
        @keyframes orgPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        .org-team-header:hover {
          background: rgba(255,255,255,0.03) !important;
        }
        .org-scroll::-webkit-scrollbar {
          width: 4px;
        }
        .org-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .org-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 2px;
        }
      `}</style>

      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={styles.title}>Organization</div>
          {!loading && totalAgents > 0 && (
            <div style={styles.viewToggle}>
              <button
                style={styles.viewBtn(view === "list")}
                onClick={() => setView("list")}
                title="List view"
              >
                &#x1F4CB; List
              </button>
              <button
                style={styles.viewBtn(view === "tree")}
                onClick={() => setView("tree")}
                title="Tree view"
              >
                &#x1F333; Tree
              </button>
            </div>
          )}
        </div>
        {!loading && totalAgents > 0 && (
          <div style={styles.summary}>
            {totalAgents} agent{totalAgents !== 1 ? "s" : ""}
            {" \u00B7 "}
            {totalTeams} team{totalTeams !== 1 ? "s" : ""}
            {" \u00B7 "}
            {totalAlive} active
          </div>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div style={styles.emptyState}>
          <span style={{ ...styles.loadingDot, animationDelay: "0s" }} />
          <span style={{ ...styles.loadingDot, animationDelay: "0.2s" }} />
          <span style={{ ...styles.loadingDot, animationDelay: "0.4s" }} />
        </div>
      ) : totalAgents === 0 ? (
        <div style={styles.emptyState}>No family agents found</div>
      ) : view === "tree" ? (
        /* ── Tree View ──────────────────────────────────────────── */
        <div className="org-scroll" style={styles.treeScroll}>
          <div style={styles.treeRoot}>
            {/* Root pill */}
            <div style={styles.treePill}>Total Agents: {totalAgents}</div>

            {/* Connector */}
            <div style={styles.treeConnectorV} />

            {/* Owner node */}
            <div style={styles.treeOwnerCard}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ marginRight: "4px" }}>&#11088;</span>
                <span style={styles.treeNodeName}>{operatorLabel}</span>
                <span style={styles.treeBadge(true)}>OWNER</span>
              </div>
              <div style={styles.treeNodeSub}>Human Operator</div>
            </div>

            {/* Connector */}
            <div style={styles.treeConnectorV} />

            {/* Argent node */}
            <div style={styles.treeArgentCard}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={styles.treeNodeName}>Argent</span>
                <span style={styles.treeBadge(true)}>ACTIVE</span>
              </div>
              <div style={styles.treeNodeSub}>Role: Elder</div>
              <div style={styles.treeNodeSub}>Department: Core</div>
            </div>

            {/* Connector to departments */}
            <div style={styles.treeConnectorV} />

            {/* Horizontal line across departments */}
            <div style={styles.treeConnectorH} />

            {/* Department columns */}
            <div style={styles.treeDeptColumns}>
              {teams.map((team) => (
                <div key={team.key} style={styles.treeDeptCol}>
                  {/* Vertical stem */}
                  <div style={styles.treeDeptStem} />

                  {/* Department label */}
                  <div style={styles.treeDeptLabel(team.color)}>{team.displayName}</div>

                  {/* Agent cards */}
                  {team.members.map((agent) => (
                    <div key={agent.id} style={styles.treeAgentCard}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={styles.treeAgentName(!!agent.alive)}>
                          {agent.name || agent.id}
                        </span>
                        <span style={styles.treeBadge(!!agent.alive)}>
                          {agent.alive ? "ACTIVE" : "IDLE"}
                        </span>
                      </div>
                      {agent.role && (
                        <div style={styles.treeAgentRole}>{formatRole(agent.role)}</div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* ── List View (original) ───────────────────────────────── */
        <div className="org-scroll" style={styles.scrollArea}>
          {teams.map((team) => {
            const expanded = !collapsed[team.key];
            return (
              <div key={team.key} style={styles.teamCard(team.color)}>
                {/* Team Header */}
                <div
                  className="org-team-header"
                  style={styles.teamHeader}
                  onClick={() => toggleTeam(team.key)}
                >
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={styles.teamName(team.color)}>{team.displayName}</span>
                    <span style={styles.teamCount}>({team.members.length})</span>
                  </div>
                  <span style={styles.chevron(expanded)}>&#9660;</span>
                </div>

                {/* Agent List */}
                <div style={styles.agentList(expanded)}>
                  {team.members.map((agent) => (
                    <div key={agent.id} style={styles.agentRow}>
                      <span style={styles.statusDot(!!agent.alive, team.color)} />
                      <span style={styles.agentName(!!agent.alive)}>{agent.name || agent.id}</span>
                      {agent.role && (
                        <>
                          <span style={styles.separator}>&middot;</span>
                          <span style={styles.agentRole}>{formatRole(agent.role)}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
