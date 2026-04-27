import { describe, expect, it } from "vitest";
import { createFakeRealtimeVoiceProvider } from "./fake-provider.js";
import {
  REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV,
  REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV,
  runRealtimeLocalAudioLiveSmoke,
} from "./index.js";

const enabledEnv = {
  [REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV]: "1",
  [REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV]: "1",
};

describe("local realtime audio live smoke harness", () => {
  it("keeps dry-run smoke deterministic with synthetic input and capture output", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const result = await runRealtimeLocalAudioLiveSmoke({
      allowTestOnlyProviders: true,
      configuredProviderId: "fake",
      env: enabledEnv,
      mode: "dry-run",
      platform: "darwin",
      providerConfigs: {
        fake: {
          script: [
            { type: "ready" },
            {
              type: "transcript",
              role: "assistant",
              text: "Argent local audio smoke ok.",
              isFinal: true,
            },
            { type: "audio", audio: "assistant-frame" },
          ],
        },
      },
      providers: [provider],
      timeoutMs: 250,
    });

    expect(result).toEqual({
      ok: true,
      mode: "dry-run",
      realDeviceEvidence: false,
      providerId: "fake",
      providerLabel: "Fake realtime voice",
      finalAssistantTranscript: "Argent local audio smoke ok.",
      audioChunkCount: 1,
      eventTypes: ["ready", "transcript", "audio"],
      error: undefined,
    });
    expect(provider.bridges.at(-1)?.state.userMessages).toEqual([
      "Say exactly: Argent local audio smoke ok.",
    ]);
  });

  it("requires explicit audio process gates before dry-run smoke construction", async () => {
    const provider = createFakeRealtimeVoiceProvider();

    await expect(
      runRealtimeLocalAudioLiveSmoke({
        allowTestOnlyProviders: true,
        configuredProviderId: "fake",
        env: {},
        mode: "dry-run",
        platform: "darwin",
        providerConfigs: { fake: {} },
        providers: [provider],
        timeoutMs: 10,
      }),
    ).rejects.toThrow(REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV);
    await expect(
      runRealtimeLocalAudioLiveSmoke({
        allowTestOnlyProviders: true,
        configuredProviderId: "fake",
        env: { [REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV]: "1" },
        mode: "dry-run",
        platform: "darwin",
        providerConfigs: { fake: {} },
        providers: [provider],
        timeoutMs: 10,
      }),
    ).rejects.toThrow(REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV);
  });

  it("returns a truthful timeout result instead of claiming live audio success", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const result = await runRealtimeLocalAudioLiveSmoke({
      allowTestOnlyProviders: true,
      configuredProviderId: "fake",
      env: enabledEnv,
      mode: "dry-run",
      platform: "darwin",
      providerConfigs: { fake: { script: [{ type: "ready" }] } },
      providers: [provider],
      timeoutMs: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.realDeviceEvidence).toBe(false);
    expect(result.error).toBe(
      "Timed out after 1ms waiting for final assistant transcript and audio output",
    );
    expect(result.audioChunkCount).toBe(0);
    expect(result.eventTypes).toEqual(["ready"]);
  });
});
