/**
 * License client for ArgentOS
 * Handles license validation, activation, and deactivation
 */

import { loadOrCreateDeviceIdentity, signDevicePayload } from "../infra/device-identity.js";
import {
  type License,
  type LicenseActivationRequest,
  type LicenseActivationResponse,
  type LicenseConfig,
  type LicenseDeactivationRequest,
  type LicenseDeactivationResponse,
  type LicenseStatus,
  type LicenseValidationRequest,
  type LicenseValidationResponse,
  DEFAULT_LICENSE_CONFIG,
} from "./types.js";

export class LicenseClient {
  private config: Required<LicenseConfig>;

  constructor(config: LicenseConfig = {}) {
    this.config = {
      ...DEFAULT_LICENSE_CONFIG,
      ...config,
    } as Required<LicenseConfig>;
  }

  /**
   * Validate a license key with the license server
   */
  async validate(request: LicenseValidationRequest): Promise<LicenseValidationResponse> {
    try {
      const response = await fetch(`${this.config.apiUrl}/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ArgentOS-LicenseClient/1.0",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        return {
          valid: false,
          error: `License server error: ${response.status} ${errorText}`,
        };
      }

      const data = (await response.json()) as LicenseValidationResponse;
      return data;
    } catch (error) {
      // Network error or timeout
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }

  /**
   * Activate a license key
   */
  async activate(request: LicenseActivationRequest): Promise<LicenseActivationResponse> {
    try {
      const response = await fetch(`${this.config.apiUrl}/activate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ArgentOS-LicenseClient/1.0",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        return {
          success: false,
          error: `License server error: ${response.status} ${errorText}`,
        };
      }

      const data = (await response.json()) as LicenseActivationResponse;
      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }

  /**
   * Deactivate a license key
   */
  async deactivate(request: LicenseDeactivationRequest): Promise<LicenseDeactivationResponse> {
    try {
      const response = await fetch(`${this.config.apiUrl}/deactivate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ArgentOS-LicenseClient/1.0",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        return {
          success: false,
          error: `License server error: ${response.status} ${errorText}`,
        };
      }

      const data = (await response.json()) as LicenseDeactivationResponse;
      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }

  /**
   * Check if a license is expired
   */
  isExpired(license: License): boolean {
    if (!license.expiresAt) {
      return false; // No expiry = perpetual license
    }

    const expiryDate = new Date(license.expiresAt);
    return expiryDate < new Date();
  }

  /**
   * Check if a license status is valid for use
   */
  isValid(status: LicenseStatus): boolean {
    return status === "active";
  }

  /**
   * Get offline grace period end time
   */
  getOfflineGraceEnd(lastValidated: string): Date {
    const lastValidatedDate = new Date(lastValidated);
    return new Date(
      lastValidatedDate.getTime() + this.config.offlineGracePeriodHours * 60 * 60 * 1000,
    );
  }

  /**
   * Check if revalidation is needed
   */
  needsRevalidation(lastValidated?: string): boolean {
    if (!lastValidated) {
      return true;
    }

    const lastValidatedDate = new Date(lastValidated);
    const nextValidation = new Date(
      lastValidatedDate.getTime() + this.config.validationIntervalHours * 60 * 60 * 1000,
    );

    return nextValidation < new Date();
  }

  /**
   * Authenticate this instance with the marketplace using Ed25519 device identity.
   * Returns a JWT on success, or an error string on failure.
   */
  async authenticateInstance(): Promise<{ token?: string; error?: string }> {
    try {
      const identity = loadOrCreateDeviceIdentity();
      const timestamp = new Date().toISOString();
      const payload = identity.deviceId + timestamp;
      const signature = signDevicePayload(identity.privateKeyPem, payload);

      const response = await fetch(`${this.config.apiUrl}/auth/instance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ArgentOS-LicenseClient/1.0",
        },
        body: JSON.stringify({
          instanceId: identity.deviceId,
          timestamp,
          signature,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { error: `Instance auth failed: ${response.status} ${text}`.trim() };
      }

      const data = (await response.json()) as { token?: string };
      if (!data.token) {
        return { error: "Instance auth response missing token" };
      }
      return { token: data.token };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Instance auth network error" };
    }
  }

  /** Expose apiUrl for sync callers */
  get apiUrl(): string {
    return this.config.apiUrl;
  }
}
