/**
 * 1Password Service Account resolver — first-class backend for service-keys.
 *
 * Detects `op://Vault/Item/field` references stored as the value of a
 * service-keys entry and resolves them via the `op` CLI (1Password Service
 * Account). The resolved plaintext is held in an in-memory cache for a short
 * TTL (default 5 minutes) so we don't shell out on every lookup.
 *
 * Design goals:
 *   - ADDITIVE: existing literal service-keys continue to work unchanged.
 *   - Read-only: we never write to 1Password without explicit user action.
 *   - Token-safe: OP_SERVICE_ACCOUNT_TOKEN is read from process.env or
 *     argent's keychain (mirrors tools/aos/aos-1password). It is NEVER logged.
 *   - Graceful fallback: when `op` is missing or the ref fails, callers can
 *     decide whether to fall through to the next resolution source.
 *
 * Reference syntax: `op://<vault>/<item>/<field>` (per the official 1Password
 * Connect spec). We accept a leading "op://" only — anything else is treated
 * as a literal secret value.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("onepassword-resolver");

const OP_REF_PREFIX = "op://";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_OP_BINARY = "op";
const OP_TIMEOUT_MS = 10_000;

/** Result of resolving a 1Password ref. */
export interface OnePasswordResolution {
  ok: boolean;
  /** Plaintext value when ok=true. NEVER include in logs without masking. */
  value?: string;
  /** Stable error code so callers can branch (or audit) without parsing message text. */
  errorCode?:
    | "not_a_ref"
    | "op_cli_missing"
    | "op_cli_failed"
    | "token_missing"
    | "invalid_ref"
    | "empty_value";
  /** Human-readable, token-redacted error message. */
  errorMessage?: string;
}

export interface ResolveOptions {
  /** Override the `op` binary path (defaults to `op` on PATH). */
  opBinary?: string;
  /** Override the cache TTL in ms (defaults to 5min). 0 disables cache. */
  cacheTtlMs?: number;
  /** Override the token. When omitted, we read from process.env / keychain. */
  serviceAccountToken?: string;
  /** Injection hook for tests — bypass `op` and return a value directly. */
  exec?: (
    args: string[],
    env: NodeJS.ProcessEnv,
  ) => { stdout: string; stderr: string; status: number | null };
  /** Now in ms; injected for tests so the cache TTL boundary is reproducible. */
  now?: () => number;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Returns true if the string looks like a 1Password reference. Cheap check;
 * detailed validation happens inside `resolveOnePasswordRef`.
 */
export function isOnePasswordRef(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith(OP_REF_PREFIX);
}

/**
 * Parse and minimally validate a 1Password reference.
 * Expected shape: op://Vault/Item/field
 * Vault/Item/field may contain encoded slashes / spaces — we don't try to
 * decode here; the `op` CLI handles that itself.
 */
export function parseOnePasswordRef(
  value: string,
): { vault: string; item: string; field: string } | null {
  if (!isOnePasswordRef(value)) return null;
  const rest = value.slice(OP_REF_PREFIX.length);
  // Must have at least vault/item/field (three non-empty segments).
  const parts = rest.split("/").filter((p) => p.length > 0);
  if (parts.length < 3) return null;
  // Field may itself contain slashes (sections/field). Reconstruct the tail.
  const [vault, item, ...fieldParts] = parts;
  return { vault: vault!, item: item!, field: fieldParts.join("/") };
}

/**
 * Clear the in-memory cache. Exposed for tests and for explicit
 * invalidation when the dashboard mutates a 1Password reference.
 */
export function clearOnePasswordCache(): void {
  cache.clear();
}

/**
 * Look up the 1Password Service Account token, in priority order:
 *   1. opts.serviceAccountToken (test/dashboard injection)
 *   2. process.env.OP_SERVICE_ACCOUNT_TOKEN
 *   3. argent's encrypted keychain entry (service-keys.json variable
 *      "OP_SERVICE_ACCOUNT_TOKEN"). We deliberately do NOT recurse into
 *      a 1Password ref here — the token must always resolve locally.
 *
 * Returns null when no token is available.
 */
export function resolveServiceAccountToken(
  opts: { serviceAccountToken?: string } = {},
  reader?: () => string | undefined,
): string | null {
  if (opts.serviceAccountToken && opts.serviceAccountToken.trim().length > 0) {
    return opts.serviceAccountToken.trim();
  }
  const fromEnv = process.env.OP_SERVICE_ACCOUNT_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (reader) {
    try {
      const v = reader();
      if (v && v.trim().length > 0) return v.trim();
    } catch {
      // Fall through.
    }
  }
  return null;
}

/**
 * Check whether the `op` CLI is reachable. Cached on first hit per process.
 */
let opAvailableCache: { binary: string; available: boolean } | null = null;
export function isOpCliAvailable(opBinary: string = DEFAULT_OP_BINARY): boolean {
  if (opAvailableCache && opAvailableCache.binary === opBinary) {
    return opAvailableCache.available;
  }
  try {
    const result = spawnSync(opBinary, ["--version"], {
      encoding: "utf-8",
      timeout: OP_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const available =
      result.status === 0 && typeof result.stdout === "string" && result.stdout.length > 0;
    opAvailableCache = { binary: opBinary, available };
    return available;
  } catch {
    opAvailableCache = { binary: opBinary, available: false };
    return false;
  }
}

/** Reset the binary-availability cache; for tests. */
export function resetOpAvailabilityCache(): void {
  opAvailableCache = null;
}

/**
 * Resolve a single 1Password reference, with caching.
 *
 * On failure we return a structured error rather than throwing — callers
 * (service-keys.ts) need to decide whether to fall through to the next
 * resolution layer.
 */
export function resolveOnePasswordRef(
  ref: string,
  opts: ResolveOptions = {},
): OnePasswordResolution {
  if (!isOnePasswordRef(ref)) {
    return {
      ok: false,
      errorCode: "not_a_ref",
      errorMessage: "value is not a 1Password reference",
    };
  }
  const parsed = parseOnePasswordRef(ref);
  if (!parsed) {
    return {
      ok: false,
      errorCode: "invalid_ref",
      errorMessage: `malformed 1Password ref (expected op://Vault/Item/field)`,
    };
  }

  const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = (opts.now ?? Date.now)();
  if (ttl > 0) {
    const hit = cache.get(ref);
    if (hit && hit.expiresAt > now) {
      return { ok: true, value: hit.value };
    }
  }

  const token = resolveServiceAccountToken({ serviceAccountToken: opts.serviceAccountToken });
  if (!token) {
    return {
      ok: false,
      errorCode: "token_missing",
      errorMessage:
        "OP_SERVICE_ACCOUNT_TOKEN not set. Run `argent secrets backend 1password setup` or export the env var.",
    };
  }

  const opBinary = opts.opBinary ?? DEFAULT_OP_BINARY;
  // Pre-flight binary check (skipped when an exec injector is supplied — tests).
  if (!opts.exec && !isOpCliAvailable(opBinary)) {
    return {
      ok: false,
      errorCode: "op_cli_missing",
      errorMessage: `\`${opBinary}\` CLI not found on PATH; install 1Password CLI or fall back to local secrets`,
    };
  }

  // Build a sanitized env: pass only the OP token + minimal PATH/HOME so we
  // don't leak unrelated process env into the subprocess. We never write the
  // token to a logged string.
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    OP_SERVICE_ACCOUNT_TOKEN: token,
  };

  let stdout = "";
  let stderr = "";
  let status: number | null = null;
  const args = ["read", ref];
  try {
    if (opts.exec) {
      const result = opts.exec(args, childEnv);
      stdout = result.stdout;
      stderr = result.stderr;
      status = result.status;
    } else {
      const result = spawnSync(opBinary, args, {
        encoding: "utf-8",
        timeout: OP_TIMEOUT_MS,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      stdout = result.stdout ?? "";
      stderr = result.stderr ?? "";
      status = result.status;
    }
  } catch (err) {
    const message = redactToken(err instanceof Error ? err.message : String(err), token);
    log.warn("op read failed", { errorMessage: message, refMask: maskRef(ref) });
    return { ok: false, errorCode: "op_cli_failed", errorMessage: message };
  }

  if (status !== 0) {
    const message = redactToken(
      (stderr || `op exited with status ${status ?? "null"}`).trim(),
      token,
    );
    log.warn("op read non-zero exit", { status, refMask: maskRef(ref), errorMessage: message });
    return { ok: false, errorCode: "op_cli_failed", errorMessage: message };
  }

  const value = stdout.replace(/\r?\n$/, "");
  if (value.length === 0) {
    return {
      ok: false,
      errorCode: "empty_value",
      errorMessage: "1Password returned an empty value",
    };
  }

  if (ttl > 0) {
    cache.set(ref, { value, expiresAt: now + ttl });
  }
  return { ok: true, value };
}

/**
 * Mask a 1Password reference for logging — keeps the vault visible so
 * operators can tell which entry is in trouble, but hides the item/field.
 */
export function maskRef(ref: string): string {
  if (!isOnePasswordRef(ref)) return "(not-a-ref)";
  const parsed = parseOnePasswordRef(ref);
  if (!parsed) return `${OP_REF_PREFIX}<malformed>`;
  return `${OP_REF_PREFIX}${parsed.vault}/<item>/<field>`;
}

/**
 * Replace any occurrence of the (sensitive) token in a string with the
 * literal "[redacted]". Used before we emit any error text to logs.
 */
export function redactToken(message: string, token: string | null | undefined): string {
  if (!token || token.length < 8) return message;
  const safe = message.split(token).join("[redacted]");
  return safe;
}

/**
 * Probe whether 1Password resolution looks healthy. Used by `argent doctor`.
 * Returns a structured object — caller decides how to render.
 */
export function probeOnePasswordHealth(opts: { sampleRef?: string; opBinary?: string } = {}): {
  installed: boolean;
  version?: string;
  tokenPresent: boolean;
  sample?: OnePasswordResolution;
} {
  const opBinary = opts.opBinary ?? DEFAULT_OP_BINARY;
  let version: string | undefined;
  let installed = false;
  try {
    const result = spawnSync(opBinary, ["--version"], {
      encoding: "utf-8",
      timeout: OP_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status === 0 && result.stdout) {
      installed = true;
      version = result.stdout.trim();
    }
  } catch {
    installed = false;
  }
  const tokenPresent = resolveServiceAccountToken() !== null;
  const sample = opts.sampleRef ? resolveOnePasswordRef(opts.sampleRef, { opBinary }) : undefined;
  return { installed, version, tokenPresent, sample };
}

/**
 * Verify the OP_SERVICE_ACCOUNT_TOKEN by running `op vault list`. Used by
 * setup — confirms the token works without exposing the value.
 */
export function verifyServiceAccountToken(opts: { token: string; opBinary?: string }): {
  ok: boolean;
  vaultCount?: number;
  errorMessage?: string;
} {
  const opBinary = opts.opBinary ?? DEFAULT_OP_BINARY;
  if (!opts.token) return { ok: false, errorMessage: "token is empty" };
  try {
    const result = execFileSync(opBinary, ["vault", "list", "--format=json"], {
      encoding: "utf-8",
      timeout: OP_TIMEOUT_MS,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG,
        OP_SERVICE_ACCOUNT_TOKEN: opts.token,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(result);
    const count = Array.isArray(parsed) ? parsed.length : 0;
    return { ok: true, vaultCount: count };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return { ok: false, errorMessage: redactToken(raw, opts.token) };
  }
}
