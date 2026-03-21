/**
 * PG Write Mirror — Intercepts MemuStore writes and mirrors them to PostgreSQL.
 *
 * When dual-write mode is active, this module wraps MemuStore's write methods
 * so that every SQLite write also fires an async PG write (fire-and-forget).
 *
 * This avoids changing 26+ call sites that use getMemuStore() directly.
 * Instead, the mirror is installed once at gateway startup via enablePgWriteMirror().
 *
 * Write methods mirrored:
 *   - createItem → memory.createItem
 *   - createResource (via createItem's resource_id path)
 *   - reinforceItem → memory.reinforceItem
 *   - createEntity → memory.createEntity
 *   - linkItemToEntity → memory.linkItemToEntity
 *   - linkItemToCategory → memory.linkItemToCategory
 *   - createReflection → memory.createReflection
 *   - createLesson → memory.createLesson
 *   - reinforceLesson → memory.reinforceLesson
 *   - decayLessons → memory.decayLessons
 *   - recordModelFeedback → memory.recordModelFeedback
 *
 * Errors on the PG side are logged but never thrown — SQLite remains the
 * source of truth during the migration. The mirror is purely additive.
 */

import type { MemuStore } from "../memory/memu-store.js";
import type { MemoryAdapter } from "./adapter.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { isRedisAgentStateActive, onMemoryStored } from "./redis-agent-state.js";

const log = createSubsystemLogger("data/pg-mirror");

let _enabled = false;

function formatMirrorError(err: unknown): string {
  const rec = err as {
    message?: string;
    code?: string;
    cause?: { message?: string; code?: string } | null;
  };
  const message = rec?.message || String(err);
  const code = rec?.code ?? rec?.cause?.code;
  const causeMessage = rec?.cause?.message;
  if (code && causeMessage) {
    return `${message} (code=${code}, cause=${causeMessage})`;
  }
  if (causeMessage) {
    return `${message} (cause=${causeMessage})`;
  }
  if (code) {
    return `${message} (code=${code})`;
  }
  return message;
}

/**
 * Install the PG write mirror on a MemuStore instance.
 * Call once at gateway startup after StorageAdapter is initialized.
 *
 * @param store - The MemuStore singleton to wrap
 * @param pgMemory - The PG MemoryAdapter to mirror writes to
 */
export function enablePgWriteMirror(store: MemuStore, pgMemory: MemoryAdapter): void {
  if (_enabled) {
    log.warn("PG write mirror already enabled — skipping");
    return;
  }

  _enabled = true;
  log.info("enabling PG write mirror on MemuStore");

  // ── createItem ──────────────────────────────────────────────────────
  const origCreateItem = store.createItem.bind(store);
  store.createItem = function wrappedCreateItem(input) {
    const result = origCreateItem(input);
    void pgMemory.createItem(input).catch((err) => {
      log.warn(`mirror createItem failed: ${formatMirrorError(err)}`);
    });
    // Fire Redis dashboard event for real-time memory activity
    if (isRedisAgentStateActive()) {
      void onMemoryStored({
        itemId: result.id,
        memoryType: input.memoryType,
        significance: input.significance,
      }).catch(() => {
        /* Redis is optional */
      });
    }
    return result;
  };

  // ── reinforceItem ───────────────────────────────────────────────────
  const origReinforceItem = store.reinforceItem.bind(store);
  store.reinforceItem = function wrappedReinforceItem(id) {
    const result = origReinforceItem(id);
    void pgMemory.reinforceItem(id).catch((err) => {
      log.warn(`mirror reinforceItem failed: ${formatMirrorError(err)}`);
    });
    return result;
  };

  // ── createEntity ────────────────────────────────────────────────────
  const origCreateEntity = store.createEntity.bind(store);
  store.createEntity = function wrappedCreateEntity(input) {
    const result = origCreateEntity(input);
    void pgMemory.createEntity(input).catch((err) => {
      log.warn(`mirror createEntity failed: ${formatMirrorError(err)}`);
    });
    return result;
  };

  // ── linkItemToEntity ────────────────────────────────────────────────
  const origLinkItemToEntity = store.linkItemToEntity.bind(store);
  store.linkItemToEntity = function wrappedLinkItemToEntity(
    itemId: string,
    entityId: string,
    role = "mentioned",
  ) {
    origLinkItemToEntity(itemId, entityId, role);
    void pgMemory.linkItemToEntity(itemId, entityId, role).catch((err) => {
      log.warn(`mirror linkItemToEntity failed: ${formatMirrorError(err)}`);
    });
  };

  // ── linkItemToCategory ──────────────────────────────────────────────
  const origLinkItemToCategory = store.linkItemToCategory.bind(store);
  store.linkItemToCategory = function wrappedLinkItemToCategory(
    itemId: string,
    categoryId: string,
  ) {
    origLinkItemToCategory(itemId, categoryId);
    void pgMemory.linkItemToCategory(itemId, categoryId).catch((err) => {
      log.warn(`mirror linkItemToCategory failed: ${formatMirrorError(err)}`);
    });
  };

  // ── createReflection ────────────────────────────────────────────────
  const origCreateReflection = store.createReflection.bind(store);
  store.createReflection = function wrappedCreateReflection(input) {
    const result = origCreateReflection(input);
    void pgMemory.createReflection(input).catch((err) => {
      log.warn(`mirror createReflection failed: ${formatMirrorError(err)}`);
    });
    return result;
  };

  // ── createLesson ────────────────────────────────────────────────────
  const origCreateLesson = store.createLesson.bind(store);
  store.createLesson = function wrappedCreateLesson(input) {
    const result = origCreateLesson(input);
    void pgMemory.createLesson(input).catch((err) => {
      log.warn(`mirror createLesson failed: ${formatMirrorError(err)}`);
    });
    return result;
  };

  // ── reinforceLesson ─────────────────────────────────────────────────
  const origReinforceLesson = store.reinforceLesson.bind(store);
  store.reinforceLesson = function wrappedReinforceLesson(id) {
    origReinforceLesson(id);
    void pgMemory.reinforceLesson(id).catch((err) => {
      log.warn(`mirror reinforceLesson failed: ${formatMirrorError(err)}`);
    });
  };

  // ── decayLessons ────────────────────────────────────────────────────
  const origDecayLessons = store.decayLessons.bind(store);
  store.decayLessons = function wrappedDecayLessons(olderThanDays: number, decayAmount: number) {
    const result = origDecayLessons(olderThanDays, decayAmount);
    void pgMemory.decayLessons(olderThanDays, decayAmount).catch((err) => {
      log.warn(`mirror decayLessons failed: ${formatMirrorError(err)}`);
    });
    return result;
  };

  // ── recordModelFeedback ─────────────────────────────────────────────
  const origRecordModelFeedback = store.recordModelFeedback.bind(store);
  store.recordModelFeedback = function wrappedRecordModelFeedback(input) {
    const result = origRecordModelFeedback(input);
    void pgMemory.recordModelFeedback(input).catch((err) => {
      log.warn(`mirror recordModelFeedback failed: ${formatMirrorError(err)}`);
    });
    return result;
  };

  log.info("PG write mirror installed — 10 methods wrapped");
}

/**
 * Check if the PG write mirror is currently active.
 */
export function isPgWriteMirrorEnabled(): boolean {
  return _enabled;
}

/**
 * Reset the mirror state (for testing).
 */
export function __resetPgWriteMirrorForTest(): void {
  _enabled = false;
}
