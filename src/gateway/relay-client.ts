import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
/**
 * Outbound WebSocket relay client for the ArgentOS gateway.
 *
 * Connects to a relay server (e.g. wss://relay.argentos.ai/gateway) so that
 * mobile apps and remote pods can reach this gateway behind NAT without
 * opening any inbound ports.
 *
 * Frame protocol is defined in argent-relay/src/types.ts.
 */
import fs from "node:fs";
import path from "node:path";
import nacl from "tweetnacl";
import WebSocket from "ws";
import { STATE_DIR } from "../config/paths.js";
import { loadOrCreateGatewayKeys, signMessage } from "./gateway-keys.js";

// ---------------------------------------------------------------------------
// Types (mirrors argent-relay/src/types.ts — kept minimal to avoid dep)
// ---------------------------------------------------------------------------

interface GatewayRegisterFrame {
  type: "gateway-register";
  gatewayId: string;
  publicKey: string;
  timestamp: number;
  signature: string;
}

interface PairRequestFrame {
  type: "pair";
  pairingCode: string;
  devicePublicKey: string;
  deviceName: string;
  platform: "ios" | "android";
}

interface DataFrame {
  type: "data";
  from: string;
  to: string;
  payload: string;
  nonce: string;
}

interface PairAckFrame {
  type: "pair_ack";
  deviceId: string;
  deviceToken: string;
  gatewayName: string;
}

interface RelayAckFrame {
  type: "relay-ack";
  status: "ok" | "error";
  message?: string;
}

type RelayFrame =
  | { type: "ping" }
  | { type: "pong" }
  | RelayAckFrame
  | { type: "relay-error"; code: string; message: string }
  | PairRequestFrame
  | PairAckFrame
  | DataFrame
  | GatewayRegisterFrame;

// ---------------------------------------------------------------------------
// Paired device persistence
// ---------------------------------------------------------------------------

const PAIRED_DEVICES_FILE = "paired-devices.json";

export interface PairedDevice {
  deviceId: string;
  deviceName: string;
  platform: "ios" | "android";
  devicePublicKey: string;
  /** Base64-encoded X25519 shared key derived during pairing. */
  sharedKey: string;
  pairedAt: number;
}

function pairedDevicesPath(): string {
  return path.join(STATE_DIR, PAIRED_DEVICES_FILE);
}

function loadPairedDevices(): Map<string, PairedDevice> {
  try {
    const raw = fs.readFileSync(pairedDevicesPath(), "utf-8");
    const arr = JSON.parse(raw) as PairedDevice[];
    return new Map(arr.map((d) => [d.deviceId, d]));
  } catch {
    return new Map();
  }
}

function savePairedDevices(devices: Map<string, PairedDevice>): void {
  const filePath = pairedDevicesPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify([...devices.values()], null, 2) + "\n", {
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Crypto helpers (NaCl secretbox — XSalsa20-Poly1305)
// ---------------------------------------------------------------------------

function decryptPayload(
  cipherBase64: string,
  nonceBase64: string,
  sharedKeyBase64: string,
): string | null {
  const cipher = new Uint8Array(Buffer.from(cipherBase64, "base64"));
  const nonce = new Uint8Array(Buffer.from(nonceBase64, "base64"));
  const key = new Uint8Array(Buffer.from(sharedKeyBase64, "base64"));
  const result = nacl.secretbox.open(cipher, nonce, key);
  if (!result) return null;
  return new TextDecoder().decode(result);
}

function encryptPayload(
  plaintext: string,
  sharedKeyBase64: string,
): { payload: string; nonce: string } {
  const key = new Uint8Array(Buffer.from(sharedKeyBase64, "base64"));
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const message = new TextEncoder().encode(plaintext);
  const box = nacl.secretbox(message, nonce, key);
  return {
    payload: Buffer.from(box).toString("base64"),
    nonce: Buffer.from(nonce).toString("base64"),
  };
}

// ---------------------------------------------------------------------------
// Relay client configuration
// ---------------------------------------------------------------------------

export interface RelayClientConfig {
  /** Relay WebSocket URL, e.g. "wss://relay.argentos.ai/gateway" */
  url: string;
  /** Unique gateway identifier. Defaults to a hash of the public key. */
  gatewayId?: string;
  /** Friendly name shown to mobile devices during pairing. */
  gatewayName?: string;
  /** Initial reconnect delay in ms (default 5000). */
  reconnectIntervalMs?: number;
  /** Max reconnect delay in ms (default 60000). */
  maxReconnectIntervalMs?: number;
  /** Heartbeat ping interval in ms (default 30000). */
  heartbeatIntervalMs?: number;
  /** Heartbeat timeout in ms (default 90000). */
  heartbeatTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// RelayClient
// ---------------------------------------------------------------------------

export interface RelayClientEvents {
  /** Relay connection established and registered. */
  connected: [];
  /** Relay connection lost. */
  disconnected: [reason: string];
  /** A mobile device wants to pair. Dashboard should show approval UI. */
  "pair-request": [request: PairRequestFrame];
  /** Decrypted gateway protocol request from a mobile device. */
  "device-message": [deviceId: string, message: unknown];
  /** Relay-level error. */
  error: [error: Error];
}

export class RelayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Required<RelayClientConfig>;
  private keys = loadOrCreateGatewayKeys();
  private pairedDevices = loadPairedDevices();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private currentReconnectDelay: number;
  private shuttingDown = false;
  private registered = false;

  constructor(config: RelayClientConfig) {
    super();
    this.config = {
      url: config.url,
      gatewayId: config.gatewayId ?? this.deriveGatewayId(),
      gatewayName: config.gatewayName ?? "ArgentOS Gateway",
      reconnectIntervalMs: config.reconnectIntervalMs ?? 5000,
      maxReconnectIntervalMs: config.maxReconnectIntervalMs ?? 60000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 90000,
    };
    this.currentReconnectDelay = this.config.reconnectIntervalMs;
  }

  /** Derive a stable gateway ID from the Ed25519 public key. */
  private deriveGatewayId(): string {
    // Use first 12 bytes of the public key as a short hex identifier.
    const raw = Buffer.from(this.keys.publicKey, "base64");
    return `gw-${raw.subarray(0, 12).toString("hex")}`;
  }

  /** Connect to the relay server. */
  connect(): void {
    if (this.ws) return;
    this.shuttingDown = false;

    try {
      this.ws = new WebSocket(this.config.url, {
        headers: { "x-gateway-id": this.config.gatewayId },
      });
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      this.sendRegistration();
      this.startHeartbeat();
      this.currentReconnectDelay = this.config.reconnectIntervalMs;
    });

    this.ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf-8");
        const frame = JSON.parse(text) as RelayFrame;
        this.handleFrame(frame);
      } catch (err) {
        this.emit("error", new Error(`relay: invalid frame: ${String(err)}`));
      }
    });

    this.ws.on("close", (_code: number, reason: Buffer) => {
      this.cleanup();
      const msg = reason?.toString("utf-8") || "connection closed";
      this.emit("disconnected", msg);
      if (!this.shuttingDown) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (err: Error) => {
      this.emit("error", err);
      // The "close" event always follows, which triggers reconnect.
    });
  }

  /** Gracefully disconnect from the relay. */
  disconnect(): void {
    this.shuttingDown = true;
    this.cleanup();
    if (this.ws) {
      try {
        this.ws.close(1000, "gateway shutdown");
      } catch {
        // Ignore close errors during shutdown.
      }
      this.ws = null;
    }
  }

  /** Whether the relay connection is open and registered. */
  get isConnected(): boolean {
    return this.registered && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Send a data frame to a specific device through the relay. */
  sendToDevice(deviceId: string, message: unknown): boolean {
    const device = this.pairedDevices.get(deviceId);
    if (!device) return false;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;

    const plaintext = JSON.stringify(message);
    const { payload, nonce } = encryptPayload(plaintext, device.sharedKey);
    const frame: DataFrame = {
      type: "data",
      from: this.config.gatewayId,
      to: deviceId,
      payload,
      nonce,
    };
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  /**
   * Complete a pairing request: derive shared key, persist the device, and
   * send a pair_ack back through the relay.
   */
  approvePairing(request: PairRequestFrame): PairedDevice {
    const deviceId = `dev_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const deviceToken = randomUUID();

    // Derive X25519 shared key from Ed25519 keys (convert using NaCl).
    const gatewaySecretKey = new Uint8Array(Buffer.from(this.keys.secretKey, "base64"));
    const devicePubBytes = new Uint8Array(Buffer.from(request.devicePublicKey, "base64"));

    // Convert Ed25519 -> X25519 for Diffie-Hellman.
    // tweetnacl doesn't expose conversion directly, but we can use the
    // box.keyPair.fromSecretKey pattern since Ed25519 secretKey contains the seed.
    // For proper DH, we need the X25519 form. Use nacl.box.before().
    const gatewayX25519 = nacl.box.keyPair.fromSecretKey(gatewaySecretKey.slice(0, 32));
    const sharedKey = nacl.box.before(devicePubBytes, gatewayX25519.secretKey);

    const device: PairedDevice = {
      deviceId,
      deviceName: request.deviceName,
      platform: request.platform,
      devicePublicKey: request.devicePublicKey,
      sharedKey: Buffer.from(sharedKey).toString("base64"),
      pairedAt: Date.now(),
    };

    this.pairedDevices.set(deviceId, device);
    savePairedDevices(this.pairedDevices);

    // Send pair acknowledgment back through relay.
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const ack: PairAckFrame = {
        type: "pair_ack",
        deviceId,
        deviceToken,
        gatewayName: this.config.gatewayName,
      };
      this.ws.send(JSON.stringify(ack));
    }

    return device;
  }

  /** Get a paired device by ID. */
  getPairedDevice(deviceId: string): PairedDevice | undefined {
    return this.pairedDevices.get(deviceId);
  }

  /** List all paired devices. */
  listPairedDevices(): PairedDevice[] {
    return [...this.pairedDevices.values()];
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private sendRegistration(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const timestamp = Math.floor(Date.now() / 1000);
    const signData = `${this.config.gatewayId}${timestamp}`;
    const signature = signMessage(signData, this.keys.secretKey);

    const frame: GatewayRegisterFrame = {
      type: "gateway-register",
      gatewayId: this.config.gatewayId,
      publicKey: this.keys.publicKey,
      timestamp,
      signature,
    };
    this.ws.send(JSON.stringify(frame));
  }

  private handleFrame(frame: RelayFrame): void {
    switch (frame.type) {
      case "relay-ack":
        if (frame.status === "ok") {
          this.registered = true;
          this.emit("connected");
        } else {
          this.emit("error", new Error(`relay registration failed: ${frame.message ?? "unknown"}`));
        }
        break;

      case "relay-error":
        this.emit("error", new Error(`relay error [${frame.code}]: ${frame.message}`));
        break;

      case "ping":
        this.sendFrame({ type: "pong" });
        this.resetHeartbeatTimeout();
        break;

      case "pong":
        this.resetHeartbeatTimeout();
        break;

      case "pair":
        this.emit("pair-request", frame);
        break;

      case "data":
        this.handleDataFrame(frame as DataFrame);
        break;

      default:
        // Ignore unknown frame types for forward compatibility.
        break;
    }
  }

  private handleDataFrame(frame: DataFrame): void {
    const device = this.pairedDevices.get(frame.from);
    if (!device) {
      this.emit("error", new Error(`relay: data from unknown device ${frame.from}`));
      return;
    }

    const plaintext = decryptPayload(frame.payload, frame.nonce, device.sharedKey);
    if (plaintext === null) {
      this.emit("error", new Error(`relay: decryption failed for device ${frame.from}`));
      return;
    }

    try {
      const message = JSON.parse(plaintext);
      this.emit("device-message", frame.from, message);
    } catch {
      this.emit("error", new Error(`relay: invalid JSON from device ${frame.from}`));
    }
  }

  private sendFrame(frame: { type: string; [key: string]: unknown }): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendFrame({ type: "ping" });
    }, this.config.heartbeatIntervalMs);
    this.resetHeartbeatTimeout();
  }

  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
    }
    this.heartbeatTimeoutTimer = setTimeout(() => {
      this.emit("error", new Error("relay: heartbeat timeout"));
      // Force reconnect.
      if (this.ws) {
        try {
          this.ws.close(4008, "heartbeat timeout");
        } catch {
          // ignore
        }
      }
    }, this.config.heartbeatTimeoutMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ws = null;
      this.connect();
    }, this.currentReconnectDelay);
    // Exponential backoff: double the delay each time, up to max.
    this.currentReconnectDelay = Math.min(
      this.currentReconnectDelay * 2,
      this.config.maxReconnectIntervalMs,
    );
  }

  private cleanup(): void {
    this.registered = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
