import postgres from "postgres";
import { resolvePostgresUrl, resolveRuntimeStorageConfig } from "../data/storage-resolver.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("infra/specforge-session-store");

export type SpecforgeProjectType = "unknown" | "greenfield" | "brownfield";
export type SpecforgeStage =
  | "project_type_gate"
  | "intake_interview"
  | "draft_review"
  | "awaiting_approval"
  | "approved_execution";

export type SpecforgeIntakeCoverage = {
  problem: boolean;
  users: boolean;
  success: boolean;
  constraints: boolean;
  scope: boolean;
  nonScope: boolean;
  technicalContext: boolean;
};

export type PersistedSpecforgeGuideSession = {
  startedAt: number;
  lastTriggeredAt: number;
  stage: SpecforgeStage;
  projectType: SpecforgeProjectType;
  intakeCoverage: SpecforgeIntakeCoverage;
  draftVersion: number;
};

let sqlClient: ReturnType<typeof postgres> | null = null;
let initPromise: Promise<ReturnType<typeof postgres> | null> | null = null;

function isTestEnv(): boolean {
  return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
}

function isPgBacked(): boolean {
  const cfg = resolveRuntimeStorageConfig(process.env);
  return cfg.backend === "postgres" || cfg.backend === "dual";
}

async function getSql(): Promise<ReturnType<typeof postgres> | null> {
  if (isTestEnv() || !isPgBacked()) return null;
  if (sqlClient) return sqlClient;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const sql = postgres(resolvePostgresUrl(), {
      max: 2,
      idle_timeout: 10,
      connect_timeout: 5,
      prepare: false,
    });
    try {
      await sql`SELECT 1`;
      await sql`
        CREATE TABLE IF NOT EXISTS specforge_guide_sessions (
          session_key TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          stage TEXT NOT NULL,
          project_type TEXT NOT NULL,
          intake_coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
          draft_version INT NOT NULL DEFAULT 0,
          started_at TIMESTAMPTZ NOT NULL,
          last_triggered_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      sqlClient = sql;
      return sql;
    } catch (err) {
      log.warn(`specforge-session-store init failed: ${String(err)}`);
      try {
        await sql.end({ timeout: 1 });
      } catch {}
      return null;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

function normalizeCoverage(value: unknown): SpecforgeIntakeCoverage {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    problem: input.problem === true,
    users: input.users === true,
    success: input.success === true,
    constraints: input.constraints === true,
    scope: input.scope === true,
    nonScope: input.nonScope === true,
    technicalContext: input.technicalContext === true,
  };
}

export async function loadSpecforgeGuideSession(
  sessionKey: string,
): Promise<PersistedSpecforgeGuideSession | null> {
  const sql = await getSql();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT stage, project_type, intake_coverage, draft_version, started_at, last_triggered_at
      FROM specforge_guide_sessions
      WHERE session_key = ${sessionKey}
      LIMIT 1
    `;
    const row = rows[0] as
      | {
          stage: SpecforgeStage;
          project_type: SpecforgeProjectType;
          intake_coverage: unknown;
          draft_version: number;
          started_at: Date | string;
          last_triggered_at: Date | string;
        }
      | undefined;
    if (!row) return null;
    const startedAt = new Date(row.started_at).getTime();
    const lastTriggeredAt = new Date(row.last_triggered_at).getTime();
    if (!Number.isFinite(startedAt) || !Number.isFinite(lastTriggeredAt)) return null;
    return {
      startedAt,
      lastTriggeredAt,
      stage: row.stage,
      projectType: row.project_type,
      intakeCoverage: normalizeCoverage(row.intake_coverage),
      draftVersion: Number(row.draft_version || 0),
    };
  } catch (err) {
    log.warn(`specforge-session-store load failed: ${String(err)}`);
    return null;
  }
}

export async function saveSpecforgeGuideSession(params: {
  sessionKey: string;
  agentId: string;
  state: PersistedSpecforgeGuideSession;
}): Promise<void> {
  const sql = await getSql();
  if (!sql) return;
  try {
    await sql`
      INSERT INTO specforge_guide_sessions (
        session_key,
        agent_id,
        stage,
        project_type,
        intake_coverage,
        draft_version,
        started_at,
        last_triggered_at,
        updated_at
      )
      VALUES (
        ${params.sessionKey},
        ${params.agentId},
        ${params.state.stage},
        ${params.state.projectType},
        ${JSON.stringify(params.state.intakeCoverage)}::jsonb,
        ${params.state.draftVersion},
        ${new Date(params.state.startedAt)},
        ${new Date(params.state.lastTriggeredAt)},
        NOW()
      )
      ON CONFLICT (session_key)
      DO UPDATE SET
        agent_id = EXCLUDED.agent_id,
        stage = EXCLUDED.stage,
        project_type = EXCLUDED.project_type,
        intake_coverage = EXCLUDED.intake_coverage,
        draft_version = EXCLUDED.draft_version,
        started_at = EXCLUDED.started_at,
        last_triggered_at = EXCLUDED.last_triggered_at,
        updated_at = NOW()
    `;
  } catch (err) {
    log.warn(`specforge-session-store save failed: ${String(err)}`);
  }
}

export async function deleteSpecforgeGuideSession(sessionKey: string): Promise<void> {
  const sql = await getSql();
  if (!sql) return;
  try {
    await sql`DELETE FROM specforge_guide_sessions WHERE session_key = ${sessionKey}`;
  } catch (err) {
    log.warn(`specforge-session-store delete failed: ${String(err)}`);
  }
}
