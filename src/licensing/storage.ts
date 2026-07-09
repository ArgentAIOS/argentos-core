/**
 * License storage manager
 * Handles encrypted storage and retrieval of license data from config
 */

import type { License, LicenseStatus, LicenseTier, StoredLicense } from "./types.js";
import { decryptLicense, encryptLicense, getMachineId } from "./crypto.js";

export class LicenseStorage {
  /**
   * Store a license (encrypted) in the provided config object
   */
  storeLicense(config: Record<string, unknown>, license: License): StoredLicense {
    const licenseData = JSON.stringify(license);
    const encrypted = encryptLicense(licenseData);

    const stored: StoredLicense = {
      encrypted,
      machineId: getMachineId(),
      lastValidated: new Date().toISOString(),
      cachedStatus: license.status,
      cachedTier: license.tier,
      cachedExpiresAt: license.expiresAt,
    };

    // Store in config
    config.license = stored;

    return stored;
  }

  /**
   * Retrieve and decrypt a license from config
   */
  retrieveLicense(config: Record<string, unknown>): License | null {
    const stored = config.license as StoredLicense | undefined;

    if (!stored || !stored.encrypted) {
      return null;
    }

    const decrypted = decryptLicense(stored.encrypted);
    if (!decrypted) {
      return null; // Decryption failed
    }

    try {
      const license = JSON.parse(decrypted) as License;
      return license;
    } catch {
      return null; // Invalid JSON
    }
  }

  /**
   * Get stored license metadata without decryption
   * Useful for quick status checks
   */
  getStoredMetadata(config: Record<string, unknown>): Omit<StoredLicense, "encrypted"> | null {
    const stored = config.license as StoredLicense | undefined;

    if (!stored) {
      return null;
    }

    return {
      machineId: stored.machineId,
      lastValidated: stored.lastValidated,
      cachedStatus: stored.cachedStatus,
      cachedTier: stored.cachedTier,
      cachedExpiresAt: stored.cachedExpiresAt,
    };
  }

  /**
   * Update cached metadata after validation
   */
  updateCachedMetadata(
    config: Record<string, unknown>,
    status: LicenseStatus,
    tier: LicenseTier,
    expiresAt?: string,
  ): void {
    const stored = config.license as StoredLicense | undefined;

    if (!stored) {
      return;
    }

    stored.lastValidated = new Date().toISOString();
    stored.cachedStatus = status;
    stored.cachedTier = tier;
    stored.cachedExpiresAt = expiresAt;

    config.license = stored;
  }

  /**
   * Clear stored license
   */
  clearLicense(config: Record<string, unknown>): void {
    delete config.license;
  }

  /**
   * Get machine ID
   */
  getMachineId(): string {
    return getMachineId();
  }
}
