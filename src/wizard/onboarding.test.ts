import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "./prompts.js";
import { DEFAULT_BOOTSTRAP_FILENAME } from "../agents/workspace.js";
import { runOnboardingWizard } from "./onboarding.js";

const setupChannels = vi.hoisted(() => vi.fn(async (cfg) => cfg));
const setupSkills = vi.hoisted(() => vi.fn(async (cfg) => cfg));
const healthCommand = vi.hoisted(() => vi.fn(async () => {}));
const ensureWorkspaceAndSessions = vi.hoisted(() => vi.fn(async () => {}));
const writeConfigFile = vi.hoisted(() => vi.fn(async () => {}));
const readConfigFileSnapshot = vi.hoisted(() =>
  vi.fn(async () => ({ exists: false, valid: true, config: {} })),
);
const ensureSystemdUserLingerInteractive = vi.hoisted(() => vi.fn(async () => {}));
const isSystemdUserServiceAvailable = vi.hoisted(() => vi.fn(async () => true));
const ensureControlUiAssetsBuilt = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const runTui = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../commands/onboard-channels.js", () => ({
  setupChannels,
}));

vi.mock("../commands/onboard-skills.js", () => ({
  setupSkills,
}));

vi.mock("../commands/health.js", () => ({
  healthCommand,
}));

vi.mock("../config/config.js", async (importActual) => {
  const actual = await importActual<typeof import("../config/config.js")>();
  return {
    ...actual,
    readConfigFileSnapshot,
    writeConfigFile,
  };
});

vi.mock("../commands/onboard-helpers.js", async (importActual) => {
  const actual = await importActual<typeof import("../commands/onboard-helpers.js")>();
  return {
    ...actual,
    ensureWorkspaceAndSessions,
    detectBrowserOpenSupport: vi.fn(async () => ({ ok: false })),
    openUrl: vi.fn(async () => true),
    printWizardHeader: vi.fn(),
    probeGatewayReachable: vi.fn(async () => ({ ok: true })),
    resolveControlUiLinks: vi.fn(() => ({
      httpUrl: "http://127.0.0.1:18789",
      wsUrl: "ws://127.0.0.1:18789",
    })),
  };
});

vi.mock("../commands/systemd-linger.js", () => ({
  ensureSystemdUserLingerInteractive,
}));

vi.mock("../daemon/systemd.js", () => ({
  isSystemdUserServiceAvailable,
}));

vi.mock("../infra/control-ui-assets.js", () => ({
  ensureControlUiAssetsBuilt,
}));

vi.mock("../tui/tui.js", () => ({
  runTui,
}));

describe("runOnboardingWizard", () => {
  it("exits when config is invalid", async () => {
    readConfigFileSnapshot.mockResolvedValueOnce({
      path: "/tmp/.argentos/argent.json",
      exists: true,
      raw: "{}",
      parsed: {},
      valid: false,
      config: {},
      issues: [{ path: "routing.allowFrom", message: "Legacy key" }],
      legacyIssues: [{ path: "routing.allowFrom", message: "Legacy key" }],
    });

    const select: WizardPrompter["select"] = vi.fn(async () => "quickstart");
    const prompter: WizardPrompter = {
      intro: vi.fn(async () => {}),
      outro: vi.fn(async () => {}),
      note: vi.fn(async () => {}),
      select,
      multiselect: vi.fn(async () => []),
      text: vi.fn(async () => ""),
      confirm: vi.fn(async () => false),
      progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
    };

    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };

    await expect(
      runOnboardingWizard(
        {
          acceptRisk: true,
          flow: "quickstart",
          authChoice: "skip",
          installDaemon: false,
          skipProviders: true,
          skipSkills: true,
          skipHealth: true,
          skipUi: true,
        },
        runtime,
        prompter,
      ),
    ).rejects.toThrow("exit:1");

    expect(select).not.toHaveBeenCalled();
    expect(prompter.outro).toHaveBeenCalled();
  });

  it("skips prompts and setup steps when flags are set", async () => {
    const select: WizardPrompter["select"] = vi.fn(async () => "quickstart");
    const multiselect: WizardPrompter["multiselect"] = vi.fn(async () => []);
    const prompter: WizardPrompter = {
      intro: vi.fn(async () => {}),
      outro: vi.fn(async () => {}),
      note: vi.fn(async () => {}),
      select,
      multiselect,
      text: vi.fn(async () => ""),
      confirm: vi.fn(async () => false),
      progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
    };
    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };

    await runOnboardingWizard(
      {
        acceptRisk: true,
        flow: "quickstart",
        authChoice: "skip",
        installDaemon: false,
        skipProviders: true,
        skipSkills: true,
        skipHealth: true,
        skipUi: true,
      },
      runtime,
      prompter,
    );

    expect(select).not.toHaveBeenCalled();
    expect(setupChannels).not.toHaveBeenCalled();
    expect(setupSkills).not.toHaveBeenCalled();
    expect(healthCommand).not.toHaveBeenCalled();
    expect(runTui).not.toHaveBeenCalled();
  });

  it("launches TUI without auto-delivery when hatching", async () => {
    runTui.mockClear();

    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-onboard-"));
    await fs.writeFile(path.join(workspaceDir, DEFAULT_BOOTSTRAP_FILENAME), "{}");

    const select: WizardPrompter["select"] = vi.fn(async (opts) => {
      if (opts.message === "How do you want to meet Argent first?") {
        return "tui";
      }
      return "quickstart";
    });

    const prompter: WizardPrompter = {
      intro: vi.fn(async () => {}),
      outro: vi.fn(async () => {}),
      note: vi.fn(async () => {}),
      select,
      multiselect: vi.fn(async () => []),
      text: vi.fn(async () => ""),
      confirm: vi.fn(async () => false),
      progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
    };

    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };

    await runOnboardingWizard(
      {
        acceptRisk: true,
        flow: "quickstart",
        mode: "local",
        workspace: workspaceDir,
        authChoice: "skip",
        skipProviders: true,
        skipSkills: true,
        skipHealth: true,
        installDaemon: false,
      },
      runtime,
      prompter,
    );

    expect(runTui).toHaveBeenCalledWith(
      expect.objectContaining({
        deliver: false,
        message:
          "Hey — this is our first conversation. Start the first-run ritual from BOOTSTRAP.md and guide it naturally.",
      }),
    );

    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("offers TUI hatch even without BOOTSTRAP.md", async () => {
    runTui.mockClear();

    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-onboard-"));

    const select: WizardPrompter["select"] = vi.fn(async (opts) => {
      if (opts.message === "How do you want to meet Argent first?") {
        return "tui";
      }
      return "quickstart";
    });

    const prompter: WizardPrompter = {
      intro: vi.fn(async () => {}),
      outro: vi.fn(async () => {}),
      note: vi.fn(async () => {}),
      select,
      multiselect: vi.fn(async () => []),
      text: vi.fn(async () => ""),
      confirm: vi.fn(async () => false),
      progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
    };

    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };

    await runOnboardingWizard(
      {
        acceptRisk: true,
        flow: "quickstart",
        mode: "local",
        workspace: workspaceDir,
        authChoice: "skip",
        skipProviders: true,
        skipSkills: true,
        skipHealth: true,
        installDaemon: false,
      },
      runtime,
      prompter,
    );

    expect(runTui).toHaveBeenCalledWith(
      expect.objectContaining({
        deliver: false,
        message: undefined,
      }),
    );

    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("shows the web search hint at the end of onboarding", async () => {
    const prevBraveKey = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;

    try {
      const note: WizardPrompter["note"] = vi.fn(async () => {});
      const prompter: WizardPrompter = {
        intro: vi.fn(async () => {}),
        outro: vi.fn(async () => {}),
        note,
        select: vi.fn(async () => "quickstart"),
        multiselect: vi.fn(async () => []),
        text: vi.fn(async () => ""),
        confirm: vi.fn(async () => false),
        progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
      };

      const runtime: RuntimeEnv = {
        log: vi.fn(),
        error: vi.fn(),
        exit: vi.fn(),
      };

      await runOnboardingWizard(
        {
          acceptRisk: true,
          flow: "quickstart",
          authChoice: "skip",
          installDaemon: false,
          skipProviders: true,
          skipSkills: true,
          skipHealth: true,
          skipUi: true,
        },
        runtime,
        prompter,
      );

      const calls = (note as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.some((call) => call?.[1] === "Web search (optional)")).toBe(true);
    } finally {
      if (prevBraveKey === undefined) {
        delete process.env.BRAVE_API_KEY;
      } else {
        process.env.BRAVE_API_KEY = prevBraveKey;
      }
    }
  });

  it("configures Ollama first when the user chooses a local runtime", async () => {
    writeConfigFile.mockClear();

    const select: WizardPrompter["select"] = vi.fn(async (opts) => {
      if (opts.message === "Where should Argent run its brain?") {
        return "ollama";
      }
      if (opts.message === "Choose Ollama's primary text model for Argent") {
        return "qwen3:14b";
      }
      if (opts.message === "Choose Ollama's embedding model for memory") {
        return "nomic-embed-text";
      }
      return "quickstart";
    });
    const text: WizardPrompter["text"] = vi.fn(async () => "");
    const prompter: WizardPrompter = {
      intro: vi.fn(async () => {}),
      outro: vi.fn(async () => {}),
      note: vi.fn(async () => {}),
      select,
      multiselect: vi.fn(async () => []),
      text,
      confirm: vi.fn(async () => false),
      progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
    };
    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };

    await runOnboardingWizard(
      {
        acceptRisk: true,
        flow: "quickstart",
        mode: "local",
        installDaemon: false,
        skipProviders: true,
        skipSkills: true,
        skipHealth: true,
        skipUi: true,
      },
      runtime,
      prompter,
    );

    const finalConfig = writeConfigFile.mock.calls.at(-1)?.[0];
    expect(finalConfig?.agents?.defaults?.model?.primary).toBe("ollama/qwen3:14b");
    expect(finalConfig?.agents?.defaults?.memorySearch).toMatchObject({
      provider: "ollama",
      model: "nomic-embed-text",
      fallback: "none",
    });
    expect(finalConfig?.models?.providers?.ollama).toMatchObject({
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "ollama-local",
    });
    expect(finalConfig?.memory?.memu?.llm).toMatchObject({
      provider: "ollama",
      model: "qwen3:14b",
    });
    expect(text).not.toHaveBeenCalled();
  });

  it("configures LM Studio first when the user chooses that local runtime", async () => {
    writeConfigFile.mockClear();

    const select: WizardPrompter["select"] = vi.fn(async (opts) => {
      if (opts.message === "Where should Argent run its brain?") {
        return "lmstudio";
      }
      if (opts.message === "Choose LM Studio's primary text model for Argent") {
        return "qwen3-32b";
      }
      if (opts.message === "Choose LM Studio's embedding model for memory") {
        return "nomic-embed-text";
      }
      return "quickstart";
    });
    const text: WizardPrompter["text"] = vi.fn(async () => "");
    const prompter: WizardPrompter = {
      intro: vi.fn(async () => {}),
      outro: vi.fn(async () => {}),
      note: vi.fn(async () => {}),
      select,
      multiselect: vi.fn(async () => []),
      text,
      confirm: vi.fn(async () => false),
      progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
    };
    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };

    await runOnboardingWizard(
      {
        acceptRisk: true,
        flow: "quickstart",
        mode: "local",
        installDaemon: false,
        skipProviders: true,
        skipSkills: true,
        skipHealth: true,
        skipUi: true,
      },
      runtime,
      prompter,
    );

    const finalConfig = writeConfigFile.mock.calls.at(-1)?.[0];
    expect(finalConfig?.agents?.defaults?.model?.primary).toBe("lmstudio/qwen3-32b");
    expect(finalConfig?.agents?.defaults?.memorySearch).toMatchObject({
      provider: "openai",
      model: "nomic-embed-text",
      fallback: "none",
      remote: {
        baseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "lmstudio",
      },
    });
    expect(finalConfig?.models?.providers?.lmstudio).toMatchObject({
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: "lmstudio",
    });
    expect(finalConfig?.memory?.memu?.llm).toMatchObject({
      provider: "lmstudio",
      model: "qwen3-32b",
    });
    expect(text).not.toHaveBeenCalled();
  });
});
