import { describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { maybeNotifyConsciousnessKernelOperatorRequest } from "./consciousness-kernel-notifier.js";
import { createConsciousnessKernelSelfState } from "./consciousness-kernel-state.js";

function makeConfig(): ArgentConfig {
  return {
    agents: {
      defaults: {
        kernel: {
          enabled: true,
          mode: "shadow",
          operatorNotifications: {
            enabled: true,
            cooldownMs: 60_000,
            targets: [{ channel: "telegram", to: "123456789" }],
          },
        },
      },
    },
  } as ArgentConfig;
}

function makeOperatorBlockedState() {
  const state = createConsciousnessKernelSelfState({
    agentId: "main",
    now: "2026-04-25T14:22:00.000Z",
    dailyBudget: 0,
    maxEscalationsPerHour: 4,
    hardwareHostRequired: false,
    allowListening: false,
    allowVision: false,
  });
  state.agency.selfSummary =
    "Awaiting operator clarity on deletion policy for fragmented docs vs immutable records.";
  state.agenda.openQuestions = ["What defines immutable?"];
  state.concerns = ["Retention rules undefined"];
  return state;
}

describe("consciousness kernel notifier", () => {
  it("sends operator requests to configured outbound targets", async () => {
    const deliver = vi.fn().mockResolvedValue([{ channel: "telegram", messageId: "m1" }]);
    const state = makeOperatorBlockedState();

    const result = await maybeNotifyConsciousnessKernelOperatorRequest({
      cfg: makeConfig(),
      selfState: state,
      now: "2026-04-25T14:23:00.000Z",
      deps: { deliver },
    });

    expect(result.status).toBe("sent");
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        to: "123456789",
        payloads: [
          expect.objectContaining({
            text: expect.stringContaining("Argent needs operator input."),
          }),
        ],
      }),
    );
    expect(state.operatorNotifications.lastSignature).toContain("What defines immutable?");
    expect(state.operatorNotifications.lastNotifiedAt).toBe("2026-04-25T14:23:00.000Z");
  });

  it("does not resend the same request inside the cooldown window", async () => {
    const deliver = vi.fn().mockResolvedValue([{ channel: "telegram", messageId: "m1" }]);
    const state = makeOperatorBlockedState();
    const cfg = makeConfig();

    await maybeNotifyConsciousnessKernelOperatorRequest({
      cfg,
      selfState: state,
      now: "2026-04-25T14:23:00.000Z",
      deps: { deliver },
    });
    const result = await maybeNotifyConsciousnessKernelOperatorRequest({
      cfg,
      selfState: state,
      now: "2026-04-25T14:23:30.000Z",
      deps: { deliver },
    });

    expect(result.status).toBe("cooldown");
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
