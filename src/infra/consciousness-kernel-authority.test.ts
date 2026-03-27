import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import {
  resolveConsciousnessKernelAuthority,
  isContemplationAutonomousSchedulingSuppressed,
  isSisAutonomousSchedulingSuppressed,
} from "./consciousness-kernel-authority.js";
import { startContemplationRunner } from "./contemplation-runner.js";
import { startSisRunner } from "./sis-runner.js";

function makeConfig(params?: { kernelMode?: "off" | "shadow" | "soft" | "full" | null }) {
  const kernelMode = params?.kernelMode ?? null;
  return {
    agents: {
      defaults: {
        contemplation: {
          enabled: true,
          every: "30m",
        },
        sis: {
          enabled: true,
          every: "10",
        },
        ...(kernelMode
          ? {
              kernel: {
                enabled: true,
                mode: kernelMode,
                tickMs: 5000,
              },
            }
          : {}),
      },
      list: [{ id: "main" }],
    },
  } satisfies ArgentConfig;
}

describe("consciousness kernel authority", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("activates scheduler authority only for shadow mode", () => {
    expect(resolveConsciousnessKernelAuthority(makeConfig())).toMatchObject({
      schedulerAuthorityActive: false,
      suppressesAutonomousContemplation: false,
      suppressesAutonomousSis: false,
    });

    expect(resolveConsciousnessKernelAuthority(makeConfig({ kernelMode: "shadow" }))).toMatchObject(
      {
        schedulerAuthorityActive: true,
        suppressesAutonomousContemplation: true,
        suppressesAutonomousSis: true,
      },
    );

    expect(resolveConsciousnessKernelAuthority(makeConfig({ kernelMode: "soft" }))).toMatchObject({
      schedulerAuthorityActive: false,
      suppressesAutonomousContemplation: false,
      suppressesAutonomousSis: false,
    });
  });

  it("suppresses only the default agent contemplation schedule in shadow mode", () => {
    const cfg = {
      agents: {
        defaults: {
          contemplation: {
            enabled: true,
            every: "30m",
          },
          kernel: {
            enabled: true,
            mode: "shadow",
          },
        },
        list: [{ id: "main" }, { id: "helper", contemplation: { enabled: true, every: "2h" } }],
      },
    } satisfies ArgentConfig;

    expect(isContemplationAutonomousSchedulingSuppressed(cfg, "main")).toBe(true);
    expect(isContemplationAutonomousSchedulingSuppressed(cfg, "helper")).toBe(false);
  });

  it("reports contemplation runner snapshot with default-agent suppression and due tracking", () => {
    const runner = startContemplationRunner({ cfg: makeConfig({ kernelMode: "shadow" }) });
    const snapshot = runner.getSnapshot();

    expect(snapshot).toMatchObject({
      defaultAgentId: "main",
      trackedAgentCount: 1,
      defaultAgentAutonomousSchedulingSuppressed: true,
      nextAutonomousDueMs: null,
      suppressedAgentIds: ["main"],
    });
    expect(typeof snapshot.defaultAgentNextDueMs).toBe("number");

    runner.stop();
  });

  it("reports SIS runner snapshot with shadow suppression and a managed due time", () => {
    const runner = startSisRunner({ cfg: makeConfig({ kernelMode: "shadow" }) });
    const snapshot = runner.getSnapshot();

    expect(isSisAutonomousSchedulingSuppressed(makeConfig({ kernelMode: "shadow" }))).toBe(true);
    expect(snapshot).toMatchObject({
      enabled: true,
      autonomousSchedulingSuppressed: true,
      intervalMs: 10 * 60 * 1000,
      running: false,
      lastRunAt: null,
    });
    expect(typeof snapshot.nextDueMs).toBe("number");

    runner.stop();
  });
});
