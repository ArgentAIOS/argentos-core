/**
 * Agent Family — Multi-agent coordination layer.
 *
 * Provides:
 *   - Family member discovery (who's alive, what roles)
 *   - Shared knowledge publishing (high-confidence lessons → family library)
 *   - Cross-agent knowledge search (query the shared library)
 *   - Agent registration (add new family members)
 *
 * All operations use PostgreSQL (agents + shared_knowledge tables) and
 * Redis (presence, streams) when available.
 *
 * Usage:
 *   const family = await getAgentFamily();
 *   const agents = await family.listAlive();
 *   await family.publishKnowledge({ ... });
 *   const results = await family.searchKnowledge("error handling");
 */

import type Redis from "ioredis";
import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  isAgentAlive,
  sendFamilyMessage,
  publishDashboardEvent,
  getRedisClient,
} from "./redis-client.js";
import {
  readStorageConfigFromDisk,
  resolvePostgresUrl,
  resolveRedisConfig,
} from "./storage-resolver.js";

const log = createSubsystemLogger("data/agent-family");

// ── Types ───────────────────────────────────────────────────────────────

export interface FamilyAgent {
  id: string;
  name: string;
  role: string;
  team?: string;
  status: "active" | "inactive";
  alive: boolean; // Redis presence — true if heartbeat within 30s
}

export interface SharedKnowledgeEntry {
  id: string;
  sourceAgentId: string;
  sourceItemId?: string;
  category: "lesson" | "fact" | "tool_tip" | "pattern";
  title: string;
  content: string;
  confidence: number;
  endorsements: number;
  createdAt: string;
}

export interface PublishKnowledgeInput {
  sourceAgentId: string;
  sourceItemId?: string;
  category: SharedKnowledgeEntry["category"];
  title: string;
  content: string;
  embedding?: Float32Array;
  confidence?: number;
}

// ── Agent Family API ────────────────────────────────────────────────────

export class AgentFamily {
  private pgUrl: string;
  private redis: Redis | null;

  constructor(pgUrl: string, redis?: Redis | null) {
    this.pgUrl = pgUrl;
    this.redis = redis ?? null;
  }

  /** Expose Redis for tools that need presence/streams. */
  getRedis(): Redis | null {
    return this.redis;
  }

  /**
   * List all registered family members with alive status.
   */
  async listMembers(): Promise<FamilyAgent[]> {
    const pg = (await import("postgres")).default;
    const sql = pg(this.pgUrl);

    try {
      const rows = await sql`
        SELECT id, name, role, status, config->>'team' AS team FROM agents
        WHERE status = 'active'
        ORDER BY CASE WHEN id = 'argent' THEN 0 ELSE 1 END, name
      `;

      // Check Redis presence for each agent
      const agents: FamilyAgent[] = [];
      for (const row of rows) {
        let alive = false;
        if (this.redis) {
          try {
            alive = await isAgentAlive(this.redis, row.id);
          } catch {
            /* Redis unavailable */
          }
        }
        agents.push({
          id: row.id,
          name: row.name,
          role: row.role,
          team: typeof row.team === "string" && row.team.trim().length > 0 ? row.team : undefined,
          status: row.status as "active" | "inactive",
          alive,
        });
      }

      return agents;
    } finally {
      await sql.end();
    }
  }

  /**
   * Publish knowledge to the shared family library.
   * Called when an agent extracts a high-confidence lesson.
   */
  async publishKnowledge(input: PublishKnowledgeInput): Promise<SharedKnowledgeEntry> {
    const pg = (await import("postgres")).default;
    const sql = pg(this.pgUrl);
    const id = crypto.randomUUID();
    const now = new Date();

    try {
      const embeddingStr = input.embedding ? `[${Array.from(input.embedding).join(",")}]` : null;

      const [row] = await sql`
        INSERT INTO shared_knowledge (
          id, source_agent_id, source_item_id, category, title, content,
          embedding, confidence, endorsements, created_at, updated_at
        ) VALUES (
          ${id}, ${input.sourceAgentId}, ${input.sourceItemId ?? null},
          ${input.category}, ${input.title}, ${input.content},
          ${embeddingStr ? sql`${embeddingStr}::vector` : null},
          ${input.confidence ?? 0.5}, 0, ${now}, ${now}
        )
        RETURNING id, source_agent_id, source_item_id, category, title, content,
                  confidence, endorsements, created_at
      `;

      log.info("shared knowledge published", {
        id,
        category: input.category,
        sourceAgent: input.sourceAgentId,
      });

      // Notify family via Redis if available
      if (this.redis) {
        try {
          await sendFamilyMessage(this.redis, {
            sender: input.sourceAgentId,
            type: "lesson_shared",
            payload: JSON.stringify({
              knowledgeId: id,
              category: input.category,
              title: input.title,
            }),
          });
          await publishDashboardEvent(this.redis, {
            type: "memory_stored",
            agentId: input.sourceAgentId,
            data: {
              event: "shared_knowledge_published",
              knowledgeId: id,
              category: input.category,
              title: input.title,
            },
          });
        } catch {
          /* Redis is optional */
        }
      }

      return {
        id: row.id,
        sourceAgentId: row.source_agent_id,
        sourceItemId: row.source_item_id ?? undefined,
        category: row.category as SharedKnowledgeEntry["category"],
        title: row.title,
        content: row.content,
        confidence: row.confidence,
        endorsements: row.endorsements,
        createdAt: row.created_at?.toISOString?.() ?? now.toISOString(),
      };
    } finally {
      await sql.end();
    }
  }

  /**
   * Search the shared knowledge library by keyword (full-text search).
   */
  async searchKnowledge(query: string, limit = 10): Promise<SharedKnowledgeEntry[]> {
    const pg = (await import("postgres")).default;
    const sql = pg(this.pgUrl);

    try {
      const rows = await sql`
        SELECT id, source_agent_id, source_item_id, category, title, content,
               confidence, endorsements, created_at,
               ts_rank(
                 to_tsvector('english', title || ' ' || content),
                 plainto_tsquery('english', ${query})
               ) AS rank
        FROM shared_knowledge
        WHERE to_tsvector('english', title || ' ' || content)
              @@ plainto_tsquery('english', ${query})
        ORDER BY rank DESC
        LIMIT ${limit}
      `;

      return rows.map((r: any) => ({
        id: r.id,
        sourceAgentId: r.source_agent_id,
        sourceItemId: r.source_item_id ?? undefined,
        category: r.category,
        title: r.title,
        content: r.content,
        confidence: r.confidence,
        endorsements: r.endorsements,
        createdAt: r.created_at?.toISOString?.() ?? "",
      }));
    } finally {
      await sql.end();
    }
  }

  /**
   * Search shared knowledge by vector similarity.
   */
  async searchKnowledgeByVector(
    embedding: Float32Array,
    limit = 10,
  ): Promise<Array<SharedKnowledgeEntry & { score: number }>> {
    const pg = (await import("postgres")).default;
    const sql = pg(this.pgUrl);
    const vecStr = `[${Array.from(embedding).join(",")}]`;

    try {
      const rows = await sql`
        SELECT id, source_agent_id, source_item_id, category, title, content,
               confidence, endorsements, created_at,
               1 - (embedding <=> ${vecStr}::vector) AS score
        FROM shared_knowledge
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${vecStr}::vector
        LIMIT ${limit}
      `;

      return rows.map((r: any) => ({
        id: r.id,
        sourceAgentId: r.source_agent_id,
        sourceItemId: r.source_item_id ?? undefined,
        category: r.category,
        title: r.title,
        content: r.content,
        confidence: r.confidence,
        endorsements: r.endorsements,
        createdAt: r.created_at?.toISOString?.() ?? "",
        score: Number(r.score ?? 0),
      }));
    } finally {
      await sql.end();
    }
  }

  /**
   * Endorse a shared knowledge entry (another agent found it useful).
   */
  async endorseKnowledge(knowledgeId: string): Promise<void> {
    const pg = (await import("postgres")).default;
    const sql = pg(this.pgUrl);

    try {
      await sql`
        UPDATE shared_knowledge
        SET endorsements = endorsements + 1,
            confidence = LEAST(confidence + 0.02, 1.0),
            updated_at = NOW()
        WHERE id = ${knowledgeId}
      `;
    } finally {
      await sql.end();
    }
  }

  /**
   * List active team members for a given team name.
   */
  async listTeamMembers(
    team: string,
  ): Promise<Array<{ id: string; name: string; role: string; config: Record<string, unknown> }>> {
    const pg = (await import("postgres")).default;
    const sql = pg(this.pgUrl);

    try {
      const rows = await sql`
        SELECT id, name, role, config FROM agents
        WHERE status = 'active' AND config->>'team' = ${team}
        ORDER BY name
      `;
      return rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        config: typeof r.config === "string" ? JSON.parse(r.config) : (r.config ?? {}),
      }));
    } finally {
      await sql.end();
    }
  }

  /**
   * Get a single agent by ID.
   */
  async getAgent(id: string): Promise<{
    id: string;
    name: string;
    role: string;
    status: string;
    config: Record<string, unknown>;
  } | null> {
    const pg = (await import("postgres")).default;
    const sql = pg(this.pgUrl);

    try {
      const rows = await sql`
        SELECT id, name, role, status, config FROM agents WHERE id = ${id} LIMIT 1
      `;
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        status: r.status,
        config: typeof r.config === "string" ? JSON.parse(r.config) : (r.config ?? {}),
      };
    } finally {
      await sql.end();
    }
  }

  /**
   * Register a new agent in the family.
   */
  async registerAgent(
    id: string,
    name: string,
    role: string,
    config?: Record<string, unknown>,
  ): Promise<void> {
    const pg = (await import("postgres")).default;
    const sql = pg(this.pgUrl);

    try {
      await sql`
        INSERT INTO agents (id, name, role, status, config)
        VALUES (${id}, ${name}, ${role}, 'active', ${sql.json(config ?? {})})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          config = EXCLUDED.config,
          updated_at = NOW()
      `;
      log.info("agent registered", { id, name, role });
    } finally {
      await sql.end();
    }
  }
}

// ── Singleton ───────────────────────────────────────────────────────────

let _family: AgentFamily | null = null;
let _rosterSyncAttempted = false;

type LocalFamilyAgent = {
  id: string;
  name: string;
  role: string;
  team?: string;
  config?: Record<string, unknown>;
};

function parseIdentityMarkdown(raw: string): {
  id?: string;
  name?: string;
  role?: string;
  team?: string;
  model?: string;
} {
  const read = (label: string) =>
    raw.match(new RegExp(`- \\*\\*${label}:\\*\\*\\s*(.+)$`, "m"))?.[1]?.trim();
  return {
    name: read("Name"),
    role: read("Role"),
    team: read("Team"),
    model: read("Model"),
  };
}

async function readLocalFamilyAgentsFromDisk(): Promise<LocalFamilyAgent[]> {
  const home = process.env.HOME ?? "";
  if (!home) return [];
  const agentsDir = path.join(home, ".argentos", "agents");
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: LocalFamilyAgent[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name.trim().toLowerCase();
    if (!id || id.startsWith("agent-main-subagent-")) continue;

    const root = path.join(agentsDir, entry.name);
    const identityJsonPath = path.join(root, "identity.json");
    const identityMdPath = path.join(root, "agent", "IDENTITY.md");

    let name: string | undefined;
    let role: string | undefined;
    let team: string | undefined;
    let config: Record<string, unknown> | undefined;

    try {
      const raw = await fs.readFile(identityJsonPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      name = typeof parsed.name === "string" ? parsed.name.trim() : undefined;
      role = typeof parsed.role === "string" ? parsed.role.trim() : undefined;
      team =
        typeof parsed.team === "string"
          ? parsed.team.trim()
          : typeof (parsed.config as Record<string, unknown> | undefined)?.team === "string"
            ? String((parsed.config as Record<string, unknown>).team).trim()
            : undefined;
      const model = typeof parsed.model === "string" ? parsed.model.trim() : undefined;
      const provider = typeof parsed.provider === "string" ? parsed.provider.trim() : undefined;
      config = {
        ...(team ? { team } : {}),
        ...(model ? { model } : {}),
        ...(provider ? { provider } : {}),
      };
    } catch {
      // Fall through to markdown fallback below.
    }

    if (!role) {
      try {
        const md = await fs.readFile(identityMdPath, "utf8");
        const parsed = parseIdentityMarkdown(md);
        name = name ?? parsed.name?.trim();
        role = parsed.role?.trim();
        team = team ?? parsed.team?.trim();
        const model = parsed.model?.trim();
        config = {
          ...(config ?? {}),
          ...(team ? { team } : {}),
          ...(model ? { model } : {}),
        };
      } catch {
        // no-op
      }
    }

    if (!role) continue;
    out.push({
      id,
      name: name || id,
      role,
      team,
      config: config ?? (team ? { team } : undefined),
    });
  }

  return out;
}

async function syncFamilyRosterFromDisk(family: AgentFamily): Promise<void> {
  const localAgents = await readLocalFamilyAgentsFromDisk();
  if (localAgents.length === 0) return;
  for (const agent of localAgents) {
    await family.registerAgent(agent.id, agent.name, agent.role, agent.config);
  }
  log.info("family roster sync complete", { count: localAgents.length });
}

/**
 * Get or create the AgentFamily singleton.
 * Reads PG and Redis config from argent.json.
 */
export async function getAgentFamily(): Promise<AgentFamily> {
  if (_family) return _family;

  const storage = readStorageConfigFromDisk(process.env);
  const pgUrl = resolvePostgresUrl({ storage });
  let redis: Redis | null = null;

  const redisCfg = resolveRedisConfig(process.env, storage);
  if (redisCfg) {
    try {
      redis = getRedisClient(redisCfg);
    } catch {
      /* Redis optional */
    }
  }

  _family = new AgentFamily(pgUrl, redis);
  if (!_rosterSyncAttempted && process.env.ARGENT_FAMILY_SYNC !== "0") {
    _rosterSyncAttempted = true;
    try {
      await syncFamilyRosterFromDisk(_family);
    } catch (err) {
      log.warn("family roster sync failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return _family;
}
