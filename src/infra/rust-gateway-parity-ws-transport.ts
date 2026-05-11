import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { RustGatewayParityFixture } from "./rust-gateway-parity-fixtures.js";
import type { RustGatewayParityReplayTransport } from "./rust-gateway-parity-runner.js";
import { GATEWAY_CLIENT_IDS, GATEWAY_CLIENT_MODES } from "../gateway/protocol/client-info.js";
import { PROTOCOL_VERSION, type RequestFrame } from "../gateway/protocol/index.js";
import { rawDataToString } from "./ws.js";

export type RustGatewayParityWsTransportOptions = {
  nodeUrl: string;
  rustUrl: string;
  token?: string;
  timeoutMs?: number;
  webSocketFactory?: (url: string) => RustGatewayParityWebSocket;
};

export type RustGatewayParityWebSocket = {
  send(data: string): void;
  close(): void;
  once(event: "open", listener: () => void): void;
  once(event: "close", listener: (code: number, reason: Buffer) => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  on(event: "message", listener: (data: unknown) => void): void;
  off(event: "message", listener: (data: unknown) => void): void;
};

type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

export function createRustGatewayWsParityTransport(
  options: RustGatewayParityWsTransportOptions,
): RustGatewayParityReplayTransport {
  return async ({ endpoint, fixture }) => {
    const url = endpoint === "node" ? options.nodeUrl : options.rustUrl;
    const timeoutMs = fixture.timeoutMs ?? options.timeoutMs;
    const client = createClient(url, options.webSocketFactory);
    try {
      await client.open(timeoutMs);
      if (fixture.method === "connect") {
        return await client.request(
          buildConnectRequest(resolveFixtureToken(options.token, fixture)),
          timeoutMs,
        );
      }
      const connect = await client.request(
        buildConnectRequest(resolveFixtureToken(options.token, fixture)),
        timeoutMs,
      );
      if (isRecord(connect) && connect.type === "res" && connect.ok === false) {
        return connect;
      }
      return await client.request(buildFixtureRequest(fixture), timeoutMs);
    } finally {
      client.close();
    }
  };
}

function createClient(
  url: string,
  webSocketFactory: RustGatewayParityWsTransportOptions["webSocketFactory"],
) {
  const ws = webSocketFactory ? webSocketFactory(url) : new WebSocket(url);
  return new ParityWsClient(ws);
}

class ParityWsClient {
  private readonly waiters: Array<{
    predicate: (message: unknown) => boolean;
    resolve: (message: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(private readonly ws: RustGatewayParityWebSocket) {
    this.ws.on("message", this.handleMessage);
  }

  open(timeoutMs = 5_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout opening websocket")), timeoutMs);
      this.ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.ws.once("close", (code, reason) => {
        clearTimeout(timer);
        reject(new Error(`websocket closed before open ${code}: ${reason.toString()}`));
      });
    });
  }

  async request(frame: RequestFrame, timeoutMs = 5_000): Promise<unknown> {
    const response = this.waitForResponse(frame.id, timeoutMs);
    this.ws.send(JSON.stringify(frame));
    return await response;
  }

  waitForResponse(id: string, timeoutMs = 5_000): Promise<GatewayResponseFrame> {
    return this.waitForMessage(
      (message): message is GatewayResponseFrame =>
        isRecord(message) && message.type === "res" && message.id === id,
      timeoutMs,
    ) as Promise<GatewayResponseFrame>;
  }

  waitForEvent(event: string, timeoutMs = 5_000): Promise<unknown> {
    return this.waitForMessage(
      (message) => isRecord(message) && message.type === "event" && message.event === event,
      timeoutMs,
    );
  }

  close(): void {
    this.ws.off("message", this.handleMessage);
    this.ws.close();
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("websocket closed"));
    }
  }

  private waitForMessage(
    predicate: (message: unknown) => boolean,
    timeoutMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) {
            this.waiters.splice(index, 1);
          }
          reject(new Error("timeout waiting for websocket message"));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private readonly handleMessage = (data: unknown) => {
    const message = parseMessage(data);
    for (const waiter of this.waiters) {
      if (!waiter.predicate(message)) {
        continue;
      }
      const index = this.waiters.indexOf(waiter);
      if (index >= 0) {
        this.waiters.splice(index, 1);
      }
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
  };
}

function buildConnectRequest(token: string | undefined): RequestFrame {
  return {
    type: "req",
    id: `connect-${randomUUID()}`,
    method: "connect",
    params: {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: GATEWAY_CLIENT_IDS.TEST,
        displayName: "Rust Gateway Parity",
        version: "0.0.0-test",
        platform: "test",
        mode: GATEWAY_CLIENT_MODES.TEST,
      },
      caps: [],
      commands: [],
      auth: token ? { token } : undefined,
    },
  };
}

function resolveFixtureToken(
  defaultToken: string | undefined,
  fixture: RustGatewayParityFixture,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(fixture, "authTokenOverride")) {
    return defaultToken;
  }
  return fixture.authTokenOverride ?? undefined;
}

function buildFixtureRequest(fixture: RustGatewayParityFixture): RequestFrame {
  return {
    type: "req",
    id: `${fixture.id}-${randomUUID()}`,
    method: fixture.method,
    params: fixture.params,
  };
}

function parseMessage(data: unknown): unknown {
  try {
    return JSON.parse(rawDataToString(data as Parameters<typeof rawDataToString>[0]));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
