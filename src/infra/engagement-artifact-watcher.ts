/**
 * Engagement artifact watcher — Phase 3b.3 of HANDOFF-kernel-fitness.md.
 *
 * The executive cycle writes "artifact" markdown files under
 * `{agentDir}/kernel/artifacts/<date>/<ts>-<title>.md` and logs each one to
 * `{agentDir}/kernel/artifact-ledger.jsonl`. Per HANDOFF Section 4.1, artifacts
 * are one of three things the kernel "surfaces" to the operator (alongside
 * notifications and pending surfaces). The fitness engagement-rate needs to
 * know whether the operator actually READ those artifacts.
 *
 * macOS APFS (and most Linux filesystems by default) update a file's access
 * time (`atime`) whenever the file is read. We exploit that: every N seconds,
 * scan the artifact ledger, fs.stat each artifact, and if `atime > mtime + 1s`
 * (i.e. the file was accessed AFTER it was created), record an `acted`
 * outcome in the engagement-ledger.
 *
 * Each artifact also gets a `surface_emitted` event on the first scan that
 * observes it. The surface ID is a deterministic hash so the same artifact
 * is recognized across watcher restarts.
 *
 * Caveats:
 *   - Volumes mounted `noatime` (or accessed via NFS/SMB with atime disabled)
 *     never update atime. The watcher will quietly produce no `acted` events
 *     in that case — operators still get the fallback explicit "I read this"
 *     button (Phase 3b.4). The handoff §9 risks call this out.
 *   - Some macOS configs aggressively cache stat; freshness is generally
 *     OK at 60s scan cadence.
 *   - Read-by-tooling counts as a read (e.g. spotlight indexer). On a quiet
 *     vault dir this is rare; if it becomes noisy, switch the trigger from
 *     atime to an explicit ack button.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  type EngagementLedgerEntry,
  recordEngagement,
  recordSurfaceEmitted,
} from "./engagement-tracker.js";

const log = createSubsystemLogger("gateway/consciousness-kernel/artifact-watcher");

/**
 * Threshold for "atime > mtime means the file was read after creation."
 * Reads that happen within 1 second of file creation are noise (the writer
 * itself often re-stats just-written files; macOS sometimes touches atime
 * during the write). 1s buffer eliminates that false positive.
 */
const ACCESS_THRESHOLD_MS = 1000;

export const DEFAULT_ARTIFACT_WATCHER_INTERVAL_MS = 60_000;

export type ArtifactLedgerLine = {
  ts?: string;
  artifactPath?: string;
  workTitle?: string;
  artifactType?: string;
};

export type ArtifactWatcherPaths = {
  artifactLedgerPath: string;
  engagementLedgerPath: string;
};

export type ArtifactWatcherHandle = {
  stop: () => void;
  /** Trigger a scan now — for tests and debugging. */
  forceScan: () => void;
};

export type StartArtifactWatcherOptions = {
  paths: ArtifactWatcherPaths;
  agentId: string;
  intervalMs?: number;
};

export function startEngagementArtifactWatcher(
  opts: StartArtifactWatcherOptions,
): ArtifactWatcherHandle {
  const intervalMs = opts.intervalMs ?? DEFAULT_ARTIFACT_WATCHER_INTERVAL_MS;
  const tick = () => {
    try {
      const result = scanArtifactsForEngagement({
        artifactLedgerPath: opts.paths.artifactLedgerPath,
        engagementLedgerPath: opts.paths.engagementLedgerPath,
        agentId: opts.agentId,
      });
      if (result.newEmissions > 0 || result.newActed > 0) {
        log.info("engagement-artifacts: scan emitted ledger entries", result);
      }
    } catch (err) {
      log.warn(`engagement-artifacts: scan failed: ${String(err)}`);
    }
  };
  const handle = setInterval(tick, intervalMs);
  handle.unref?.();
  return { stop: () => clearInterval(handle), forceScan: tick };
}

export type ScanArtifactsResult = {
  scannedArtifacts: number;
  newEmissions: number;
  newActed: number;
};

export type ScanArtifactsOptions = {
  artifactLedgerPath: string;
  engagementLedgerPath: string;
  agentId: string;
};

/**
 * One scan pass — pure-ish (reads artifact-ledger + filesystem stat, appends
 * to engagement-ledger). Exposed for tests.
 *
 * For each entry in the artifact-ledger:
 *   1. Derive a stable surface ID from agentId + artifactPath + ts.
 *   2. If the engagement-ledger doesn't yet have a `surface_emitted` event
 *      for that ID → write one.
 *   3. fs.stat the artifact file. If it doesn't exist (file deleted), skip.
 *   4. If `atime > mtime + ACCESS_THRESHOLD_MS` AND engagement-ledger has
 *      no `acted` outcome for this surface yet → write `acted` with source
 *      `artifact_file_open`.
 */
export function scanArtifactsForEngagement(opts: ScanArtifactsOptions): ScanArtifactsResult {
  const result: ScanArtifactsResult = {
    scannedArtifacts: 0,
    newEmissions: 0,
    newActed: 0,
  };
  if (!fs.existsSync(opts.artifactLedgerPath)) return result;

  const knownSurfaceIds = new Set<string>();
  const knownActedSurfaceIds = new Set<string>();
  if (fs.existsSync(opts.engagementLedgerPath)) {
    for (const entry of readEngagementEntries(opts.engagementLedgerPath)) {
      if (entry.type === "surface_emitted") {
        knownSurfaceIds.add(entry.surfaceId);
      } else if (entry.type === "outcome" && entry.outcome === "acted") {
        knownActedSurfaceIds.add(entry.surfaceId);
      }
    }
  }

  const artifactLines = fs.readFileSync(opts.artifactLedgerPath, "utf-8").split("\n");
  for (const line of artifactLines) {
    if (!line.trim()) continue;
    let entry: ArtifactLedgerLine;
    try {
      entry = JSON.parse(line) as ArtifactLedgerLine;
    } catch {
      continue;
    }
    if (typeof entry.artifactPath !== "string" || typeof entry.ts !== "string") continue;
    result.scannedArtifacts++;

    const surfaceId = artifactSurfaceId(opts.agentId, entry.artifactPath, entry.ts);

    if (!knownSurfaceIds.has(surfaceId)) {
      recordSurfaceEmitted({
        ledgerPath: opts.engagementLedgerPath,
        surfaceId,
        agentId: opts.agentId,
        ts: entry.ts,
        payload: {
          source: "artifact",
          artifactPath: entry.artifactPath,
          workTitle: entry.workTitle ?? null,
          artifactType: entry.artifactType ?? null,
        },
      });
      knownSurfaceIds.add(surfaceId);
      result.newEmissions++;
    }

    if (knownActedSurfaceIds.has(surfaceId)) continue;

    // Stat the artifact file. If it doesn't exist (deleted), no signal.
    let stat: fs.Stats;
    try {
      stat = fs.statSync(entry.artifactPath);
    } catch {
      continue;
    }
    const accessMs = stat.atime.getTime();
    const modifyMs = stat.mtime.getTime();
    if (accessMs <= modifyMs + ACCESS_THRESHOLD_MS) continue;

    recordEngagement({
      ledgerPath: opts.engagementLedgerPath,
      surfaceId,
      outcome: "acted",
      source: "artifact_file_open",
      ts: new Date(accessMs).toISOString(),
    });
    knownActedSurfaceIds.add(surfaceId);
    result.newActed++;
  }

  return result;
}

/**
 * Derive a stable surface ID for an artifact. Deterministic across watcher
 * restarts so we don't double-emit `surface_emitted` for the same file.
 */
export function artifactSurfaceId(agentId: string, artifactPath: string, ts: string): string {
  return createHash("sha256").update(`${agentId}|${artifactPath}|${ts}`).digest("hex").slice(0, 16);
}

function readEngagementEntries(ledgerPath: string): EngagementLedgerEntry[] {
  try {
    const raw = fs.readFileSync(ledgerPath, "utf-8");
    const entries: EngagementLedgerEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as EngagementLedgerEntry);
      } catch {
        /* skip */
      }
    }
    return entries;
  } catch {
    return [];
  }
}
