/**
 * Migrate legacy canvas.db rows into PG memory_items (knowledge namespace).
 *
 * Supports both:
 * - legacy knowledge ingest rows (`--scope=knowledge`)
 * - full DocPane backfill (`--scope=all`, default)
 *
 * Usage:
 *   node --import tsx scripts/migrate-canvas-knowledge-to-pg.ts
 *   node --import tsx scripts/migrate-canvas-knowledge-to-pg.ts --scope=knowledge
 *   node --import tsx scripts/migrate-canvas-knowledge-to-pg.ts --agent main
 *   node --import tsx scripts/migrate-canvas-knowledge-to-pg.ts --db ~/argent/memory/canvas.db
 *   node --import tsx scripts/migrate-canvas-knowledge-to-pg.ts --dry-run
 */

import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config/config.js";
import {
  ensureKnowledgeCollectionAccess,
  knowledgeCollectionTag,
  normalizeKnowledgeCollection,
} from "../src/data/knowledge-acl.js";
import { getPgMemoryAdapter, getStorageAdapter } from "../src/data/storage-factory.js";
import { resolveRuntimeStorageConfig } from "../src/data/storage-resolver.js";
import { getMemuEmbedder } from "../src/memory/memu-embed.js";

type LegacyDocRow = {
  id: string;
  title: string | null;
  content: string | null;
  type: string | null;
  language: string | null;
  tags: string | null;
  embedding: Buffer | null;
  created_at: number | string | null;
  metadata: string | null;
};

type MigrationScope = "all" | "knowledge";

type CliArgs = {
  agentId: string;
  dbPath?: string;
  dryRun: boolean;
  limit?: number;
  strictPg: boolean;
  scope: MigrationScope;
  docpaneCollection: string;
  embedMissing: boolean;
};

type ParsedLegacyDoc = {
  id: string;
  title: string;
  content: string;
  type: string;
  language: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  isKnowledge: boolean;
  collection: string;
  collectionTag: string;
  sourceFile: string;
  citation: string;
  summary: string;
  embedding: number[] | null;
  createdAtIso: string | null;
};

function parseArgs(argv: string[]): CliArgs {
  let agentId = "main";
  let dbPath: string | undefined;
  let dryRun = false;
  let limit: number | undefined;
  let strictPg = true;
  let scope: MigrationScope = "all";
  let docpaneCollection = "docpane";
  let embedMissing = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--agent" && argv[i + 1]) {
      agentId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--agent=")) {
      agentId = arg.slice("--agent=".length);
      continue;
    }
    if (arg === "--db" && argv[i + 1]) {
      dbPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--db=")) {
      dbPath = arg.slice("--db=".length);
      continue;
    }
    if (arg === "--limit" && argv[i + 1]) {
      const next = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(next) && next > 0) limit = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const next = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(next) && next > 0) limit = next;
      continue;
    }
    if (arg === "--scope" && argv[i + 1]) {
      const raw = String(argv[i + 1])
        .trim()
        .toLowerCase();
      scope = raw === "knowledge" ? "knowledge" : "all";
      i += 1;
      continue;
    }
    if (arg.startsWith("--scope=")) {
      const raw = arg.slice("--scope=".length).trim().toLowerCase();
      scope = raw === "knowledge" ? "knowledge" : "all";
      continue;
    }
    if (arg === "--docpane-collection" && argv[i + 1]) {
      docpaneCollection = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--docpane-collection=")) {
      docpaneCollection = arg.slice("--docpane-collection=".length);
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--allow-dual") {
      strictPg = false;
      continue;
    }
    if (arg === "--embed-missing") {
      embedMissing = true;
      continue;
    }
  }

  return {
    agentId,
    dbPath,
    dryRun,
    limit,
    strictPg,
    scope,
    docpaneCollection: normalizeKnowledgeCollection(docpaneCollection, "docpane"),
    embedMissing,
  };
}

function resolveCanvasDbPath(explicitPath?: string): string | null {
  const candidates = [
    explicitPath?.trim(),
    process.env.ARGENT_CANVAS_DB_PATH?.trim(),
    path.join(os.homedir(), "argent", "memory", "canvas.db"),
    path.join(os.homedir(), ".argentos", "data", "canvas.db"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function sanitizeTagValue(value: string | undefined, fallback = "unknown"): string {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value).trim()).filter(Boolean);
      }
    } catch {
      // ignore malformed JSON
    }
  }
  return [];
}

function parseFloat32Buffer(buf: Buffer | null): number[] | null {
  if (!buf || buf.length === 0 || buf.length % 4 !== 0) return null;
  const out: number[] = [];
  for (let i = 0; i < buf.length; i += 4) {
    const value = buf.readFloatLE(i);
    if (!Number.isFinite(value)) return null;
    out.push(value);
  }
  return out.length > 0 ? out : null;
}

function parseCreatedAtIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (Number.isFinite(numeric)) {
    const d = new Date(numeric);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  const d = new Date(String(value));
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

function parseCitationFromContent(content: string): string | null {
  const match = content.match(/^\s*\[\[citation:([^\]]+)\]\]/i);
  const citation = match?.[1]?.trim();
  return citation ? citation : null;
}

function stripCitation(summary: string): string {
  return summary.replace(/^\s*\[\[citation:[^\]]+\]\]\s*/i, "").trim();
}

function isKnowledgeRow(
  typeValue: string,
  tags: string[],
  metadata: Record<string, unknown>,
): boolean {
  if (typeValue === "knowledge") return true;
  if (tags.some((tag) => tag.toLowerCase() === "knowledge")) return true;
  if (tags.some((tag) => tag.toLowerCase().startsWith("kb:"))) return true;
  if (String(metadata.source || "").toLowerCase() === "knowledge_ingest") return true;
  return false;
}

function resolveCollectionForRow(
  isKnowledge: boolean,
  metadata: Record<string, unknown>,
  tags: string[],
  fallbackDocpaneCollection: string,
): string {
  const metadataCollection =
    typeof metadata.collection === "string" ? metadata.collection.trim() : "";
  const metadataCollectionTag =
    typeof metadata.collectionTag === "string" ? metadata.collectionTag.trim() : "";
  const metadataKnowledgeCollection =
    typeof metadata.knowledgeCollection === "string" ? metadata.knowledgeCollection.trim() : "";
  const kbTag = tags.find((tag) => tag.toLowerCase().startsWith("kb:")) || "";
  const tagCollection = kbTag ? kbTag.slice(3).trim() : "";

  if (isKnowledge) {
    return normalizeKnowledgeCollection(
      metadataCollection ||
        metadataCollectionTag ||
        metadataKnowledgeCollection ||
        tagCollection ||
        "default",
      "default",
    );
  }

  return normalizeKnowledgeCollection(
    metadataKnowledgeCollection || metadataCollection || fallbackDocpaneCollection,
    fallbackDocpaneCollection,
  );
}

function resolveSourceFileForRow(
  rowId: string,
  isKnowledge: boolean,
  metadata: Record<string, unknown>,
): string {
  const metadataSourceFile =
    typeof metadata.sourceFile === "string" ? metadata.sourceFile.trim() : "";
  if (isKnowledge && metadataSourceFile) return metadataSourceFile;
  return `docpanel-${sanitizeTagValue(rowId, "doc")}.md`;
}

function normalizeLegacyRow(row: LegacyDocRow, docpaneCollection: string): ParsedLegacyDoc | null {
  const id = String(row.id || "").trim();
  if (!id) return null;

  const content = String(row.content || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!content) return null;

  const title = String(row.title || "").trim() || id;
  const tags = parseTags(row.tags);
  const metadata = parseJsonObject(row.metadata);
  const rawType =
    String(row.type || "markdown")
      .trim()
      .toLowerCase() || "markdown";
  const language =
    typeof row.language === "string" && row.language.trim() ? row.language.trim() : null;

  const knowledge = isKnowledgeRow(rawType, tags, metadata);
  const collection = resolveCollectionForRow(knowledge, metadata, tags, docpaneCollection);
  const collectionTag = knowledgeCollectionTag(collection, "default");
  const sourceFile = resolveSourceFileForRow(id, knowledge, metadata);
  const metadataCitation = typeof metadata.citation === "string" ? metadata.citation.trim() : "";
  const contentCitation = parseCitationFromContent(content);
  const citation = metadataCitation || contentCitation || `${sourceFile}#chunk-1`;
  const summary = contentCitation ? content : `[[citation:${citation}]]\n${content}`;

  return {
    id,
    title,
    content: stripCitation(summary),
    type: rawType,
    language,
    tags,
    metadata,
    isKnowledge: knowledge,
    collection,
    collectionTag,
    sourceFile,
    citation,
    summary,
    embedding: parseFloat32Buffer(row.embedding),
    createdAtIso: parseCreatedAtIso(row.created_at),
  };
}

function buildContentHash(parsed: ParsedLegacyDoc): string {
  const seed = [
    "legacy-canvas-doc-migrate",
    parsed.collectionTag,
    parsed.sourceFile,
    parsed.citation,
    parsed.summary,
  ].join("\n");
  return crypto.createHash("sha256").update(seed).digest("hex");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = resolveCanvasDbPath(args.dbPath);
  if (!dbPath) {
    console.error("No canvas.db found. Checked --db, ARGENT_CANVAS_DB_PATH, and default paths.");
    process.exit(1);
  }

  const storage = resolveRuntimeStorageConfig();
  const backend = storage.backend;
  if (args.strictPg && backend !== "postgres") {
    console.error(
      `Storage backend is "${backend}". Set storage.backend=postgres (or pass --allow-dual for temporary dual mode).`,
    );
    process.exit(1);
  }
  if (!args.strictPg && backend !== "postgres" && backend !== "dual") {
    console.error(
      `Storage backend is "${backend}". This migration requires postgres or dual backend.`,
    );
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });
  const rows = db
    .prepare(
      `
      SELECT id, title, content, type, language, tags, embedding, created_at, metadata
      FROM documents
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC
    `,
    )
    .all() as LegacyDocRow[];
  db.close();

  const normalized = rows
    .map((row) => normalizeLegacyRow(row, args.docpaneCollection))
    .filter((row): row is ParsedLegacyDoc => Boolean(row));

  const scoped =
    args.scope === "knowledge" ? normalized.filter((row) => row.isKnowledge) : normalized;
  const selected = typeof args.limit === "number" ? scoped.slice(0, args.limit) : scoped;

  console.log(
    `[knowledge-migrate] source=${dbPath} totalRows=${rows.length} normalized=${normalized.length} selected=${selected.length} scope=${args.scope} docpaneCollection=${args.docpaneCollection} embedMissing=${args.embedMissing} agent=${args.agentId} dryRun=${args.dryRun}`,
  );
  if (selected.length === 0) {
    console.log("[knowledge-migrate] nothing to migrate");
    return;
  }

  const cfg = loadConfig();
  await getStorageAdapter();
  const pgMemory = getPgMemoryAdapter();
  if (!pgMemory) {
    console.error(
      "PG memory adapter is not available (storage may have fallen back to sqlite). Start PG and retry.",
    );
    process.exit(1);
  }
  const memory = pgMemory.withAgentId ? pgMemory.withAgentId(args.agentId) : pgMemory;
  const embedder = await getMemuEmbedder(cfg).catch(() => null);

  const resourceByKey = new Map<string, string>();
  const existingMigratedDocIds = new Set<string>();
  const existingSourceKeys = new Set<string>();
  const existingHashes = new Set<string>();

  try {
    const existing = await memory.listItems({ memoryType: "knowledge", limit: 100_000 });
    for (const item of existing) {
      if (typeof item.contentHash === "string" && item.contentHash.trim()) {
        existingHashes.add(item.contentHash.trim());
      }
      const extra =
        item.extra && typeof item.extra === "object" ? (item.extra as Record<string, unknown>) : {};
      const migratedDocId =
        typeof extra.migratedFromDocId === "string" ? extra.migratedFromDocId.trim() : "";
      if (migratedDocId) existingMigratedDocIds.add(migratedDocId);

      const sourceFile = typeof extra.sourceFile === "string" ? extra.sourceFile.trim() : "";
      const collection =
        typeof extra.collection === "string"
          ? normalizeKnowledgeCollection(extra.collection, "")
          : "";
      const collectionTag = knowledgeCollectionTag(collection, "");
      if (sourceFile && collectionTag) {
        existingSourceKeys.add(`${collectionTag}::${sourceFile}`);
      }
    }
  } catch (err) {
    console.warn(
      "[knowledge-migrate] failed to preload existing knowledge items; continuing without pre-scan:",
      err instanceof Error ? err.message : String(err),
    );
  }

  let migrated = 0;
  let skippedExisting = 0;
  let failed = 0;
  let embeddedFromLegacy = 0;
  let embeddedFresh = 0;

  for (const row of selected) {
    const sourceKey = `${row.collectionTag}::${row.sourceFile}`;
    const contentHash = buildContentHash(row);

    try {
      await ensureKnowledgeCollectionAccess({
        agentId: args.agentId,
        collection: row.collection,
        createIfMissing: true,
      });

      if (existingMigratedDocIds.has(row.id)) {
        skippedExisting += 1;
        continue;
      }
      if (existingSourceKeys.has(sourceKey)) {
        skippedExisting += 1;
        continue;
      }
      if (existingHashes.has(contentHash)) {
        skippedExisting += 1;
        continue;
      }

      const existing = await memory.findItemByHash(contentHash);
      if (existing) {
        existingHashes.add(contentHash);
        skippedExisting += 1;
        continue;
      }

      if (args.dryRun) {
        migrated += 1;
        continue;
      }

      let resourceId = resourceByKey.get(sourceKey);
      if (!resourceId) {
        const resource = await memory.createResource({
          url: `kb://${row.collectionTag}/${encodeURIComponent(row.sourceFile)}`,
          modality: "text",
          caption: `Migrated legacy canvas source (${row.collection}): ${row.sourceFile}`,
        });
        resourceId = resource.id;
        resourceByKey.set(sourceKey, resourceId);
      }

      const item = await memory.createItem({
        resourceId,
        memoryType: "knowledge",
        summary: row.summary,
        significance: "noteworthy",
        agentId: args.agentId,
        contentHash,
        extra: {
          source: "knowledge_ingest",
          collection: row.collection,
          collectionTag: row.collectionTag,
          sourceFile: row.sourceFile,
          sourceTag: sanitizeTagValue(row.sourceFile, "file"),
          citation: row.citation,
          chunkIndex: 1,
          chunkTotal: 1,
          chunkStart: 0,
          chunkEnd: row.content.length,
          ingestVersion: 1,
          ingestedAt: row.createdAtIso || new Date().toISOString(),
          migratedFrom: "canvas.db",
          migratedFromDocId: row.id,
          migratedAt: new Date().toISOString(),
          docId: row.id,
          docTitle: row.title,
          docType: row.type,
          docLanguage: row.language,
          docTags: row.tags,
          docCreatedAt: row.createdAtIso || new Date().toISOString(),
          docUpdatedAt: row.createdAtIso || new Date().toISOString(),
        },
        happenedAt: row.createdAtIso || undefined,
      } as any);

      if (row.embedding && row.embedding.length > 0) {
        try {
          await memory.updateItemEmbedding(item.id, row.embedding);
          embeddedFromLegacy += 1;
        } catch (err) {
          console.warn(
            `[knowledge-migrate] embedding update skipped (legacy vector incompatible) id=${row.id}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      } else if (embedder && args.embedMissing) {
        try {
          const vec = await embedder.embed(`${row.sourceFile}\n\n${row.content}`);
          await memory.updateItemEmbedding(item.id, vec);
          embeddedFresh += 1;
        } catch (err) {
          console.warn(
            `[knowledge-migrate] embedding generation skipped id=${row.id}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      migrated += 1;
      existingMigratedDocIds.add(row.id);
      existingSourceKeys.add(sourceKey);
      existingHashes.add(contentHash);
    } catch (err) {
      failed += 1;
      console.warn(
        `[knowledge-migrate] failed row id=${row.id} source=${row.sourceFile}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log(
    `[knowledge-migrate] done migrated=${migrated} skippedExisting=${skippedExisting} failed=${failed} embeddedFromLegacy=${embeddedFromLegacy} embeddedFresh=${embeddedFresh} dryRun=${args.dryRun}`,
  );
}

await main();
