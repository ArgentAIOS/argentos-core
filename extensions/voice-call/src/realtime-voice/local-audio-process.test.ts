import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  assertRealtimeLocalAudioProcessGate,
  createFfmpegMacosPcm24kCaptureCommand,
  createFfplayPcm24kPlaybackCommand,
  FfmpegMacosRealtimeOperatorAudioInput,
  FfplayRealtimeOperatorAudioOutput,
  parseSystemProfilerAudioDevices,
  probeRealtimeLocalAudioProcesses,
  REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV,
  REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV,
  type RealtimeLocalAudioSpawn,
  type RealtimeLocalAudioSpawnResult,
  type RealtimeLocalAudioSyncRunner,
} from "./local-audio-process.js";

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

const enabledEnv = {
  [REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV]: "1",
  [REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV]: "1",
};

describe("local realtime audio process helpers", () => {
  it("parses macOS default input and output devices from system_profiler audio output", () => {
    const devices = parseSystemProfilerAudioDevices(`
Audio:

    MacBook Pro Microphone:

      Default Input Device: Yes
      Input Channels: 1
      Current SampleRate: 48000

    MacBook Pro Speakers:

      Default Output Device: Yes
      Output Channels: 2
      Current SampleRate: 48000
`);

    expect(devices).toEqual([
      {
        name: "MacBook Pro Microphone",
        input: true,
        output: false,
        defaultInput: true,
        defaultOutput: false,
      },
      {
        name: "MacBook Pro Speakers",
        input: false,
        output: true,
        defaultInput: false,
        defaultOutput: true,
      },
    ]);
  });

  it("probes tools, devices, gates, and warnings without spawning live audio", () => {
    const runner: RealtimeLocalAudioSyncRunner = (command): RealtimeLocalAudioSpawnResult => {
      if (command === "system_profiler") {
        return {
          status: 0,
          stdout: `
Audio:
    Studio Mic:
      Default Input Device: Yes
      Input Channels: 1
    Studio Monitor:
      Default Output Device: Yes
      Output Channels: 2
`,
          stderr: "",
        };
      }
      if (command === "ffplay") {
        return {
          status: 1,
          stdout: "",
          stderr: "missing ffplay",
        };
      }
      return { status: 0, stdout: `${command} ok`, stderr: "" };
    };

    const probe = probeRealtimeLocalAudioProcesses({
      env: {},
      platform: "darwin",
      runner,
    });

    expect(probe.enabled).toBe(false);
    expect(probe.liveConfirmed).toBe(false);
    expect(probe.tools.ffmpeg.available).toBe(true);
    expect(probe.tools.ffplay.available).toBe(false);
    expect(probe.tools.afplay.available).toBe(true);
    expect(probe.defaultInputDevice).toBe("Studio Mic");
    expect(probe.defaultOutputDevice).toBe("Studio Monitor");
    expect(probe.warnings).toContain(
      `${REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV}=1 is required before spawning audio tools.`,
    );
    expect(probe.warnings).toContain(
      `${REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV}=1 is required before live mic/speaker use.`,
    );
    expect(probe.warnings).toContain(
      "ffplay is required for this realtime local audio playback wrapper.",
    );
  });

  it("requires explicit process and live gates before wrapper construction", () => {
    expect(() => assertRealtimeLocalAudioProcessGate({ env: {}, platform: "darwin" })).toThrow(
      REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV,
    );
    expect(() =>
      assertRealtimeLocalAudioProcessGate({
        env: { [REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV]: "1" },
        platform: "darwin",
      }),
    ).toThrow(REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV);
    expect(() =>
      assertRealtimeLocalAudioProcessGate({
        env: enabledEnv,
        platform: "darwin",
      }),
    ).not.toThrow();
  });

  it("builds deterministic PCM24k playback and capture commands", () => {
    expect(createFfplayPcm24kPlaybackCommand({ ffplayPath: "/opt/homebrew/bin/ffplay" })).toEqual({
      command: "/opt/homebrew/bin/ffplay",
      args: ["-nodisp", "-autoexit", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0"],
    });
    expect(createFfmpegMacosPcm24kCaptureCommand({ avFoundationDevice: ":1" })).toEqual({
      command: "ffmpeg",
      args: ["-f", "avfoundation", "-i", ":1", "-ac", "1", "-ar", "24000", "-f", "s16le", "pipe:1"],
    });
  });

  it("writes provider audio chunks to ffplay stdin and cleans up the child process", () => {
    const child = createFakeChild();
    const restartedChild = createFakeChild();
    const spawnMock = vi.fn(() => child) as unknown as RealtimeLocalAudioSpawn;
    vi.mocked(spawnMock)
      .mockReturnValueOnce(child as never)
      .mockReturnValueOnce(restartedChild as never);
    const output = new FfplayRealtimeOperatorAudioOutput({
      env: enabledEnv,
      platform: "darwin",
      spawn: spawnMock,
      command: createFfplayPcm24kPlaybackCommand({ ffplayPath: "ffplay-test" }),
    });

    output.writePcm24k(Buffer.from([1, 2, 3]));
    output.writePcm24k(Buffer.from([4, 5]));
    output.clear();
    output.writePcm24k(Buffer.from([6]));
    output.close();
    output.writePcm24k(Buffer.from([7]));

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock).toHaveBeenCalledWith(
      "ffplay-test",
      createFfplayPcm24kPlaybackCommand({ ffplayPath: "ffplay-test" }).args,
      { stdio: "pipe" },
    );
    expect(child.stdin.writes).toEqual([Buffer.from([1, 2, 3]), Buffer.from([4, 5])]);
    expect(child.stdin.ended).toBe(true);
    expect(child.killed).toBe(true);
    expect(restartedChild.stdin.writes).toEqual([Buffer.from([6])]);
    expect(restartedChild.stdin.ended).toBe(true);
    expect(restartedChild.killed).toBe(true);
  });

  it("routes ffmpeg stdout PCM chunks into the operator input callback without persisting audio by default", () => {
    const child = createFakeChild();
    const spawnMock = vi.fn(() => child) as unknown as RealtimeLocalAudioSpawn;
    const input = new FfmpegMacosRealtimeOperatorAudioInput({
      env: enabledEnv,
      platform: "darwin",
      spawn: spawnMock,
      command: createFfmpegMacosPcm24kCaptureCommand({ ffmpegPath: "ffmpeg-test" }),
    });
    const chunks: Buffer[] = [];

    input.start((chunk) => chunks.push(chunk));
    child.stdout.emit("data", Buffer.from([9, 8, 7]));
    input.stop();
    child.stdout.emit("data", Buffer.from([6, 5, 4]));

    expect(spawnMock).toHaveBeenCalledWith(
      "ffmpeg-test",
      createFfmpegMacosPcm24kCaptureCommand({ ffmpegPath: "ffmpeg-test" }).args,
      { stdio: "pipe" },
    );
    expect(chunks).toEqual([Buffer.from([9, 8, 7])]);
    expect(child.killed).toBe(true);
  });
});
