// License validation utilities — reads ~/.argentos/license.json and validates against marketplace

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LICENSE_PATH = path.join(os.homedir(), ".argentos", "license.json");
const MARKETPLACE_URL = "https://marketplace.argentos.ai";

export interface LicenseInfo {
  key: string;
  companyName?: string;
  validatedAt?: string;
  status?: string;
}

export interface LicenseCheckResult {
  valid: boolean;
  status: string;
  type?: string;
  packageName?: string;
  orgName?: string;
  expiresAt?: string | null;
}

/** Read the local license file, or null if missing/invalid. */
export function readLocalLicense(): LicenseInfo | null {
  try {
    if (!fs.existsSync(LICENSE_PATH)) {
      return null;
    }
    const raw = fs.readFileSync(LICENSE_PATH, "utf-8");
    const data = JSON.parse(raw) as LicenseInfo;
    return data.key ? data : null;
  } catch {
    return null;
  }
}

/** Validate a license key against the marketplace API. Non-throwing. */
export async function checkLicenseRemote(key: string): Promise<LicenseCheckResult> {
  try {
    const res = await fetch(`${MARKETPLACE_URL}/api/v1/license/check/${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { valid: false, status: res.status === 404 ? "not_found" : `http_${res.status}` };
    }
    return (await res.json()) as LicenseCheckResult;
  } catch {
    // Network error — assume valid (offline grace)
    return { valid: true, status: "offline_grace" };
  }
}

/** Update the local license file with validation result. */
export function updateLocalLicense(info: LicenseInfo): void {
  try {
    const dir = path.dirname(LICENSE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(LICENSE_PATH, JSON.stringify(info, null, 2), "utf-8");
  } catch {
    // Ignore write errors
  }
}

/**
 * Validate the license on gateway startup.
 * Returns true if license is valid (or offline grace), false if invalid.
 * Logs warnings but never throws.
 */
export async function validateLicenseOnStartup(log: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}): Promise<boolean> {
  const local = readLocalLicense();

  if (!local) {
    log.warn("no license found (~/.argentos/license.json) — running unlicensed");
    return false;
  }

  const result = await checkLicenseRemote(local.key);

  if (result.status === "offline_grace") {
    log.info("license server unreachable — offline grace period active");
    return true;
  }

  if (result.valid) {
    log.info(`license valid (${result.type ?? "unknown"}, org: ${result.orgName ?? "none"})`);
    updateLocalLicense({
      ...local,
      validatedAt: new Date().toISOString(),
      status: "active",
    });
    return true;
  }

  log.warn(`license invalid: ${result.status}`);
  updateLocalLicense({
    ...local,
    validatedAt: new Date().toISOString(),
    status: result.status,
  });
  return false;
}
