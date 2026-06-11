/**
 * Licensing system types for ArgentOS
 */

export type LicenseTier = "free" | "pro" | "enterprise" | "custom";

export type LicenseStatus = "active" | "expired" | "invalid" | "revoked" | "pending";

export interface License {
  key: string;
  tier: LicenseTier;
  status: LicenseStatus;
  expiresAt?: string; // ISO timestamp
  activatedAt?: string; // ISO timestamp
  metadata?: {
    organizationId?: string;
    organizationName?: string;
    maxAgents?: number;
    features?: string[];
    [key: string]: unknown;
  };
}

export interface LicenseValidationRequest {
  key: string;
  machineId?: string;
}

export interface LicenseValidationResponse {
  valid: boolean;
  license?: License;
  error?: string;
}

export interface LicenseActivationRequest {
  key: string;
  machineId: string;
  metadata?: {
    hostname?: string;
    platform?: string;
    version?: string;
  };
}

export interface LicenseActivationResponse {
  success: boolean;
  license?: License;
  error?: string;
}

export interface LicenseDeactivationRequest {
  key: string;
  machineId: string;
}

export interface LicenseDeactivationResponse {
  success: boolean;
  error?: string;
}

export interface StoredLicense {
  encrypted: string; // Encrypted license data
  machineId: string;
  lastValidated?: string; // ISO timestamp
  cachedStatus?: LicenseStatus;
  cachedTier?: LicenseTier;
  cachedExpiresAt?: string;
}

export interface LicenseConfig {
  apiUrl?: string; // License server URL (default: https://license.argentos.ai/api)
  offlineGracePeriodHours?: number; // Hours to allow offline before requiring validation (default: 72)
  validationIntervalHours?: number; // Hours between automatic validations (default: 24)
}

export const DEFAULT_LICENSE_CONFIG: LicenseConfig = {
  apiUrl: "https://license.argentos.ai/api",
  offlineGracePeriodHours: 72,
  validationIntervalHours: 24,
};
