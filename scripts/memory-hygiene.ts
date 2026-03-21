/**
 * MemU hygiene pass for category/entity metadata.
 *
 * Safe-by-default:
 * - Dry-run unless --apply is provided
 * - Never deletes memory_items unless --collapse-profiles is explicitly enabled
 * - Only clears/sanitizes category summaries, removes empty categories,
 *   and prunes clearly low-value entities that have zero links.
 *
 * Usage:
 *   bun scripts/memory-hygiene.ts
 *   bun scripts/memory-hygiene.ts --apply
 *   bun scripts/memory-hygiene.ts --collapse-profiles --preview 20
 *   bun scripts/memory-hygiene.ts --collapse-profiles --apply --preview 20
 *   bun scripts/memory-hygiene.ts --db /path/to/memory.db --apply --preview 20
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeCategorySummary } from "../src/memory/categories/sanitize.js";
import { openDatabase, closeDatabase } from "../src/memory/sqlite.js";

interface CategoryRow {
  id: string;
  name: string;
  summary: string | null;
}

interface OrphanCategoryRow {
  id: string;
  name: string;
}

interface EntityRow {
  id: string;
  name: string;
  link_count: number;
}

interface ProfileItemRow {
  id: string;
  summary: string;
  reinforcement_count: number;
  significance: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_reinforced_at: string | null;
  happened_at: string | null;
  resource_id: string | null;
}

interface ProfileCollapsePlan {
  signature: string;
  canonicalId: string;
  canonicalSummary: string;
  duplicateIds: string[];
  totalReinforcement: number;
  mergedSignificance: string;
  mergedHappenedAt: string | null;
  mergedLastReinforcedAt: string | null;
  mergedResourceId: string | null;
}

function getArgValue(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx < 0) {
    return null;
  }
  return args[idx + 1] ?? null;
}

function resolveDbPath(args: string[]): string {
  const explicit = getArgValue(args, "--db");
  if (explicit) {
    return explicit.startsWith("~/")
      ? path.join(os.homedir(), explicit.slice(2))
      : path.resolve(explicit);
  }
  return path.join(os.homedir(), ".argentos", "memory.db");
}

function isLowValueEntityName(name: string): boolean {
  const normalized = name.trim();
  if (!normalized) {
    return true;
  }
  if (normalized.length < 2) {
    return true;
  }
  if (normalized.length > 120) {
    return true;
  }
  if (/^(utc|gmt|api|json|http|https|url|uuid|sql)$/i.test(normalized)) {
    return true;
  }
  if (/^\d{4,}$/.test(normalized)) {
    return true;
  }
  if (/^[a-f0-9]{8,}$/i.test(normalized)) {
    return true;
  }
  return false;
}

const OP_PROFILE_HINT_RE =
  /\b(?:status|snapshot|health|metric|count|queue|uptime|latency|ticket|alert|cron|heartbeat|service|gateway|dashboard|api|provider|model)\b/i;
const OP_PROFILE_NUMERIC_RE = /\b\d+(?:[.,]\d+)?%?\b/g;
const OP_PROFILE_DATETIME_RE =
  /\b\d{4}-\d{2}-\d{2}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?:z)?\b/gi;
const OP_PROFILE_ID_RE =
  /\b(?:[a-f0-9]{8,}|[a-f0-9]{8}-[a-f0-9-]{27,}|(?:run|req|msg)-[a-z0-9-]+)\b/gi;
const OP_PROFILE_NUMERIC_TEST_RE = /\b\d+(?:[.,]\d+)?%?\b/;
const OP_PROFILE_DATETIME_TEST_RE =
  /\b\d{4}-\d{2}-\d{2}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?:z)?\b/i;

function isOperationalProfileSnapshot(summary: string): boolean {
  if (!OP_PROFILE_HINT_RE.test(summary)) {
    return false;
  }
  return OP_PROFILE_NUMERIC_TEST_RE.test(summary) || OP_PROFILE_DATETIME_TEST_RE.test(summary);
}

function operationalProfileSignature(summary: string): string {
  return summary
    .toLowerCase()
    .replace(OP_PROFILE_DATETIME_RE, " <datetime> ")
    .replace(OP_PROFILE_ID_RE, " <id> ")
    .replace(OP_PROFILE_NUMERIC_RE, " <num> ")
    .replace(/[^\p{L}\p{N}<>\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SIGNIFICANCE_RANK: Record<string, number> = {
  routine: 0,
  noteworthy: 1,
  important: 2,
  core: 3,
};

function significanceRank(value: string | null): number {
  if (!value) {
    return -1;
  }
  return SIGNIFICANCE_RANK[value] ?? -1;
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const filtered = values.filter((value): value is string => Boolean(value));
  if (filtered.length === 0) {
    return null;
  }
  filtered.sort((a, b) => a.localeCompare(b));
  return filtered[filtered.length - 1];
}

function selectCanonicalItem(rows: ProfileItemRow[]): ProfileItemRow {
  const sorted = [...rows].sort((a, b) => {
    const reinforcementDelta = b.reinforcement_count - a.reinforcement_count;
    if (reinforcementDelta !== 0) {
      return reinforcementDelta;
    }

    const significanceDelta = significanceRank(b.significance) - significanceRank(a.significance);
    if (significanceDelta !== 0) {
      return significanceDelta;
    }

    const aRecent = latestTimestamp([a.last_reinforced_at, a.updated_at, a.created_at]) ?? "";
    const bRecent = latestTimestamp([b.last_reinforced_at, b.updated_at, b.created_at]) ?? "";
    const recentDelta = bRecent.localeCompare(aRecent);
    if (recentDelta !== 0) {
      return recentDelta;
    }

    return a.id.localeCompare(b.id);
  });
  return sorted[0];
}

function buildProfileCollapsePlans(rows: ProfileItemRow[]): ProfileCollapsePlan[] {
  const grouped = new Map<string, ProfileItemRow[]>();

  for (const row of rows) {
    if (!isOperationalProfileSnapshot(row.summary)) {
      continue;
    }
    const signature = operationalProfileSignature(row.summary);
    if (!signature) {
      continue;
    }
    const list = grouped.get(signature) ?? [];
    list.push(row);
    grouped.set(signature, list);
  }

  const plans: ProfileCollapsePlan[] = [];
  for (const [signature, items] of grouped.entries()) {
    if (items.length < 2) {
      continue;
    }

    const canonical = selectCanonicalItem(items);
    const duplicates = items.filter((item) => item.id !== canonical.id);
    if (duplicates.length === 0) {
      continue;
    }

    const allRows = [canonical, ...duplicates];
    const strongest = allRows.reduce((best, row) => {
      return significanceRank(row.significance) > significanceRank(best.significance) ? row : best;
    }, canonical);

    plans.push({
      signature,
      canonicalId: canonical.id,
      canonicalSummary: canonical.summary,
      duplicateIds: duplicates.map((item) => item.id),
      totalReinforcement: allRows.reduce((sum, row) => sum + row.reinforcement_count, 0),
      mergedSignificance: strongest.significance ?? canonical.significance ?? "routine",
      mergedHappenedAt: latestTimestamp(allRows.map((row) => row.happened_at)),
      mergedLastReinforcedAt: latestTimestamp(
        allRows.map((row) => row.last_reinforced_at ?? row.updated_at ?? row.created_at),
      ),
      mergedResourceId:
        canonical.resource_id ?? duplicates.find((row) => row.resource_id)?.resource_id ?? null,
    });
  }

  plans.sort((a, b) => b.duplicateIds.length - a.duplicateIds.length);
  return plans;
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const collapseProfiles = args.includes("--collapse-profiles");
const preview = Math.max(1, Number(getArgValue(args, "--preview") ?? "10"));
const dbPath = resolveDbPath(args);

if (!fs.existsSync(dbPath)) {
  console.error(`Memory DB not found: ${dbPath}`);
  process.exit(1);
}

const db = openDatabase(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

try {
  const totalItems = (db.prepare("SELECT count(*) as c FROM memory_items").get() as { c: number })
    .c;
  const totalCategories = (
    db.prepare("SELECT count(*) as c FROM memory_categories").get() as { c: number }
  ).c;
  const totalEntities = (db.prepare("SELECT count(*) as c FROM entities").get() as { c: number }).c;

  const categories = db
    .prepare("SELECT id, name, summary FROM memory_categories")
    .all() as CategoryRow[];

  const categorySummariesToClear: string[] = [];
  const categorySummariesToNormalize: Array<{ id: string; name: string; summary: string }> = [];

  for (const row of categories) {
    if (row.summary == null) {
      continue;
    }
    const sanitized = sanitizeCategorySummary(row.summary);
    if (!sanitized) {
      categorySummariesToClear.push(row.id);
      continue;
    }
    if (sanitized !== row.summary) {
      categorySummariesToNormalize.push({ id: row.id, name: row.name, summary: sanitized });
    }
  }

  const orphanCategories = db
    .prepare(
      `SELECT c.id, c.name
       FROM memory_categories c
       LEFT JOIN category_items ci ON ci.category_id = c.id
       GROUP BY c.id, c.name
       HAVING count(ci.item_id) = 0`,
    )
    .all() as OrphanCategoryRow[];

  const entities = db
    .prepare(
      `SELECT e.id, e.name, count(ie.item_id) as link_count
       FROM entities e
       LEFT JOIN item_entities ie ON ie.entity_id = e.id
       GROUP BY e.id, e.name`,
    )
    .all() as EntityRow[];

  const lowValueUnlinkedEntityIds = entities
    .filter((row) => row.link_count === 0 && isLowValueEntityName(row.name))
    .map((row) => row.id);

  const profileItems = collapseProfiles
    ? (db
        .prepare(
          `SELECT id, summary, reinforcement_count, significance, created_at, updated_at, last_reinforced_at, happened_at, resource_id
           FROM memory_items
           WHERE memory_type = 'profile'`,
        )
        .all() as ProfileItemRow[])
    : [];
  const collapsePlans = collapseProfiles ? buildProfileCollapsePlans(profileItems) : [];
  const profileItemsInScope = profileItems.filter((row) =>
    isOperationalProfileSnapshot(row.summary),
  ).length;
  const profileDuplicatesToDelete = collapsePlans.reduce(
    (sum, plan) => sum + plan.duplicateIds.length,
    0,
  );

  console.log("=== MemU Hygiene Report ===");
  console.log(`Database: ${dbPath}`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Profile collapse enabled: ${collapseProfiles ? "yes" : "no"}`);
  console.log(`memory_items: ${totalItems}`);
  console.log(`memory_categories: ${totalCategories}`);
  console.log(`entities: ${totalEntities}`);
  console.log("");
  console.log(`Category summaries to clear: ${categorySummariesToClear.length}`);
  console.log(`Category summaries to normalize: ${categorySummariesToNormalize.length}`);
  console.log(`Orphan categories to delete: ${orphanCategories.length}`);
  console.log(`Low-value unlinked entities to delete: ${lowValueUnlinkedEntityIds.length}`);
  if (collapseProfiles) {
    console.log(`Operational profile items in scope: ${profileItemsInScope}`);
    console.log(`Operational profile duplicate groups: ${collapsePlans.length}`);
    console.log(`Operational profile rows to collapse: ${profileDuplicatesToDelete}`);
  }

  if (categorySummariesToNormalize.length > 0) {
    console.log("");
    console.log("Sample category summary normalizations:");
    for (const row of categorySummariesToNormalize.slice(0, preview)) {
      console.log(`- ${row.name} (${row.id})`);
    }
  }

  if (collapsePlans.length > 0) {
    console.log("");
    console.log("Sample operational profile collapse groups:");
    for (const plan of collapsePlans.slice(0, preview)) {
      const compactSummary = plan.canonicalSummary.replace(/\s+/g, " ").slice(0, 140);
      console.log(
        `- canonical ${plan.canonicalId} <- ${plan.duplicateIds.length} duplicates | "${compactSummary}${plan.canonicalSummary.length > 140 ? "…" : ""}"`,
      );
    }
  }

  if (!apply) {
    console.log("");
    console.log("Dry run complete. Re-run with --apply to persist changes.");
    process.exit(0);
  }

  const updateCategorySummaryStmt = db.prepare(
    "UPDATE memory_categories SET summary = ?, updated_at = datetime('now') WHERE id = ?",
  );
  const clearCategorySummaryStmt = db.prepare(
    "UPDATE memory_categories SET summary = NULL, updated_at = datetime('now') WHERE id = ?",
  );
  const deleteCategoryStmt = db.prepare("DELETE FROM memory_categories WHERE id = ?");
  const deleteEntityStmt = db.prepare("DELETE FROM entities WHERE id = ?");
  const moveCategoryLinksStmt = db.prepare(
    `INSERT OR IGNORE INTO category_items (item_id, category_id)
     SELECT ?, category_id FROM category_items WHERE item_id = ?`,
  );
  const moveEntityLinksStmt = db.prepare(
    `INSERT OR IGNORE INTO item_entities (item_id, entity_id, role)
     SELECT ?, entity_id, role FROM item_entities WHERE item_id = ?`,
  );
  const deleteMemoryItemStmt = db.prepare("DELETE FROM memory_items WHERE id = ?");
  const deleteCategoryLinksForItemStmt = db.prepare("DELETE FROM category_items WHERE item_id = ?");
  const deleteEntityLinksForItemStmt = db.prepare("DELETE FROM item_entities WHERE item_id = ?");
  const updateCanonicalProfileStmt = db.prepare(
    `UPDATE memory_items
        SET reinforcement_count = ?,
            significance = ?,
            happened_at = COALESCE(?, happened_at),
            last_reinforced_at = COALESCE(?, last_reinforced_at),
            resource_id = COALESCE(resource_id, ?),
            updated_at = datetime('now')
      WHERE id = ?`,
  );
  const refreshEntityCountsStmt = db.prepare(
    `UPDATE entities
        SET memory_count = (SELECT count(*) FROM item_entities WHERE entity_id = entities.id),
            updated_at = datetime('now')`,
  );

  let movedCategoryLinks = 0;
  let movedEntityLinks = 0;
  let deletedProfileRows = 0;
  let deletedLegacyCategoryLinks = 0;
  let deletedLegacyEntityLinks = 0;
  let updatedCanonicalProfiles = 0;

  const tx = db.transaction(() => {
    for (const row of categorySummariesToNormalize) {
      updateCategorySummaryStmt.run(row.summary, row.id);
    }
    for (const id of categorySummariesToClear) {
      clearCategorySummaryStmt.run(id);
    }
    for (const row of orphanCategories) {
      deleteCategoryStmt.run(row.id);
    }
    for (const id of lowValueUnlinkedEntityIds) {
      deleteEntityStmt.run(id);
    }
    if (collapseProfiles) {
      for (const plan of collapsePlans) {
        for (const duplicateId of plan.duplicateIds) {
          movedCategoryLinks += Number(
            moveCategoryLinksStmt.run(plan.canonicalId, duplicateId).changes ?? 0,
          );
          movedEntityLinks += Number(
            moveEntityLinksStmt.run(plan.canonicalId, duplicateId).changes ?? 0,
          );
          deletedLegacyCategoryLinks += Number(
            deleteCategoryLinksForItemStmt.run(duplicateId).changes ?? 0,
          );
          deletedLegacyEntityLinks += Number(
            deleteEntityLinksForItemStmt.run(duplicateId).changes ?? 0,
          );
          deletedProfileRows += Number(deleteMemoryItemStmt.run(duplicateId).changes ?? 0);
        }
        updatedCanonicalProfiles += Number(
          updateCanonicalProfileStmt.run(
            plan.totalReinforcement,
            plan.mergedSignificance,
            plan.mergedHappenedAt,
            plan.mergedLastReinforcedAt,
            plan.mergedResourceId,
            plan.canonicalId,
          ).changes ?? 0,
        );
      }
      refreshEntityCountsStmt.run();
    }
  });

  tx();

  console.log("");
  console.log("Applied hygiene changes successfully.");
  if (collapseProfiles) {
    console.log(`Canonical profiles updated: ${updatedCanonicalProfiles}`);
    console.log(`Profile rows deleted: ${deletedProfileRows}`);
    console.log(`Category links moved: ${movedCategoryLinks}`);
    console.log(`Entity links moved: ${movedEntityLinks}`);
    console.log(`Legacy category links removed: ${deletedLegacyCategoryLinks}`);
    console.log(`Legacy entity links removed: ${deletedLegacyEntityLinks}`);
  }
} finally {
  closeDatabase(db);
}
