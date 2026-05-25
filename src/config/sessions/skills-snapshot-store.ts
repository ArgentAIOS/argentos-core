// Sidecar store for `SessionSkillSnapshot` blobs, deduplicated by content hash.
//
// Background (#410): each SessionEntry historically embedded a full
// SessionSkillSnapshot (~280 KB: a 100KB system-prompt + 213 skill specs).
// With 357 entries and only ~25 logically-distinct snapshots, the embedded
// duplication blew sessions.json up to 98 MB. Under concurrent writers
// (chat + contemplation + SIS + kernel ticks + workflow runs), the file-lock
// contended past its 10s timeout and chat turns failed outright with
// `timeout acquiring session store lock`.
//
// This module factors the snapshot blobs out into a sibling content-addressed
// store. The main sessions.json keeps a small `skillsSnapshotHash` reference
// per entry; the actual blob lives once under that hash here.
//
// Concurrency model:
//   - Sidecar writes are idempotent "create if not exists" by hash, so no
//     dedicated lock is needed — concurrent writers may race on the same hash
//     and the loser's write is harmless (same bytes).
//   - The main store lock continues to serialize sessions.json writes.
//   - Save order is sidecar-first → sessions.json-second so a concurrent
//     reader never sees a hash with no resolvable blob.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SessionSkillSnapshot } from "./types.js";

const SIDECAR_FILE_NAME = "skills-snapshots.json";

type SkillsSnapshotSidecar = Record<string, SessionSkillSnapshot>;

function sidecarPathFor(storePath: string): string {
  return path.join(path.dirname(storePath), SIDECAR_FILE_NAME);
}

// Deterministic JSON encoding so logically-identical snapshots collapse to
// the same hash regardless of key insertion order. Keep it self-contained
// (no third-party stable-stringify) to avoid a dep for one call site.
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

export function hashSkillsSnapshot(snapshot: SessionSkillSnapshot): string {
  return crypto.createHash("sha256").update(canonicalStringify(snapshot)).digest("hex");
}

function readSidecarSync(storePath: string): SkillsSnapshotSidecar {
  const sidecarPath = sidecarPathFor(storePath);
  try {
    const raw = fs.readFileSync(sidecarPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SkillsSnapshotSidecar;
    }
  } catch {
    // missing/invalid sidecar: treat as empty
  }
  return {};
}

export function readSkillsSnapshotByHash(
  storePath: string,
  hash: string,
): SessionSkillSnapshot | null {
  if (!hash) return null;
  const sidecar = readSidecarSync(storePath);
  return sidecar[hash] ?? null;
}

// Write `snapshot` to the sidecar if its hash isn't already present.
// Returns the hash so callers can store the reference. Idempotent under
// concurrent writers of the same content.
export function writeSkillsSnapshot(storePath: string, snapshot: SessionSkillSnapshot): string {
  const hash = hashSkillsSnapshot(snapshot);
  const sidecarPath = sidecarPathFor(storePath);
  const sidecar = readSidecarSync(storePath);
  if (sidecar[hash]) {
    return hash;
  }
  sidecar[hash] = snapshot;
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  // Atomic write via temp + rename so a concurrent reader can't see a partial JSON.
  const tmp = `${sidecarPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(sidecar), { mode: 0o600, encoding: "utf-8" });
    fs.renameSync(tmp, sidecarPath);
    try {
      fs.chmodSync(sidecarPath, 0o600);
    } catch {
      /* belt-and-braces */
    }
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
  return hash;
}
