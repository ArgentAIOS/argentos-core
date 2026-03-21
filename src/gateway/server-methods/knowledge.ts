import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { resolveSessionAgentIds } from "../../agents/agent-scope.js";
import { inferDepartmentKnowledgeCollections } from "../../agents/support-rag-routing.js";
import { loadConfig } from "../../config/config.js";
import {
  ensureKnowledgeCollectionAccess,
  getKnowledgeAclSnapshot,
  hasKnowledgeCollectionReadAccess,
  knowledgeCollectionTag,
  listKnowledgeCollections,
  normalizeKnowledgeCollection,
  setKnowledgeCollectionGrant,
} from "../../data/knowledge-acl.js";
import { getPgMemoryAdapter, getStorageAdapter } from "../../data/storage-factory.js";
import {
  DEFAULT_INPUT_FILE_MAX_BYTES,
  DEFAULT_INPUT_FILE_MAX_CHARS,
  DEFAULT_INPUT_FILE_MIMES,
  DEFAULT_INPUT_MAX_REDIRECTS,
  DEFAULT_INPUT_TIMEOUT_MS,
  DEFAULT_INPUT_PDF_MAX_PAGES,
  DEFAULT_INPUT_PDF_MAX_PIXELS,
  DEFAULT_INPUT_PDF_MIN_TEXT_CHARS,
  extractFileContentFromSource,
  normalizeMimeType,
  type InputFileLimits,
} from "../../media/input-files.js";
import { shouldEnforceV3EmbeddingContract } from "../../memory/embedding-contract.js";
import { getMemuEmbedder } from "../../memory/memu-embed.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

const requireModule = createRequire(import.meta.url);

type KnowledgeIngestFile = {
  fileName?: string;
  mimeType?: string;
  content?: string;
};

type KnowledgeIngestOptions = {
  collection?: string;
  chunkSize?: number;
  overlap?: number;
  itemExtra?: Record<string, unknown>;
};

type KnowledgeVaultIngestOptions = KnowledgeIngestOptions & {
  dryRun?: boolean;
  limitFiles?: number;
};

type KnowledgeSearchOptions = {
  collection?: string | string[];
  limit?: number;
  includeShared?: boolean;
  ingestedOnly?: boolean;
};

type KnowledgeCollectionsListOptions = {
  includeInaccessible?: boolean;
  agentId?: string;
};

type KnowledgeCollectionsGrantOptions = {
  actorAgentId?: string;
  collection?: string;
  agentId?: string;
  canRead?: boolean;
  canWrite?: boolean;
  isOwner?: boolean;
};

type KnowledgeLibraryListOptions = {
  q?: string;
  collection?: string | string[];
  sourceFile?: string;
  sourceFileExact?: boolean;
  limit?: number;
  scanLimit?: number;
  sort?: "savedAt" | "title" | "type";
  order?: "asc" | "desc";
  ingestedOnly?: boolean;
  includeFullText?: boolean;
  distinctByDocument?: boolean;
};

type KnowledgeLibraryDeleteOptions = {
  ids?: string[];
  q?: string;
  collection?: string | string[];
  sourceFile?: string;
  limit?: number;
  dryRun?: boolean;
};

type KnowledgeLibraryReindexOptions = {
  q?: string;
  collection?: string | string[];
  sourceFile?: string;
  limit?: number;
  onlyMissing?: boolean;
};

const EXTRA_TEXT_MIMES = [
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/yaml",
  "application/csv",
  "application/sql",
  "application/x-sh",
];

const BINARY_FILE_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function isRawTextMime(mimeType: string): boolean {
  if (mimeType.startsWith("text/")) return true;
  if (EXTRA_TEXT_MIMES.includes(mimeType)) return true;
  return !BINARY_FILE_MIMES.has(mimeType);
}

function sanitizeTagValue(value: string | undefined, fallback = "unknown"): string {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function parseCollectionFilter(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    return [trimmed];
  }
  return [];
}

function getItemExtra(item: unknown): Record<string, unknown> {
  if (!item || typeof item !== "object") return {};
  const maybeExtra = (item as { extra?: unknown }).extra;
  if (!maybeExtra || typeof maybeExtra !== "object") return {};
  return maybeExtra as Record<string, unknown>;
}

function parseCitation(summary: string, fallback?: unknown): string | null {
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  const match = /^\s*\[\[citation:([^\]]+)\]\]/i.exec(summary);
  if (!match) return null;
  return match[1]?.trim() || null;
}

function stripCitation(summary: string): string {
  return summary.replace(/^\s*\[\[citation:[^\]]+\]\]\s*/i, "").trim();
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const RESERVED_INGEST_EXTRA_KEYS = new Set([
  "source",
  "collection",
  "collectiontag",
  "sourcefile",
  "sourcetag",
  "citation",
  "chunkindex",
  "chunktotal",
  "chunkstart",
  "chunkend",
  "ingestversion",
  "ingestedat",
]);

function normalizeIngestItemExtra(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeOptionalString(rawKey);
    if (!key) continue;
    if (RESERVED_INGEST_EXTRA_KEYS.has(key.toLowerCase())) continue;

    if (
      rawValue === null ||
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      out[key] = rawValue;
      continue;
    }

    if (Array.isArray(rawValue)) {
      const normalized = rawValue.filter(
        (entry) =>
          entry === null ||
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean",
      );
      if (normalized.length > 0) {
        out[key] = normalized;
      }
      continue;
    }

    if (rawValue && typeof rawValue === "object") {
      try {
        const serialized = JSON.stringify(rawValue);
        if (serialized) {
          out[key] = JSON.parse(serialized);
        }
      } catch {
        // Ignore non-serializable values.
      }
    }
  }
  return out;
}

type OptionalIntentResolution = {
  departmentId?: string | null;
};

let resolveEffectiveIntentForAgentOptional:
  | ((params: { config: unknown; agentId: string }) => OptionalIntentResolution | null)
  | null
  | undefined;

function resolveEffectiveIntentForAgentIfAvailable(params: {
  config: unknown;
  agentId: string;
}): OptionalIntentResolution | null {
  if (resolveEffectiveIntentForAgentOptional === undefined) {
    try {
      const mod = requireModule("../../agents/intent.js") as {
        resolveEffectiveIntentForAgent?: (params: {
          config: unknown;
          agentId: string;
        }) => OptionalIntentResolution | null;
      };
      resolveEffectiveIntentForAgentOptional =
        typeof mod.resolveEffectiveIntentForAgent === "function"
          ? mod.resolveEffectiveIntentForAgent
          : null;
    } catch {
      resolveEffectiveIntentForAgentOptional = null;
    }
  }
  return resolveEffectiveIntentForAgentOptional?.(params) ?? null;
}

async function getPgKnowledgeMemory(agentId: string) {
  // Enforce PG-only knowledge path: do not allow sqlite fallback here.
  await getStorageAdapter();
  const pgMemory = getPgMemoryAdapter();
  if (!pgMemory) {
    throw new Error("Knowledge storage requires PostgreSQL memory adapter");
  }
  return pgMemory.withAgentId ? pgMemory.withAgentId(agentId) : pgMemory;
}

function normalizeCollectionFromExtra(extra: Record<string, unknown>): string {
  const raw =
    typeof extra.collection === "string" && extra.collection.trim()
      ? extra.collection
      : typeof extra.collectionTag === "string"
        ? extra.collectionTag
        : "";
  return normalizeKnowledgeCollection(raw, "");
}

function isIngestedKnowledge(extra: Record<string, unknown>): boolean {
  if (typeof extra.source !== "string") return false;
  return extra.source === "knowledge_ingest" || extra.source === "vault";
}

type LibraryCandidate = {
  id: string;
  memoryType: string;
  summary: string;
  createdAt: string;
  extra: Record<string, unknown>;
};

function libraryCandidateFromItem(item: unknown): LibraryCandidate | null {
  if (!item || typeof item !== "object") return null;
  const row = item as {
    id?: unknown;
    summary?: unknown;
    memoryType?: unknown;
    createdAt?: unknown;
  };
  const id = normalizeOptionalString(row.id);
  if (!id) return null;
  return {
    id,
    summary: typeof row.summary === "string" ? row.summary : "",
    memoryType: typeof row.memoryType === "string" ? row.memoryType : "knowledge",
    createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
    extra: getItemExtra(item),
  };
}

function matchesLibraryFilter(
  candidate: LibraryCandidate,
  params: {
    query: string;
    sourceFileFilter: string;
    sourceFileExact: boolean;
    collectionFilterRaw: Set<string>;
    collectionFilterTag: Set<string>;
    ingestedOnly: boolean;
  },
): boolean {
  if (candidate.memoryType !== "knowledge") return false;
  const extra = candidate.extra;
  const ingested = isIngestedKnowledge(extra);
  if (params.ingestedOnly && !ingested) return false;

  const rawCollection = normalizeCollectionFromExtra(extra);
  const tagCollection = sanitizeTagValue(rawCollection, "");
  if (params.collectionFilterRaw.size > 0 || params.collectionFilterTag.size > 0) {
    const rawLower = rawCollection.toLowerCase();
    const wanted =
      (rawLower && params.collectionFilterRaw.has(rawLower)) ||
      (tagCollection && params.collectionFilterTag.has(tagCollection));
    if (!wanted) return false;
  }

  const sourceFile = normalizeOptionalString(extra.sourceFile);
  if (params.sourceFileFilter) {
    const sourceFileLower = sourceFile.toLowerCase();
    if (params.sourceFileExact) {
      if (sourceFileLower !== params.sourceFileFilter) return false;
    } else if (!sourceFileLower.includes(params.sourceFileFilter)) {
      return false;
    }
  }

  if (!params.query) return true;
  const summaryText = stripCitation(candidate.summary).toLowerCase();
  const docTitle = normalizeOptionalString(extra.docTitle).toLowerCase();
  const citation = parseCitation(candidate.summary, extra.citation)?.toLowerCase() ?? "";
  const sourceTag = normalizeOptionalString(extra.sourceTag).toLowerCase();
  return (
    summaryText.includes(params.query) ||
    docTitle.includes(params.query) ||
    sourceFile.toLowerCase().includes(params.query) ||
    rawCollection.toLowerCase().includes(params.query) ||
    sourceTag.includes(params.query) ||
    citation.includes(params.query)
  );
}

function distinctKnowledgeRowsByDocument<
  T extends { documentId?: string | null; sourceFile?: string | null },
>(rows: T[]): T[] {
  const deduped = new Map<string, T>();
  for (const row of rows) {
    const key = normalizeOptionalString(row.documentId || row.sourceFile) || "";
    if (!key) continue;
    if (!deduped.has(key)) deduped.set(key, row);
  }
  const values = [...deduped.values()];
  if (values.length === 0) return rows;
  return values;
}

function isLikelyBase64(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length % 4 !== 0) return false;
  return !/[^A-Za-z0-9+/=]/.test(trimmed);
}

function stripDataUrlPrefix(value: string): string {
  const trimmed = String(value ?? "").trim();
  const m = /^data:[^;]+;base64,(.*)$/i.exec(trimmed);
  return m ? m[1] : trimmed;
}

function chunkTextForIngest(
  text: string,
  chunkSize: number,
  overlap: number,
): Array<{ start: number; end: number; text: string }> {
  const content = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!content) return [];

  const chunks: Array<{ start: number; end: number; text: string }> = [];
  const size = Math.max(300, Math.min(12000, Number(chunkSize) || 1800));
  const ov = Math.max(0, Math.min(size - 1, Number(overlap) || 200));

  let start = 0;
  while (start < content.length) {
    const end = Math.min(content.length, start + size);
    chunks.push({ start, end, text: content.slice(start, end) });
    if (end >= content.length) break;
    start = Math.max(0, end - ov);
  }
  return chunks;
}

function buildLimitsForMime(mimeType: string): InputFileLimits {
  const allowed = new Set(
    DEFAULT_INPUT_FILE_MIMES.map((m) => normalizeMimeType(m)).filter(Boolean) as string[],
  );
  for (const m of EXTRA_TEXT_MIMES) {
    const normalized = normalizeMimeType(m);
    if (normalized) allowed.add(normalized);
  }
  if (mimeType.startsWith("text/")) {
    allowed.add(mimeType);
  }
  return {
    allowUrl: false,
    allowedMimes: allowed,
    maxBytes: DEFAULT_INPUT_FILE_MAX_BYTES,
    maxChars: DEFAULT_INPUT_FILE_MAX_CHARS,
    maxRedirects: DEFAULT_INPUT_MAX_REDIRECTS,
    timeoutMs: DEFAULT_INPUT_TIMEOUT_MS,
    pdf: {
      maxPages: DEFAULT_INPUT_PDF_MAX_PAGES,
      maxPixels: DEFAULT_INPUT_PDF_MAX_PIXELS,
      minTextChars: DEFAULT_INPUT_PDF_MIN_TEXT_CHARS,
    },
  };
}

async function extractIngestText(file: KnowledgeIngestFile): Promise<string> {
  const fileName = String(file.fileName || "file");
  const mimeType = normalizeMimeType(file.mimeType) ?? "application/octet-stream";
  const raw = String(file.content || "");
  if (!raw.trim()) {
    throw new Error(`empty content (${fileName})`);
  }

  // Text files from chat attachments are plain UTF-8, not base64.
  if (isRawTextMime(mimeType) && !isLikelyBase64(raw)) {
    const bytes = Buffer.byteLength(raw, "utf8");
    if (bytes > DEFAULT_INPUT_FILE_MAX_BYTES) {
      throw new Error(`file too large: ${bytes} bytes (limit: ${DEFAULT_INPUT_FILE_MAX_BYTES})`);
    }
    return raw.slice(0, DEFAULT_INPUT_FILE_MAX_CHARS);
  }

  const payload = stripDataUrlPrefix(raw);
  if (!isLikelyBase64(payload)) {
    throw new Error(`invalid attachment payload (${fileName})`);
  }

  const limits = buildLimitsForMime(mimeType);
  const extracted = await extractFileContentFromSource({
    source: {
      type: "base64",
      data: payload,
      mediaType: mimeType,
      filename: fileName,
    },
    limits,
  });

  return String(extracted.text || "");
}

function resolveVaultRoot(input: string): string {
  const trimmed = normalizeOptionalString(input);
  if (!trimmed) return "";
  if (trimmed === "~") {
    return process.env.HOME ?? "";
  }
  if (trimmed.startsWith("~/")) {
    return path.join(process.env.HOME ?? "", trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

function normalizeVaultRelativePath(input: string): string {
  const normalized = String(input || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .trim();
  if (!normalized) return "";
  if (normalized.endsWith("/**")) {
    return normalized.slice(0, -3);
  }
  return normalized;
}

function shouldExcludeVaultPath(relativePath: string, excludedPaths: string[]): boolean {
  const normalizedRelative = normalizeVaultRelativePath(relativePath).toLowerCase();
  if (!normalizedRelative) return false;
  for (const excluded of excludedPaths) {
    const normalizedExcluded = normalizeVaultRelativePath(excluded).toLowerCase();
    if (!normalizedExcluded) continue;
    if (
      normalizedRelative === normalizedExcluded ||
      normalizedRelative.startsWith(`${normalizedExcluded}/`)
    ) {
      return true;
    }
  }
  return false;
}

async function collectVaultMarkdownFiles(params: {
  rootPath: string;
  excludedPaths: string[];
  limitFiles: number;
}): Promise<KnowledgeIngestFile[]> {
  const files: KnowledgeIngestFile[] = [];
  const rootPath = path.resolve(params.rootPath);

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, "/");
      if (!relativePath || relativePath.startsWith("..")) continue;
      if (shouldExcludeVaultPath(relativePath, params.excludedPaths)) continue;

      if (entry.isDirectory()) {
        await walk(absolutePath);
        if (files.length >= params.limitFiles) return;
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
        continue;
      }

      const content = await fs.readFile(absolutePath, "utf8");
      files.push({
        fileName: relativePath,
        mimeType: "text/markdown",
        content,
      });
      if (files.length >= params.limitFiles) return;
    }
  }

  await walk(rootPath);
  return files;
}

async function ingestKnowledgeFiles(params: {
  files: KnowledgeIngestFile[];
  options: KnowledgeIngestOptions;
  sessionKey?: string;
  config: ReturnType<typeof loadConfig>;
  source: "knowledge_ingest" | "vault";
  defaultCollection?: string;
}): Promise<{
  success: true;
  collection: string;
  agentId: string;
  acceptedFiles: number;
  rejectedFiles: number;
  totalChunks: number;
  embeddedChunks: number;
  ingested: Array<{
    id: string;
    fileName: string;
    chunk: number;
    total: number;
    citation: string;
  }>;
  errors: Array<{ fileName: string; error: string }>;
}> {
  const cfg = params.config;
  const enforceEmbeddingContract = shouldEnforceV3EmbeddingContract(cfg);
  const { sessionAgentId } = resolveSessionAgentIds({ sessionKey: params.sessionKey, config: cfg });

  const memory = await getPgKnowledgeMemory(sessionAgentId);
  const embedder = enforceEmbeddingContract
    ? await getMemuEmbedder(cfg)
    : await getMemuEmbedder(cfg).catch(() => null);

  const requestedCollection =
    normalizeOptionalString(params.options.collection) ||
    normalizeOptionalString(params.defaultCollection);
  const collection = normalizeKnowledgeCollection(requestedCollection || undefined);
  const chunkSize = Math.max(300, Math.min(12000, Number(params.options.chunkSize) || 1800));
  const overlap = Math.max(0, Math.min(chunkSize - 1, Number(params.options.overlap) || 200));
  const itemExtra = normalizeIngestItemExtra(params.options.itemExtra);
  const collectionTag = knowledgeCollectionTag(collection, "default");
  const collectionAccess = await ensureKnowledgeCollectionAccess({
    agentId: sessionAgentId,
    collection,
    createIfMissing: true,
  });
  if (collectionAccess.aclEnforced && !collectionAccess.canWrite) {
    throw new Error(`No write access to knowledge collection: ${collection}`);
  }

  let acceptedFiles = 0;
  let rejectedFiles = 0;
  let totalChunks = 0;
  const errors: Array<{ fileName: string; error: string }> = [];
  let embeddedChunks = 0;
  const ingested: Array<{
    id: string;
    fileName: string;
    chunk: number;
    total: number;
    citation: string;
  }> = [];

  for (const file of params.files) {
    const fileName = String(file.fileName || "file");
    try {
      const extractedText = await extractIngestText(file);
      const chunks = chunkTextForIngest(extractedText, chunkSize, overlap);
      if (chunks.length === 0) {
        rejectedFiles += 1;
        errors.push({ fileName, error: "no extractable text" });
        continue;
      }

      acceptedFiles += 1;
      const sourceTag = sanitizeTagValue(fileName, "file");
      const resource = await memory.createResource({
        url: `kb://${collectionTag}/${encodeURIComponent(fileName)}`,
        modality: "text",
        caption: `Knowledge ingest source (${collection}): ${fileName}`,
      });

      for (let idx = 0; idx < chunks.length; idx += 1) {
        const chunk = chunks[idx];
        const chunkNumber = idx + 1;
        const citation = `${fileName}#chunk-${chunkNumber}`;
        const item = await memory.createItem({
          resourceId: resource.id,
          memoryType: "knowledge",
          summary: `[[citation:${citation}]]\n${chunk.text}`,
          significance: "noteworthy",
          agentId: sessionAgentId,
          extra: {
            source: params.source,
            collection,
            collectionTag,
            sourceFile: fileName,
            sourceTag,
            citation,
            chunkIndex: chunkNumber,
            chunkTotal: chunks.length,
            chunkStart: chunk.start,
            chunkEnd: chunk.end,
            ingestVersion: 1,
            ingestedAt: new Date().toISOString(),
            ...(params.source === "vault" ? { vaultPath: fileName } : {}),
            ...itemExtra,
          },
        });
        if (embedder) {
          try {
            const vec = await embedder.embed(`${fileName}\n\n${chunk.text}`);
            await memory.updateItemEmbedding(item.id, vec);
            embeddedChunks += 1;
          } catch (err) {
            if (enforceEmbeddingContract) {
              throw err;
            }
            // non-fatal: chunk is stored even if embedding fails
          }
        }
        ingested.push({
          id: item.id,
          fileName,
          chunk: chunkNumber,
          total: chunks.length,
          citation,
        });
      }
      totalChunks += chunks.length;
    } catch (err) {
      if (enforceEmbeddingContract) {
        throw err;
      }
      rejectedFiles += 1;
      errors.push({
        fileName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    success: true,
    collection,
    agentId: sessionAgentId,
    acceptedFiles,
    rejectedFiles,
    totalChunks,
    embeddedChunks,
    ingested: ingested.slice(0, 500),
    errors,
  };
}

export const knowledgeHandlers: GatewayRequestHandlers = {
  "knowledge.ingest": async ({ params, respond }) => {
    try {
      const files = Array.isArray(params.files) ? (params.files as KnowledgeIngestFile[]) : [];
      const options =
        params.options && typeof params.options === "object"
          ? (params.options as KnowledgeIngestOptions)
          : {};
      const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;

      if (files.length === 0) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "files[] is required"));
        return;
      }

      const cfg = loadConfig();
      const result = await ingestKnowledgeFiles({
        files,
        options,
        sessionKey,
        config: cfg,
        source: "knowledge_ingest",
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "knowledge.vault.ingest": async ({ params, respond }) => {
    try {
      const options =
        params.options && typeof params.options === "object"
          ? (params.options as KnowledgeVaultIngestOptions)
          : {};
      const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;
      const cfg = loadConfig();
      const vaultConfig = cfg.memory?.vault;
      const vaultIngest = vaultConfig?.ingest;
      if (!vaultConfig?.enabled || vaultIngest?.enabled !== true) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "vault ingest is disabled"),
        );
        return;
      }

      const rootPath = resolveVaultRoot(vaultConfig.path ?? "");
      if (!rootPath) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "memory.vault.path is required"),
        );
        return;
      }

      const stat = await fs.stat(rootPath).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "vault path is not a directory"),
        );
        return;
      }

      const excludedPaths = Array.isArray(vaultIngest.excludePaths)
        ? vaultIngest.excludePaths.filter((entry): entry is string => typeof entry === "string")
        : [];
      const limitFiles = Math.max(1, Math.min(5000, Number(options.limitFiles) || 250));
      const files = await collectVaultMarkdownFiles({
        rootPath,
        excludedPaths,
        limitFiles,
      });

      if (options.dryRun === true) {
        respond(
          true,
          {
            success: true,
            dryRun: true,
            rootPath,
            count: files.length,
            files: files.slice(0, 500).map((file) => String(file.fileName || "")),
          },
          undefined,
        );
        return;
      }

      const result = await ingestKnowledgeFiles({
        files,
        options,
        sessionKey,
        config: cfg,
        source: "vault",
        defaultCollection:
          normalizeOptionalString(vaultConfig.knowledgeCollection) || "vault-knowledge",
      });
      respond(
        true,
        {
          ...result,
          rootPath,
          source: "vault",
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "knowledge.search": async ({ params, respond }) => {
    try {
      const query = String(params.query || "").trim();
      if (!query) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "query is required"));
        return;
      }

      const options =
        params.options && typeof params.options === "object"
          ? (params.options as KnowledgeSearchOptions)
          : {};
      const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;
      const cfg = loadConfig();
      const { sessionAgentId } = resolveSessionAgentIds({ sessionKey, config: cfg });

      const memory = await getPgKnowledgeMemory(sessionAgentId);
      const resolvedIntent = resolveEffectiveIntentForAgentIfAvailable({
        config: cfg,
        agentId: sessionAgentId,
      });

      const limit = Math.max(1, Math.min(100, Number(options.limit) || 12));
      const includeShared = options.includeShared === true;
      const ingestedOnly = options.ingestedOnly !== false;
      const explicitCollectionFilters = parseCollectionFilter(options.collection)
        .map((entry) => normalizeKnowledgeCollection(entry, ""))
        .filter(Boolean);
      let collectionFilters = inferDepartmentKnowledgeCollections({
        departmentId: resolvedIntent?.departmentId,
        query,
        explicitCollections: explicitCollectionFilters,
      })
        .map((entry) => normalizeKnowledgeCollection(entry, ""))
        .filter(Boolean);
      const autoRoutedCollections =
        explicitCollectionFilters.length === 0 && collectionFilters.length > 0;

      if (collectionFilters.length > 0) {
        const allowedCollections: string[] = [];
        for (const requestedCollection of collectionFilters) {
          const access = await ensureKnowledgeCollectionAccess({
            agentId: sessionAgentId,
            collection: requestedCollection,
            createIfMissing: false,
          });
          if (access.aclEnforced && !access.canRead) {
            if (autoRoutedCollections) {
              continue;
            }
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                `No read access to knowledge collection: ${requestedCollection}`,
              ),
            );
            return;
          }
          allowedCollections.push(requestedCollection);
        }
        collectionFilters = allowedCollections;
      }

      const collectionRaw = new Set(collectionFilters.map((entry) => entry.toLowerCase()));
      const collectionTags = new Set(
        collectionFilters.map((entry) => sanitizeTagValue(entry, "")).filter(Boolean),
      );

      const fetchLimit = Math.max(limit * 6, 30);
      const ownHits = await memory.searchByKeyword(query, fetchLimit);
      const merged = [...ownHits];

      if (includeShared && memory.searchByKeywordShared) {
        try {
          const sharedHits = await memory.searchByKeywordShared(query, fetchLimit);
          if (Array.isArray(sharedHits) && sharedHits.length > 0) {
            merged.push(...sharedHits);
          }
        } catch {
          // Shared search is optional.
        }
      }

      const deduped = new Map<string, (typeof merged)[number]>();
      for (const hit of merged) {
        if (!hit?.item?.id) continue;
        const existing = deduped.get(hit.item.id);
        if (!existing || (hit.score ?? 0) > (existing.score ?? 0)) {
          deduped.set(hit.item.id, hit);
        }
      }

      const dedupedHits = [...deduped.values()];
      const autoCreateCollections = includeShared
        ? []
        : dedupedHits
            .map((hit) => {
              const extra = getItemExtra(hit.item);
              if (!isIngestedKnowledge(extra)) return null;
              if (typeof extra.collection === "string" && extra.collection.trim()) {
                return extra.collection;
              }
              if (typeof extra.collectionTag === "string" && extra.collectionTag.trim()) {
                return extra.collectionTag;
              }
              return null;
            })
            .filter((value): value is string => Boolean(value));

      const aclSnapshot = await getKnowledgeAclSnapshot({
        agentId: sessionAgentId,
        autoCreateCollections,
      });

      const candidates = dedupedHits.filter((hit) => {
        if (hit.item.memoryType !== "knowledge") return false;
        const extra = getItemExtra(hit.item);
        const ingested = isIngestedKnowledge(extra);
        if (ingestedOnly && !ingested) return false;
        if (ingested) {
          const collectionValue =
            typeof extra.collection === "string" && extra.collection.trim()
              ? extra.collection
              : typeof extra.collectionTag === "string"
                ? extra.collectionTag
                : "";
          if (!hasKnowledgeCollectionReadAccess(aclSnapshot, collectionValue)) return false;
        }

        if (collectionFilters.length === 0) return true;
        const rawCollection =
          typeof extra.collection === "string" ? extra.collection.toLowerCase() : "";
        const tagCollection =
          typeof extra.collectionTag === "string"
            ? sanitizeTagValue(extra.collectionTag, "")
            : sanitizeTagValue(rawCollection, "");
        if (rawCollection && collectionRaw.has(rawCollection)) return true;
        if (tagCollection && collectionTags.has(tagCollection)) return true;
        return false;
      });

      candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const sliced = candidates.slice(0, limit);

      const results = await Promise.all(
        sliced.map(async (hit) => {
          const item = hit.item;
          const extra = getItemExtra(item);
          const summary = String(item.summary || "");
          const citation = parseCitation(summary, extra.citation);
          const categories = await memory
            .getItemCategories(item.id)
            .then((rows) => rows.map((row) => row.name))
            .catch(() => []);
          const snippet = stripCitation(summary);
          const rawDocumentTags = Array.isArray(extra.docTags)
            ? extra.docTags
            : Array.isArray(extra.tags)
              ? extra.tags
              : [];
          const documentTags = rawDocumentTags
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean);
          return {
            id: item.id,
            score: Math.round((hit.score ?? 0) * 1000) / 1000,
            summary: snippet.length > 600 ? `${snippet.slice(0, 600)}...` : snippet,
            type: item.memoryType,
            citation,
            collection: typeof extra.collection === "string" ? extra.collection : null,
            sourceFile: typeof extra.sourceFile === "string" ? extra.sourceFile : null,
            chunkIndex: typeof extra.chunkIndex === "number" ? extra.chunkIndex : null,
            chunkTotal: typeof extra.chunkTotal === "number" ? extra.chunkTotal : null,
            documentId: normalizeOptionalString(extra.docId) || null,
            documentTitle: normalizeOptionalString(extra.docTitle) || null,
            documentType: normalizeOptionalString(extra.docType) || null,
            documentLanguage: normalizeOptionalString(extra.docLanguage) || null,
            documentCreatedAt: normalizeOptionalString(extra.docCreatedAt) || null,
            documentTags,
            categories,
            createdAt: item.createdAt,
          };
        }),
      );

      respond(
        true,
        {
          success: true,
          query,
          agentId: sessionAgentId,
          count: results.length,
          totalMatched: candidates.length,
          limit,
          collection: collectionFilters.length ? collectionFilters : undefined,
          collectionRouting:
            autoRoutedCollections && collectionFilters.length > 0
              ? {
                  auto: true,
                  departmentId: resolvedIntent?.departmentId ?? null,
                }
              : undefined,
          includeShared,
          ingestedOnly,
          aclEnforced: aclSnapshot.aclEnforced,
          results,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "knowledge.library.list": async ({ params, respond }) => {
    try {
      const options =
        params.options && typeof params.options === "object"
          ? (params.options as KnowledgeLibraryListOptions)
          : {};
      const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;
      const cfg = loadConfig();
      const enforceEmbeddingContract = shouldEnforceV3EmbeddingContract(cfg);
      const { sessionAgentId } = resolveSessionAgentIds({ sessionKey, config: cfg });
      const memory = await getPgKnowledgeMemory(sessionAgentId);

      const query = normalizeOptionalString(options.q).toLowerCase();
      const sourceFileFilter = normalizeOptionalString(options.sourceFile).toLowerCase();
      const sourceFileExact = options.sourceFileExact === true;
      const ingestedOnly = options.ingestedOnly !== false;
      const limit = Math.max(1, Math.min(2000, Number(options.limit) || 500));
      const sort = options.sort === "title" || options.sort === "type" ? options.sort : "savedAt";
      const order = options.order === "asc" ? "asc" : "desc";
      const includeFullText = options.includeFullText === true;
      const distinctByDocument = options.distinctByDocument === true;
      const collectionFilters = parseCollectionFilter(options.collection)
        .map((entry) => normalizeKnowledgeCollection(entry, ""))
        .filter(Boolean);
      const collectionFilterRaw = new Set(collectionFilters.map((entry) => entry.toLowerCase()));
      const collectionFilterTag = new Set(
        collectionFilters.map((entry) => sanitizeTagValue(entry, "")).filter(Boolean),
      );

      const requestedScanLimit = Number(options.scanLimit);
      const defaultScanLimit = sourceFileFilter
        ? Math.max(limit * 2, 800)
        : distinctByDocument
          ? Math.max(limit * 25, 4000)
          : Math.max(limit * 4, 3000);
      const scanLimit = Number.isFinite(requestedScanLimit)
        ? Math.max(200, Math.min(50_000, Math.trunc(requestedScanLimit)))
        : Math.min(50_000, defaultScanLimit);
      const items = await memory.listItems({ memoryType: "knowledge", limit: scanLimit });
      const candidates = items
        .map((item) => libraryCandidateFromItem(item))
        .filter((row): row is LibraryCandidate => Boolean(row));

      const autoCreateCollections = candidates
        .map((candidate) => {
          if (!isIngestedKnowledge(candidate.extra)) return null;
          const collection = normalizeCollectionFromExtra(candidate.extra);
          return collection || null;
        })
        .filter((value): value is string => Boolean(value));

      const aclSnapshot = await getKnowledgeAclSnapshot({
        agentId: sessionAgentId,
        autoCreateCollections,
      });

      const filtered = candidates.filter((candidate) => {
        const extra = candidate.extra;
        const ingested = isIngestedKnowledge(extra);
        if (ingested) {
          const collection = normalizeCollectionFromExtra(extra);
          if (!hasKnowledgeCollectionReadAccess(aclSnapshot, collection)) return false;
        }
        return matchesLibraryFilter(candidate, {
          query,
          sourceFileFilter,
          sourceFileExact,
          collectionFilterRaw,
          collectionFilterTag,
          ingestedOnly,
        });
      });

      const rows = filtered
        .map((candidate) => {
          const extra = candidate.extra;
          const collection = normalizeCollectionFromExtra(extra);
          const sourceFile = normalizeOptionalString(extra.sourceFile) || null;
          const citation = parseCitation(candidate.summary, extra.citation);
          const stripped = stripCitation(candidate.summary);
          const excerpt = stripped.slice(0, 260);
          const documentId = normalizeOptionalString(extra.docId) || null;
          const documentTitle = normalizeOptionalString(extra.docTitle) || null;
          const documentType = normalizeOptionalString(extra.docType) || null;
          const documentLanguage = normalizeOptionalString(extra.docLanguage) || null;
          const documentCreatedAt = normalizeOptionalString(extra.docCreatedAt) || null;
          const rawDocumentTags = Array.isArray(extra.docTags)
            ? extra.docTags
            : Array.isArray(extra.tags)
              ? extra.tags
              : [];
          const documentTags = rawDocumentTags
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const title =
            documentTitle ||
            (sourceFile &&
            typeof extra.chunkIndex === "number" &&
            typeof extra.chunkTotal === "number"
              ? `${sourceFile} (${extra.chunkIndex}/${extra.chunkTotal})`
              : sourceFile || `knowledge:${candidate.id.slice(0, 8)}`);
          return {
            id: candidate.id,
            title,
            type: candidate.memoryType,
            sourceType: isIngestedKnowledge(extra) ? "ingested" : "memory",
            collection: collection || null,
            sourceFile,
            citation,
            chunkIndex: typeof extra.chunkIndex === "number" ? extra.chunkIndex : null,
            chunkTotal: typeof extra.chunkTotal === "number" ? extra.chunkTotal : null,
            savedAt: candidate.createdAt,
            excerpt,
            fullText: includeFullText ? stripped : undefined,
            documentId,
            documentTitle,
            documentType,
            documentLanguage,
            documentCreatedAt,
            documentTags,
          };
        })
        .sort((a, b) => {
          let cmp = 0;
          if (sort === "title") cmp = a.title.localeCompare(b.title);
          else if (sort === "type") cmp = a.type.localeCompare(b.type);
          else cmp = new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime();
          return order === "asc" ? cmp : -cmp;
        });

      const listedRows = distinctByDocument ? distinctKnowledgeRowsByDocument(rows) : rows;
      const stats = {
        total: listedRows.length,
        ingested: listedRows.filter((row) => row.sourceType === "ingested").length,
        memory: listedRows.filter((row) => row.sourceType === "memory").length,
      };

      respond(
        true,
        {
          success: true,
          agentId: sessionAgentId,
          aclEnforced: aclSnapshot.aclEnforced,
          query,
          sort,
          order,
          total: listedRows.length,
          stats,
          rows: listedRows.slice(0, limit),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "knowledge.library.delete": async ({ params, respond }) => {
    try {
      const options =
        params.options && typeof params.options === "object"
          ? (params.options as KnowledgeLibraryDeleteOptions)
          : {};
      const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;
      const cfg = loadConfig();
      const { sessionAgentId } = resolveSessionAgentIds({ sessionKey, config: cfg });
      const memory = await getPgKnowledgeMemory(sessionAgentId);

      const limit = Math.max(1, Math.min(2000, Number(options.limit) || 500));
      const query = normalizeOptionalString(options.q).toLowerCase();
      const sourceFileFilter = normalizeOptionalString(options.sourceFile).toLowerCase();
      const ingestedOnly = true;
      const dryRun = options.dryRun === true;
      const explicitIds = Array.isArray(options.ids)
        ? options.ids.map((entry) => normalizeOptionalString(entry)).filter(Boolean)
        : [];
      const collectionFilters = parseCollectionFilter(options.collection)
        .map((entry) => normalizeKnowledgeCollection(entry, ""))
        .filter(Boolean);
      const collectionFilterRaw = new Set(collectionFilters.map((entry) => entry.toLowerCase()));
      const collectionFilterTag = new Set(
        collectionFilters.map((entry) => sanitizeTagValue(entry, "")).filter(Boolean),
      );

      const scanLimit = explicitIds.length > 0 ? explicitIds.length : Math.max(limit * 4, 3000);
      const items = await memory.listItems({ memoryType: "knowledge", limit: scanLimit });
      const candidates = items
        .map((item) => libraryCandidateFromItem(item))
        .filter((row): row is LibraryCandidate => Boolean(row));

      const autoCreateCollections = candidates
        .map((candidate) => {
          if (!isIngestedKnowledge(candidate.extra)) return null;
          const collection = normalizeCollectionFromExtra(candidate.extra);
          return collection || null;
        })
        .filter((value): value is string => Boolean(value));
      const aclSnapshot = await getKnowledgeAclSnapshot({
        agentId: sessionAgentId,
        autoCreateCollections,
      });

      const selected = candidates.filter((candidate) => {
        const extra = candidate.extra;
        const collection = normalizeCollectionFromExtra(extra);
        if (
          isIngestedKnowledge(extra) &&
          !aclSnapshot.writableTags.has(knowledgeCollectionTag(collection, ""))
        ) {
          return false;
        }
        if (explicitIds.length > 0) return explicitIds.includes(candidate.id);
        return matchesLibraryFilter(candidate, {
          query,
          sourceFileFilter,
          sourceFileExact: false,
          collectionFilterRaw,
          collectionFilterTag,
          ingestedOnly,
        });
      });

      const limited = selected.slice(0, limit);
      if (dryRun) {
        respond(
          true,
          {
            success: true,
            dryRun: true,
            matched: selected.length,
            selected: limited.length,
            ids: limited.map((row) => row.id),
          },
          undefined,
        );
        return;
      }

      let deleted = 0;
      const failed: Array<{ id: string; error: string }> = [];
      for (const row of limited) {
        try {
          const ok = await memory.deleteItem(row.id);
          if (ok) deleted += 1;
        } catch (err) {
          failed.push({
            id: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      respond(
        true,
        {
          success: true,
          matched: selected.length,
          deleted,
          failed,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "knowledge.library.reindex": async ({ params, respond }) => {
    try {
      const options =
        params.options && typeof params.options === "object"
          ? (params.options as KnowledgeLibraryReindexOptions)
          : {};
      const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;
      const cfg = loadConfig();
      const enforceEmbeddingContract = shouldEnforceV3EmbeddingContract(cfg);
      const { sessionAgentId } = resolveSessionAgentIds({ sessionKey, config: cfg });
      const memory = await getPgKnowledgeMemory(sessionAgentId);

      const embedder = await getMemuEmbedder(cfg);
      const query = normalizeOptionalString(options.q).toLowerCase();
      const sourceFileFilter = normalizeOptionalString(options.sourceFile).toLowerCase();
      const ingestedOnly = true;
      const onlyMissing = options.onlyMissing !== false;
      const limit = Math.max(1, Math.min(4000, Number(options.limit) || 1000));
      const collectionFilters = parseCollectionFilter(options.collection)
        .map((entry) => normalizeKnowledgeCollection(entry, ""))
        .filter(Boolean);
      const collectionFilterRaw = new Set(collectionFilters.map((entry) => entry.toLowerCase()));
      const collectionFilterTag = new Set(
        collectionFilters.map((entry) => sanitizeTagValue(entry, "")).filter(Boolean),
      );

      const scanLimit = Math.max(limit * 3, 4000);
      const items = await memory.listItems({ memoryType: "knowledge", limit: scanLimit });
      const candidates = items
        .map((item) => libraryCandidateFromItem(item))
        .filter((row): row is LibraryCandidate => Boolean(row));

      const autoCreateCollections = candidates
        .map((candidate) => {
          if (!isIngestedKnowledge(candidate.extra)) return null;
          const collection = normalizeCollectionFromExtra(candidate.extra);
          return collection || null;
        })
        .filter((value): value is string => Boolean(value));
      const aclSnapshot = await getKnowledgeAclSnapshot({
        agentId: sessionAgentId,
        autoCreateCollections,
      });

      const selected = candidates
        .filter((candidate) => {
          const extra = candidate.extra;
          const collection = normalizeCollectionFromExtra(extra);
          if (
            isIngestedKnowledge(extra) &&
            !aclSnapshot.writableTags.has(knowledgeCollectionTag(collection, ""))
          ) {
            return false;
          }
          return matchesLibraryFilter(candidate, {
            query,
            sourceFileFilter,
            sourceFileExact: false,
            collectionFilterRaw,
            collectionFilterTag,
            ingestedOnly,
          });
        })
        .slice(0, limit);

      let processed = 0;
      let embedded = 0;
      let skipped = 0;
      const failed: Array<{ id: string; error: string }> = [];
      for (const row of selected) {
        processed += 1;
        if (onlyMissing) {
          const item = items.find((candidate) => candidate.id === row.id);
          if (item && Array.isArray(item.embedding) && item.embedding.length > 0) {
            skipped += 1;
            continue;
          }
        }
        try {
          const cleanText = stripCitation(row.summary);
          if (!cleanText) {
            skipped += 1;
            continue;
          }
          const vec = await embedder.embed(cleanText);
          await memory.updateItemEmbedding(row.id, vec);
          embedded += 1;
        } catch (err) {
          if (enforceEmbeddingContract) {
            throw err;
          }
          failed.push({
            id: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      respond(
        true,
        {
          success: true,
          processed,
          embedded,
          skipped,
          failed,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "knowledge.collections.list": async ({ params, respond }) => {
    try {
      const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;
      const options =
        params.options && typeof params.options === "object"
          ? (params.options as KnowledgeCollectionsListOptions)
          : {};
      const includeInaccessible = options.includeInaccessible === true;
      const cfg = loadConfig();
      const { sessionAgentId } = resolveSessionAgentIds({ sessionKey, config: cfg });
      const targetAgentId = normalizeOptionalString(options.agentId) || sessionAgentId;
      const listing = await listKnowledgeCollections({ agentId: targetAgentId });
      const collections = includeInaccessible
        ? listing.collections
        : listing.collections.filter((entry) => entry.canRead || entry.canWrite || entry.isOwner);

      respond(
        true,
        {
          success: true,
          agentId: targetAgentId,
          actorAgentId: sessionAgentId,
          aclEnforced: listing.aclEnforced,
          collections,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "knowledge.collections.grant": async ({ params, respond }) => {
    try {
      const options =
        params.options && typeof params.options === "object"
          ? (params.options as KnowledgeCollectionsGrantOptions)
          : {};
      const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;
      const cfg = loadConfig();
      const { sessionAgentId } = resolveSessionAgentIds({ sessionKey, config: cfg });
      const actorAgentId = normalizeOptionalString(options.actorAgentId) || sessionAgentId;

      const collection = normalizeKnowledgeCollection(options.collection, "");
      if (!collection) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "collection is required"));
        return;
      }

      const targetAgentId =
        typeof options.agentId === "string" && options.agentId.trim() ? options.agentId.trim() : "";
      if (!targetAgentId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId is required"));
        return;
      }

      const canRead = options.canRead !== false;
      const canWrite = options.canWrite === true;
      const isOwner = options.isOwner === true;

      const grant = await setKnowledgeCollectionGrant({
        actorAgentId,
        targetAgentId,
        collection,
        canRead,
        canWrite,
        isOwner,
      });

      respond(
        true,
        {
          success: true,
          actorAgentId,
          targetAgentId,
          collection: grant.access.collection,
          collectionTag: grant.access.collectionTag,
          aclEnforced: grant.aclEnforced,
          updated: grant.updated,
          granted: {
            canRead: isOwner ? true : canRead,
            canWrite: isOwner ? true : canWrite,
            isOwner,
          },
        },
        undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.includes("not owner")
        ? ErrorCodes.INVALID_REQUEST
        : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, message));
    }
  },
};
