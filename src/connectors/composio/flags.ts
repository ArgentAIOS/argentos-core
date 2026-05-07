/**
 * Composio per-agent feature flag store — slice 2.2.
 *
 * The Q4 decision (locked in
 * `ops/HANDOFF_OPEN_DESIGN_COMPOSIO_INTEGRATION_REPLY.md`) is that the
 * Composio surface is **default-off** and that the Tool Router beta is an
 * additional **opt-in within** that gate. Slice 2.1 introduced the
 * `ComposioFeatureFlags` type but had nowhere to persist a per-agent value.
 *
 * This module is the smallest possible persistence layer for those flags so
 * the slice 2.2 settings UI can round-trip them. It mirrors
 * `src/infra/service-keys.ts` in spirit (file under `~/.argentos`,
 * mode 0o600) but is intentionally separate: the flags are not secret, and
 * conflating them with the secret store would broaden the blast radius of a
 * stolen secret-store dump.
 *
 * Decision map:
 *   - Q1 user_id source     -> per-agent record key uses `normalizeAgentId`
 *     (same shape as service-keys consumers).
 *   - Q3 AOS overlap policy -> `preferComposio: string[]` opt-in override.
 *   - Q4 default-off gate    -> `enabled: false` default; persisted entries
 *     never silently flip on.
 *   - Q4 Tool Router beta    -> `toolRouter.enabled: false` default; opt-in
 *     mirrors the `experimentalWrites` precedent.
 *
 * What this module deliberately does NOT do:
 *   - Execute tools (slice 2.5).
 *   - Validate `preferComposio` toolkit slugs against a live catalog
 *     (slice 2.4 owns toolkit discovery).
 *   - Surface the flags through the agent runtime (slice 2.3+ wiring).
 */

import fs from "node:fs";
import path from "node:path";
import type { ComposioFeatureFlags } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { normalizeAgentId } from "../../routing/session-key.js";

const log = createSubsystemLogger("composio-flags");

const COMPOSIO_FLAGS_PATH = path.join(
  process.env.HOME ?? "/tmp",
  ".argentos",
  "composio-flags.json",
);

const FILE_VERSION = 1 as const;

/**
 * On-disk shape. The outer `agents` map is keyed by the normalized agent id
 * (Q1) so a single file holds the whole operator's per-agent state without
 * cross-agent leakage.
 */
export interface ComposioFlagsFile {
  version: number;
  agents: Record<string, ComposioFeatureFlags>;
}

const DEFAULT_FLAGS: ComposioFeatureFlags = Object.freeze({
  enabled: false,
  preferComposio: [],
  toolRouter: { enabled: false },
});

/**
 * Defensive deep clone: callers must never receive the cached object so
 * accidental in-place mutation cannot leak across agents.
 */
function cloneFlags(flags: ComposioFeatureFlags): ComposioFeatureFlags {
  return {
    enabled: flags.enabled === true,
    preferComposio: Array.isArray(flags.preferComposio) ? [...flags.preferComposio] : [],
    toolRouter: { enabled: flags.toolRouter?.enabled === true },
  };
}

export function defaultComposioFlags(): ComposioFeatureFlags {
  return cloneFlags(DEFAULT_FLAGS);
}

/**
 * Override the on-disk path used by this module. Tests inject a tmpdir;
 * production code should never call this. Returns the effective path.
 */
let activePath = COMPOSIO_FLAGS_PATH;
export function __setComposioFlagsPathForTesting(nextPath: string | undefined): string {
  activePath = nextPath?.trim() || COMPOSIO_FLAGS_PATH;
  return activePath;
}

export function getComposioFlagsPath(): string {
  return activePath;
}

function readRaw(): ComposioFlagsFile {
  try {
    const raw = fs.readFileSync(activePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ComposioFlagsFile> | undefined;
    if (!parsed || typeof parsed !== "object") {
      return { version: FILE_VERSION, agents: {} };
    }
    const agents: Record<string, ComposioFeatureFlags> = {};
    const inAgents = (parsed.agents ?? {}) as Record<string, unknown>;
    for (const [rawAgentId, value] of Object.entries(inAgents)) {
      const normalizedId = normalizeAgentId(String(rawAgentId ?? "").trim());
      if (!normalizedId) {
        continue;
      }
      if (!value || typeof value !== "object") {
        continue;
      }
      const v = value as Partial<ComposioFeatureFlags>;
      agents[normalizedId] = {
        enabled: v.enabled === true,
        preferComposio: Array.isArray(v.preferComposio)
          ? v.preferComposio
              .map((s) =>
                String(s ?? "")
                  .trim()
                  .toLowerCase(),
              )
              .filter((s) => s.length > 0)
          : [],
        toolRouter: { enabled: v.toolRouter?.enabled === true },
      };
    }
    return { version: FILE_VERSION, agents };
  } catch {
    return { version: FILE_VERSION, agents: {} };
  }
}

function writeRaw(file: ComposioFlagsFile): void {
  const dir = path.dirname(activePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(activePath, JSON.stringify(file, null, 2), "utf-8");
  try {
    fs.chmodSync(activePath, 0o600);
  } catch {
    // chmod fails on some filesystems (e.g. CI tmpfs); the file is still
    // protected by the parent dir's perms which we don't change.
  }
}

/**
 * Read the persisted Composio flags for the given agent. Returns the
 * default (all-off) when the agent has no entry — never throws, never
 * returns undefined.
 *
 * The returned object is a defensive copy; mutating it is safe.
 */
export function readComposioFlagsForAgent(agentId: string | undefined): ComposioFeatureFlags {
  // Same Q1 discipline as the write path: do not silently fall back to
  // DEFAULT_AGENT_ID when the caller forgot to pass an agent id, since
  // that would inherit "main"'s policy across unrelated callers.
  const trimmed = String(agentId ?? "").trim();
  if (!trimmed) {
    return defaultComposioFlags();
  }
  const normalizedId = normalizeAgentId(trimmed);
  if (!normalizedId) {
    return defaultComposioFlags();
  }
  const file = readRaw();
  const entry = file.agents[normalizedId];
  return entry ? cloneFlags(entry) : defaultComposioFlags();
}

/**
 * Persist the flags for a single agent. Other agents' entries are left
 * untouched (per-agent isolation, Q1). Returns the saved value.
 *
 * Empty / falsy flags still write an entry — the store is the source of
 * truth and "no entry" must remain distinguishable from "explicitly off"
 * for future audit.
 */
export function writeComposioFlagsForAgent(
  agentId: string | undefined,
  flags: ComposioFeatureFlags,
): ComposioFeatureFlags {
  // Reject empty/missing input BEFORE normalization. `normalizeAgentId` falls
  // back to DEFAULT_AGENT_ID, which would silently merge unrelated callers
  // into the "main" record — exactly the cross-agent leak the Q1 contract
  // forbids. A typed-empty agentId is a programmer error; surface it.
  const trimmed = String(agentId ?? "").trim();
  if (!trimmed) {
    throw new Error("writeComposioFlagsForAgent: agentId is required");
  }
  const normalizedId = normalizeAgentId(trimmed);
  if (!normalizedId) {
    throw new Error("writeComposioFlagsForAgent: agentId is required");
  }
  const file = readRaw();
  const next: ComposioFeatureFlags = {
    enabled: flags.enabled === true,
    preferComposio: Array.isArray(flags.preferComposio)
      ? Array.from(
          new Set(
            flags.preferComposio
              .map((s) =>
                String(s ?? "")
                  .trim()
                  .toLowerCase(),
              )
              .filter((s) => s.length > 0),
          ),
        )
      : [],
    toolRouter: { enabled: flags.toolRouter?.enabled === true },
  };
  file.agents[normalizedId] = next;
  writeRaw(file);
  log.info("wrote composio flags", {
    agentId: normalizedId,
    enabled: next.enabled,
    toolRouterEnabled: next.toolRouter?.enabled === true,
    preferComposioCount: next.preferComposio?.length ?? 0,
  });
  return cloneFlags(next);
}

/**
 * Read every stored agent's flags as a flat map. Used by the dashboard
 * status endpoint to render multiple agents at once. Read-only.
 */
export function readAllComposioFlags(): Record<string, ComposioFeatureFlags> {
  const file = readRaw();
  const out: Record<string, ComposioFeatureFlags> = {};
  for (const [agentId, flags] of Object.entries(file.agents)) {
    out[agentId] = cloneFlags(flags);
  }
  return out;
}
