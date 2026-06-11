/**
 * License manager
 * High-level API for license management in ArgentOS
 */

import os from "node:os";
import type { License, LicenseConfig, LicenseStatus } from "./types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { VERSION } from "../version.js";
import { LicenseClient } from "./client.js";
import { getMachineId } from "./crypto.js";
import { syncOrgSecrets, type SyncResult } from "./secret-sync.js";
import { LicenseStorage } from "./storage.js";

const log = createSubsystemLogger("license-manager");

export interface LicenseManagerOptions {
  config: Record<string, unknown>;
  licenseConfig?: LicenseConfig;
}

export class LicenseManager {
  private client: LicenseClient;
  private storage: LicenseStorage;
  private config: Record<string, unknown>;

  constructor(options: LicenseManagerOptions) {
    this.config = options.config;
    this.client = new LicenseClient(options.licenseConfig);
    this.storage = new LicenseStorage();
  }

  /**
   * Get current license from storage
   */
  getCurrentLicense(): License | null {
    return this.storage.retrieveLicense(this.config);
  }

  /**
   * Get license status
   */
  getStatus(): {
    hasLicense: boolean;
    status?: LicenseStatus;
    tier?: string;
    expiresAt?: string;
    lastValidated?: string;
    needsValidation: boolean;
  } {
    const metadata = this.storage.getStoredMetadata(this.config);

    if (!metadata) {
      return {
        hasLicense: false,
        needsValidation: false,
      };
    }

    const needsValidation = this.client.needsRevalidation(metadata.lastValidated);

    return {
      hasLicense: true,
      status: metadata.cachedStatus,
      tier: metadata.cachedTier,
      expiresAt: metadata.cachedExpiresAt,
      lastValidated: metadata.lastValidated,
      needsValidation,
    };
  }

  /**
   * Activate a new license
   */
  async activate(key: string): Promise<{ success: boolean; error?: string; license?: License }> {
    const machineId = getMachineId();

    const result = await this.client.activate({
      key,
      machineId,
      metadata: {
        hostname: os.hostname(),
        platform: os.platform(),
        version: VERSION,
      },
    });

    if (!result.success || !result.license) {
      return {
        success: false,
        error: result.error || "Activation failed",
      };
    }

    // Store the license
    this.storage.storeLicense(this.config, result.license);

    // Best-effort org secret sync after activation
    if (result.license.metadata?.organizationId) {
      try {
        const syncResult = await this.syncSecrets();
        log.info("post-activation secret sync", {
          orgId: result.license.metadata.organizationId,
          synced: syncResult.synced,
          skipped: syncResult.skipped,
        });
      } catch (err) {
        log.warn("post-activation secret sync failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      success: true,
      license: result.license,
    };
  }

  /**
   * Validate current license with server
   */
  async validate(): Promise<{ valid: boolean; error?: string; license?: License }> {
    const currentLicense = this.getCurrentLicense();

    if (!currentLicense) {
      return {
        valid: false,
        error: "No license found",
      };
    }

    const result = await this.client.validate({
      key: currentLicense.key,
      machineId: getMachineId(),
    });

    if (!result.valid || !result.license) {
      return {
        valid: false,
        error: result.error || "Validation failed",
      };
    }

    // Update cached metadata
    this.storage.updateCachedMetadata(
      this.config,
      result.license.status,
      result.license.tier,
      result.license.expiresAt,
    );

    return {
      valid: true,
      license: result.license,
    };
  }

  /**
   * Deactivate current license
   */
  async deactivate(): Promise<{ success: boolean; error?: string }> {
    const currentLicense = this.getCurrentLicense();

    if (!currentLicense) {
      return {
        success: false,
        error: "No license to deactivate",
      };
    }

    const result = await this.client.deactivate({
      key: currentLicense.key,
      machineId: getMachineId(),
    });

    if (result.success) {
      // Clear stored license
      this.storage.clearLicense(this.config);
    }

    return result;
  }

  /**
   * Check if current license allows feature access
   * Returns true if:
   * - License is active
   * - Not expired
   * - Within offline grace period if server unreachable
   */
  async checkAccess(): Promise<{ allowed: boolean; reason?: string }> {
    const license = this.getCurrentLicense();

    if (!license) {
      return {
        allowed: false,
        reason: "No license found",
      };
    }

    // Check expiry
    if (this.client.isExpired(license)) {
      return {
        allowed: false,
        reason: "License expired",
      };
    }

    // Check status
    if (!this.client.isValid(license.status)) {
      return {
        allowed: false,
        reason: `License status: ${license.status}`,
      };
    }

    // Check if validation is needed
    const metadata = this.storage.getStoredMetadata(this.config);
    const needsValidation = this.client.needsRevalidation(metadata?.lastValidated);

    if (needsValidation) {
      // Try to revalidate
      const validation = await this.validate();

      if (!validation.valid) {
        // Check offline grace period
        if (metadata?.lastValidated) {
          const graceEnd = this.client.getOfflineGraceEnd(metadata.lastValidated);

          if (new Date() < graceEnd) {
            // Still within grace period
            return {
              allowed: true,
              reason: "Offline grace period active",
            };
          }
        }

        return {
          allowed: false,
          reason: validation.error || "License validation failed",
        };
      }

      // Update license from validation
      if (validation.license) {
        this.storage.storeLicense(this.config, validation.license);
      }
    }

    return {
      allowed: true,
    };
  }

  /**
   * Get machine ID for this installation
   */
  getMachineId(): string {
    return getMachineId();
  }

  /**
   * Synchronize organization secrets from the marketplace.
   * Requires an active license with an organization binding.
   */
  async syncSecrets(): Promise<SyncResult> {
    const license = this.getCurrentLicense();

    if (!license?.metadata?.organizationId) {
      return { synced: 0, skipped: 0, errors: ["No organization binding"] };
    }

    // Authenticate with the marketplace to get a JWT
    const auth = await this.client.authenticateInstance();
    if (!auth.token) {
      return { synced: 0, skipped: 0, errors: [auth.error || "Instance authentication failed"] };
    }

    return syncOrgSecrets(this.client.apiUrl, auth.token);
  }
}
