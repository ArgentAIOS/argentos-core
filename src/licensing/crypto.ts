/**
 * Encryption utilities for license storage
 * Uses AES-256-GCM for authenticated encryption
 */

import crypto from "node:crypto";
import os from "node:os";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits

/**
 * Derive encryption key from machine-specific data
 * This provides basic obfuscation - not security against determined attackers
 * but prevents casual reading of license data from config files
 */
function deriveKey(): Buffer {
  const machineData = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || "unknown",
  ].join("|");

  return crypto.createHash("sha256").update(machineData).digest().slice(0, KEY_LENGTH);
}

/**
 * Encrypt license data
 */
export function encryptLicense(data: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag();

  // Format: iv:encrypted:authTag (all base64)
  return `${iv.toString("base64")}:${encrypted}:${authTag.toString("base64")}`;
}

/**
 * Decrypt license data
 */
export function decryptLicense(encrypted: string): string | null {
  try {
    const parts = encrypted.split(":");
    if (parts.length !== 3) {
      return null;
    }

    const [ivB64, encryptedB64, authTagB64] = parts;
    const key = deriveKey();
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedB64, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch {
    // Decryption failed (wrong key, corrupted data, etc.)
    return null;
  }
}

/**
 * Generate unique machine ID
 * Used for license activation tracking
 */
export function getMachineId(): string {
  const machineData = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || "unknown",
    os.networkInterfaces()["en0"]?.[0]?.mac || "unknown",
  ].join("|");

  return crypto.createHash("sha256").update(machineData).digest("hex").slice(0, 32);
}
