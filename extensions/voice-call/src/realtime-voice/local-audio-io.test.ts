import { describe, expect, it, vi } from "vitest";
import { createFakeRealtimeVoiceProvider } from "./fake-provider.js";
import {
  CaptureRealtimeOperatorAudioOutput,
  createRealtimeOperatorAudioSession,
  SyntheticRealtimeOperatorAudioInput,
} from "./local-audio-io.js";

function latestBridge(provider: ReturnType<typeof createFakeRealtimeVoiceProvider>) {
  const bridge = provider.bridges.at(-1);
  if (!bridge) {
    throw new Error("Expected fake bridge");
  }
  return bridge;
}

describe("local realtime operator audio I/O", () => {
  it("routes synthetic PCM input into the operator session and captures output audio", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const audioInput = new SyntheticRealtimeOperatorAudioInput(["operator-frame"]);
    const audioOutput = new CaptureRealtimeOperatorAudioOutput();
    const session = createRealtimeOperatorAudioSession({
      allowTestOnlyProviders: true,
      audioInput,
      audioOutput,
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: {
        fake: {
          script: [{ type: "ready" }, { type: "audio", audio: "assistant-frame" }],
        },
      },
    });

    await session.start();
    session.stop("completed");

    expect(latestBridge(provider).state.audioInputs).toEqual([Buffer.from("operator-frame")]);
    expect(audioInput.started).toBe(true);
    expect(audioInput.stopped).toBe(true);
    expect(audioOutput.chunks).toEqual([Buffer.from("assistant-frame")]);
    expect(audioOutput.closed).toBe(true);
  });

  it("clears captured output on provider clear-audio events", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const audioInput = new SyntheticRealtimeOperatorAudioInput([]);
    const audioOutput = new CaptureRealtimeOperatorAudioOutput();
    const session = createRealtimeOperatorAudioSession({
      allowTestOnlyProviders: true,
      audioInput,
      audioOutput,
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: {
        fake: {
          script: [{ type: "audio", audio: [1, 2, 3] }, { type: "clearAudio" }],
        },
      },
    });

    await session.start();

    expect(audioOutput.chunks).toEqual([]);
    expect(audioOutput.clearCount).toBe(1);
    expect(audioOutput.closed).toBe(false);
  });

  it("cleans up input and output on operator cancellation", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const audioInput = new SyntheticRealtimeOperatorAudioInput([]);
    const audioOutput = new CaptureRealtimeOperatorAudioOutput();
    const onEvent = vi.fn();
    const session = createRealtimeOperatorAudioSession({
      allowTestOnlyProviders: true,
      audioInput,
      audioOutput,
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: { fake: { autoReady: false } },
      onEvent,
    });

    await session.start();
    session.stop("cancelled");

    expect(audioInput.stopped).toBe(true);
    expect(audioOutput.closed).toBe(true);
    expect(onEvent).toHaveBeenCalledWith({ type: "close", reason: "cancelled" });
    expect(session.isConnected()).toBe(false);
  });

  it("cleans up input and output when provider errors", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const audioInput = new SyntheticRealtimeOperatorAudioInput([]);
    const audioOutput = new CaptureRealtimeOperatorAudioOutput();
    const session = createRealtimeOperatorAudioSession({
      allowTestOnlyProviders: true,
      audioInput,
      audioOutput,
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: { fake: { script: [{ type: "error", message: "boom" }] } },
    });

    await session.start();

    expect(audioInput.stopped).toBe(true);
    expect(audioOutput.closed).toBe(true);
    expect(session.operatorSession.getEvents()[0]).toMatchObject({
      type: "error",
      error: { message: "boom" },
    });
  });

  it("cleans up input and output when input adapter startup fails", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const audioInput = new SyntheticRealtimeOperatorAudioInput([Buffer.from("late")]);
    const audioOutput = new CaptureRealtimeOperatorAudioOutput();
    audioInput.stop();
    const session = createRealtimeOperatorAudioSession({
      allowTestOnlyProviders: true,
      audioInput,
      audioOutput,
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: { fake: { autoReady: false } },
    });

    await expect(session.start()).rejects.toThrow("Synthetic realtime audio input is stopped");

    expect(audioInput.stopped).toBe(true);
    expect(audioOutput.closed).toBe(true);
    expect(session.operatorSession.getEvents()).toEqual([{ type: "close", reason: "error" }]);
  });

  it("keeps fake providers test-only unless explicitly allowed", () => {
    const provider = createFakeRealtimeVoiceProvider();
    const audioInput = new SyntheticRealtimeOperatorAudioInput([]);
    const audioOutput = new CaptureRealtimeOperatorAudioOutput();

    expect(() =>
      createRealtimeOperatorAudioSession({
        audioInput,
        audioOutput,
        providers: [provider],
        configuredProviderId: "fake",
        providerConfigs: { fake: {} },
      }),
    ).toThrow("No realtime voice provider is available for operator sessions");
  });
});
