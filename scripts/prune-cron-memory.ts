/**
 * Historical cron-noise cleanup for PostgreSQL-backed MemU.
 *
 * Safe by default:
 * - Preview only unless --apply is passed
 * - Only targets memory_items attached to cron:// resources
 * - Preserves meaningful cron memories like actionable alerts/errors
 *
 * Usage:
 *   node --import tsx scripts/prune-cron-memory.ts
 *   node --import tsx scripts/prune-cron-memory.ts --apply
 *   node --import tsx scripts/prune-cron-memory.ts --preview 20 --scan-limit 50000
 */

import { resolveDefaultAgentId } from "../src/agents/agent-scope.js";
import { loadConfig } from "../src/config/config.js";
import { closePgClient, getPgClient } from "../src/data/pg-client.js";
import { isPostgresEnabled } from "../src/data/storage-config.js";
import { resolveRuntimeStorageConfig } from "../src/data/storage-resolver.js";

interface CronNoiseRow {
  id: string;
  memory_type: string;
  summary: string;
  resource_id: string | null;
  created_at: string;
  url: string;
  caption: string | null;
}

const LOW_VALUE_CRON_TEXT_RE =
  /\b(?:done|ok|status(?: is)? ok|no new vip email(?:s)?|finished checking(?: for vip emails)?|completed successfully|next run|scheduled (?:its )?next run|duration|unique id|active and connected|integrated with|is a vip email check|configured for next run|cron job action|action was vip email check|performing a vip email check|via vip_email|check_pending)\b/i;
const MEANINGFUL_CRON_TEXT_RE =
  /\b(?:new vip email(?:s)?|pending vip email(?:s)?|alerts sent|task(?:s)? created|actionable mention(?:s)?|setup required|cooldown active|failed|error|warning|blocked|escalat(?:e|ion)|incident)\b/i;
const GENERIC_CRON_CONTEXT_RE =
  /\b(?:cron job|vip email(?: check| scan)?|scheduled run|next run|atera rmm\/psa)\b/i;

function parseFlagNumber(args: string[], flag: string, fallback: number): number {
  const idx = args.indexOf(flag);
  const raw = idx >= 0 ? Number(args[idx + 1]) : Number.NaN;
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function shouldPruneHistoricalCronSummary(summary: string): boolean {
  const normalized = summary.trim();
  if (!normalized) {
    return true;
  }
  if (LOW_VALUE_CRON_TEXT_RE.test(normalized)) {
    return true;
  }
  if (MEANINGFUL_CRON_TEXT_RE.test(normalized)) {
    return false;
  }
  return GENERIC_CRON_CONTEXT_RE.test(normalized);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const previewCount = parseFlagNumber(args, "--preview", 10);
  const scanLimit = parseFlagNumber(args, "--scan-limit", 25000);

  const storage = resolveRuntimeStorageConfig(process.env);
  if (!isPostgresEnabled(storage) || !storage.postgres) {
    throw new Error("PostgreSQL-backed memory is required for this cleanup script.");
  }

  const cfg = await loadConfig();
  const agentId = resolveDefaultAgentId(cfg);
  const sql = getPgClient(storage.postgres);

  try {
    const rows = await sql<CronNoiseRow[]>`
      SELECT
        mi.id,
        mi.memory_type,
        mi.summary,
        mi.resource_id,
        mi.created_at::text AS created_at,
        r.url,
        r.caption
      FROM memory_items mi
      JOIN resources r
        ON r.id = mi.resource_id
      WHERE mi.agent_id = ${agentId}
        AND r.agent_id = ${agentId}
        AND r.url LIKE 'cron://%'
      ORDER BY mi.created_at DESC
      LIMIT ${scanLimit}
    `;

    const pruneRows = rows.filter((row) => shouldPruneHistoricalCronSummary(row.summary));
    const itemIds = pruneRows.map((row) => row.id);
    const resourceIds = unique(
      pruneRows.map((row) => row.resource_id).filter((id): id is string => Boolean(id)),
    );

    const byType = pruneRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.memory_type] = (acc[row.memory_type] ?? 0) + 1;
      return acc;
    }, {});
    const exampleRows = pruneRows.slice(0, previewCount).map((row) => ({
      createdAt: row.created_at,
      type: row.memory_type,
      summary: row.summary,
    }));

    console.log(`Agent: ${agentId}`);
    console.log(`Scanned cron-backed memory items: ${rows.length}`);
    console.log(`Prune candidates: ${pruneRows.length}`);
    console.log(`Mode: ${apply ? "apply" : "preview"}`);
    console.log("");
    console.log("Candidates by type:");
    for (const [memoryType, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
      console.log(`- ${memoryType}: ${count}`);
    }
    if (exampleRows.length > 0) {
      console.log("");
      console.log(`Preview (${exampleRows.length}):`);
      for (const row of exampleRows) {
        console.log(`- [${row.type}] ${row.createdAt} :: ${row.summary}`);
      }
    }

    if (!apply || itemIds.length === 0) {
      return;
    }

    await sql.begin(async (tx) => {
      for (const idChunk of chunk(itemIds, 500)) {
        await tx`
          DELETE FROM memory_items
          WHERE agent_id = ${agentId}
            AND id = ANY(${tx.array(idChunk)})
        `;
      }

      if (resourceIds.length > 0) {
        for (const idChunk of chunk(resourceIds, 500)) {
          await tx`
            DELETE FROM resources r
            WHERE r.agent_id = ${agentId}
              AND r.id = ANY(${tx.array(idChunk)})
              AND NOT EXISTS (
                SELECT 1
                FROM memory_items mi
                WHERE mi.resource_id = r.id
              )
          `;
        }
      }

      await tx`
        DELETE FROM memory_categories c
        WHERE c.agent_id = ${agentId}
          AND NOT EXISTS (
            SELECT 1
            FROM category_items ci
            WHERE ci.category_id = c.id
          )
      `;
    });

    console.log("");
    console.log(`Deleted memory items: ${itemIds.length}`);
    console.log(`Touched cron resources: ${resourceIds.length}`);
  } finally {
    await closePgClient();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
