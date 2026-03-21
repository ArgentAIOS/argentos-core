/**
 * Audit current MemU parse-failure signals.
 *
 * Important: the gateway health `memuParse` counter currently reflects
 * fallback contemplation episodes (`summary LIKE '[fallback]%'`), not every
 * possible extraction failure. This script shows that signal directly and also
 * surfaces recent explicit MemU extraction model failures.
 *
 * Usage:
 *   node --import tsx scripts/audit-memu-parse-failures.ts
 *   node --import tsx scripts/audit-memu-parse-failures.ts --hours 72 --limit 20
 */

import { resolveDefaultAgentId } from "../src/agents/agent-scope.js";
import { loadConfig } from "../src/config/config.js";
import { closePgClient, getPgClient } from "../src/data/pg-client.js";
import { isPostgresEnabled } from "../src/data/storage-config.js";
import { resolveRuntimeStorageConfig } from "../src/data/storage-resolver.js";

interface FallbackEpisodeRow {
  id: string;
  created_at: string;
  summary: string;
  extra: Record<string, unknown> | null;
}

interface ExtractFailureRow {
  created_at: string;
  session_key: string | null;
  provider: string;
  model: string;
  error_type: string | null;
}

function parseFlagNumber(args: string[], flag: string, fallback: number): number {
  const idx = args.indexOf(flag);
  const raw = idx >= 0 ? Number(args[idx + 1]) : Number.NaN;
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function previewObservation(extra: Record<string, unknown> | null): string {
  const observations = Array.isArray(extra?.observations) ? extra.observations : [];
  const first = observations[0];
  if (!first || typeof first !== "object") {
    return "(no observation preview)";
  }
  const what = (first as Record<string, unknown>).what;
  if (typeof what !== "string" || !what.trim()) {
    return "(no observation preview)";
  }
  return what.replace(/\s+/g, " ").slice(0, 220);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const hours = parseFlagNumber(args, "--hours", 24);
  const limit = parseFlagNumber(args, "--limit", 10);
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const storage = resolveRuntimeStorageConfig(process.env);
  if (!isPostgresEnabled(storage) || !storage.postgres) {
    throw new Error("PostgreSQL-backed memory is required for this audit script.");
  }

  const cfg = await loadConfig();
  const agentId = resolveDefaultAgentId(cfg);
  const sql = getPgClient(storage.postgres);

  try {
    const fallbackEpisodes = await sql<FallbackEpisodeRow[]>`
      SELECT
        id,
        created_at::text AS created_at,
        summary,
        extra
      FROM memory_items
      WHERE agent_id = ${agentId}
        AND memory_type = 'episode'
        AND summary LIKE '[fallback]%'
        AND created_at >= ${sinceIso}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    const extractFailures = await sql<ExtractFailureRow[]>`
      SELECT
        created_at::text AS created_at,
        session_key,
        provider,
        model,
        error_type
      FROM model_feedback
      WHERE agent_id = ${agentId}
        AND session_key LIKE 'temp:memu-extract:%'
        AND success = false
        AND created_at >= ${sinceIso}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    console.log(`Agent: ${agentId}`);
    console.log(`Window: last ${hours}h`);
    console.log("");
    console.log(
      `Health memuParse signal (fallback contemplation episodes): ${fallbackEpisodes.length}`,
    );
    for (const row of fallbackEpisodes) {
      console.log(`- ${row.created_at} :: ${row.summary}`);
      console.log(`  observation: ${previewObservation(row.extra)}`);
    }

    console.log("");
    console.log(`Explicit MemU extraction model failures: ${extractFailures.length}`);
    for (const row of extractFailures) {
      const memoryType = row.session_key?.split(":")[2] ?? "unknown";
      console.log(
        `- ${row.created_at} :: ${memoryType} :: ${row.provider}/${row.model} :: ${row.error_type ?? "unknown-error"}`,
      );
    }
  } finally {
    await closePgClient();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
