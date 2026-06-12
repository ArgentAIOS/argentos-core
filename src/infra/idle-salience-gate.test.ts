import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { updateSessionStore, resolveStorePath } from "../config/sessions.js";
import {
  createIdleSalienceGate,
  resolveIdleSalienceAnchorHours,
  DEFAULT_IDLE_SALIENCE_ANCHOR_HOURS,
} from "./idle-salience-gate.js";

/**
 * LIMBIC law 3 for the background fan-spinners: an idle gateway burns zero
 * heartbeat/contemplation inference. The gate is deterministic — operator
 * activity since the last salient run, a board delta, or a due anchor.
 */
describe("idle salience gate", () => {
  let dir: string;
  let cfg: ArgentConfig;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-idle-salience-"));
    cfg = {
      session: { store: path.join(dir, "sessions-{agentId}.json") },
    } as ArgentConfig;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function writeLastUserMessageAt(agentId: string, atMs: number) {
    const storePath = resolveStorePath(cfg.session?.store, { agentId });
    await updateSessionStore(storePath, (store) => {
      store["__lastUserMessage"] = {
        sessionId: "global",
        updatedAt: atMs,
        lastUserMessageAt: atMs,
      } as never;
    });
  }

  it("admits the first run as baseline, then skips an idle box", () => {
    const gate = createIdleSalienceGate({ subsystem: "test" });
    const t0 = Date.now();
    const first = gate.evaluate({ cfg, agentId: "main", anchorHours: 24, nowMs: t0 });
    expect(first).toMatchObject({ salient: true, reason: "first-cognition" });

    // No operator activity, no board delta, anchor far away: pure skips.
    for (let i = 1; i <= 5; i++) {
      const verdict = gate.evaluate({
        cfg,
        agentId: "main",
        anchorHours: 24,
        nowMs: t0 + i * 30 * 60_000,
      });
      expect(verdict).toMatchObject({ salient: false, skipReason: "skip(no-salience)" });
    }
  });

  it("operator activity since the last salient run admits exactly one run", async () => {
    const gate = createIdleSalienceGate({ subsystem: "test" });
    const t0 = Date.now();
    gate.evaluate({ cfg, agentId: "main", anchorHours: 24, nowMs: t0 }); // baseline

    await writeLastUserMessageAt("main", t0 + 10 * 60_000);
    const admitted = gate.evaluate({
      cfg,
      agentId: "main",
      anchorHours: 24,
      nowMs: t0 + 30 * 60_000,
    });
    expect(admitted).toMatchObject({ salient: true, reason: "operator-activity" });

    // Salience consumed: the same activity does not admit again.
    const after = gate.evaluate({
      cfg,
      agentId: "main",
      anchorHours: 24,
      nowMs: t0 + 60 * 60_000,
    });
    expect(after).toMatchObject({ salient: false, skipReason: "skip(no-salience)" });
  });

  it("the anchor admits a run after N idle hours; 0 disables it", () => {
    const gate = createIdleSalienceGate({ subsystem: "test" });
    const t0 = Date.now();
    gate.evaluate({ cfg, agentId: "main", anchorHours: 6, nowMs: t0 }); // baseline

    const before = gate.evaluate({
      cfg,
      agentId: "main",
      anchorHours: 6,
      nowMs: t0 + 5 * 3_600_000,
    });
    expect(before.salient).toBe(false);

    const due = gate.evaluate({
      cfg,
      agentId: "main",
      anchorHours: 6,
      nowMs: t0 + 6 * 3_600_000,
    });
    expect(due).toMatchObject({ salient: true, reason: "anchor-due" });

    const disabledGate = createIdleSalienceGate({ subsystem: "test" });
    disabledGate.evaluate({ cfg, agentId: "main", anchorHours: 0, nowMs: t0 });
    const never = disabledGate.evaluate({
      cfg,
      agentId: "main",
      anchorHours: 0,
      nowMs: t0 + 1000 * 3_600_000,
    });
    expect(never.salient).toBe(false);
  });

  it("tracks agents independently", () => {
    const gate = createIdleSalienceGate({ subsystem: "test" });
    const t0 = Date.now();
    expect(gate.evaluate({ cfg, agentId: "a", anchorHours: 24, nowMs: t0 }).salient).toBe(true);
    expect(gate.evaluate({ cfg, agentId: "b", anchorHours: 24, nowMs: t0 }).salient).toBe(true);
    expect(gate.evaluate({ cfg, agentId: "a", anchorHours: 24, nowMs: t0 + 60_000 }).salient).toBe(
      false,
    );
  });

  it("resolveIdleSalienceAnchorHours: default 24, clamps negatives, passes 0 through", () => {
    expect(resolveIdleSalienceAnchorHours(undefined)).toBe(DEFAULT_IDLE_SALIENCE_ANCHOR_HOURS);
    expect(resolveIdleSalienceAnchorHours("nope")).toBe(DEFAULT_IDLE_SALIENCE_ANCHOR_HOURS);
    expect(resolveIdleSalienceAnchorHours(-5)).toBe(0);
    expect(resolveIdleSalienceAnchorHours(0)).toBe(0);
    expect(resolveIdleSalienceAnchorHours(6)).toBe(6);
  });
});
