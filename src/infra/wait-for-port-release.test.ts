import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  extractPortFromProgramArguments,
  probePort,
  waitForPortRelease,
  type PortProbeResult,
} from "./wait-for-port-release.js";

function listenOnRandomPort(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error("Failed to bind random port"));
      }
    });
  });
}

describe("probePort", () => {
  it("reports free when nothing is listening", async () => {
    // Get a free port and immediately close it.
    const { server, port } = await listenOnRandomPort();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await probePort(port, "127.0.0.1")).toBe("free");
  });

  it("reports busy when a server is already listening", async () => {
    const { server, port } = await listenOnRandomPort();
    try {
      expect(await probePort(port, "127.0.0.1")).toBe("busy");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("waitForPortRelease", () => {
  it("returns released=true immediately when the port is already free", async () => {
    const result = await waitForPortRelease({
      port: 1,
      timeoutMs: 200,
      intervalMs: 50,
      probe: async () => "free" satisfies PortProbeResult,
    });
    expect(result.released).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it("polls until the port is released and then returns released=true", async () => {
    let calls = 0;
    const result = await waitForPortRelease({
      port: 18789,
      timeoutMs: 1_000,
      intervalMs: 25,
      probe: async (): Promise<PortProbeResult> => {
        calls += 1;
        // Busy for the first two checks, then free.
        return calls < 3 ? "busy" : "free";
      },
    });
    expect(result.released).toBe(true);
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it("returns released=false when the port stays busy past the timeout", async () => {
    const result = await waitForPortRelease({
      port: 18789,
      timeoutMs: 120,
      intervalMs: 30,
      probe: async () => "busy" satisfies PortProbeResult,
    });
    expect(result.released).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(120);
    expect(result.attempts).toBeGreaterThan(1);
  });

  it("integrates with a real socket: detects a busy port releasing", async () => {
    const { server, port } = await listenOnRandomPort();
    // Schedule the server to close shortly after we begin polling.
    setTimeout(() => server.close(), 75);
    const result = await waitForPortRelease({
      port,
      timeoutMs: 2_000,
      intervalMs: 25,
    });
    expect(result.released).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("extractPortFromProgramArguments", () => {
  it("returns null for empty input", () => {
    expect(extractPortFromProgramArguments(undefined)).toBeNull();
    expect(extractPortFromProgramArguments([])).toBeNull();
  });

  it("parses --port <num>", () => {
    expect(
      extractPortFromProgramArguments(["node", "entry.js", "gateway", "--port", "18789"]),
    ).toBe(18789);
  });

  it("parses --port=<num>", () => {
    expect(extractPortFromProgramArguments(["node", "entry.js", "gateway", "--port=18789"])).toBe(
      18789,
    );
  });

  it("ignores non-numeric values", () => {
    expect(extractPortFromProgramArguments(["node", "gateway", "--port", "abc"])).toBeNull();
    expect(extractPortFromProgramArguments(["node", "gateway", "--port=NaN"])).toBeNull();
  });

  it("rejects non-positive values", () => {
    expect(extractPortFromProgramArguments(["node", "gateway", "--port", "0"])).toBeNull();
    expect(extractPortFromProgramArguments(["node", "gateway", "--port", "-1"])).toBeNull();
  });
});
