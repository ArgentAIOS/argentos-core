import fs from "node:fs";
import path from "node:path";
import type { ArgentConfig } from "../config/config.js";
import { LicenseStorage } from "../licensing/storage.js";
import { resolveConfigDir } from "../utils.js";

const ORG_ID_ENV = "ARGENT_ORG_ID";
const ORG_ALLOWLIST_FILENAME = "plugins.allowlist.json";

export type OrgPluginScope = {
  orgId: string | null;
  allowlist: Set<string>;
  allowlistStatus: "none" | "ok" | "missing" | "invalid";
  allowlistPath?: string;
  error?: string;
};

function parseAllowlist(raw: unknown): Set<string> | null {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { allow?: unknown }).allow)
      ? (raw as { allow: unknown[] }).allow
      : null;
  if (!list) {
    return null;
  }
  return new Set(
    list.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean),
  );
}

function resolveOrgIdFromLicense(config: ArgentConfig): string | null {
  try {
    const storage = new LicenseStorage();
    const license = storage.retrieveLicense(config as unknown as Record<string, unknown>);
    const orgId = license?.metadata?.organizationId?.trim();
    return orgId || null;
  } catch {
    return null;
  }
}

export function resolveOrgId(
  config: ArgentConfig,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const fromEnv = env[ORG_ID_ENV]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return resolveOrgIdFromLicense(config);
}

export function resolveOrgPluginsDir(orgId: string): string {
  return path.join(resolveConfigDir(), "orgs", orgId, "extensions");
}

function resolveOrgAllowlistPath(orgId: string): string {
  return path.join(resolveConfigDir(), "orgs", orgId, ORG_ALLOWLIST_FILENAME);
}

export function resolveOrgPluginScope(
  config: ArgentConfig,
  env: NodeJS.ProcessEnv = process.env,
): OrgPluginScope {
  const orgId = resolveOrgId(config, env);
  if (!orgId) {
    return { orgId: null, allowlist: new Set(), allowlistStatus: "none" };
  }

  const allowlistPath = resolveOrgAllowlistPath(orgId);
  if (!fs.existsSync(allowlistPath)) {
    return {
      orgId,
      allowlist: new Set(),
      allowlistStatus: "missing",
      allowlistPath,
      error: `org plugin allowlist missing: ${allowlistPath}`,
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(allowlistPath, "utf-8")) as unknown;
    const allowlist = parseAllowlist(raw);
    if (!allowlist) {
      return {
        orgId,
        allowlist: new Set(),
        allowlistStatus: "invalid",
        allowlistPath,
        error: `org plugin allowlist invalid (expected array or { allow: [] }): ${allowlistPath}`,
      };
    }
    return {
      orgId,
      allowlist,
      allowlistStatus: "ok",
      allowlistPath,
    };
  } catch (err) {
    return {
      orgId,
      allowlist: new Set(),
      allowlistStatus: "invalid",
      allowlistPath,
      error: `failed to parse org plugin allowlist ${allowlistPath}: ${String(err)}`,
    };
  }
}
