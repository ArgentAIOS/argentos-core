/**
 * macOS Keychain — Master encryption key management.
 *
 * Stores and retrieves a 256-bit AES master key in the macOS Keychain.
 * Falls back to a file-based key on non-macOS platforms.
 *
 * The master key encrypts service keys at rest in service-keys.json
 * and (when PG is enabled) the encrypted_value column in service_keys.
 *
 * SAFETY: The key is always stored in BOTH keychain AND file for redundancy.
 * A new key is NEVER auto-generated when encrypted secrets already exist —
 * doing so would orphan all existing encrypted data.
 */

import { execSync } from "node:child_process";
import { createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("keychain");

const KEYCHAIN_SERVICE = "ArgentOS-MasterKey";
const KEYCHAIN_ACCOUNT = "ArgentOS";
const KEY_FILE_NAME = ".master-key";
const SERVICE_KEYS_FILE_NAME = "service-keys.json";
const KEYCHAIN_AUTO_MIGRATE_ENV = "ARGENT_KEYCHAIN_MIGRATE_FILE_KEY";
const KEYCHAIN_DISABLE_WRITE_ENV = "ARGENT_KEYCHAIN_DISABLE_WRITE";
const SECRET_PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;

/**
 * Read the master key from macOS Keychain.
 */
function readKeychainKey(): Buffer | null {
  if (process.platform !== "darwin") return null;
  try {
    const hex = execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w`,
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const buf = Buffer.from(hex, "hex");
    if (buf.length !== 32) return null;
    return buf;
  } catch {
    return null;
  }
}

/**
 * Write the master key to macOS Keychain.
 */
function writeKeychainKey(key: Buffer): boolean {
  if (process.platform !== "darwin") return false;
  const disableRaw = process.env[KEYCHAIN_DISABLE_WRITE_ENV]?.trim().toLowerCase();
  if (disableRaw === "1" || disableRaw === "true" || disableRaw === "yes" || disableRaw === "on") {
    log.info("skipping macOS Keychain write because ARGENT_KEYCHAIN_DISABLE_WRITE is enabled");
    return false;
  }
  const hex = key.toString("hex");
  try {
    // -U updates in place when item exists; avoids delete+add double-prompt behavior.
    execSync(
      `security add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w "${hex}"`,
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );
    log.info("stored master key in macOS Keychain");
    return true;
  } catch (err) {
    log.warn("failed to write master key to Keychain", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function shouldAutoMigrateFileKeyToKeychain(): boolean {
  if (process.platform !== "darwin") return false;
  const raw = process.env[KEYCHAIN_AUTO_MIGRATE_ENV]?.trim().toLowerCase();
  if (!raw) return false;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Resolve the file-based key path (fallback for non-macOS).
 * File is stored at ~/.argentos/.master-key with 0o600 permissions.
 */
function resolveKeyFilePath(): string {
  const home = process.env.HOME ?? "/tmp";
  return path.join(home, ".argentos", KEY_FILE_NAME);
}

/**
 * Read the master key from the file-based fallback.
 */
function readFileKey(): Buffer | null {
  const keyPath = resolveKeyFilePath();
  try {
    const hex = fs.readFileSync(keyPath, "utf-8").trim();
    const buf = Buffer.from(hex, "hex");
    if (buf.length !== 32) return null;
    return buf;
  } catch {
    return null;
  }
}

/**
 * Write the master key to the file-based fallback.
 */
function writeFileKey(key: Buffer): boolean {
  const keyPath = resolveKeyFilePath();
  try {
    const dir = path.dirname(keyPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyPath, key.toString("hex"), "utf-8");
    fs.chmodSync(keyPath, 0o600);
    log.info("stored master key in file", { path: keyPath });
    return true;
  } catch (err) {
    log.warn("failed to write master key to file", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Check whether encrypted secrets exist in service-keys.json.
 * If they do, generating a new master key would orphan them.
 */
function hasEncryptedSecrets(): boolean {
  const home = process.env.HOME ?? "/tmp";
  const filePath = path.join(home, ".argentos", SERVICE_KEYS_FILE_NAME);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw.includes('"enc:v1:');
  } catch {
    return false;
  }
}

function readEncryptedServiceKeyValues(): string[] {
  const home = process.env.HOME ?? "/tmp";
  const filePath = path.join(home, ".argentos", SERVICE_KEYS_FILE_NAME);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      keys?: Array<{ value?: unknown }>;
    };
    return (parsed.keys ?? [])
      .map((entry) => (typeof entry.value === "string" ? entry.value : ""))
      .filter((value) => value.startsWith(SECRET_PREFIX));
  } catch {
    return [];
  }
}

function canDecryptSecretValue(value: string, key: Buffer): boolean {
  const parts = value.slice(SECRET_PREFIX.length).split(":");
  if (parts.length !== 3) {
    return false;
  }
  try {
    const [ivHex, authTagHex, cipherHex] = parts;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex!, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex!, "hex"));
    decipher.update(cipherHex!, "hex", "utf8");
    decipher.final("utf8");
    return true;
  } catch {
    return false;
  }
}

function canDecryptExistingSecrets(key: Buffer): boolean {
  const encryptedValues = readEncryptedServiceKeyValues();
  if (encryptedValues.length === 0) {
    return true;
  }
  return encryptedValues.every((value) => canDecryptSecretValue(value, key));
}

/**
 * Ensure the key is stored in both locations for redundancy.
 * Called whenever a key is successfully read from either source.
 */
function ensureRedundantStorage(key: Buffer, source: "keychain" | "file"): void {
  if (source === "keychain") {
    // Ensure file copy exists
    const existing = readFileKey();
    if (!existing || !existing.equals(key)) {
      writeFileKey(key);
    }
  } else {
    // Ensure keychain copy exists (opt-in on macOS to avoid prompt loops at startup)
    if (shouldAutoMigrateFileKeyToKeychain()) {
      writeKeychainKey(key);
    }
  }
}

/**
 * Get the 256-bit AES master key. Auto-generates and stores on first call.
 *
 * Resolution order:
 *   1. In-memory cache
 *   2. macOS Keychain (darwin only)
 *   3. File-based fallback (~/.argentos/.master-key)
 *   4. Generate new key — ONLY if no encrypted secrets exist
 *
 * SAFETY: If encrypted secrets exist but no master key can be found,
 * this throws instead of generating a new key. A new key would make
 * all existing encrypted data permanently unrecoverable.
 */
export function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const keychainKey = readKeychainKey();
  const fileKey = readFileKey();

  if (hasEncryptedSecrets()) {
    if (keychainKey && canDecryptExistingSecrets(keychainKey)) {
      cachedKey = keychainKey;
      ensureRedundantStorage(keychainKey, "keychain");
      return keychainKey;
    }
    if (fileKey && canDecryptExistingSecrets(fileKey)) {
      cachedKey = fileKey;
      ensureRedundantStorage(fileKey, "file");
      return fileKey;
    }
    if (keychainKey || fileKey) {
      log.error(
        "CRITICAL: Available master key cannot decrypt existing encrypted service keys. " +
          "Restore the matching master key before reading or rotating secrets.",
      );
      throw new Error(
        "Master encryption key mismatch. Existing encrypted service keys cannot be decrypted.",
      );
    }
  }

  // Try Keychain first when there are no encrypted secrets to validate against.
  if (keychainKey) {
    cachedKey = keychainKey;
    ensureRedundantStorage(keychainKey, "keychain");
    return keychainKey;
  }

  // Try file fallback.
  if (fileKey) {
    cachedKey = fileKey;
    ensureRedundantStorage(fileKey, "file");
    return fileKey;
  }

  // No key found anywhere. If encrypted secrets exist, refuse to generate
  // a new key — that would orphan all existing encrypted data.
  if (hasEncryptedSecrets()) {
    const keyPath = resolveKeyFilePath();
    log.error(
      "CRITICAL: Master key not found but encrypted secrets exist. " +
        "Generating a new key would orphan all encrypted service keys. " +
        `Restore the master key to keychain (security add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w "<hex>") ` +
        `or file (${keyPath}), then restart the gateway.`,
    );
    throw new Error(
      "Master encryption key not found. Encrypted secrets exist — refusing to generate a new key. " +
        `Restore the key to ${keyPath} or macOS Keychain ("${KEYCHAIN_SERVICE}"). ` +
        "See gateway log for details.",
    );
  }

  // Fresh install — no encrypted secrets, safe to generate
  log.info("generating new master encryption key (no existing encrypted secrets found)");
  const newKey = randomBytes(32);
  // Store in BOTH locations for redundancy
  const storedKeychain = writeKeychainKey(newKey);
  const storedFile = writeFileKey(newKey);
  if (!storedKeychain && !storedFile) {
    log.warn("master key generated but could not be persisted to any location");
  }
  cachedKey = newKey;
  return newKey;
}

/**
 * Check if a master key exists without generating one.
 */
export function hasMasterKey(): boolean {
  if (cachedKey) return true;
  return readKeychainKey() !== null || readFileKey() !== null;
}

/** Reset the in-memory cache (for tests). */
export function resetMasterKeyCache(): void {
  cachedKey = null;
}

/**
 * Generate a new master key during install. Does NOT auto-store.
 * Returns the hex string so the installer can display it for backup.
 */
export function generateMasterKeyForInstall(): {
  hex: string;
  stored: { keychain: boolean; file: boolean };
} {
  const key = randomBytes(32);
  const hex = key.toString("hex");
  const storedKeychain = writeKeychainKey(key);
  const storedFile = writeFileKey(key);
  cachedKey = key;
  return { hex, stored: { keychain: storedKeychain, file: storedFile } };
}

/**
 * Restore a master key from operator-provided hex string.
 * Used by the dashboard restore flow and CLI recovery.
 * Validates the key, stores in both locations, clears cache.
 */
export function restoreMasterKey(hex: string): {
  ok: boolean;
  error?: string;
  stored: { keychain: boolean; file: boolean };
} {
  const trimmed = hex.trim();
  if (!/^[0-9a-f]{64}$/i.test(trimmed)) {
    return {
      ok: false,
      error: "Invalid key format. Expected 64 hex characters (256-bit key).",
      stored: { keychain: false, file: false },
    };
  }
  const key = Buffer.from(trimmed, "hex");
  if (key.length !== 32) {
    return {
      ok: false,
      error: "Invalid key length. Expected 32 bytes.",
      stored: { keychain: false, file: false },
    };
  }
  const storedKeychain = writeKeychainKey(key);
  const storedFile = writeFileKey(key);
  if (!storedKeychain && !storedFile) {
    return {
      ok: false,
      error: "Failed to store key in both keychain and file.",
      stored: { keychain: false, file: false },
    };
  }
  cachedKey = key;
  log.info("master key restored by operator");
  return { ok: true, stored: { keychain: storedKeychain, file: storedFile } };
}

/**
 * Get the current master key as hex (for backup display).
 * Returns null if no key exists.
 */
export function getMasterKeyHex(): string | null {
  if (cachedKey) return cachedKey.toString("hex");
  const keychainKey = readKeychainKey();
  if (keychainKey) return keychainKey.toString("hex");
  const fileKey = readFileKey();
  if (fileKey) return fileKey.toString("hex");
  return null;
}
