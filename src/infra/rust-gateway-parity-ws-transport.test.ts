import { describe, expect, it } from "vitest";
import type { RustGatewayParityFixture } from "./rust-gateway-parity-fixtures.js";
import { createRustGatewayWsParityTransport } from "./rust-gateway-parity-ws-transport.js";

type Listener = (...args: never[]) => void;

class FakeParityWebSocket {
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly onceListeners = new Map<string, Set<Listener>>();

  constructor(readonly url: string) {
    queueMicrotask(() => this.emit("open"));
  }

  send(data: string): void {
    const frame = JSON.parse(data) as { id: string; method: string };
    this.sent.push(frame);
    queueMicrotask(() => {
      this.emit(
        "message",
        JSON.stringify({
          type: "res",
          id: frame.id,
          ok: frame.method !== "workflows.list",
          payload: frame.method === "connect" ? { type: "hello-ok" } : { method: frame.method },
          error:
            frame.method === "workflows.list"
              ? { code: "INVALID_REQUEST", message: "unknown method: workflows.list" }
              : undefined,
        }),
      );
    });
  }

  close(): void {
    this.emit("close", 1000, Buffer.from(""));
  }

  once(event: "open" | "close" | "error", listener: Listener): void {
    const listeners = this.onceListeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.onceListeners.set(event, listeners);
  }

  on(event: "message", listener: Listener): void {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: "message", listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  protected emit(event: string, ...args: never[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
    const once = this.onceListeners.get(event);
    if (once) {
      this.onceListeners.delete(event);
      for (const listener of once) {
        listener(...args);
      }
    }
  }
}

class NeverRespondsWebSocket extends FakeParityWebSocket {
  override send(data: string): void {
    const frame = JSON.parse(data) as { id: string; method: string };
    this.sent.push(frame);
  }
}

class RejectingConnectWebSocket extends FakeParityWebSocket {
  override send(data: string): void {
    const frame = JSON.parse(data) as { id: string; method: string };
    this.sent.push(frame);
    queueMicrotask(() => {
      this.emit(
        "message",
        JSON.stringify({
          type: "res",
          id: frame.id,
          ok: false,
          error: { code: "INVALID_REQUEST", message: "invalid connect params" },
        }),
      );
    });
  }
}

const fixture: RustGatewayParityFixture = {
  id: "health",
  surface: "health",
  method: "health",
  safety: "read-only",
  expectedParity: "schema-compatible",
  reason: "test",
};

describe("createRustGatewayWsParityTransport", () => {
  it("connects to the requested endpoint and sends connect before RPC fixtures", async () => {
    const sockets: FakeParityWebSocket[] = [];
    const transport = createRustGatewayWsParityTransport({
      nodeUrl: "ws://node",
      rustUrl: "ws://rust",
      token: "token-1",
      webSocketFactory: (url) => {
        const socket = new FakeParityWebSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    const response = await transport({ endpoint: "rust", fixture });

    const socket = sockets[0];
    expect(socket?.url).toBe("ws://rust");
    expect(socket?.sent).toHaveLength(2);
    expect((socket?.sent[0] as { method?: string } | undefined)?.method).toBe("connect");
    expect(socket?.sent[0]).toMatchObject({
      params: {
        client: {
          id: "test",
          mode: "test",
        },
      },
    });
    expect((socket?.sent[1] as { method?: string } | undefined)?.method).toBe("health");
    expect(response).toMatchObject({ type: "res", ok: true });
  });

  it("returns the connect response directly for connect fixtures", async () => {
    const sockets: FakeParityWebSocket[] = [];
    const connectFixture: RustGatewayParityFixture = {
      ...fixture,
      id: "connect-v3-token",
      surface: "connect",
      method: "connect",
    };
    const transport = createRustGatewayWsParityTransport({
      nodeUrl: "ws://node",
      rustUrl: "ws://rust",
      webSocketFactory: (url) => {
        const socket = new FakeParityWebSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    const response = await transport({ endpoint: "node", fixture: connectFixture });

    expect(sockets[0]?.url).toBe("ws://node");
    expect(sockets[0]?.sent).toHaveLength(1);
    expect(response).toMatchObject({ type: "res", ok: true });
  });

  it("can send failed-auth connect fixtures without using the shared service token", async () => {
    const sockets: FakeParityWebSocket[] = [];
    const transport = createRustGatewayWsParityTransport({
      nodeUrl: "ws://node",
      rustUrl: "ws://rust",
      token: "shared-token",
      webSocketFactory: (url) => {
        const socket = new FakeParityWebSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    await transport({
      endpoint: "node",
      fixture: {
        ...fixture,
        id: "connect-missing-token",
        surface: "connect",
        method: "connect",
        authTokenOverride: null,
      },
    });
    await transport({
      endpoint: "rust",
      fixture: {
        ...fixture,
        id: "connect-wrong-token",
        surface: "connect",
        method: "connect",
        authTokenOverride: "wrong-token",
      },
    });

    expect(
      (sockets[0]?.sent[0] as { params?: Record<string, unknown> } | undefined)?.params,
    ).not.toHaveProperty("auth");
    expect(sockets[1]?.sent[0]).toMatchObject({ params: { auth: { token: "wrong-token" } } });
  });

  it("returns a failed connect response instead of sending an RPC after rejected handshake", async () => {
    const sockets: RejectingConnectWebSocket[] = [];
    const transport = createRustGatewayWsParityTransport({
      nodeUrl: "ws://node",
      rustUrl: "ws://rust",
      webSocketFactory: (url) => {
        const socket = new RejectingConnectWebSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    const response = await transport({ endpoint: "node", fixture });

    expect(sockets[0]?.sent).toHaveLength(1);
    expect(response).toMatchObject({
      type: "res",
      ok: false,
      error: { message: "invalid connect params" },
    });
  });

  it("uses a fixture timeout override for slow read-only surfaces", async () => {
    const sockets: NeverRespondsWebSocket[] = [];
    const transport = createRustGatewayWsParityTransport({
      nodeUrl: "ws://node",
      rustUrl: "ws://rust",
      timeoutMs: 1,
      webSocketFactory: (url) => {
        const socket = new NeverRespondsWebSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    await expect(
      transport({
        endpoint: "node",
        fixture: {
          ...fixture,
          timeoutMs: 25,
        },
      }),
    ).rejects.toThrow("timeout waiting for websocket message");
    expect(sockets[0]?.sent).toHaveLength(1);
  });
});
