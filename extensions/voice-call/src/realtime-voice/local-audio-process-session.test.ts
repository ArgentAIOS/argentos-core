import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createFakeRealtimeVoiceProvider } from "./fake-provider.js";
import {
  createRealtimeLocalAudioOperatorSession,
  REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV,
  REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV,
  type RealtimeLocalAudioSpawn,
} from "./index.js";

class FakeStream extends EventEmitter {
  readonly writes: Buffer[] = [];
  ended = false;

  write(chunk: Buffer): boolean {
    this.writes.push(Buffer.from(chunk));
    return true;
  }

  end(): void {
    this.ended = true;
  }
}

function createFakeChild() {
  return {
    stdin: new FakeStream(),
    stdout: new FakeStream(),
    stderr: new FakeStream(),
    killed: false,
    kill() {
      this.killed = true;
      return true;
    },
  };
}

function latestBridge(provider: ReturnType<typeof createFakeRealtimeVoiceProvider>) {
  const bridge = provider.bridges.at(-1);
  if (!bridge) {
    throw new Error("Expected fake bridge");
  }
  return bridge;
}

const enabledEnv = {
  [REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV]: "1",
  [REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV]: "1",
};

describe("local realtime audio operator process sessions", () => {
  it("requires explicit live gates even for dry-run synthetic and capture adapters", () => {
    const provider = createFakeRealtimeVoiceProvider();

    expect(() =>
      createRealtimeLocalAudioOperatorSession({
        allowTestOnlyProviders: true,
        configuredProviderId: "fake",
        input: { kind: "synthetic", frames: [] },
        output: { kind: "capture" },
        platform: "darwin",
        providerConfigs: { fake: {} },
        providers: [provider],
      }),
    ).toThrow(REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV);
    expect(() =>
      createRealtimeLocalAudioOperatorSession({
        allowTestOnlyProviders: true,
        configuredProviderId: "fake",
        env: { [REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV]: "1" },
        input: { kind: "synthetic", frames: [] },
        output: { kind: "capture" },
        platform: "darwin",
        providerConfigs: { fake: {} },
        providers: [provider],
      }),
    ).toThrow(REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV);
  });

  it("runs a dry-run operator audio session with synthetic input and captured provider audio", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const session = createRealtimeLocalAudioOperatorSession({
      allowTestOnlyProviders: true,
      configuredProviderId: "fake",
      env: enabledEnv,
      input: { kind: "synthetic", frames: ["operator-frame"] },
      output: { kind: "capture" },
      platform: "darwin",
      providerConfigs: {
        fake: {
          script: [{ type: "ready" }, { type: "audio", audio: "assistant-frame" }],
        },
      },
      providers: [provider],
    });

    await session.start();
    session.stop("completed");

    expect(latestBridge(provider).state.audioInputs).toEqual([Buffer.from("operator-frame")]);
    expect(session.operatorSession.getEvents()).toContainEqual({
      type: "audio",
      audio: Buffer.from("assistant-frame"),
    });
    expect(session.isConnected()).toBe(false);
  });

  it("wires process input and output adapters into the operator session behind gates", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const playbackChild = createFakeChild();
    const captureChild = createFakeChild();
    const spawnMock = vi
      .fn()
      .mockReturnValueOnce(playbackChild)
      .mockReturnValueOnce(captureChild) as unknown as RealtimeLocalAudioSpawn;
    const session = createRealtimeLocalAudioOperatorSession({
      allowTestOnlyProviders: true,
      configuredProviderId: "fake",
      env: enabledEnv,
      input: {
        kind: "process",
        command: { command: "ffmpeg-test", args: ["capture"] },
      },
      output: {
        kind: "process",
        command: { command: "ffplay-test", args: ["playback"] },
      },
      platform: "darwin",
      providerConfigs: {
        fake: {
          script: [{ type: "ready" }, { type: "audio", audio: "assistant-frame" }],
        },
      },
      providers: [provider],
      spawn: spawnMock,
    });

    await session.start();
    captureChild.stdout.emit("data", Buffer.from("operator-frame"));
    session.stop("cancelled");
    captureChild.stdout.emit("data", Buffer.from("late-frame"));

    expect(spawnMock).toHaveBeenNthCalledWith(1, "ffplay-test", ["playback"], { stdio: "pipe" });
    expect(spawnMock).toHaveBeenNthCalledWith(2, "ffmpeg-test", ["capture"], { stdio: "pipe" });
    expect(playbackChild.stdin.writes).toEqual([Buffer.from("assistant-frame")]);
    expect(playbackChild.killed).toBe(true);
    expect(captureChild.killed).toBe(true);
    expect(latestBridge(provider).state.audioInputs).toEqual([Buffer.from("operator-frame")]);
  });
});
