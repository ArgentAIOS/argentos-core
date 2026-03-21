/**
 * Secret Encryption — AES-256-GCM encrypt/decrypt using the Keychain master key.
 *
 * Used by service-keys.ts to encrypt API key values at rest.
 * Format: "enc:v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>"
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getMasterKey } from "./keychain.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard
const PREFIX = "enc:v1:";

/**
 * Encrypt a plaintext string using AES-256-GCM with the master key.
 * Returns a prefixed string: "enc:v1:<iv>:<tag>:<ciphertext>"
 */
export function encryptSecret(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${PREFIX}${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an encrypted secret string.
 * Accepts both encrypted ("enc:v1:...") and plaintext strings.
 * Plaintext strings are returned as-is (backward compatibility).
 */
export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX)) {
    return value; // Plaintext — backward compatible
  }

  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted secret format");
  }

  const [ivHex, authTagHex, cipherHex] = parts;
  const key = getMasterKey();
  const iv = Buffer.from(ivHex!, "hex");
  const authTag = Buffer.from(authTagHex!, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherHex!, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Check if a value is in encrypted format.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}
