import type { RealtimeVoiceOperatorSessionParams } from "./operator-session.js";
import {
  CaptureRealtimeOperatorAudioOutput,
  createRealtimeOperatorAudioSession,
  SyntheticRealtimeOperatorAudioInput,
  type RealtimeOperatorAudioInput,
  type RealtimeOperatorAudioOutput,
  type RealtimeOperatorAudioSession,
} from "./local-audio-io.js";
import {
  assertRealtimeLocalAudioProcessGate,
  createFfmpegMacosPcm24kCaptureCommand,
  createFfplayPcm24kPlaybackCommand,
  FfmpegMacosRealtimeOperatorAudioInput,
  FfplayRealtimeOperatorAudioOutput,
  type FfmpegMacosPcm24kCaptureCommandOptions,
  type FfplayPcm24kPlaybackCommandOptions,
  type RealtimeLocalAudioCommand,
  type RealtimeLocalAudioProcessOptions,
} from "./local-audio-process.js";

export type RealtimeLocalAudioOperatorInputConfig =
  | {
      readonly kind: "process";
      readonly command?: RealtimeLocalAudioCommand;
      readonly commandOptions?: FfmpegMacosPcm24kCaptureCommandOptions;
    }
  | {
      readonly kind: "synthetic";
      readonly frames: Array<Buffer | number[] | string>;
    };

export type RealtimeLocalAudioOperatorOutputConfig =
  | {
      readonly kind: "process";
      readonly command?: RealtimeLocalAudioCommand;
      readonly commandOptions?: FfplayPcm24kPlaybackCommandOptions;
    }
  | {
      readonly kind: "capture";
    };

export type RealtimeLocalAudioOperatorSessionParams = RealtimeVoiceOperatorSessionParams &
  RealtimeLocalAudioProcessOptions & {
    readonly input?: RealtimeLocalAudioOperatorInputConfig;
    readonly output?: RealtimeLocalAudioOperatorOutputConfig;
  };

function createLocalAudioInput(
  input: RealtimeLocalAudioOperatorInputConfig,
  options: RealtimeLocalAudioProcessOptions,
): RealtimeOperatorAudioInput {
  if (input.kind === "synthetic") {
    return new SyntheticRealtimeOperatorAudioInput(input.frames);
  }
  return new FfmpegMacosRealtimeOperatorAudioInput({
    ...options,
    command: input.command ?? createFfmpegMacosPcm24kCaptureCommand(input.commandOptions),
  });
}

function createLocalAudioOutput(
  output: RealtimeLocalAudioOperatorOutputConfig,
  options: RealtimeLocalAudioProcessOptions,
): RealtimeOperatorAudioOutput {
  if (output.kind === "capture") {
    return new CaptureRealtimeOperatorAudioOutput();
  }
  return new FfplayRealtimeOperatorAudioOutput({
    ...options,
    command: output.command ?? createFfplayPcm24kPlaybackCommand(output.commandOptions),
  });
}

export function createRealtimeLocalAudioOperatorSession({
  env,
  platform,
  spawn,
  input = { kind: "process" },
  output = { kind: "process" },
  ...params
}: RealtimeLocalAudioOperatorSessionParams): RealtimeOperatorAudioSession {
  const processOptions: RealtimeLocalAudioProcessOptions = { env, platform, spawn };
  assertRealtimeLocalAudioProcessGate(processOptions);
  return createRealtimeOperatorAudioSession({
    ...params,
    audioInput: createLocalAudioInput(input, processOptions),
    audioOutput: createLocalAudioOutput(output, processOptions),
  });
}
