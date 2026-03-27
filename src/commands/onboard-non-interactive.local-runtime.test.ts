import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runtime = {
  log: () => {},
  error: (msg: string) => {
    throw new Error(msg);
  },
  exit: (code: number) => {
    throw new Error(`exit:${code}`);
  },
};

describe("onboard (non-interactive): local runtime", () => {
  const prev = {
    home: process.env.HOME,
    stateDir: process.env.ARGENT_STATE_DIR,
    configPath: process.env.ARGENT_CONFIG_PATH,
    skipChannels: process.env.ARGENT_SKIP_CHANNELS,
    skipGmail: process.env.ARGENT_SKIP_GMAIL_WATCHER,
    skipCron: process.env.ARGENT_SKIP_CRON,
    skipCanvas: process.env.ARGENT_SKIP_CANVAS_HOST,
    skipBrowser: process.env.ARGENT_SKIP_BROWSER_CONTROL_SERVER,
  };
  let tempHome: string | undefined;

  const initStateDir = async (prefix: string) => {
    if (!tempHome) {
      throw new Error("temp home not initialized");
    }
    const stateDir = await fs.mkdtemp(path.join(tempHome, prefix));
    process.env.ARGENT_STATE_DIR = stateDir;
    delete process.env.ARGENT_CONFIG_PATH;
    return stateDir;
  };

  beforeAll(async () => {
    process.env.ARGENT_SKIP_CHANNELS = "1";
    process.env.ARGENT_SKIP_GMAIL_WATCHER = "1";
    process.env.ARGENT_SKIP_CRON = "1";
    process.env.ARGENT_SKIP_CANVAS_HOST = "1";
    process.env.ARGENT_SKIP_BROWSER_CONTROL_SERVER = "1";

    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "argent-onboard-local-runtime-"));
    process.env.HOME = tempHome;
  });

  afterAll(async () => {
    if (tempHome) {
      await fs.rm(tempHome, { recursive: true, force: true });
    }
    process.env.HOME = prev.home;
    process.env.ARGENT_STATE_DIR = prev.stateDir;
    process.env.ARGENT_CONFIG_PATH = prev.configPath;
    process.env.ARGENT_SKIP_CHANNELS = prev.skipChannels;
    process.env.ARGENT_SKIP_GMAIL_WATCHER = prev.skipGmail;
    process.env.ARGENT_SKIP_CRON = prev.skipCron;
    process.env.ARGENT_SKIP_CANVAS_HOST = prev.skipCanvas;
    process.env.ARGENT_SKIP_BROWSER_CONTROL_SERVER = prev.skipBrowser;
  });

  it("writes Ollama-first local runtime config from explicit non-interactive flags", async () => {
    const stateDir = await initStateDir("state-local-runtime-");
    const workspace = path.join(stateDir, "argent");

    const { runNonInteractiveOnboarding } = await import("./onboard-non-interactive.js");
    await runNonInteractiveOnboarding(
      {
        nonInteractive: true,
        mode: "local",
        workspace,
        localRuntime: "ollama",
        localTextModel: "qwen3:14b",
        localEmbeddingModel: "nomic-embed-text",
        authChoice: "skip",
        skipSkills: true,
        skipHealth: true,
        installDaemon: false,
      },
      runtime,
    );

    const { resolveConfigPath } = await import("../config/paths.js");
    const configPath = resolveConfigPath(process.env, stateDir);
    const cfg = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      agents?: {
        defaults?: {
          workspace?: string;
          model?: { primary?: string };
          memorySearch?: { provider?: string; model?: string; fallback?: string };
        };
      };
      models?: { providers?: { ollama?: { baseUrl?: string; apiKey?: string } } };
      memory?: { memu?: { llm?: { provider?: string; model?: string } } };
    };

    expect(cfg?.agents?.defaults?.workspace).toBe(workspace);
    expect(cfg?.agents?.defaults?.model?.primary).toBe("ollama/qwen3:14b");
    expect(cfg?.agents?.defaults?.memorySearch).toMatchObject({
      provider: "ollama",
      model: "nomic-embed-text",
      fallback: "none",
    });
    expect(cfg?.models?.providers?.ollama).toMatchObject({
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "ollama-local",
    });
    expect(cfg?.memory?.memu?.llm).toMatchObject({
      provider: "ollama",
      model: "qwen3:14b",
    });
  });

  it("keeps the local runtime as primary when cloud auth is also configured", async () => {
    const stateDir = await initStateDir("state-local-runtime-cloud-");
    const workspace = path.join(stateDir, "argent");

    const { runNonInteractiveOnboarding } = await import("./onboard-non-interactive.js");
    await runNonInteractiveOnboarding(
      {
        nonInteractive: true,
        mode: "local",
        workspace,
        localRuntime: "lmstudio",
        localTextModel: "qwen3-32b",
        localEmbeddingModel: "nomic-embed-text",
        authChoice: "mistral-api-key",
        mistralApiKey: "mistral-test-key",
        skipSkills: true,
        skipHealth: true,
        installDaemon: false,
      },
      runtime,
    );

    const { resolveConfigPath } = await import("../config/paths.js");
    const configPath = resolveConfigPath(process.env, stateDir);
    const cfg = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      agents?: {
        defaults?: {
          model?: { primary?: string };
          memorySearch?: {
            provider?: string;
            model?: string;
            remote?: { baseUrl?: string; apiKey?: string };
          };
        };
      };
      models?: { providers?: { mistral?: { baseUrl?: string; api?: string } } };
      memory?: { memu?: { llm?: { provider?: string; model?: string } } };
    };

    expect(cfg?.agents?.defaults?.model?.primary).toBe("lmstudio/qwen3-32b");
    expect(cfg?.agents?.defaults?.memorySearch).toMatchObject({
      provider: "openai",
      model: "nomic-embed-text",
      remote: {
        baseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "lmstudio",
      },
    });
    expect(cfg?.memory?.memu?.llm).toMatchObject({
      provider: "lmstudio",
      model: "qwen3-32b",
    });
    expect(cfg?.models?.providers?.mistral).toMatchObject({
      baseUrl: "https://api.mistral.ai/v1",
      api: "openai-completions",
    });
  });
});
