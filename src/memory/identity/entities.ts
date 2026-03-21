/**
 * Identity System — Entity Management
 *
 * Entity resolution, NER extraction, profile generation,
 * bond calibration, and auto-linking.
 */

import type { ArgentConfig } from "../../config/config.js";
import type { MemoryAdapter } from "../../data/adapter.js";
import type { Entity, EntityType, MemoryItem } from "../memu-types.js";
import { callIdentityLlm } from "./llm.js";
import { ENTITY_EXTRACTION_PROMPT, buildEntityProfilePrompt } from "./prompts.js";

const LOW_VALUE_ENTITY_PATTERNS: RegExp[] = [
  /^(utc|gmt|api|json|http|https|url|uuid|sql)$/i,
  /^\d{4,}$/,
  /^[a-f0-9]{8,}$/i,
  /^(cron|cron job|cron jobs|heartbeat|monitoring|automation|automated operations|automated scheduling)$/i,
  /^(schedule|scheduling|timezone|time zone)$/i,
  /^[A-Z]{2,3}$/,
];

const LOW_VALUE_ENTITY_TOKENS = new Set([
  "activity",
  "alerting",
  "alerts",
  "ops",
  "operations",
  "memory",
  "system",
  "report",
  "reports",
]);

function normalizeEntityAliasName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function canUseAsCanonicalPersonAlias(name: string): boolean {
  return /^[A-Za-z][A-Za-z'-]*$/.test(name.trim());
}

function findCanonicalPersonAlias(params: {
  name: string;
  candidates: Array<Pick<Entity, "name" | "entityType" | "memoryCount">>;
}): string | null {
  const normalized = params.name.trim().replace(/\s+/g, " ");
  if (!canUseAsCanonicalPersonAlias(normalized) || normalized.includes(" ")) {
    return null;
  }

  const folded = normalizeEntityAliasName(normalized);
  const matches = params.candidates.filter((candidate) => {
    if (candidate.entityType !== "person") {
      return false;
    }
    if (candidate.name.includes("(") || candidate.name.includes(")")) {
      return false;
    }
    const candidateParts = candidate.name.trim().split(/\s+/);
    return (
      candidateParts.length >= 2 && normalizeEntityAliasName(candidateParts[0] ?? "") === folded
    );
  });

  if (matches.length !== 1) {
    return null;
  }

  const match = matches[0];
  if ((match.memoryCount ?? 0) < 5) {
    return null;
  }
  return match.name;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasEntityBoundaryMatch(text: string, entityName: string): boolean {
  const escaped = escapeRegex(entityName.trim());
  if (!escaped) {
    return false;
  }
  const boundaryPattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu");
  return boundaryPattern.test(text);
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
  if (LOW_VALUE_ENTITY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  const folded = normalized.toLowerCase().replace(/\s+/g, " ");
  if (LOW_VALUE_ENTITY_TOKENS.has(folded)) {
    return true;
  }
  const wordCount = folded.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 2 && /\b(?:job|jobs|run|runs|window|cycle)\b/i.test(folded)) {
    return true;
  }
  return false;
}

// ── Entity Resolution ──

/**
 * Find or create an entity by name. Case-insensitive lookup.
 * If the entity doesn't exist, creates it with default values.
 */
export async function resolveEntity(
  store: MemoryAdapter,
  name: string,
  defaults?: { entityType?: EntityType; relationship?: string },
): Promise<Entity> {
  const trimmedName = name.trim();
  let canonicalName = trimmedName;

  if ((defaults?.entityType ?? "person") === "person") {
    const canonicalAlias = findCanonicalPersonAlias({
      name: trimmedName,
      candidates: await store.listEntities(),
    });
    if (canonicalAlias) {
      canonicalName = canonicalAlias;
    }
  }

  return store.getOrCreateEntity(canonicalName, {
    entityType: defaults?.entityType ?? "person",
    relationship: defaults?.relationship,
  });
}

// ── Named Entity Recognition ──

interface ExtractedEntity {
  name: string;
  entityType: EntityType;
  role: string;
}

/**
 * Extract named entities from text using LLM.
 * Returns structured entity objects with name, type, and role.
 */
export async function extractEntities(
  text: string,
  config: ArgentConfig,
): Promise<ExtractedEntity[]> {
  const prompt = ENTITY_EXTRACTION_PROMPT + text;
  const response = await callIdentityLlm(prompt, "entity-extract", config);

  if (!response || response.trim().toUpperCase() === "NONE") {
    return [];
  }

  const entities: ExtractedEntity[] = [];
  for (const line of response.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("ENTITY:")) {
      continue;
    }

    const match = trimmed.match(
      /ENTITY:\s*(.+?)\s*\|\s*TYPE:\s*(person|pet|place|organization|project)\s*\|\s*ROLE:\s*(.+)/i,
    );
    if (match) {
      entities.push({
        name: match[1].trim(),
        entityType: match[2].toLowerCase() as EntityType,
        role: match[3].trim(),
      });
    }
  }

  return entities;
}

// ── Profile Generation ──

/**
 * Generate or refresh an entity's profile summary from linked memories.
 * Uses LLM to synthesize a coherent profile from all memories about the entity.
 */
export async function generateEntityProfile(
  store: MemoryAdapter,
  entityId: string,
  config: ArgentConfig,
): Promise<string | null> {
  const entity = await store.getEntity(entityId);
  if (!entity) {
    return null;
  }

  const memories = await store.getEntityItems(entityId, 50);
  if (memories.length === 0) {
    return null;
  }

  const summaries = memories.map((m) => m.summary);
  const prompt = buildEntityProfilePrompt(entity.name, summaries);
  const profile = await callIdentityLlm(prompt, "entity-profile", config);

  if (profile && profile.trim()) {
    await store.updateEntity(entityId, { profileSummary: profile.trim() });
    return profile.trim();
  }

  return null;
}

// ── Bond Calibration ──

/**
 * Calibrate bond strength based on memory patterns.
 *
 * Factors:
 * - Memory count (more memories = stronger bond)
 * - Recency (recent mentions boost bond)
 * - Emotional intensity (high-emotion memories increase bond)
 * - Significance distribution (more important memories = deeper bond)
 */
export function calibrateBondStrength(entity: Entity, memories: MemoryItem[]): number {
  if (memories.length === 0) {
    return entity.bondStrength;
  }

  // Factor 1: Memory count (logarithmic — diminishing returns)
  const countFactor = Math.min(1.0, Math.log2(memories.length + 1) / 6); // 64 memories → 1.0

  // Factor 2: Recency — most recent memory within last 7 days = 1.0, decays from there
  const mostRecent = memories.reduce((latest, m) => {
    const d = new Date(m.createdAt);
    return d > latest ? d : latest;
  }, new Date(0));
  const daysSinceLastMention = (Date.now() - mostRecent.getTime()) / (1000 * 60 * 60 * 24);
  const recencyFactor = Math.exp(-daysSinceLastMention / 30); // 30-day half-life

  // Factor 3: Emotional intensity average
  const avgIntensity =
    memories.reduce((sum, m) => sum + Math.abs(m.emotionalValence) * m.emotionalArousal, 0) /
    memories.length;
  const emotionFactor = Math.min(1.0, avgIntensity); // 0 to 1

  // Factor 4: Significance distribution
  const sigWeights = { routine: 0.1, noteworthy: 0.3, important: 0.6, core: 1.0 };
  const avgSignificance =
    memories.reduce((sum, m) => sum + (sigWeights[m.significance] ?? 0.1), 0) / memories.length;

  // Combine: weighted average with floor of 0.1 and ceiling of 1.0
  const raw =
    countFactor * 0.25 + recencyFactor * 0.25 + emotionFactor * 0.25 + avgSignificance * 0.25;
  return Math.max(0.1, Math.min(1.0, raw));
}

// ── Auto-Linking ──

/**
 * Given a new memory item, detect entities mentioned and link them.
 * Uses simple keyword matching against known entities first,
 * then falls back to LLM NER for unknown entities.
 */
export async function autoLinkEntities(
  store: MemoryAdapter,
  item: MemoryItem,
  config: ArgentConfig,
): Promise<string[]> {
  const linkedEntityIds: string[] = [];
  const text = item.summary;

  // Phase 1: Match against known entities (fast, no LLM call)
  const knownEntities = await store.listEntities();
  for (const entity of knownEntities) {
    if (isLowValueEntityName(entity.name)) {
      continue;
    }
    if (hasEntityBoundaryMatch(text, entity.name)) {
      await store.linkItemToEntity(item.id, entity.id, "mentioned");
      linkedEntityIds.push(entity.id);
    }
  }

  // Phase 2: LLM NER for potential new entities (only if summary is substantial)
  if (item.summary.length > 30) {
    try {
      const extracted = await extractEntities(item.summary, config);
      for (const ext of extracted) {
        if (isLowValueEntityName(ext.name)) {
          continue;
        }

        // Skip if already linked by name
        let alreadyLinked = false;
        for (const id of linkedEntityIds) {
          const e = await store.getEntity(id);
          if (e && e.name.toLowerCase() === ext.name.toLowerCase()) {
            alreadyLinked = true;
            break;
          }
        }
        if (alreadyLinked) {
          continue;
        }

        // Resolve (find or create) the entity
        const entity = await resolveEntity(store, ext.name, {
          entityType: ext.entityType,
          relationship: ext.role,
        });
        await store.linkItemToEntity(item.id, entity.id, ext.role);
        linkedEntityIds.push(entity.id);
      }
    } catch (err) {
      console.warn("[Identity] Entity extraction failed:", String(err));
    }
  }

  return linkedEntityIds;
}

export const __testing = {
  isLowValueEntityName,
  findCanonicalPersonAlias,
};
