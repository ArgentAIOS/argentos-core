import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import {
  isGarbageOperationalCategoryName,
  isPrunableOperationalEntityCandidate,
  type OperationalEntityStats,
} from "../src/memory/hygiene/operational-noise.js";

interface ArgentStorageConfig {
  storage?: {
    postgres?: {
      connectionString?: string;
    } | null;
  } | null;
}

interface CategoryCandidate {
  id: string;
  name: string;
  item_count: number;
}

interface EntityCandidate extends OperationalEntityStats {
  id: string;
  relationship: string | null;
}

function getArgValue(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx < 0) {
    return null;
  }
  return args[idx + 1] ?? null;
}

function resolveConfigPath(args: string[]): string {
  const explicit = getArgValue(args, "--config");
  if (explicit) {
    return explicit.startsWith("~/")
      ? path.join(os.homedir(), explicit.slice(2))
      : path.resolve(explicit);
  }
  return path.join(os.homedir(), ".argentos", "argent.json");
}

function resolveBackupDir(args: string[]): string {
  const explicit = getArgValue(args, "--backup-dir");
  if (explicit) {
    return explicit.startsWith("~/")
      ? path.join(os.homedir(), explicit.slice(2))
      : path.resolve(explicit);
  }
  return path.join(os.homedir(), ".argentos", "backups", "memory-hygiene");
}

function readConnectionString(configPath: string): string {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as ArgentStorageConfig;
  const connectionString = raw.storage?.postgres?.connectionString;
  if (!connectionString) {
    throw new Error(`No PostgreSQL connection string configured in ${configPath}`);
  }
  return connectionString;
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const preview = Math.max(1, Number(getArgValue(args, "--preview") ?? "20"));
const configPath = resolveConfigPath(args);
const backupDir = resolveBackupDir(args);
const connectionString = readConnectionString(configPath);

const sql = postgres(connectionString, { max: 1, onnotice() {} });

try {
  const categoryRows = await sql<CategoryCandidate[]>`
    SELECT
      mc.id,
      mc.name,
      (SELECT count(*)::int FROM category_items ci WHERE ci.category_id = mc.id) AS item_count
    FROM memory_categories mc
    ORDER BY item_count DESC, mc.created_at ASC
  `;
  const entityRows = await sql<EntityCandidate[]>`
    SELECT
      e.id,
      e.name,
      e.entity_type,
      e.relationship,
      COALESCE(e.memory_count, 0)::int AS memory_count,
      count(ie.item_id)::int AS link_count,
      count(*) FILTER (WHERE r.url LIKE 'cron://%')::int AS cron_links,
      count(*) FILTER (WHERE r.url LIKE 'session://%')::int AS session_links,
      count(*) FILTER (WHERE r.url LIKE 'kb://docpane/%')::int AS docpane_links,
      count(*) FILTER (WHERE r.url IS NULL)::int AS direct_links
    FROM entities e
    LEFT JOIN item_entities ie ON ie.entity_id = e.id
    LEFT JOIN memory_items mi ON mi.id = ie.item_id
    LEFT JOIN resources r ON r.id = mi.resource_id
    GROUP BY e.id, e.name, e.entity_type, e.relationship, e.memory_count
    ORDER BY COALESCE(e.memory_count, 0) DESC, e.created_at ASC
  `;

  const categoryCandidates = categoryRows.filter((row) =>
    isGarbageOperationalCategoryName(row.name),
  );
  const entityCandidates = entityRows.filter((row) =>
    isPrunableOperationalEntityCandidate({
      name: row.name,
      entityType: row.entity_type,
      memoryCount: row.memory_count,
      linkCount: row.link_count,
      cronLinks: row.cron_links,
      sessionLinks: row.session_links,
      docpaneLinks: row.docpane_links,
      directLinks: row.direct_links,
    }),
  );

  console.log("=== Operational Memory Noise Report ===");
  console.log(`Config: ${configPath}`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Garbage categories: ${categoryCandidates.length}`);
  console.log(`Operational entities: ${entityCandidates.length}`);

  if (categoryCandidates.length > 0) {
    console.log("");
    console.log("Category candidates:");
    for (const row of categoryCandidates.slice(0, preview)) {
      console.log(`- ${row.name} (${row.item_count} items)`);
    }
  }

  if (entityCandidates.length > 0) {
    console.log("");
    console.log("Entity candidates:");
    for (const row of entityCandidates.slice(0, preview)) {
      console.log(
        `- ${row.name} [${row.entity_type}] memory=${row.memory_count} links=${row.link_count} cron=${row.cron_links} direct=${row.direct_links}`,
      );
    }
  }

  if (!apply) {
    console.log("");
    console.log("Dry run complete. Re-run with --apply to persist cleanup.");
    process.exit(0);
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `operational-noise-prune-${timestampSlug()}.json`);

  const categoryIds = categoryCandidates.map((row) => row.id);
  const entityIds = entityCandidates.map((row) => row.id);

  const backup = {
    createdAt: new Date().toISOString(),
    categories: {
      rows: categoryCandidates,
      links:
        categoryIds.length > 0
          ? await sql.unsafe(
              `
                SELECT category_id, item_id
                FROM category_items
                WHERE category_id = ANY($1::text[])
                ORDER BY category_id, item_id
              `,
              [categoryIds],
            )
          : [],
    },
    entities: {
      rows: entityCandidates,
      links:
        entityIds.length > 0
          ? await sql.unsafe(
              `
                SELECT entity_id, item_id, role
                FROM item_entities
                WHERE entity_id = ANY($1::text[])
                ORDER BY entity_id, item_id
              `,
              [entityIds],
            )
          : [],
    },
  };
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");

  let categoryLinksDeleted = 0;
  let categoriesDeleted = 0;
  let entityLinksDeleted = 0;
  let entitiesDeleted = 0;

  await sql.begin(async (tx) => {
    if (categoryIds.length > 0) {
      const deletedLinks = await tx.unsafe(
        `
          DELETE FROM category_items
          WHERE category_id = ANY($1::text[])
        `,
        [categoryIds],
      );
      categoryLinksDeleted = deletedLinks.count;
      const deletedCategories = await tx.unsafe(
        `
          DELETE FROM memory_categories
          WHERE id = ANY($1::text[])
        `,
        [categoryIds],
      );
      categoriesDeleted = deletedCategories.count;
    }

    if (entityIds.length > 0) {
      const deletedLinks = await tx.unsafe(
        `
          DELETE FROM item_entities
          WHERE entity_id = ANY($1::text[])
        `,
        [entityIds],
      );
      entityLinksDeleted = deletedLinks.count;
      const deletedEntities = await tx.unsafe(
        `
          DELETE FROM entities
          WHERE id = ANY($1::text[])
        `,
        [entityIds],
      );
      entitiesDeleted = deletedEntities.count;
    }
  });

  console.log("");
  console.log("Cleanup applied.");
  console.log(`Backup: ${backupPath}`);
  console.log(`Category links deleted: ${categoryLinksDeleted}`);
  console.log(`Categories deleted: ${categoriesDeleted}`);
  console.log(`Entity links deleted: ${entityLinksDeleted}`);
  console.log(`Entities deleted: ${entitiesDeleted}`);
} finally {
  await sql.end({ timeout: 1 });
}
