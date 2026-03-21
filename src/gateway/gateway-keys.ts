/**
 * Gateway Ed25519 keypair management for relay server authentication.
 *
 * Keys are stored at ~/.argentos/gateway-keys.json and are generated on
 * first use via tweetnacl.
 */
import fs from "node:fs";
import path from "node:path";
import nacl from "tweetnacl";
import { STATE_DIR } from "../config/paths.js";

const KEYS_FILENAME = "gateway-keys.json";

export interface GatewayKeyPair {
  publicKey: string; // Base64-encoded
  secretKey: string; // Base64-encoded
}

function keysPath(): string {
  return path.join(STATE_DIR, KEYS_FILENAME);
}

/**
 * Load an existing Ed25519 keypair from disk, or generate a new one and persist it.
 */
export function loadOrCreateGatewayKeys(): GatewayKeyPair {
  const filePath = keysPath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { publicKey?: string; secretKey?: string };
    if (
      typeof parsed.publicKey === "string" &&
      typeof parsed.secretKey === "string" &&
      parsed.publicKey.length > 0 &&
      parsed.secretKey.length > 0
    ) {
      return { publicKey: parsed.publicKey, secretKey: parsed.secretKey };
    }
  } catch {
    // File doesn't exist or is invalid — generate below.
  }

  const kp = nacl.sign.keyPair();
  const keys: GatewayKeyPair = {
    publicKey: Buffer.from(kp.publicKey).toString("base64"),
    secretKey: Buffer.from(kp.secretKey).toString("base64"),
  };

  // Ensure state directory exists before writing.
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(keys, null, 2) + "\n", {
    mode: 0o600,
  });

  return keys;
}

/**
 * Sign a UTF-8 message string with the given Ed25519 secret key (Base64).
 * Returns the detached signature as a Base64 string.
 */
export function signMessage(message: string, secretKeyBase64: string): string {
  const secretKey = new Uint8Array(Buffer.from(secretKeyBase64, "base64"));
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return Buffer.from(signature).toString("base64");
}
