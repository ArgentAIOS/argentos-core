import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createExecutiveShadowClient,
  type ExecutiveShadowClient,
} from "./executive-shadow-client.js";

async function allocatePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("ephemeral port allocation failed"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth(client: ExecutiveShadowClient, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = await client.getHealth();
      if (health.status === "ok") {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("executive shadow daemon did not become healthy in time");
}

const spawned: ChildProcessWithoutNullStreams[] = [];

afterEach(async () => {
  await Promise.all(
    spawned.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode != null || child.killed) {
            resolve();
            return;
          }
          child.once("exit", () => resolve());
          child.kill("SIGTERM");
          setTimeout(() => {
            if (child.exitCode == null) {
              child.kill("SIGKILL");
            }
          }, 1_000);
        }),
    ),
  );
});

describe("ExecutiveShadowClient integration", () => {
  it("talks to a live argent-execd daemon", async () => {
    const port = await allocatePort();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-execd-ts-int-"));
    const daemonPath = path.resolve(
      process.cwd(),
      "rust",
      "target",
      "debug",
      process.platform === "win32" ? "argent-execd.exe" : "argent-execd",
    );
    const daemon = spawn(daemonPath, [], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ARGENT_EXECD_BIND: `127.0.0.1:${port}`,
        ARGENT_EXECD_STATE_DIR: stateDir,
        ARGENT_EXECD_TICK_INTERVAL_MS: "10000",
        ARGENT_EXECD_DEFAULT_LEASE_MS: "5000",
      },
      stdio: "pipe",
    });
    spawned.push(daemon);

    const client = createExecutiveShadowClient({
      baseUrl: `http://127.0.0.1:${port}`,
      experimentalWrites: true,
    });
    await waitForHealth(client);

    const before = await client.getHealth();
    expect(before.status).toBe("ok");

    await client.experimentalRequestLane({
      lane: "operator",
      priority: 95,
      reason: "integration-test",
      leaseMs: 5000,
    });
    await client.experimentalTick({ count: 1 });

    const state = await client.getState();
    expect(state.state.active_lane).toBe("operator");
    expect(state.state.lanes.operator.reason).toBe("integration-test");

    const journal = await client.getJournal(10);
    expect(journal.some((record) => record.event.type === "lane_requested")).toBe(true);
    expect(journal.some((record) => record.event.type === "lane_activated")).toBe(true);
    const timeline = await client.getTimeline(10);
    expect(timeline.recentEvents.some((event) => event.type === "lane_activated")).toBe(true);
    expect(timeline.lastActivationAtMs).not.toBeNull();

    await client.experimentalShutdown({ reason: "integration-test-complete" });
  }, 20_000);

  it("observes lane transition metrics across lease expiry", async () => {
    const port = await allocatePort();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-execd-ts-metrics-"));
    const daemonPath = path.resolve(
      process.cwd(),
      "rust",
      "target",
      "debug",
      process.platform === "win32" ? "argent-execd.exe" : "argent-execd",
    );
    const daemon = spawn(daemonPath, [], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ARGENT_EXECD_BIND: `127.0.0.1:${port}`,
        ARGENT_EXECD_STATE_DIR: stateDir,
        ARGENT_EXECD_TICK_INTERVAL_MS: "10000",
        ARGENT_EXECD_DEFAULT_LEASE_MS: "120",
      },
      stdio: "pipe",
    });
    spawned.push(daemon);

    const client = createExecutiveShadowClient({
      baseUrl: `http://127.0.0.1:${port}`,
      experimentalWrites: true,
    });
    await waitForHealth(client);

    await client.experimentalRequestLane({
      lane: "operator",
      priority: 90,
      reason: "primary",
      leaseMs: 120,
    });
    await client.experimentalRequestLane({
      lane: "background",
      priority: 20,
      reason: "secondary",
      leaseMs: 120,
    });
    await client.experimentalTick({ count: 1 });

    const metricsBefore = await client.getMetrics();
    expect(metricsBefore.activeLane).toBe("operator");
    expect(metricsBefore.laneCounts.pending).toBe(1);
    expect(metricsBefore.highestPendingPriority).toBe(20);

    await new Promise((resolve) => setTimeout(resolve, 180));
    await client.experimentalTick({ count: 1 });

    const metricsAfter = await client.getMetrics();
    expect(metricsAfter.activeLane).toBe("background");
    expect(metricsAfter.laneCounts.active).toBe(1);
    expect(metricsAfter.laneCounts.pending).toBe(0);

    const state = await client.getState();
    expect(state.state.lanes.operator.last_outcome).toBe("lease_expired");
    expect(state.state.lanes.background.status).toBe("active");
    const timeline = await client.getTimeline(10);
    expect(timeline.lastReleaseOutcome).toBe("lease_expired");
    expect(timeline.recentEvents.some((event) => event.type === "lane_released")).toBe(true);

    await client.experimentalShutdown({ reason: "metrics-test-complete" });
  }, 20_000);

  it("supports stable read-only polling across live ticks", async () => {
    const port = await allocatePort();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-execd-ts-poll-"));
    const daemonPath = path.resolve(
      process.cwd(),
      "rust",
      "target",
      "debug",
      process.platform === "win32" ? "argent-execd.exe" : "argent-execd",
    );
    const daemon = spawn(daemonPath, [], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ARGENT_EXECD_BIND: `127.0.0.1:${port}`,
        ARGENT_EXECD_STATE_DIR: stateDir,
        ARGENT_EXECD_TICK_INTERVAL_MS: "10000",
        ARGENT_EXECD_DEFAULT_LEASE_MS: "5000",
      },
      stdio: "pipe",
    });
    spawned.push(daemon);

    const client = createExecutiveShadowClient({
      baseUrl: `http://127.0.0.1:${port}`,
      experimentalWrites: true,
    });
    await waitForHealth(client);

    await client.experimentalRequestLane({
      lane: "operator",
      priority: 95,
      reason: "polling",
      leaseMs: 5000,
    });

    let lastTickCount = 0;
    for (let index = 0; index < 3; index += 1) {
      await client.experimentalTick({ count: 1 });
      const [health, metrics, state] = await Promise.all([
        client.getHealth(),
        client.getMetrics(),
        client.getState(),
      ]);

      expect(health.status).toBe("ok");
      expect(health.tickCount).toBeGreaterThanOrEqual(lastTickCount);
      expect(metrics.tickCount).toBe(health.tickCount);
      expect(metrics.activeLane).toBe(state.state.active_lane);
      expect(state.state.active_lane).toBe("operator");
      expect(metrics.laneCounts.active).toBe(1);
      lastTickCount = health.tickCount;
    }

    const journal = await client.getJournal(20);
    expect(journal.filter((record) => record.event.type === "tick").length).toBeGreaterThanOrEqual(
      3,
    );
    const timeline = await client.getTimeline(20);
    expect(timeline.counts.tick).toBeGreaterThanOrEqual(3);
    expect(timeline.recentEvents.length).toBeGreaterThan(0);

    await client.experimentalShutdown({ reason: "polling-test-complete" });
  }, 20_000);
});
