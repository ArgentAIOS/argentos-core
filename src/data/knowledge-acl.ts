import type postgres from "postgres";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getPgClient } from "./pg-client.js";
import { isPostgresEnabled } from "./storage-config.js";
import { resolveRuntimeStorageConfig } from "./storage-resolver.js";

const log = createSubsystemLogger("data/knowledge-acl");

type SqlClient = ReturnType<typeof postgres>;

type AclRuntime = {
  sqlClient: SqlClient;
  tablesAvailable: boolean;
};

const TABLE_CHECK_TTL_MS = 30_000;
let cachedTableCheck: { checkedAt: number; available: boolean } | null = null;
let warnedMissingTables = false;

function shouldFailClosed(): boolean {
  if (process.env.ARGENT_KNOWLEDGE_ACL_FAIL_OPEN === "1") return false;
  if (process.env.ARGENT_KNOWLEDGE_ACL_FAIL_CLOSED === "1") return true;
  const storage = resolveRuntimeStorageConfig();
  return storage.backend === "postgres" || storage.backend === "dual";
}

export interface KnowledgeCollectionAccess {
  collection: string;
  collectionTag: string;
  collectionId: string | null;
  ownerAgentId: string | null;
  aclEnforced: boolean;
  exists: boolean;
  canRead: boolean;
  canWrite: boolean;
  isOwner: boolean;
}

export interface KnowledgeCollectionSummary {
  collection: string;
  collectionTag: string;
  collectionId: string;
  ownerAgentId: string | null;
  canRead: boolean;
  canWrite: boolean;
  isOwner: boolean;
}

export interface KnowledgeAclSnapshot {
  aclEnforced: boolean;
  readableTags: Set<string>;
  writableTags: Set<string>;
}

function normalizeAgentPrincipal(agentId: string): string {
  return String(agentId || "")
    .trim()
    .toLowerCase();
}

function resolveEquivalentAgentIds(agentId: string): [string, string | null] {
  const normalized = normalizeAgentPrincipal(agentId);
  if (!normalized) return ["", null];
  if (normalized === "main") return ["main", "argent"];
  if (normalized === "argent") return ["argent", "main"];
  return [normalized, null];
}

function agentPrincipalsMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const [l1, l2] = resolveEquivalentAgentIds(String(left || ""));
  const [r1, r2] = resolveEquivalentAgentIds(String(right || ""));
  if (!l1 || !r1) return false;
  return l1 === r1 || l1 === r2 || l2 === r1 || (l2 !== null && l2 === r2);
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultOpenAccess(collection: string, collectionTag: string): KnowledgeCollectionAccess {
  return {
    collection,
    collectionTag,
    collectionId: null,
    ownerAgentId: null,
    aclEnforced: false,
    exists: false,
    canRead: true,
    canWrite: true,
    isOwner: true,
  };
}

function defaultClosedAccess(collection: string, collectionTag: string): KnowledgeCollectionAccess {
  return {
    collection,
    collectionTag,
    collectionId: null,
    ownerAgentId: null,
    aclEnforced: true,
    exists: false,
    canRead: false,
    canWrite: false,
    isOwner: false,
  };
}

function unavailableAclAccess(
  collection: string,
  collectionTag: string,
): KnowledgeCollectionAccess {
  return shouldFailClosed()
    ? defaultClosedAccess(collection, collectionTag)
    : defaultOpenAccess(collection, collectionTag);
}

function isMissingTableError(err: unknown): boolean {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
  if (code === "42P01") return true;
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("relation") &&
    message.includes("does not exist") &&
    (message.includes("knowledge_collections") || message.includes("knowledge_collection_grants"))
  );
}

async function getAclRuntime(): Promise<AclRuntime | null> {
  const storage = resolveRuntimeStorageConfig();
  if (!isPostgresEnabled(storage) || !storage.postgres) return null;

  const sqlClient = getPgClient(storage.postgres);
  const now = Date.now();
  if (cachedTableCheck && now - cachedTableCheck.checkedAt < TABLE_CHECK_TTL_MS) {
    return {
      sqlClient,
      tablesAvailable: cachedTableCheck.available,
    };
  }

  try {
    const rows = await sqlClient`
      SELECT
        to_regclass('public.knowledge_collections') AS collections,
        to_regclass('public.knowledge_collection_grants') AS grants
    `;
    const row = rows[0] as { collections?: string | null; grants?: string | null } | undefined;
    const available = Boolean(row?.collections && row?.grants);
    cachedTableCheck = { checkedAt: now, available };
    if (!available && !warnedMissingTables) {
      warnedMissingTables = true;
      log.warn("knowledge ACL tables unavailable; running fail-open until migrations are applied");
    }
    return { sqlClient, tablesAvailable: available };
  } catch (err) {
    cachedTableCheck = { checkedAt: now, available: false };
    if (!warnedMissingTables) {
      warnedMissingTables = true;
      log.warn("knowledge ACL table check failed; running fail-open", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { sqlClient, tablesAvailable: false };
  }
}

export function normalizeKnowledgeCollection(value: unknown, fallback = "default"): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

export function knowledgeCollectionTag(value: string, fallback = "default"): string {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function boolValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "t" || normalized === "1";
  }
  return false;
}

function rowString(row: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!row) return "";
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function rowNullableString(
  row: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  const value = rowString(row, ...keys);
  return value || null;
}

async function findCollectionByTag(
  sqlClient: SqlClient,
  collectionTag: string,
): Promise<{
  id: string;
  collectionName: string;
  collectionTag: string;
  ownerAgentId: string | null;
} | null> {
  const rows = await sqlClient`
    SELECT
      id,
      collection_name AS "collectionName",
      collection_tag AS "collectionTag",
      owner_agent_id AS "ownerAgentId"
    FROM knowledge_collections
    WHERE collection_tag = ${collectionTag}
    LIMIT 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  const id = rowString(row, "id");
  const collectionName = rowString(row, "collectionName", "collection_name");
  const collectionTagValue = rowString(row, "collectionTag", "collection_tag");
  const ownerAgentId = rowNullableString(row, "ownerAgentId", "owner_agent_id");
  if (!id || !collectionTagValue || !collectionName) return null;
  return {
    id,
    collectionName,
    collectionTag: collectionTagValue,
    ownerAgentId,
  };
}

async function upsertCollectionWithOwner(
  sqlClient: SqlClient,
  collection: string,
  collectionTag: string,
  ownerAgentId: string,
): Promise<{
  id: string;
  collectionName: string;
  collectionTag: string;
  ownerAgentId: string | null;
}> {
  const inserted = await sqlClient`
    INSERT INTO knowledge_collections (
      id,
      collection_name,
      collection_tag,
      owner_agent_id,
      created_at,
      updated_at
    )
    VALUES (
      ${crypto.randomUUID()},
      ${collection},
      ${collectionTag},
      ${ownerAgentId},
      ${nowIso()},
      ${nowIso()}
    )
    ON CONFLICT (collection_tag)
    DO UPDATE SET
      collection_name = EXCLUDED.collection_name,
      owner_agent_id = COALESCE(knowledge_collections.owner_agent_id, EXCLUDED.owner_agent_id),
      updated_at = EXCLUDED.updated_at
    RETURNING
      id,
      collection_name AS "collectionName",
      collection_tag AS "collectionTag",
      owner_agent_id AS "ownerAgentId"
  `;

  const row = inserted[0] as Record<string, unknown> | undefined;
  const rowId = rowString(row, "id");
  const rowCollectionName = rowString(row, "collectionName", "collection_name");
  const rowCollectionTag = rowString(row, "collectionTag", "collection_tag");
  const rowOwnerAgentId = rowNullableString(row, "ownerAgentId", "owner_agent_id");
  if (!rowId || !rowCollectionName || !rowCollectionTag) {
    throw new Error("knowledge collection upsert returned incomplete row");
  }

  await sqlClient`
    INSERT INTO knowledge_collection_grants (
      id,
      collection_id,
      agent_id,
      can_read,
      can_write,
      is_owner,
      created_at,
      updated_at
    )
    VALUES (
      ${crypto.randomUUID()},
      ${rowId},
      ${ownerAgentId},
      true,
      true,
      true,
      ${nowIso()},
      ${nowIso()}
    )
    ON CONFLICT (collection_id, agent_id)
    DO UPDATE SET
      can_read = true,
      can_write = true,
      is_owner = true,
      updated_at = EXCLUDED.updated_at
  `;

  return {
    id: rowId,
    collectionName: rowCollectionName,
    collectionTag: rowCollectionTag,
    ownerAgentId: rowOwnerAgentId,
  };
}

async function readCollectionPermission(
  sqlClient: SqlClient,
  collectionId: string,
  agentId: string,
): Promise<{ canRead: boolean; canWrite: boolean; isOwnerGrant: boolean }> {
  const [agentPrimary, agentAlias] = resolveEquivalentAgentIds(agentId);
  const rows = await sqlClient`
    SELECT
      COALESCE(bool_or(can_read), false) AS "canRead",
      COALESCE(bool_or(can_write), false) AS "canWrite",
      COALESCE(bool_or(is_owner), false) AS "isOwner"
    FROM knowledge_collection_grants
    WHERE collection_id = ${collectionId}
      AND (
        agent_id = ${agentPrimary}
        OR agent_id = ${agentAlias}
        OR agent_id = '*'
      )
  `;

  const row = rows[0] as Record<string, unknown> | undefined;

  return {
    canRead: boolValue(row?.canRead ?? row?.can_read),
    canWrite: boolValue(row?.canWrite ?? row?.can_write),
    isOwnerGrant: boolValue(row?.isOwner ?? row?.is_owner),
  };
}

export async function ensureKnowledgeCollectionAccess(params: {
  agentId: string;
  collection: string;
  createIfMissing?: boolean;
}): Promise<KnowledgeCollectionAccess> {
  const collection = normalizeKnowledgeCollection(params.collection);
  const collectionTag = knowledgeCollectionTag(collection);
  const fallback = unavailableAclAccess(collection, collectionTag);

  const runtime = await getAclRuntime();
  if (!runtime || !runtime.tablesAvailable) return fallback;

  try {
    let collectionRow = await findCollectionByTag(runtime.sqlClient, collectionTag);

    if (
      collectionRow &&
      params.createIfMissing &&
      !normalizeAgentPrincipal(collectionRow.ownerAgentId || "")
    ) {
      collectionRow = await upsertCollectionWithOwner(
        runtime.sqlClient,
        collection,
        collectionTag,
        params.agentId,
      );
    }

    if (!collectionRow && params.createIfMissing) {
      collectionRow = await upsertCollectionWithOwner(
        runtime.sqlClient,
        collection,
        collectionTag,
        params.agentId,
      );
    }

    if (!collectionRow) {
      return {
        collection,
        collectionTag,
        collectionId: null,
        ownerAgentId: null,
        aclEnforced: true,
        exists: false,
        canRead: false,
        canWrite: false,
        isOwner: false,
      };
    }

    const grant = await readCollectionPermission(
      runtime.sqlClient,
      collectionRow.id,
      params.agentId,
    );
    const ownerMatch = agentPrincipalsMatch(collectionRow.ownerAgentId, params.agentId);

    return {
      collection: collectionRow.collectionName,
      collectionTag: collectionRow.collectionTag,
      collectionId: collectionRow.id,
      ownerAgentId: collectionRow.ownerAgentId,
      aclEnforced: true,
      exists: true,
      canRead: ownerMatch || grant.canRead,
      canWrite: ownerMatch || grant.canWrite,
      isOwner: ownerMatch || grant.isOwnerGrant,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      cachedTableCheck = { checkedAt: Date.now(), available: false };
      return fallback;
    }
    throw err;
  }
}

export async function listKnowledgeCollections(params: {
  agentId: string;
}): Promise<{ aclEnforced: boolean; collections: KnowledgeCollectionSummary[] }> {
  const runtime = await getAclRuntime();
  if (!runtime || !runtime.tablesAvailable) {
    return { aclEnforced: shouldFailClosed(), collections: [] };
  }

  try {
    const [agentPrimary, agentAlias] = resolveEquivalentAgentIds(params.agentId);
    const rows = await runtime.sqlClient`
      SELECT
        c.id,
        c.collection_name AS "collectionName",
        c.collection_tag AS "collectionTag",
        c.owner_agent_id AS "ownerAgentId",
        COALESCE(bool_or((g.agent_id = ${agentPrimary} OR g.agent_id = ${agentAlias} OR g.agent_id = '*') AND g.can_read), false) AS "canRead",
        COALESCE(bool_or((g.agent_id = ${agentPrimary} OR g.agent_id = ${agentAlias} OR g.agent_id = '*') AND g.can_write), false) AS "canWrite",
        COALESCE(bool_or((g.agent_id = ${agentPrimary} OR g.agent_id = ${agentAlias} OR g.agent_id = '*') AND g.is_owner), false) AS "grantOwner"
      FROM knowledge_collections c
      LEFT JOIN knowledge_collection_grants g
        ON g.collection_id = c.id
      GROUP BY c.id, c.collection_name, c.collection_tag, c.owner_agent_id
      ORDER BY c.collection_name ASC
    `;

    const collections = (rows as Array<Record<string, unknown>>)
      .map((row) => {
        const ownerAgentId = rowNullableString(row, "ownerAgentId", "owner_agent_id");
        const ownerMatch = agentPrincipalsMatch(ownerAgentId, params.agentId);
        return {
          collectionId: String(row.id ?? ""),
          collection: rowString(row, "collectionName", "collection_name"),
          collectionTag: rowString(row, "collectionTag", "collection_tag"),
          ownerAgentId,
          canRead: ownerMatch || boolValue(row.canRead ?? row.can_read),
          canWrite: ownerMatch || boolValue(row.canWrite ?? row.can_write),
          isOwner: ownerMatch || boolValue(row.grantOwner ?? row.grant_owner),
        };
      })
      .filter((entry) => entry.collectionId && entry.collectionTag && entry.collection);

    return { aclEnforced: true, collections };
  } catch (err) {
    if (isMissingTableError(err)) {
      cachedTableCheck = { checkedAt: Date.now(), available: false };
      return { aclEnforced: false, collections: [] };
    }
    throw err;
  }
}

export async function getKnowledgeAclSnapshot(params: {
  agentId: string;
  autoCreateCollections?: string[];
}): Promise<KnowledgeAclSnapshot> {
  const autoCreateRaw = Array.isArray(params.autoCreateCollections)
    ? params.autoCreateCollections
    : [];

  if (autoCreateRaw.length > 0) {
    const dedup = new Set<string>();
    for (const raw of autoCreateRaw) {
      const normalized = normalizeKnowledgeCollection(raw, "");
      if (!normalized) continue;
      dedup.add(normalized);
    }
    for (const collection of dedup) {
      await ensureKnowledgeCollectionAccess({
        agentId: params.agentId,
        collection,
        createIfMissing: true,
      }).catch((err) => {
        log.warn("failed to auto-register knowledge collection", {
          collection,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  const listing = await listKnowledgeCollections({ agentId: params.agentId });
  if (!listing.aclEnforced) {
    return {
      aclEnforced: false,
      readableTags: new Set<string>(),
      writableTags: new Set<string>(),
    };
  }

  const readableTags = new Set<string>();
  const writableTags = new Set<string>();
  for (const collection of listing.collections) {
    if (collection.canRead) readableTags.add(collection.collectionTag);
    if (collection.canWrite) writableTags.add(collection.collectionTag);
  }

  return {
    aclEnforced: true,
    readableTags,
    writableTags,
  };
}

export function hasKnowledgeCollectionReadAccess(
  snapshot: KnowledgeAclSnapshot,
  collection: unknown,
): boolean {
  if (!snapshot.aclEnforced) return true;
  const normalized = normalizeKnowledgeCollection(collection, "");
  if (!normalized) return false;
  const tag = knowledgeCollectionTag(normalized, "");
  if (!tag) return false;
  return snapshot.readableTags.has(tag);
}

export async function setKnowledgeCollectionGrant(params: {
  actorAgentId: string;
  targetAgentId: string;
  collection: string;
  canRead: boolean;
  canWrite: boolean;
  isOwner?: boolean;
}): Promise<{ aclEnforced: boolean; updated: boolean; access: KnowledgeCollectionAccess }> {
  const access = await ensureKnowledgeCollectionAccess({
    agentId: params.actorAgentId,
    collection: params.collection,
    createIfMissing: true,
  });

  if (!access.aclEnforced) {
    return {
      aclEnforced: false,
      updated: false,
      access,
    };
  }

  if (!access.collectionId) {
    throw new Error(`collection not found: ${params.collection}`);
  }

  if (!access.isOwner) {
    throw new Error(`agent ${params.actorAgentId} is not owner of collection ${access.collection}`);
  }

  const runtime = await getAclRuntime();
  if (!runtime || !runtime.tablesAvailable) {
    return {
      aclEnforced: shouldFailClosed(),
      updated: false,
      access,
    };
  }

  const promoteOwner = params.isOwner === true;
  const canRead = promoteOwner ? true : params.canRead || params.canWrite;
  const canWrite = promoteOwner ? true : params.canWrite;

  try {
    await runtime.sqlClient`
      INSERT INTO knowledge_collection_grants (
        id,
        collection_id,
        agent_id,
        can_read,
        can_write,
        is_owner,
        created_at,
        updated_at
      )
      VALUES (
        ${crypto.randomUUID()},
        ${access.collectionId},
        ${params.targetAgentId},
        ${canRead},
        ${canWrite},
        ${promoteOwner},
        ${nowIso()},
        ${nowIso()}
      )
      ON CONFLICT (collection_id, agent_id)
      DO UPDATE SET
        can_read = EXCLUDED.can_read,
        can_write = EXCLUDED.can_write,
        is_owner = EXCLUDED.is_owner,
        updated_at = EXCLUDED.updated_at
    `;

    return {
      aclEnforced: true,
      updated: true,
      access,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      cachedTableCheck = { checkedAt: Date.now(), available: false };
      return {
        aclEnforced: shouldFailClosed(),
        updated: false,
        access: unavailableAclAccess(access.collection, access.collectionTag),
      };
    }
    throw err;
  }
}
