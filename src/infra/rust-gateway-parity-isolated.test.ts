import { describe, expect, it } from "vitest";
import type { RustGatewayParityFixture } from "./rust-gateway-parity-fixtures.js";
import type { RustGatewayParityWebSocket } from "./rust-gateway-parity-ws-transport.js";
import { runIsolatedRustGatewayParity } from "./rust-gateway-parity-isolated.js";

type Listener = (...args: never[]) => void;

class FakeParityWebSocket implements RustGatewayParityWebSocket {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly onceListeners = new Map<string, Set<Listener>>();

  constructor(readonly url: string) {
    queueMicrotask(() => this.emit("open"));
  }

  send(data: string): void {
    const frame = JSON.parse(data) as { id: string; method: string };
    queueMicrotask(() => {
      this.emit(
        "message",
        JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload:
            frame.method === "connect"
              ? { type: "hello-ok" }
              : { ok: true, durationMs: 1, defaultAgentId: "main" },
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

  private emit(event: string, ...args: never[]): void {
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

const fixture: RustGatewayParityFixture = {
  id: "health",
  surface: "health",
  method: "health",
  safety: "read-only",
  expectedParity: "schema-compatible",
  reason: "test",
};

describe("runIsolatedRustGatewayParity", () => {
  it("starts both services, runs replay, and stops services in reverse order", async () => {
    const events: string[] = [];

    const report = await runIsolatedRustGatewayParity({
      fixtures: [fixture],
      nowMs: () => 42,
      startNodeGateway: async () => {
        events.push("start-node");
        return {
          url: "ws://node",
          stop: () => events.push("stop-node"),
        };
      },
      startRustGateway: async () => {
        events.push("start-rust");
        return {
          url: "ws://rust",
          stop: () => events.push("stop-rust"),
        };
      },
      webSocketFactory: (url) => new FakeParityWebSocket(url),
    });

    expect(report.generatedAtMs).toBe(42);
    expect(report.totals.passed).toBe(1);
    expect(events).toEqual(["start-node", "start-rust", "stop-rust", "stop-node"]);
  });

  it("stops already-started services when later startup fails", async () => {
    const events: string[] = [];

    await expect(
      runIsolatedRustGatewayParity({
        fixtures: [fixture],
        startNodeGateway: async () => {
          events.push("start-node");
          return {
            url: "ws://node",
            stop: () => events.push("stop-node"),
          };
        },
        startRustGateway: async () => {
          events.push("start-rust");
          throw new Error("rust failed");
        },
      }),
    ).rejects.toThrow("rust failed");

    expect(events).toEqual(["start-node", "start-rust", "stop-node"]);
  });
});
