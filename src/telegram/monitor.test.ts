import { beforeEach, describe, expect, it, vi } from "vitest";
import { monitorTelegramProvider, type TelegramMonitorStatusPatch } from "./monitor.js";
import { resetTelegramPollingSlotsForTest } from "./polling-singleton.js";

type MockCtx = {
  message: {
    chat: { id: number; type: string; title?: string };
    text?: string;
    caption?: string;
  };
  me?: { username: string };
  getFile: () => Promise<unknown>;
};

// Fake bot to capture handler and API calls
const handlers: Record<string, (ctx: MockCtx) => Promise<void> | void> = {};
const api = {
  sendMessage: vi.fn(),
  sendPhoto: vi.fn(),
  sendVideo: vi.fn(),
  sendAudio: vi.fn(),
  sendDocument: vi.fn(),
  setWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
};
const { initSpy, runSpy, createBotSpy, loadConfig } = vi.hoisted(() => ({
  initSpy: vi.fn(async () => undefined),
  runSpy: vi.fn(() => ({
    task: () => Promise.resolve(),
    stop: vi.fn(),
  })),
  createBotSpy: vi.fn(),
  loadConfig: vi.fn(() => ({
    agents: { defaults: { maxConcurrent: 2 } },
    channels: { telegram: {} },
  })),
}));

// Use the real computeBackoff so we can verify the actual exponential
// schedule rather than a constant. sleepWithAbort stays mocked so the
// test never actually sleeps.
const { computeBackoff, sleepWithAbort } = vi.hoisted(() => {
  return {
    computeBackoff: vi.fn(
      (
        policy: { initialMs: number; maxMs: number; factor: number; jitter: number },
        attempt: number,
      ) => {
        const base = policy.initialMs * policy.factor ** Math.max(attempt - 1, 0);
        // No jitter in tests so assertions are deterministic.
        return Math.min(policy.maxMs, Math.round(base));
      },
    ),
    sleepWithAbort: vi.fn(async () => undefined),
  };
});

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig,
  };
});

vi.mock("./bot.js", () => ({
  createTelegramBot: (...args: unknown[]) => {
    createBotSpy(...args);
    handlers.message = async (ctx: MockCtx) => {
      const chatId = ctx.message.chat.id;
      const isGroup = ctx.message.chat.type !== "private";
      const text = ctx.message.text ?? ctx.message.caption ?? "";
      if (isGroup && !text.includes("@mybot")) {
        return;
      }
      if (!text.trim()) {
        return;
      }
      await api.sendMessage(chatId, `echo:${text}`, { parse_mode: "HTML" });
    };
    return {
      on: vi.fn(),
      api,
      me: { username: "mybot" },
      init: initSpy,
      stop: vi.fn(),
      start: vi.fn(),
    };
  },
  createTelegramWebhookCallback: vi.fn(),
}));

// Mock the grammyjs/runner to resolve immediately
vi.mock("@grammyjs/runner", () => ({
  run: runSpy,
}));

vi.mock("../infra/backoff.js", () => ({
  computeBackoff,
  sleepWithAbort,
}));

vi.mock("../auto-reply/reply.js", () => ({
  getReplyFromConfig: async (ctx: { Body?: string }) => ({
    text: `echo:${ctx.Body}`,
  }),
}));

describe("monitorTelegramProvider (grammY)", () => {
  beforeEach(() => {
    resetTelegramPollingSlotsForTest();
    loadConfig.mockReturnValue({
      agents: { defaults: { maxConcurrent: 2 } },
      channels: { telegram: {} },
    });
    initSpy.mockClear();
    runSpy.mockClear();
    createBotSpy.mockClear();
    computeBackoff.mockClear();
    sleepWithAbort.mockClear();
  });

  it("processes a DM and sends reply", async () => {
    Object.values(api).forEach((fn) => {
      fn?.mockReset?.();
    });
    await monitorTelegramProvider({ token: "tok" });
    expect(handlers.message).toBeDefined();
    await handlers.message?.({
      message: {
        message_id: 1,
        chat: { id: 123, type: "private" },
        text: "hi",
      },
      me: { username: "mybot" },
      getFile: vi.fn(async () => ({})),
    });
    expect(api.sendMessage).toHaveBeenCalledWith(123, "echo:hi", {
      parse_mode: "HTML",
    });
  });

  it("uses agent maxConcurrent for runner concurrency", async () => {
    runSpy.mockClear();
    loadConfig.mockReturnValue({
      agents: { defaults: { maxConcurrent: 3 } },
      channels: { telegram: {} },
    });

    await monitorTelegramProvider({ token: "tok" });

    expect(runSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sink: { concurrency: 3 },
        runner: expect.objectContaining({
          silent: true,
          maxRetryTime: 5 * 60 * 1000,
          retryInterval: "exponential",
        }),
      }),
    );
  });

  it("requires mention in groups by default", async () => {
    Object.values(api).forEach((fn) => {
      fn?.mockReset?.();
    });
    await monitorTelegramProvider({ token: "tok" });
    await handlers.message?.({
      message: {
        message_id: 2,
        chat: { id: -99, type: "supergroup", title: "G" },
        text: "hello all",
      },
      me: { username: "mybot" },
      getFile: vi.fn(async () => ({})),
    });
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("retries on recoverable network errors", async () => {
    const networkError = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    const failedRunnerStop = vi.fn();
    runSpy
      .mockImplementationOnce(() => ({
        task: () => Promise.reject(networkError),
        stop: failedRunnerStop,
      }))
      .mockImplementationOnce(() => ({
        task: () => Promise.resolve(),
        stop: vi.fn(),
      }));

    await monitorTelegramProvider({ token: "tok" });

    expect(computeBackoff).toHaveBeenCalled();
    expect(sleepWithAbort).toHaveBeenCalled();
    expect(failedRunnerStop).toHaveBeenCalled();
    expect(runSpy).toHaveBeenCalledTimes(2);
  });

  it("recreates the bot and applies a 60s initial cooldown after the first getUpdates conflict", async () => {
    const conflictError = Object.assign(new Error("terminated by other getUpdates request"), {
      error_code: 409,
      method: "getUpdates",
    });
    const failedRunnerStop = vi.fn();
    runSpy
      .mockImplementationOnce(() => ({
        task: () => Promise.reject(conflictError),
        stop: failedRunnerStop,
      }))
      .mockImplementationOnce(() => ({
        task: () => Promise.resolve(),
        stop: vi.fn(),
      }));

    await monitorTelegramProvider({ token: "tok" });

    expect(failedRunnerStop).toHaveBeenCalled();
    expect(createBotSpy).toHaveBeenCalledTimes(2);
    expect(sleepWithAbort).toHaveBeenCalledWith(60_000, undefined);
    expect(runSpy).toHaveBeenCalledTimes(2);
  });

  it("self-recovers from many consecutive getUpdates conflicts via exponential backoff (no permanent exit)", async () => {
    // Previous behavior: throw permanent error after 3 strikes.
    // New behavior: keep retrying with exponential backoff so a
    // transient overlap (gateway restart race) self-recovers without
    // a manual `argent gateway restart`.
    const conflictError = Object.assign(new Error("terminated by other getUpdates request"), {
      error_code: 409,
      method: "getUpdates",
    });
    const runtimeError = vi.fn();
    // Reject 5 times in a row, then succeed on the 6th.
    for (let i = 0; i < 5; i += 1) {
      runSpy.mockImplementationOnce(() => ({
        task: () => Promise.reject(conflictError),
        stop: vi.fn(),
      }));
    }
    runSpy.mockImplementationOnce(() => ({
      task: () => Promise.resolve(),
      stop: vi.fn(),
    }));

    await monitorTelegramProvider({
      token: "tok",
      runtime: { error: runtimeError } as never,
    });

    // 5 failed attempts + 1 successful attempt = 6 runner invocations.
    expect(runSpy).toHaveBeenCalledTimes(6);
    // 5 backoff sleeps: 60s, 120s, 240s, 480s, 960s.
    expect(sleepWithAbort).toHaveBeenNthCalledWith(1, 60_000, undefined);
    expect(sleepWithAbort).toHaveBeenNthCalledWith(2, 120_000, undefined);
    expect(sleepWithAbort).toHaveBeenNthCalledWith(3, 240_000, undefined);
    expect(sleepWithAbort).toHaveBeenNthCalledWith(4, 480_000, undefined);
    expect(sleepWithAbort).toHaveBeenNthCalledWith(5, 960_000, undefined);
    // Operator-readable retry log on every conflict.
    expect(runtimeError).toHaveBeenCalledWith(expect.stringContaining("getUpdates conflict"));
    // Critically: no permanent-exit log this time.
    expect(runtimeError).not.toHaveBeenCalledWith(
      expect.stringContaining("stopping polling until channel restart"),
    );
  });

  it("caps conflict backoff at 30 minutes", async () => {
    const conflictError = Object.assign(new Error("terminated by other getUpdates request"), {
      error_code: 409,
      method: "getUpdates",
    });
    // Reject 8 times — by attempt 6 the doubling schedule (60s × 2^5
    // = 1920s = 32 min) would exceed the 30-min cap.
    for (let i = 0; i < 8; i += 1) {
      runSpy.mockImplementationOnce(() => ({
        task: () => Promise.reject(conflictError),
        stop: vi.fn(),
      }));
    }
    runSpy.mockImplementationOnce(() => ({
      task: () => Promise.resolve(),
      stop: vi.fn(),
    }));

    await monitorTelegramProvider({ token: "tok" });

    const calls = sleepWithAbort.mock.calls.map((args) => args[0] as number);
    // Schedule: 60s, 120s, 240s, 480s, 960s, then capped at 1800s.
    expect(calls).toEqual([
      60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000, 1_800_000,
    ]);
  });

  it("reports lifecycle state via onStatusChange (polling → backing-off → polling)", async () => {
    const conflictError = Object.assign(new Error("terminated by other getUpdates request"), {
      error_code: 409,
      method: "getUpdates",
    });
    runSpy
      .mockImplementationOnce(() => ({
        task: () => Promise.reject(conflictError),
        stop: vi.fn(),
      }))
      .mockImplementationOnce(() => ({
        task: () => Promise.resolve(),
        stop: vi.fn(),
      }));

    const statusPatches: TelegramMonitorStatusPatch[] = [];
    await monitorTelegramProvider({
      token: "tok",
      onStatusChange: (patch) => statusPatches.push(patch),
    });

    // Expect: polling (start), backing-off (after conflict), polling (retry start), stopped (final cleanup).
    const states = statusPatches.map((p) => p.state).filter((s): s is string => Boolean(s));
    expect(states[0]).toBe("polling");
    expect(states.some((s) => s.startsWith("backing-off"))).toBe(true);
    // We should see "polling" at least twice — once at initial start and again on retry.
    const pollingCount = states.filter((s) => s === "polling").length;
    expect(pollingCount).toBeGreaterThanOrEqual(2);
    expect(states.at(-1)).toBe("stopped");
    // Backing-off patch carries lastError and a future nextRetryAt.
    const backoffPatch = statusPatches.find((p) => p.state?.startsWith("backing-off"));
    expect(backoffPatch?.lastError).toMatch(/terminated by other getUpdates request/);
    expect(typeof backoffPatch?.nextRetryAt).toBe("number");
  });

  it("reports exited state when a non-recoverable error surfaces", async () => {
    runSpy.mockImplementationOnce(() => ({
      task: () => Promise.reject(new Error("bad token")),
      stop: vi.fn(),
    }));

    const statusPatches: TelegramMonitorStatusPatch[] = [];
    await expect(
      monitorTelegramProvider({
        token: "tok",
        onStatusChange: (patch) => statusPatches.push(patch),
      }),
    ).rejects.toThrow("bad token");

    expect(statusPatches.some((p) => p.state === "exited (manual restart needed)")).toBe(true);
  });

  it("skips a duplicate poller for the same bot token", async () => {
    let resolveFirst!: () => void;
    const firstTask = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const firstStop = vi.fn(() => {
      resolveFirst();
    });
    runSpy.mockImplementationOnce(() => ({
      task: () => firstTask,
      stop: firstStop,
    }));
    const firstAbort = new AbortController();
    const firstRun = monitorTelegramProvider({
      token: "tok",
      accountId: "default",
      abortSignal: firstAbort.signal,
    });
    await Promise.resolve();

    const duplicateAbort = new AbortController();
    const duplicateLog = vi.fn();
    const duplicateRun = monitorTelegramProvider({
      token: "tok",
      accountId: "default",
      abortSignal: duplicateAbort.signal,
      runtime: { error: duplicateLog } as never,
    });
    await vi.waitFor(() => {
      expect(duplicateLog).toHaveBeenCalledWith(
        expect.stringContaining("Telegram polling already active"),
      );
    });

    duplicateAbort.abort();
    await duplicateRun;
    expect(runSpy).toHaveBeenCalledTimes(1);

    firstAbort.abort();
    await firstRun;
    expect(firstStop).toHaveBeenCalled();
  });

  it("surfaces non-recoverable errors", async () => {
    runSpy.mockImplementationOnce(() => ({
      task: () => Promise.reject(new Error("bad token")),
      stop: vi.fn(),
    }));

    await expect(monitorTelegramProvider({ token: "tok" })).rejects.toThrow("bad token");
  });
});
