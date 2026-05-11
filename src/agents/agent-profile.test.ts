import { describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import type { AuthProfileStore } from "./auth-profiles.js";
import {
  mergeTtsConfig,
  redactTtsConfig,
  resolveEffectiveAgentTtsProfile,
  summarizeAuthProfileStore,
} from "./agent-profile.js";

describe("agent profile foundation", () => {
  it("deep-merges per-agent TTS overrides over global settings", () => {
    const merged = mergeTtsConfig(
      {
        auto: "tagged",
        provider: "elevenlabs",
        providers: {
          elevenlabs: {
            apiKey: "global-key",
            voiceId: "global-voice",
            modelId: "eleven_multilingual_v2",
          },
        },
      },
      {
        provider: "fish",
        providers: {
          elevenlabs: { voiceId: "agent-eleven-voice" },
          fish: { voiceId: "agent-fish-voice", outputFormat: "mp3" },
        },
      },
    );

    expect(merged).toEqual({
      auto: "tagged",
      provider: "fish",
      providers: {
        elevenlabs: {
          apiKey: "global-key",
          voiceId: "agent-eleven-voice",
          modelId: "eleven_multilingual_v2",
        },
        fish: { voiceId: "agent-fish-voice", outputFormat: "mp3" },
      },
    });
  });

  it("resolves effective agent TTS profile from agents.list[].tts", () => {
    const cfg: ArgentConfig = {
      messages: {
        tts: {
          auto: "inbound",
          provider: "elevenlabs",
          providers: { elevenlabs: { apiKey: "shared", voiceId: "shared-voice" } },
        },
      },
      agents: {
        list: [
          {
            id: "sam",
            tts: {
              provider: "fish",
              providers: { fish: { voiceId: "sam-fish" } },
            },
          },
        ],
      },
    };

    const profile = resolveEffectiveAgentTtsProfile(cfg, "sam");
    expect(profile.source).toBe("agent");
    expect(profile.effective).toMatchObject({
      auto: "inbound",
      provider: "fish",
      providers: {
        elevenlabs: { apiKey: "shared", voiceId: "shared-voice" },
        fish: { voiceId: "sam-fish" },
      },
    });
  });

  it("redacts TTS provider secrets while preserving voice metadata", () => {
    const redacted = redactTtsConfig({
      provider: "elevenlabs",
      elevenlabs: {
        apiKey: "secret-elevenlabs",
        voiceId: "voice-1",
        modelId: "eleven_multilingual_v2",
      },
      providers: {
        custom: {
          token: "secret-token",
          voiceId: "voice-2",
          nested: { refreshToken: "secret-refresh", modelId: "model-2" },
        },
      },
    });

    expect(JSON.stringify(redacted)).not.toContain("secret-elevenlabs");
    expect(JSON.stringify(redacted)).not.toContain("secret-token");
    expect(JSON.stringify(redacted)).not.toContain("secret-refresh");
    expect(redacted).toMatchObject({
      provider: "elevenlabs",
      elevenlabs: { voiceId: "voice-1", modelId: "eleven_multilingual_v2" },
      providers: {
        custom: {
          voiceId: "voice-2",
          nested: { modelId: "model-2" },
        },
      },
    });
  });

  it("redacts auth profile credentials while preserving status metadata", () => {
    const nowMs = 100_000;
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "anthropic:work": {
          type: "api_key",
          provider: "anthropic",
          key: "super-secret",
          email: "agent@example.com",
          metadata: { accountId: "acct-1" },
        },
        "openai:oauth": {
          type: "oauth",
          provider: "openai",
          accessToken: "oauth-secret",
          refreshToken: "refresh-secret",
          expiresAt: nowMs + 1_000,
        },
      },
      order: { anthropic: ["anthropic:work"] },
      lastGood: { anthropic: "anthropic:work" },
      usageStats: {
        "anthropic:work": {
          lastUsed: 50_000,
          cooldownUntil: nowMs + 30_000,
          errorCount: 2,
        },
      },
      providerStats: { anthropic: { circuitState: "open" } },
    };

    const summary = summarizeAuthProfileStore(store, { nowMs });
    expect(JSON.stringify(summary)).not.toContain("super-secret");
    expect(JSON.stringify(summary)).not.toContain("oauth-secret");
    expect(JSON.stringify(summary)).not.toContain("refresh-secret");
    expect(summary).toEqual({
      profileCount: 2,
      order: { anthropic: ["anthropic:work"] },
      providerStats: ["anthropic"],
      profiles: [
        {
          id: "anthropic:work",
          provider: "anthropic",
          type: "api_key",
          email: "agent@example.com",
          metadataKeys: ["accountId"],
          lastGoodForProviders: ["anthropic"],
          lastUsed: 50_000,
          cooldownUntil: nowMs + 30_000,
          errorCount: 2,
          available: false,
        },
        {
          id: "openai:oauth",
          provider: "openai",
          type: "oauth",
          lastGoodForProviders: [],
          available: true,
        },
      ],
    });
  });
});
