import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("onboard (non-interactive): Mistral", () => {
  it("infers auth choice from --mistral-api-key and sets default model", async () => {
    const prev = {
      home: process.env.HOME,
      stateDir: process.env.ARGENT_STATE_DIR,
      configPath: process.env.ARGENT_CONFIG_PATH,
      skipChannels: process.env.ARGENT_SKIP_CHANNELS,
      skipGmail: process.env.ARGENT_SKIP_GMAIL_WATCHER,
      skipCron: process.env.ARGENT_SKIP_CRON,
      skipCanvas: process.env.ARGENT_SKIP_CANVAS_HOST,
      token: process.env.ARGENT_GATEWAY_TOKEN,
      password: process.env.ARGENT_GATEWAY_PASSWORD,
    };

    process.env.ARGENT_SKIP_CHANNELS = "1";
    process.env.ARGENT_SKIP_GMAIL_WATCHER = "1";
    process.env.ARGENT_SKIP_CRON = "1";
    process.env.ARGENT_SKIP_CANVAS_HOST = "1";
    delete process.env.ARGENT_GATEWAY_TOKEN;
    delete process.env.ARGENT_GATEWAY_PASSWORD;

    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "argent-onboard-mistral-"));
    process.env.HOME = tempHome;
    process.env.ARGENT_STATE_DIR = tempHome;
    process.env.ARGENT_CONFIG_PATH = path.join(tempHome, "argent.json");
    vi.resetModules();

    const runtime = {
      log: () => {},
      error: (msg: string) => {
        throw new Error(msg);
      },
      exit: (code: number) => {
        throw new Error(`exit:${code}`);
      },
    };

    try {
      const { runNonInteractiveOnboarding } = await import("./onboard-non-interactive.js");
      await runNonInteractiveOnboarding(
        {
          nonInteractive: true,
          mistralApiKey: "mistral-test-key",
          skipHealth: true,
          skipChannels: true,
          skipSkills: true,
          json: true,
        },
        runtime,
      );

      const { CONFIG_PATH } = await import("../config/config.js");
      const cfg = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")) as {
        auth?: {
          profiles?: Record<string, { provider?: string; mode?: string }>;
        };
        agents?: { defaults?: { model?: { primary?: string } } };
      };

      expect(cfg.auth?.profiles?.["mistral:default"]?.provider).toBe("mistral");
      expect(cfg.auth?.profiles?.["mistral:default"]?.mode).toBe("api_key");
      expect(cfg.agents?.defaults?.model?.primary).toBe("mistral/mistral-large-latest");

      const { ensureAuthProfileStore } = await import("../agents/auth-profiles.js");
      const store = ensureAuthProfileStore();
      const profile = store.profiles["mistral:default"];
      expect(profile?.type).toBe("api_key");
      if (profile?.type === "api_key") {
        expect(profile.provider).toBe("mistral");
        expect(profile.key).toBe("mistral-test-key");
      }
    } finally {
      await fs.rm(tempHome, { recursive: true, force: true });
      process.env.HOME = prev.home;
      process.env.ARGENT_STATE_DIR = prev.stateDir;
      process.env.ARGENT_CONFIG_PATH = prev.configPath;
      process.env.ARGENT_SKIP_CHANNELS = prev.skipChannels;
      process.env.ARGENT_SKIP_GMAIL_WATCHER = prev.skipGmail;
      process.env.ARGENT_SKIP_CRON = prev.skipCron;
      process.env.ARGENT_SKIP_CANVAS_HOST = prev.skipCanvas;
      process.env.ARGENT_GATEWAY_TOKEN = prev.token;
      process.env.ARGENT_GATEWAY_PASSWORD = prev.password;
    }
  }, 60_000);
});
