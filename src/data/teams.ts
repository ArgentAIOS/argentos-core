/**
 * Teams Data Module
 *
 * CRUD operations for teams stored in the dashboard database.
 * Used to coordinate multiple agent sessions working together.
 */

import { randomUUID } from "node:crypto";
import type { ConnectionManager } from "./connection.js";
import type {
  Team,
  TeamCreateInput,
  TeamMember,
  TeamMemberRole,
  TeamMemberStatus,
  TeamStatus,
  TeamWithMembers,
} from "./types.js";

const TEAMS_SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lead_session_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  config TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'worker',
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  joined_at INTEGER NOT NULL,
  last_active_at INTEGER,
  PRIMARY KEY (team_id, session_key),
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_session ON team_members(session_key);
`;

interface TeamRow {
  id: string;
  name: string;
  lead_session_key: string;
  status: string;
  created_at: number;
  updated_at: number;
  config: string | null;
}

interface TeamMemberRow {
  team_id: string;
  session_key: string;
  role: string;
  label: string | null;
  status: string;
  joined_at: number;
  last_active_at: number | null;
}

export class TeamsModule {
  private conn: ConnectionManager;
  private initialized = false;

  constructor(conn: ConnectionManager) {
    this.conn = conn;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const db = this.conn.getDatabase("dashboard");
    db.exec(TEAMS_SCHEMA);
    this.initialized = true;
  }

  /**
   * Create a new team
   */
  createTeam(input: TeamCreateInput): Team {
    const now = Date.now();
    const id = randomUUID();

    const team: Team = {
      id,
      name: input.name,
      leadSessionKey: input.leadSessionKey,
      status: "active",
      createdAt: now,
      updatedAt: now,
      config: input.config,
    };

    this.conn.execute(
      "dashboard",
      `INSERT INTO teams (id, name, lead_session_key, status, created_at, updated_at, config)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        team.id,
        team.name,
        team.leadSessionKey,
        team.status,
        team.createdAt,
        team.updatedAt,
        team.config ? JSON.stringify(team.config) : "{}",
      ],
    );

    return team;
  }

  /**
   * Get a team by ID
   */
  getTeam(id: string): Team | null {
    const db = this.conn.getDatabase("dashboard");
    const row = db.prepare("SELECT * FROM teams WHERE id = ?").get(id) as TeamRow | undefined;
    return row ? this.rowToTeam(row) : null;
  }

  /**
   * Add a member to a team
   */
  addMember(params: {
    teamId: string;
    sessionKey: string;
    role: TeamMemberRole;
    label?: string;
  }): TeamMember {
    const now = Date.now();

    const member: TeamMember = {
      teamId: params.teamId,
      sessionKey: params.sessionKey,
      role: params.role,
      label: params.label,
      status: "active",
      joinedAt: now,
      lastActiveAt: now,
    };

    this.conn.execute(
      "dashboard",
      `INSERT OR REPLACE INTO team_members (team_id, session_key, role, label, status, joined_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        member.teamId,
        member.sessionKey,
        member.role,
        member.label || null,
        member.status,
        member.joinedAt,
        member.lastActiveAt || null,
      ],
    );

    return member;
  }

  /**
   * Remove a member from a team
   */
  removeMember(teamId: string, sessionKey: string): boolean {
    const result = this.conn.execute(
      "dashboard",
      "DELETE FROM team_members WHERE team_id = ? AND session_key = ?",
      [teamId, sessionKey],
    );
    return result.changes > 0;
  }

  /**
   * Update a member's status
   */
  updateMemberStatus(teamId: string, sessionKey: string, status: TeamMemberStatus): boolean {
    const now = Date.now();
    const result = this.conn.execute(
      "dashboard",
      "UPDATE team_members SET status = ?, last_active_at = ? WHERE team_id = ? AND session_key = ?",
      [status, now, teamId, sessionKey],
    );
    return result.changes > 0;
  }

  /**
   * Get a team with all its members
   */
  getTeamWithMembers(teamId: string): TeamWithMembers | null {
    const team = this.getTeam(teamId);
    if (!team) return null;

    const db = this.conn.getDatabase("dashboard");
    const memberRows = db
      .prepare("SELECT * FROM team_members WHERE team_id = ? ORDER BY joined_at ASC")
      .all(teamId) as TeamMemberRow[];

    return {
      team,
      members: memberRows.map((row) => this.rowToMember(row)),
    };
  }

  /**
   * Find the team a session belongs to (most recent active team)
   */
  getTeamForSession(sessionKey: string): TeamWithMembers | null {
    const db = this.conn.getDatabase("dashboard");
    const row = db
      .prepare(
        `SELECT t.* FROM teams t
         JOIN team_members tm ON t.id = tm.team_id
         WHERE tm.session_key = ? AND t.status = 'active'
         ORDER BY t.created_at DESC
         LIMIT 1`,
      )
      .get(sessionKey) as TeamRow | undefined;

    if (!row) return null;
    return this.getTeamWithMembers(row.id);
  }

  /**
   * List all active teams
   */
  listActiveTeams(): Team[] {
    const db = this.conn.getDatabase("dashboard");
    const rows = db
      .prepare("SELECT * FROM teams WHERE status = 'active' ORDER BY created_at DESC")
      .all() as TeamRow[];
    return rows.map((row) => this.rowToTeam(row));
  }

  /**
   * Disband a team (set status to disbanded)
   */
  disbandTeam(teamId: string): Team | null {
    const team = this.getTeam(teamId);
    if (!team) return null;

    const now = Date.now();
    this.conn.execute(
      "dashboard",
      "UPDATE teams SET status = 'disbanded', updated_at = ? WHERE id = ?",
      [now, teamId],
    );

    // Mark all members as completed
    this.conn.execute(
      "dashboard",
      "UPDATE team_members SET status = 'completed', last_active_at = ? WHERE team_id = ?",
      [now, teamId],
    );

    return this.getTeam(teamId);
  }

  /**
   * Get members of a team
   */
  getMembers(teamId: string): TeamMember[] {
    const db = this.conn.getDatabase("dashboard");
    const rows = db
      .prepare("SELECT * FROM team_members WHERE team_id = ? ORDER BY joined_at ASC")
      .all(teamId) as TeamMemberRow[];
    return rows.map((row) => this.rowToMember(row));
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private rowToTeam(row: TeamRow): Team {
    return {
      id: row.id,
      name: row.name,
      leadSessionKey: row.lead_session_key,
      status: row.status as TeamStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      config: row.config ? JSON.parse(row.config) : undefined,
    };
  }

  private rowToMember(row: TeamMemberRow): TeamMember {
    return {
      teamId: row.team_id,
      sessionKey: row.session_key,
      role: row.role as TeamMemberRole,
      label: row.label || undefined,
      status: row.status as TeamMemberStatus,
      joinedAt: row.joined_at,
      lastActiveAt: row.last_active_at || undefined,
    };
  }
}
