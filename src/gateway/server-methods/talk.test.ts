import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCallbacks,
  RealtimeVoiceBrowserSessionCreateRequest,
  RealtimeVoiceProvider,
} from "../../realtime-voice/provider-types.js";
import { clearTalkRealtimeRelaySessionsForTest } from "../talk-realtime-relay.js";
import { createTalkHandlers } from "./talk.js";

type TestBridge = RealtimeVoiceBridge & {
  callbacks: RealtimeVoiceBridgeCallbacks;
  sentAudio: Buffer[];
  toolResults: Array<{ callId: string; result: unknown; willContinue?: boolean }>;
  markAckCount: number;
};

function createRelayProvider(bridges: TestBridge[]): RealtimeVoiceProvider {
  return {
    id: "relay-provider",
    createBridge: (request) => {
      const bridge: TestBridge = {
        callbacks: request,
        sentAudio: [],
        toolResults: [],
        markAckCount: 0,
        connect: async () => request.onReady?.(),
        sendAudio: (audio) => bridge.sentAudio.push(audio),
        setMediaTimestamp: vi.fn(),
        submitToolResult: (callId, result, options) =>
          bridge.toolResults.push({ callId, result, willContinue: options?.willContinue }),
        acknowledgeMark: () => {
          bridge.markAckCount += 1;
        },
        close: vi.fn((reason = "completed") => request.onClose?.(reason)),
        isConnected: () => true,
      };
      bridges.push(bridge);
      return bridge;
    },
  };
}

function baseContext() {
  return {
    hasConnectedMobileNode: () => true,
    broadcast: vi.fn(),
    broadcastToConnIds: vi.fn(),
  } as never;
}

function baseOptions(params: Record<string, unknown>, context = baseContext()) {
  const respond = vi.fn();
  return {
    options: {
      req: { id: "req-1", type: "req", method: "talk.realtime.session" },
      params,
      client: { connect: { client: "dashboard" }, connId: "conn-1" },
      isWebchatConnect: () => false,
      respond,
      context,
    } as never,
    respond,
  };
}

describe("talk realtime gateway methods", () => {
  afterEach(() => {
    clearTalkRealtimeRelaySessionsForTest();
  });

  it("creates a direct browser realtime session without exposing the provider API key", async () => {
    let browserRequest: RealtimeVoiceBrowserSessionCreateRequest | undefined;
    const provider: RealtimeVoiceProvider = {
      id: "openai",
      aliases: ["gpt-realtime"],
      resolveConfig: ({ rawConfig }) => rawConfig,
      isConfigured: ({ providerConfig }) => providerConfig.apiKey === "server-secret",
      createBridge: vi.fn(() => {
        throw new Error("not used");
      }),
      createBrowserSession: vi.fn(async (request) => {
        browserRequest = request;
        return {
          provider: "openai",
          transport: "webrtc-sdp" as const,
          clientSecret: "client-secret",
          offerUrl: "https://api.openai.com/v1/realtime/calls",
          model: request.model,
          voice: request.voice,
          expiresAt: 123,
        };
      }),
    };
    const handlers = createTalkHandlers({
      providers: [provider],
      loadConfig: () => ({
        talk: {
          realtime: {
            provider: "gpt-realtime",
            model: "config-model",
            voice: "config-voice",
            instructions: "config instructions",
            providers: { openai: { apiKey: "server-secret" } },
          },
        },
      }),
    });
    const { options, respond } = baseOptions({ model: "request-model", voice: "request-voice" });

    await handlers["talk.realtime.session"](options);

    expect(browserRequest).toMatchObject({
      providerConfig: {
        apiKey: "server-secret",
        model: "request-model",
        voice: "request-voice",
      },
      model: "request-model",
      voice: "request-voice",
      instructions: "config instructions",
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        provider: "openai",
        transport: "webrtc-sdp",
        mode: "browser-direct",
        clientSecret: "client-secret",
      }),
    );
    expect(JSON.stringify(respond.mock.calls[0]?.[1])).not.toContain("server-secret");
  });

  it("creates a gateway relay session and routes relay controls by connection", async () => {
    const bridges: TestBridge[] = [];
    const context = baseContext();
    const handlers = createTalkHandlers({
      providers: [createRelayProvider(bridges)],
      loadConfig: () => ({
        talk: {
          realtime: {
            provider: "relay-provider",
            transport: "gateway-relay",
          },
        },
      }),
    });
    const sessionCall = baseOptions({}, context);

    await handlers["talk.realtime.session"](sessionCall.options);
    await Promise.resolve();

    const sessionPayload = sessionCall.respond.mock.calls[0]?.[1] as { relaySessionId: string };
    expect(sessionPayload).toMatchObject({
      provider: "relay-provider",
      transport: "gateway-relay",
      mode: "gateway-relay",
    });

    await handlers["talk.realtime.audio"](
      baseOptions({ relaySessionId: sessionPayload.relaySessionId, audioBase64: "AQID" }, context)
        .options,
    );
    await handlers["talk.realtime.mark"](
      baseOptions({ relaySessionId: sessionPayload.relaySessionId }, context).options,
    );
    await handlers["talk.realtime.toolResult"](
      baseOptions(
        {
          relaySessionId: sessionPayload.relaySessionId,
          callId: "call-1",
          result: { ok: true },
          willContinue: true,
        },
        context,
      ).options,
    );

    expect(bridges[0]?.sentAudio).toEqual([Buffer.from([1, 2, 3])]);
    expect(bridges[0]?.markAckCount).toBe(1);
    expect(bridges[0]?.toolResults).toEqual([
      { callId: "call-1", result: { ok: true }, willContinue: true },
    ]);
  });

  it("rejects invalid realtime session params", async () => {
    const handlers = createTalkHandlers({
      providers: [],
      loadConfig: () => ({}),
    });
    const { options, respond } = baseOptions({ transport: "phone-call" });

    await handlers["talk.realtime.session"](options);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid talk.realtime.session params"),
      }),
    );
  });
});
