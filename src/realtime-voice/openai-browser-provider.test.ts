import { describe, expect, it, vi } from "vitest";
import { createOpenAiRealtimeBrowserProvider } from "./openai-browser-provider.js";

describe("OpenAiRealtimeBrowserProvider", () => {
  it("creates a browser session with an ephemeral client secret", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer server-key",
        "Content-Type": "application/json",
      });
      const body = JSON.parse(String(init?.body)) as {
        session: { model: string; instructions: string; audio: { output: { voice: string } } };
      };
      expect(body.session).toMatchObject({
        type: "realtime",
        model: "request-model",
        instructions: "Talk briefly.",
        audio: { output: { voice: "request-voice" } },
      });
      return {
        ok: true,
        json: async () => ({ value: "client-secret", expires_at: 123 }),
      } as Response;
    });
    const provider = createOpenAiRealtimeBrowserProvider({
      env: {} as NodeJS.ProcessEnv,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const session = await provider.createBrowserSession?.({
      providerConfig: { apiKey: "server-key", model: "config-model", voice: "config-voice" },
      model: "request-model",
      voice: "request-voice",
      instructions: "Talk briefly.",
    });

    expect(session).toEqual({
      provider: "openai",
      transport: "webrtc-sdp",
      clientSecret: "client-secret",
      offerUrl: "https://api.openai.com/v1/realtime/calls",
      model: "request-model",
      voice: "request-voice",
      expiresAt: 123,
    });
  });

  it("resolves OPENAI_API_KEY from server environment only", () => {
    const provider = createOpenAiRealtimeBrowserProvider({
      env: { OPENAI_API_KEY: "env-key" } as NodeJS.ProcessEnv,
    });
    const providerConfig = provider.resolveConfig?.({ rawConfig: {} }) ?? {};

    expect(providerConfig).toMatchObject({
      apiKey: "env-key",
      model: "gpt-realtime-1.5",
      voice: "marin",
    });
    expect(provider.isConfigured?.({ providerConfig })).toBe(true);
  });
});
