/**
 * Public Core override for startup license validation.
 *
 * Marketplace-backed licensing remains outside the public core boundary, so
 * gateway startup treats license validation as unavailable and non-blocking.
 */

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

export function readLocalLicense(): LicenseInfo | null {
  return null;
}

export async function checkLicenseRemote(_key: string): Promise<LicenseCheckResult> {
  return { valid: false, status: "unavailable_in_core" };
}

export function updateLocalLicense(_info: LicenseInfo): void {}

export async function validateLicenseOnStartup(log: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}): Promise<boolean> {
  log.info("license validation unavailable in ArgentOS Core; skipping marketplace check");
  return false;
}
