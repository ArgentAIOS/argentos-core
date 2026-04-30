import { describe, expect, it, vi } from "vitest";
import {
  createRealtimeOperatorVoiceCliPreflight,
  REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV,
  REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV,
  runRealtimeOperatorVoiceCli,
  type RealtimeLocalAudioLiveSmokeResult,
  type RealtimeLocalAudioProbe,
} from "./index.js";

const enabledEnv = {
  OPENAI_API_KEY: "sk-test",
  [REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV]: "1",
  [REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV]: "1",
};

function probe({
  ffmpeg = true,
  ffplay = true,
}: {
  ffmpeg?: boolean;
  ffplay?: boolean;
} = {}): RealtimeLocalAudioProbe {
  return {
    platform: "darwin",
    enabled: true,
    liveConfirmed: true,
    tools: {
      ffmpeg: { name: "ffmpeg", command: "ffmpeg", available: ffmpeg },
      ffplay: { name: "ffplay", command: "ffplay", available: ffplay },
      afplay: { name: "afplay", command: "afplay", available: true },
      system_profiler: { name: "system_profiler", command: "system_profiler", available: true },
    },
    devices: [],
    defaultInputDevice: "MacBook Pro Microphone",
    defaultOutputDevice: "MacBook Pro Speakers",
    warnings: [],
  };
}

describe("realtime operator voice CLI", () => {
  it("reports separate preflight issues for missing gates, key, and process tools", () => {
    const preflight = createRealtimeOperatorVoiceCliPreflight({
      env: {},
      mode: "process",
      platform: "darwin",
      probe: probe({ ffmpeg: false, ffplay: false }),
    });

    expect(preflight.issues.map((issue) => issue.type)).toEqual([
      "missing_audio_process_gate",
      "missing_audio_live_confirmation",
      "missing_openai_api_key",
      "missing_ffmpeg",
      "missing_ffplay",
    ]);
    expect(preflight.openAiKeyConfigured).toBe(false);
    expect(preflight.rawAudioCapturePathConfigured).toBe(false);
  });

  it("runs the smoke harness and preserves live/dry-run evidence labels", async () => {
    const evidence: RealtimeLocalAudioLiveSmokeResult = {
      ok: true,
      mode: "process",
      realDeviceEvidence: true,
      providerId: "openai",
      providerLabel: "OpenAI Realtime",
      finalAssistantTranscript: "Argent local audio smoke ok.",
      audioChunkCount: 9,
      eventTypes: ["ready", "transcript", "audio"],
    };
    const runSmoke = vi.fn(async () => evidence);

    const report = await runRealtimeOperatorVoiceCli({
      env: enabledEnv,
      mode: "process",
      platform: "darwin",
      probe: probe(),
      runSmoke,
      timeoutMs: 123,
    });

    expect(report).toMatchObject({
      ok: true,
      status: "passed",
      mode: "process",
      evidence,
    });
    expect(runSmoke).toHaveBeenCalledWith({
      env: enabledEnv,
      mode: "process",
      platform: "darwin",
      timeoutMs: 123,
    });
  });

  it("blocks before running smoke when the OpenAI key is missing", async () => {
    const runSmoke = vi.fn();

    const report = await runRealtimeOperatorVoiceCli({
      env: {
        [REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV]: "1",
        [REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV]: "1",
      },
      mode: "dry-run",
      platform: "darwin",
      probe: probe(),
      runSmoke,
    });

    expect(report.status).toBe("blocked");
    expect(report.preflight.issues).toContainEqual({
      type: "missing_openai_api_key",
      message: "OPENAI_API_KEY is required for the live OpenAI realtime provider.",
    });
    expect(runSmoke).not.toHaveBeenCalled();
  });

  it("labels likely microphone permission/runtime failures separately", async () => {
    const report = await runRealtimeOperatorVoiceCli({
      env: enabledEnv,
      mode: "process",
      platform: "darwin",
      probe: probe(),
      runSmoke: async () => {
        throw new Error("AVFoundation input device permission denied");
      },
    });

    expect(report).toMatchObject({
      ok: false,
      status: "failed",
      failureType: "microphone_or_speaker_permission",
      error:
        "Microphone or speaker permission/runtime failure: AVFoundation input device permission denied",
    });
  });

  it("labels failed smoke evidence without regexing error text", async () => {
    const report = await runRealtimeOperatorVoiceCli({
      env: enabledEnv,
      mode: "dry-run",
      platform: "darwin",
      probe: probe(),
      runSmoke: async () => ({
        ok: false,
        mode: "dry-run",
        realDeviceEvidence: false,
        audioChunkCount: 0,
        eventTypes: [],
        error: "Timed out after 1ms waiting for final assistant transcript and audio output",
      }),
    });

    expect(report).toMatchObject({
      ok: false,
      status: "failed",
      failureType: "smoke_failed",
      error: "Timed out after 1ms waiting for final assistant transcript and audio output",
    });
  });
});
