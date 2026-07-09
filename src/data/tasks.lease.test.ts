import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectionManager } from "./connection.js";
import { TasksModule } from "./tasks.js";

/**
 * Lease protocol (Worker Runtime v2 D4): atomic claim CAS, heartbeat,
 * release/requeue, and the expiry/orphan sweeps. Exercised against the real
 * SQLite module — the PG adapter mirrors the same WHERE-clause semantics and
 * is covered by the live sandbox verification.
 */
describe("task lease protocol (D4)", () => {
  let dir: string;
  let conn: ConnectionManager;
  let tasks: TasksModule;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-task-lease-"));
    conn = new ConnectionManager({
      paths: {
        dashboard: path.join(dir, "dashboard.db"),
        memo: path.join(dir, "memo.db"),
        sessions: path.join(dir, "sessions.db"),
      },
      readOnly: false,
    });
    await conn.init();
    tasks = new TasksModule(conn);
    await tasks.init();
  });

  afterEach(() => {
    conn.closeAll?.();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("claims a pending task atomically; the loser of the race gets null", () => {
    const task = tasks.create({ title: "triage tickets" });
    const won = tasks.claim(task.id, { claimedBy: "run-A", ttlMs: 60_000 });
    expect(won?.status).toBe("in_progress");
    expect(won?.claimedBy).toBe("run-A");
    expect(won?.claimTtl).toBeGreaterThan(Date.now());

    const lost = tasks.claim(task.id, { claimedBy: "run-B", ttlMs: 60_000 });
    expect(lost).toBeNull();
  });

  it("an expired lease is claimable again; a live one is not", () => {
    const task = tasks.create({ title: "t" });
    expect(tasks.claim(task.id, { claimedBy: "run-A", ttlMs: -1 })).toBeTruthy();
    // run-A's lease is already expired (negative TTL) — run-B may take over.
    const taken = tasks.claim(task.id, { claimedBy: "run-B", ttlMs: 60_000 });
    expect(taken?.claimedBy).toBe("run-B");
  });

  it("heartbeat refreshes only the holder's lease", () => {
    const task = tasks.create({ title: "t" });
    tasks.claim(task.id, { claimedBy: "run-A", ttlMs: 1_000 });
    expect(tasks.heartbeatClaim(task.id, { claimedBy: "run-B", ttlMs: 60_000 })).toBe(false);
    expect(tasks.heartbeatClaim(task.id, { claimedBy: "run-A", ttlMs: 60_000 })).toBe(true);
    const after = tasks.get(task.id);
    expect(after?.claimTtl).toBeGreaterThan(Date.now() + 30_000);
  });

  it("releaseClaim with requeue returns the task to pending and bumps attempt", () => {
    const task = tasks.create({ title: "t" });
    tasks.claim(task.id, { claimedBy: "run-A", ttlMs: 60_000 });
    const released = tasks.releaseClaim(task.id, {
      claimedBy: "run-A",
      requeue: true,
      reason: "run_error: boom",
    });
    expect(released?.status).toBe("pending");
    expect(released?.claimedBy).toBeUndefined();
    expect(released?.attempt).toBe(1);
    expect(released?.metadata?.leaseReleaseReason).toBe("run_error: boom");
  });

  it("terminal statuses clear the lease", () => {
    const task = tasks.create({ title: "t" });
    tasks.claim(task.id, { claimedBy: "run-A", ttlMs: 60_000 });
    const completed = tasks.update(task.id, { status: "completed" });
    expect(completed?.claimedBy).toBeUndefined();
    expect(completed?.claimTtl).toBeUndefined();
  });

  it("sweepExpiredClaims requeues lapsed leases with lease_expired", () => {
    const live = tasks.create({ title: "live" });
    const dead = tasks.create({ title: "dead" });
    tasks.claim(live.id, { claimedBy: "run-L", ttlMs: 60_000 });
    tasks.claim(dead.id, { claimedBy: "run-D", ttlMs: -1 });

    const swept = tasks.sweepExpiredClaims();
    expect(swept.map((t) => t.id)).toEqual([dead.id]);
    expect(swept[0].status).toBe("pending");
    expect(swept[0].attempt).toBe(1);
    expect(swept[0].metadata?.leaseReleaseReason).toBe("lease_expired");
    expect(tasks.get(live.id)?.status).toBe("in_progress");
  });

  it("orphanAll sweeps every held lease (boot-time recovery)", () => {
    const a = tasks.create({ title: "a" });
    const b = tasks.create({ title: "b" });
    tasks.claim(a.id, { claimedBy: "run-A", ttlMs: 600_000 });
    tasks.claim(b.id, { claimedBy: "run-B", ttlMs: 600_000 });

    const swept = tasks.sweepExpiredClaims({ orphanAll: true });
    expect(swept).toHaveLength(2);
    for (const task of swept) {
      expect(task.status).toBe("pending");
      expect(task.metadata?.leaseReleaseReason).toBe("orphaned_at_boot");
    }
  });
});
