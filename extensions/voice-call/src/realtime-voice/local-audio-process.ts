import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import type { RealtimeOperatorAudioInput, RealtimeOperatorAudioOutput } from "./local-audio-io.js";

export const REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV = "ARGENT_REALTIME_AUDIO_PROCESS_ENABLE";
export const REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV = "ARGENT_REALTIME_AUDIO_CONFIRM_LIVE";
export const REALTIME_LOCAL_AUDIO_CAPTURE_PATH_ENV = "ARGENT_REALTIME_AUDIO_CAPTURE_PATH";

export type RealtimeLocalAudioToolName = "ffmpeg" | "ffplay" | "afplay" | "system_profiler";

export type RealtimeLocalAudioToolProbe = {
  readonly name: RealtimeLocalAudioToolName;
  readonly command: string;
  readonly available: boolean;
  readonly detail?: string;
};

export type RealtimeLocalAudioDevice = {
  readonly name: string;
  readonly input: boolean;
  readonly output: boolean;
  readonly defaultInput: boolean;
  readonly defaultOutput: boolean;
};

export type RealtimeLocalAudioProbe = {
  readonly platform: NodeJS.Platform;
  readonly enabled: boolean;
  readonly liveConfirmed: boolean;
  readonly capturePath?: string;
  readonly tools: Record<RealtimeLocalAudioToolName, RealtimeLocalAudioToolProbe>;
  readonly devices: RealtimeLocalAudioDevice[];
  readonly defaultInputDevice?: string;
  readonly defaultOutputDevice?: string;
  readonly warnings: string[];
};

export type RealtimeLocalAudioProcessEnv = Partial<
  Record<
    | typeof REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV
    | typeof REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV
    | typeof REALTIME_LOCAL_AUDIO_CAPTURE_PATH_ENV,
    string
  >
>;

export type RealtimeLocalAudioSpawnResult = Pick<
  ReturnType<typeof spawnSync>,
  "error" | "status" | "stdout" | "stderr"
>;

export type RealtimeLocalAudioSyncRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number },
) => RealtimeLocalAudioSpawnResult;

export type RealtimeLocalAudioSpawn = (
  command: string,
  args: string[],
  options: { stdio: "pipe" },
) => ChildProcessWithoutNullStreams;

export type RealtimeLocalAudioProcessOptions = {
  env?: RealtimeLocalAudioProcessEnv;
  platform?: NodeJS.Platform;
  spawn?: RealtimeLocalAudioSpawn;
};

export type RealtimeLocalAudioProbeOptions = {
  env?: RealtimeLocalAudioProcessEnv;
  platform?: NodeJS.Platform;
  runner?: RealtimeLocalAudioSyncRunner;
  timeoutMs?: number;
};

export type RealtimeLocalAudioCommand = {
  readonly command: string;
  readonly args: string[];
};

export type FfplayPcm24kPlaybackCommandOptions = {
  ffplayPath?: string;
};

export type FfmpegMacosPcm24kCaptureCommandOptions = {
  ffmpegPath?: string;
  avFoundationDevice?: string;
};

const DEFAULT_TIMEOUT_MS = 2_000;
const TOOL_COMMANDS: Record<RealtimeLocalAudioToolName, string> = {
  ffmpeg: "ffmpeg",
  ffplay: "ffplay",
  afplay: "afplay",
  system_profiler: "system_profiler",
};

function envEnabled(env: RealtimeLocalAudioProcessEnv | undefined, key: string): boolean {
  return env?.[key] === "1" || env?.[key]?.toLowerCase() === "true";
}

function defaultRunner(
  command: string,
  args: string[],
  options: { timeoutMs: number },
): RealtimeLocalAudioSpawnResult {
  return spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeoutMs,
  });
}

function probeTool(
  name: RealtimeLocalAudioToolName,
  runner: RealtimeLocalAudioSyncRunner,
  timeoutMs: number,
): RealtimeLocalAudioToolProbe {
  const command = TOOL_COMMANDS[name];
  const args = name === "system_profiler" ? ["SPAudioDataType"] : ["-version"];
  const result = runner(command, args, { timeoutMs });
  if (result.error) {
    return {
      name,
      command,
      available: false,
      detail: result.error.message,
    };
  }
  return {
    name,
    command,
    available: result.status === 0 || result.status === null,
    detail:
      String(result.stderr || result.stdout || "")
        .split("\n")[0]
        ?.trim() || undefined,
  };
}

export function parseSystemProfilerAudioDevices(output: string): RealtimeLocalAudioDevice[] {
  const devices: Array<{
    name: string;
    input: boolean;
    output: boolean;
    defaultInput: boolean;
    defaultOutput: boolean;
  }> = [];
  let current:
    | {
        name: string;
        input: boolean;
        output: boolean;
        defaultInput: boolean;
        defaultOutput: boolean;
      }
    | undefined;

  const finishCurrent = () => {
    if (current && current.name !== "Audio") {
      devices.push(current);
    }
  };

  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.endsWith(":") && !line.includes("Default ")) {
      finishCurrent();
      current = {
        name: line.slice(0, -1),
        input: false,
        output: false,
        defaultInput: false,
        defaultOutput: false,
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("Input Channels:")) {
      current.input = true;
    } else if (line.startsWith("Output Channels:")) {
      current.output = true;
    } else if (line === "Default Input Device: Yes") {
      current.defaultInput = true;
    } else if (line === "Default Output Device: Yes") {
      current.defaultOutput = true;
    }
  }
  finishCurrent();

  return devices.filter((device) => device.input || device.output);
}

export function probeRealtimeLocalAudioProcesses({
  env = process.env,
  platform = process.platform,
  runner = defaultRunner,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: RealtimeLocalAudioProbeOptions = {}): RealtimeLocalAudioProbe {
  const tools = Object.fromEntries(
    (Object.keys(TOOL_COMMANDS) as RealtimeLocalAudioToolName[]).map((name) => [
      name,
      probeTool(name, runner, timeoutMs),
    ]),
  ) as Record<RealtimeLocalAudioToolName, RealtimeLocalAudioToolProbe>;

  const systemProfilerResult =
    platform === "darwin" && tools.system_profiler.available
      ? runner(TOOL_COMMANDS.system_profiler, ["SPAudioDataType"], { timeoutMs })
      : undefined;
  const devices = systemProfilerResult?.error
    ? []
    : parseSystemProfilerAudioDevices(String(systemProfilerResult?.stdout || ""));
  const defaultInputDevice = devices.find((device) => device.defaultInput)?.name;
  const defaultOutputDevice = devices.find((device) => device.defaultOutput)?.name;
  const enabled = envEnabled(env, REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV);
  const liveConfirmed = envEnabled(env, REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV);
  const warnings: string[] = [];

  if (platform !== "darwin") {
    warnings.push("Path A local audio process wrappers are currently macOS-only.");
  }
  if (!enabled) {
    warnings.push(
      `${REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV}=1 is required before spawning audio tools.`,
    );
  }
  if (!liveConfirmed) {
    warnings.push(
      `${REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV}=1 is required before live mic/speaker use.`,
    );
  }
  if (!tools.ffmpeg.available) {
    warnings.push("ffmpeg is required for macOS microphone capture.");
  }
  if (!tools.ffplay.available) {
    warnings.push("ffplay is required for this realtime local audio playback wrapper.");
  }

  return {
    platform,
    enabled,
    liveConfirmed,
    capturePath: env?.[REALTIME_LOCAL_AUDIO_CAPTURE_PATH_ENV],
    tools,
    devices,
    defaultInputDevice,
    defaultOutputDevice,
    warnings,
  };
}

export function createFfplayPcm24kPlaybackCommand({
  ffplayPath = "ffplay",
}: FfplayPcm24kPlaybackCommandOptions = {}): RealtimeLocalAudioCommand {
  return {
    command: ffplayPath,
    args: ["-nodisp", "-autoexit", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0"],
  };
}

export function createFfmpegMacosPcm24kCaptureCommand({
  ffmpegPath = "ffmpeg",
  avFoundationDevice = ":0",
}: FfmpegMacosPcm24kCaptureCommandOptions = {}): RealtimeLocalAudioCommand {
  return {
    command: ffmpegPath,
    args: [
      "-f",
      "avfoundation",
      "-i",
      avFoundationDevice,
      "-ac",
      "1",
      "-ar",
      "24000",
      "-f",
      "s16le",
      "pipe:1",
    ],
  };
}

export function assertRealtimeLocalAudioProcessGate({
  env = process.env,
  platform = process.platform,
}: Pick<RealtimeLocalAudioProcessOptions, "env" | "platform"> = {}): void {
  if (platform !== "darwin") {
    throw new Error("Realtime local audio process wrappers are currently macOS-only");
  }
  if (!envEnabled(env, REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV)) {
    throw new Error(
      `${REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV}=1 is required for local audio processes`,
    );
  }
  if (!envEnabled(env, REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV)) {
    throw new Error(
      `${REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV}=1 is required for live mic/speaker processes`,
    );
  }
}

export class FfplayRealtimeOperatorAudioOutput implements RealtimeOperatorAudioOutput {
  readonly sinkLabel = "ffplay-pcm24k";
  private readonly command: RealtimeLocalAudioCommand;
  private readonly spawnProcess: RealtimeLocalAudioSpawn;
  private child?: ChildProcessWithoutNullStreams;
  private closed = false;

  constructor({
    command = createFfplayPcm24kPlaybackCommand(),
    env,
    platform,
    spawn: spawnProcess = spawn,
  }: RealtimeLocalAudioProcessOptions & { command?: RealtimeLocalAudioCommand } = {}) {
    assertRealtimeLocalAudioProcessGate({ env, platform });
    this.command = command;
    this.spawnProcess = spawnProcess;
  }

  writePcm24k(chunk: Buffer): void {
    if (this.closed) {
      return;
    }
    if (!this.child) {
      this.child = this.spawnProcess(this.command.command, this.command.args, { stdio: "pipe" });
    }
    this.child.stdin.write(Buffer.from(chunk));
  }

  clear(): void {
    this.stopChild();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stopChild();
  }

  private stopChild(): void {
    this.child?.stdin.end();
    this.child?.kill();
    this.child = undefined;
  }
}

export class FfmpegMacosRealtimeOperatorAudioInput implements RealtimeOperatorAudioInput {
  readonly sourceLabel = "ffmpeg-macos-pcm24k";
  private readonly command: RealtimeLocalAudioCommand;
  private readonly spawnProcess: RealtimeLocalAudioSpawn;
  private readonly capturePath?: string;
  private child?: ChildProcessWithoutNullStreams;
  private captureStream?: WriteStream;
  private stdoutDataHandler?: (chunk: Buffer) => void;
  private stopped = false;

  constructor({
    command = createFfmpegMacosPcm24kCaptureCommand(),
    env = process.env,
    platform,
    spawn: spawnProcess = spawn,
  }: RealtimeLocalAudioProcessOptions & { command?: RealtimeLocalAudioCommand } = {}) {
    assertRealtimeLocalAudioProcessGate({ env, platform });
    this.command = command;
    this.spawnProcess = spawnProcess;
    this.capturePath = env[REALTIME_LOCAL_AUDIO_CAPTURE_PATH_ENV];
  }

  start(onPcm24k: (chunk: Buffer) => void): void {
    if (this.stopped) {
      throw new Error("Realtime local microphone input is stopped");
    }
    if (this.child) {
      return;
    }
    if (this.capturePath) {
      this.captureStream = createWriteStream(this.capturePath, { flags: "a" });
    }
    this.child = this.spawnProcess(this.command.command, this.command.args, { stdio: "pipe" });
    this.stdoutDataHandler = (chunk: Buffer) => {
      if (this.stopped) {
        return;
      }
      const frame = Buffer.from(chunk);
      this.captureStream?.write(frame);
      onPcm24k(frame);
    };
    this.child.stdout.on("data", this.stdoutDataHandler);
  }

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    if (this.stdoutDataHandler) {
      this.child?.stdout.off("data", this.stdoutDataHandler);
      this.stdoutDataHandler = undefined;
    }
    this.captureStream?.end();
    this.child?.kill();
  }
}
