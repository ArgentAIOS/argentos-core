import { pathToFileURL } from "node:url";
import {
  runRealtimeLocalAudioLiveSmoke,
  type RealtimeLocalAudioLiveSmokeMode,
  type RealtimeLocalAudioLiveSmokeOptions,
  type RealtimeLocalAudioLiveSmokeResult,
} from "./local-audio-live-smoke.js";
import {
  probeRealtimeLocalAudioProcesses,
  REALTIME_LOCAL_AUDIO_CAPTURE_PATH_ENV,
  REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV,
  REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV,
  type RealtimeLocalAudioProbe,
  type RealtimeLocalAudioProbeOptions,
} from "./local-audio-process.js";

export type RealtimeOperatorVoiceCliStatus = "passed" | "blocked" | "failed";

export type RealtimeOperatorVoiceCliFailureType =
  | "smoke_failed"
  | "microphone_or_speaker_permission"
  | "runtime_error";

export type RealtimeOperatorVoiceCliPreflightIssue =
  | {
      type: "missing_audio_process_gate";
      message: string;
    }
  | {
      type: "missing_audio_live_confirmation";
      message: string;
    }
  | {
      type: "missing_openai_api_key";
      message: string;
    }
  | {
      type: "missing_ffmpeg";
      message: string;
    }
  | {
      type: "missing_ffplay";
      message: string;
    }
  | {
      type: "unsupported_platform";
      message: string;
    };

export type RealtimeOperatorVoiceCliPreflight = {
  mode: RealtimeLocalAudioLiveSmokeMode;
  openAiKeyConfigured: boolean;
  rawAudioCapturePathConfigured: boolean;
  probe: Pick<
    RealtimeLocalAudioProbe,
    "platform" | "enabled" | "liveConfirmed" | "defaultInputDevice" | "defaultOutputDevice"
  > & {
    tools: Pick<RealtimeLocalAudioProbe["tools"], "ffmpeg" | "ffplay">;
  };
  issues: RealtimeOperatorVoiceCliPreflightIssue[];
};

export type RealtimeOperatorVoiceCliReport = {
  ok: boolean;
  status: RealtimeOperatorVoiceCliStatus;
  mode: RealtimeLocalAudioLiveSmokeMode;
  preflight: RealtimeOperatorVoiceCliPreflight;
  evidence?: RealtimeLocalAudioLiveSmokeResult;
  failureType?: RealtimeOperatorVoiceCliFailureType;
  error?: string;
};

export type RealtimeOperatorVoiceCliOptions = {
  env?: NodeJS.ProcessEnv;
  mode?: RealtimeLocalAudioLiveSmokeMode;
  platform?: NodeJS.Platform;
  probe?: RealtimeLocalAudioProbe;
  probeOptions?: Omit<RealtimeLocalAudioProbeOptions, "env" | "platform">;
  runSmoke?: (
    options: RealtimeLocalAudioLiveSmokeOptions,
  ) => Promise<RealtimeLocalAudioLiveSmokeResult>;
  timeoutMs?: number;
};

function envEnabled(env: NodeJS.ProcessEnv, key: string): boolean {
  return env[key] === "1" || env[key]?.toLowerCase() === "true";
}

function modeFromEnv(env: NodeJS.ProcessEnv): RealtimeLocalAudioLiveSmokeMode {
  return env.ARGENT_REALTIME_AUDIO_SMOKE_MODE === "process" ? "process" : "dry-run";
}

function isLikelyMicPermissionError(message: string): boolean {
  return /permission|not authorized|privacy|avfoundation|input device|Operation not permitted/iu.test(
    message,
  );
}

export function createRealtimeOperatorVoiceCliPreflight({
  env = process.env,
  mode = modeFromEnv(env),
  platform = process.platform,
  probe = probeRealtimeLocalAudioProcesses({ env, platform }),
}: Pick<
  RealtimeOperatorVoiceCliOptions,
  "env" | "mode" | "platform" | "probe"
> = {}): RealtimeOperatorVoiceCliPreflight {
  const issues: RealtimeOperatorVoiceCliPreflightIssue[] = [];
  if (platform !== "darwin") {
    issues.push({
      type: "unsupported_platform",
      message: "Local process-mode voice is currently supported on macOS only.",
    });
  }
  if (!envEnabled(env, REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV)) {
    issues.push({
      type: "missing_audio_process_gate",
      message: `${REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV}=1 is required.`,
    });
  }
  if (!envEnabled(env, REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV)) {
    issues.push({
      type: "missing_audio_live_confirmation",
      message: `${REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV}=1 is required.`,
    });
  }
  if (!env.OPENAI_API_KEY) {
    issues.push({
      type: "missing_openai_api_key",
      message: "OPENAI_API_KEY is required for the live OpenAI realtime provider.",
    });
  }
  if (mode === "process" && !probe.tools.ffmpeg.available) {
    issues.push({
      type: "missing_ffmpeg",
      message: "ffmpeg is required for microphone capture.",
    });
  }
  if (mode === "process" && !probe.tools.ffplay.available) {
    issues.push({
      type: "missing_ffplay",
      message: "ffplay is required for speaker playback.",
    });
  }

  return {
    mode,
    openAiKeyConfigured: Boolean(env.OPENAI_API_KEY),
    rawAudioCapturePathConfigured: Boolean(env[REALTIME_LOCAL_AUDIO_CAPTURE_PATH_ENV]),
    probe: {
      platform: probe.platform,
      enabled: probe.enabled,
      liveConfirmed: probe.liveConfirmed,
      defaultInputDevice: probe.defaultInputDevice,
      defaultOutputDevice: probe.defaultOutputDevice,
      tools: {
        ffmpeg: probe.tools.ffmpeg,
        ffplay: probe.tools.ffplay,
      },
    },
    issues,
  };
}

export async function runRealtimeOperatorVoiceCli({
  env = process.env,
  mode = modeFromEnv(env),
  platform = process.platform,
  probe,
  probeOptions,
  runSmoke = runRealtimeLocalAudioLiveSmoke,
  timeoutMs,
}: RealtimeOperatorVoiceCliOptions = {}): Promise<RealtimeOperatorVoiceCliReport> {
  const preflight = createRealtimeOperatorVoiceCliPreflight({
    env,
    mode,
    platform,
    probe:
      probe ??
      probeRealtimeLocalAudioProcesses({
        env,
        platform,
        ...probeOptions,
      }),
  });

  if (preflight.issues.length > 0) {
    return {
      ok: false,
      status: "blocked",
      mode,
      preflight,
      error: preflight.issues.map((issue) => issue.message).join(" "),
    };
  }

  try {
    const evidence = await runSmoke({
      env,
      mode,
      platform,
      timeoutMs,
    });
    return {
      ok: evidence.ok,
      status: evidence.ok ? "passed" : "failed",
      mode,
      preflight,
      evidence,
      failureType: evidence.ok ? undefined : "smoke_failed",
      error: evidence.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permissionFailure = isLikelyMicPermissionError(message);
    return {
      ok: false,
      status: "failed",
      mode,
      preflight,
      failureType: permissionFailure ? "microphone_or_speaker_permission" : "runtime_error",
      error: permissionFailure
        ? `Microphone or speaker permission/runtime failure: ${message}`
        : message,
    };
  }
}

async function main(): Promise<void> {
  const report = await runRealtimeOperatorVoiceCli();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
