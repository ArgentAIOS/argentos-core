import { describe, expect, it } from "vitest";
import type { RealtimeVoiceProvider } from "./provider-types.js";
import { resolveConfiguredRealtimeVoiceProvider } from "./provider-resolver.js";

const createProvider = (overrides: Partial<RealtimeVoiceProvider> = {}): RealtimeVoiceProvider => ({
  id: "openai",
  aliases: ["openai-realtime"],
  isConfigured: ({ providerConfig }) => Boolean(providerConfig.apiKey),
  createBridge: () => {
    throw new Error("not used");
  },
  ...overrides,
});

describe("resolveConfiguredRealtimeVoiceProvider", () => {
  it("selects the first configured provider when no provider is explicit", () => {
    const provider = createProvider();

    const resolved = resolveConfiguredRealtimeVoiceProvider({
      providers: [provider],
      providerConfigs: { openai: { apiKey: "test-key" } },
      defaultModel: "gpt-realtime",
    });

    expect(resolved.provider).toBe(provider);
    expect(resolved.providerConfig).toEqual({ apiKey: "test-key", model: "gpt-realtime" });
  });

  it("resolves provider aliases", () => {
    const provider = createProvider();

    const resolved = resolveConfiguredRealtimeVoiceProvider({
      configuredProviderId: "openai-realtime",
      providers: [provider],
      providerConfigs: { openai: { apiKey: "test-key" } },
    });

    expect(resolved.provider.id).toBe("openai");
  });

  it("passes config context through provider hooks", () => {
    const cfg = { channel: "telegram" } as never;
    const provider = createProvider({
      resolveConfig: ({ cfg: hookCfg, rawConfig }) => ({
        ...rawConfig,
        hasConfig: hookCfg === cfg,
      }),
      isConfigured: ({ cfg: hookCfg, providerConfig }) =>
        hookCfg === cfg && providerConfig.hasConfig === true,
    });

    const resolved = resolveConfiguredRealtimeVoiceProvider({
      cfg,
      providers: [provider],
      providerConfigs: { openai: { apiKey: "test-key" } },
    });

    expect(resolved.providerConfig).toMatchObject({ hasConfig: true });
  });

  it("fails when the requested provider is not registered", () => {
    expect(() =>
      resolveConfiguredRealtimeVoiceProvider({
        configuredProviderId: "google",
        providers: [createProvider()],
      }),
    ).toThrow('Realtime voice provider "google" is not registered');
  });

  it("fails when the provider is not configured", () => {
    expect(() =>
      resolveConfiguredRealtimeVoiceProvider({
        providers: [createProvider()],
        providerConfigs: { openai: {} },
      }),
    ).toThrow('Realtime voice provider "openai" is not configured');
  });
});
