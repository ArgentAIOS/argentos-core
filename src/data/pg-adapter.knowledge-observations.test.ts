import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PostgresConfig } from "./storage-config.js";
import { PgAdapter } from "./pg-adapter.js";

function resolvePgTestConfig(): PostgresConfig | null {
  const envUrl = process.env.ARGENT_TEST_PG_URL?.trim();
  if (envUrl) {
    return { connectionString: envUrl };
  }
  try {
    const path = `${os.homedir()}/.argentos/argent.json`;
    const raw = JSON.parse(fs.readFileSync(path, "utf8")) as {
      storage?: { postgres?: PostgresConfig | null };
    };
    return raw.storage?.postgres ?? null;
  } catch {
    return null;
  }
}

const pgConfig = resolvePgTestConfig();

describe.skipIf(!pgConfig)("pg knowledge observation uniqueness", () => {
  let adminSql: ReturnType<typeof postgres>;
  let adapter: PgAdapter;
  let sql: ReturnType<typeof postgres>;
  let dbName = "";
  const agentIds = new Set<string>();

  async function cleanupAgent(agentId: string) {
    await sql`DELETE FROM knowledge_observation_evidence WHERE observation_id IN (
      SELECT id FROM knowledge_observations WHERE agent_id = ${agentId}
    )`;
    await sql`DELETE FROM knowledge_observations WHERE agent_id = ${agentId}`;
    await sql`DELETE FROM agents WHERE id = ${agentId}`;
  }

  function nextAgentId(label: string): string {
    const id = `test-knowledge-observation-${label}-${crypto.randomUUID()}`;
    agentIds.add(id);
    return id;
  }

  async function countStatuses(agentId: string, canonicalKey: string): Promise<string[]> {
    const rows = await sql<{ status: string }[]>`
      SELECT status
      FROM knowledge_observations
      WHERE agent_id = ${agentId} AND canonical_key = ${canonicalKey}
      ORDER BY created_at ASC
    `;
    return rows.map((row) => row.status);
  }

  beforeAll(async () => {
    const baseUrl = new URL(pgConfig!.connectionString);
    dbName = `argentos_obs_test_${crypto.randomUUID().replace(/-/g, "")}`;

    const adminUrl = new URL(baseUrl.toString());
    adminUrl.pathname = "/postgres";
    adminSql = postgres(adminUrl.toString(), { max: 1, idle_timeout: 5, onnotice: () => {} });
    await adminSql.unsafe(`CREATE DATABASE "${dbName}"`);

    const testUrl = new URL(baseUrl.toString());
    testUrl.pathname = `/${dbName}`;
    sql = postgres(testUrl.toString(), { max: 1, idle_timeout: 5, onnotice: () => {} });

    await sql.unsafe(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        config JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await sql.unsafe(`
      CREATE TABLE knowledge_observations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        kind TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT,
        canonical_key TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT,
        confidence REAL NOT NULL DEFAULT 0.5,
        confidence_components JSONB NOT NULL DEFAULT '{}'::jsonb,
        freshness REAL NOT NULL DEFAULT 1.0,
        revalidation_due_at TIMESTAMPTZ,
        support_count INTEGER NOT NULL DEFAULT 0,
        source_diversity INTEGER NOT NULL DEFAULT 0,
        contradiction_weight REAL NOT NULL DEFAULT 0,
        operator_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'active',
        first_supported_at TIMESTAMPTZ,
        last_supported_at TIMESTAMPTZ,
        last_contradicted_at TIMESTAMPTZ,
        supersedes_observation_id TEXT REFERENCES knowledge_observations(id) ON DELETE SET NULL,
        embedding TEXT,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await sql.unsafe(`
      CREATE TABLE knowledge_observation_evidence (
        id TEXT PRIMARY KEY,
        observation_id TEXT NOT NULL REFERENCES knowledge_observations(id) ON DELETE CASCADE,
        stance TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        excerpt TEXT,
        item_id TEXT,
        lesson_id TEXT,
        reflection_id TEXT,
        entity_id TEXT,
        source_created_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await sql.unsafe(`
      CREATE UNIQUE INDEX idx_knowledge_obs_active_canonical_unique
      ON knowledge_observations (agent_id, canonical_key)
      WHERE status = 'active';
    `);

    adapter = new PgAdapter(
      {
        connectionString: testUrl.toString(),
      },
      "test-knowledge-observation-root",
    );
  });

  afterEach(async () => {
    for (const agentId of agentIds) {
      await cleanupAgent(agentId);
    }
    agentIds.clear();
  });

  afterAll(async () => {
    for (const agentId of agentIds) {
      await cleanupAgent(agentId);
    }
    await adapter.close();
    await sql.end();
    await adminSql.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await adminSql.end();
  });

  it("allows stale backfill rows while creating a new active row for the same canonical key", async () => {
    const agentId = nextAgentId("stale-backfill");
    const canonicalKey = "project:argent-launch:project_state:status";
    await sql`
      INSERT INTO agents (id, name, status, created_at, updated_at)
      VALUES (${agentId}, ${agentId}, 'active', NOW(), NOW())
    `;
    await sql`
      INSERT INTO knowledge_observations (
        id, agent_id, kind, subject_type, subject_id, canonical_key, summary, status, created_at, updated_at
      )
      VALUES (
        ${crypto.randomUUID()},
        ${agentId},
        'project_state',
        'project',
        'argent-launch',
        ${canonicalKey},
        'Old stale launch summary',
        'stale',
        NOW(),
        NOW()
      )
    `;

    const memory = adapter.memory.withAgentId
      ? adapter.memory.withAgentId(agentId)
      : adapter.memory;
    const observation = await memory.upsertKnowledgeObservation({
      kind: "project_state",
      subjectType: "project",
      subjectId: "argent-launch",
      canonicalKey,
      summary: "Argent Launch is on track for QA exit",
      supportCount: 1,
      sourceDiversity: 1,
      evidence: [],
    });

    expect(observation.status).toBe("active");
    expect(await countStatuses(agentId, canonicalKey)).toEqual(["stale", "active"]);
  });

  it("updates the existing active row instead of creating a second active row", async () => {
    const agentId = nextAgentId("active-upsert");
    const canonicalKey = "entity:entity-jason:relationship_fact:relationship";
    const memory = adapter.memory.withAgentId
      ? adapter.memory.withAgentId(agentId)
      : adapter.memory;

    const first = await memory.upsertKnowledgeObservation({
      kind: "relationship_fact",
      subjectType: "entity",
      subjectId: "entity-jason",
      canonicalKey,
      summary: "Jason Brashear is a business partner",
      supportCount: 1,
      sourceDiversity: 1,
      evidence: [],
    });
    const second = await memory.upsertKnowledgeObservation({
      kind: "relationship_fact",
      subjectType: "entity",
      subjectId: "entity-jason",
      canonicalKey,
      summary: "Jason Brashear is a trusted business partner",
      supportCount: 2,
      sourceDiversity: 1,
      evidence: [],
    });

    expect(second.id).toBe(first.id);
    expect(await countStatuses(agentId, canonicalKey)).toEqual(["active"]);
  });

  it("rejects a second active row for the same canonical key", async () => {
    const agentId = nextAgentId("unique-conflict");
    const canonicalKey = "project:argent-launch:project_state:status";
    await sql`
      INSERT INTO agents (id, name, status, created_at, updated_at)
      VALUES (${agentId}, ${agentId}, 'active', NOW(), NOW())
    `;
    await sql`
      INSERT INTO knowledge_observations (
        id, agent_id, kind, subject_type, subject_id, canonical_key, summary, status, created_at, updated_at
      )
      VALUES (
        ${crypto.randomUUID()},
        ${agentId},
        'project_state',
        'project',
        'argent-launch',
        ${canonicalKey},
        'Argent Launch is underway',
        'active',
        NOW(),
        NOW()
      )
    `;

    await expect(
      sql`
        INSERT INTO knowledge_observations (
          id, agent_id, kind, subject_type, subject_id, canonical_key, summary, status, created_at, updated_at
        )
        VALUES (
          ${crypto.randomUUID()},
          ${agentId},
          'project_state',
          'project',
          'argent-launch',
          ${canonicalKey},
          'Argent Launch is blocked',
          'active',
          NOW(),
          NOW()
        )
      `,
    ).rejects.toThrow(/idx_knowledge_obs_active_canonical_unique|duplicate key/i);
  });
});
