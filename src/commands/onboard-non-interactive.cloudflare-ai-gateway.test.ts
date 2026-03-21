import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("onboard (non-interactive): Cloudflare AI Gateway", () => {
  it("stores the API key and configures the default model", async () => {
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

    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "argent-onboard-cf-gateway-"));
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
          authChoice: "cloudflare-ai-gateway-api-key",
          cloudflareAiGatewayAccountId: "cf-account-id",
          cloudflareAiGatewayGatewayId: "cf-gateway-id",
          cloudflareAiGatewayApiKey: "cf-gateway-test-key",
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

      expect(cfg.auth?.profiles?.["cloudflare-ai-gateway:default"]?.provider).toBe(
        "cloudflare-ai-gateway",
      );
      expect(cfg.auth?.profiles?.["cloudflare-ai-gateway:default"]?.mode).toBe("api_key");
      expect(cfg.agents?.defaults?.model?.primary).toBe("cloudflare-ai-gateway/claude-sonnet-4-6");

      const { ensureAuthProfileStore } = await import("../agents/auth-profiles.js");
      const store = ensureAuthProfileStore();
      const profile = store.profiles["cloudflare-ai-gateway:default"];
      expect(profile?.type).toBe("api_key");
      if (profile?.type === "api_key") {
        expect(profile.provider).toBe("cloudflare-ai-gateway");
        expect(profile.key).toBe("cf-gateway-test-key");
        expect(profile.metadata).toEqual({
          accountId: "cf-account-id",
          gatewayId: "cf-gateway-id",
        });
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

  it("infers auth choice from API key flags", async () => {
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

    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "argent-onboard-cf-gateway-infer-"));
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
          cloudflareAiGatewayAccountId: "cf-account-id",
          cloudflareAiGatewayGatewayId: "cf-gateway-id",
          cloudflareAiGatewayApiKey: "cf-gateway-test-key",
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

      expect(cfg.auth?.profiles?.["cloudflare-ai-gateway:default"]?.provider).toBe(
        "cloudflare-ai-gateway",
      );
      expect(cfg.auth?.profiles?.["cloudflare-ai-gateway:default"]?.mode).toBe("api_key");
      expect(cfg.agents?.defaults?.model?.primary).toBe("cloudflare-ai-gateway/claude-sonnet-4-6");

      const { ensureAuthProfileStore } = await import("../agents/auth-profiles.js");
      const store = ensureAuthProfileStore();
      const profile = store.profiles["cloudflare-ai-gateway:default"];
      expect(profile?.type).toBe("api_key");
      if (profile?.type === "api_key") {
        expect(profile.provider).toBe("cloudflare-ai-gateway");
        expect(profile.key).toBe("cf-gateway-test-key");
        expect(profile.metadata).toEqual({
          accountId: "cf-account-id",
          gatewayId: "cf-gateway-id",
        });
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
