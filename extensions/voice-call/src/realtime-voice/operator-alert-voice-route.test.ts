import { describe, expect, it, vi } from "vitest";
import type { OperatorAlertEvent } from "../../../../src/infra/operator-alerts.js";
import {
  OPERATOR_ALERT_VOICE_ENABLE_ENV,
  OPERATOR_ALERT_VOICE_PRIVACY_ENV,
  OPERATOR_ALERT_VOICE_PROVIDER_ENV,
  preflightOperatorAlertVoiceRoute,
  renderOperatorAlertVoicePrompt,
  runOperatorAlertVoiceRoute,
  type RealtimeLocalAudioLiveSmokeResult,
  type RealtimeLocalAudioProbe,
} from "./index.js";
import {
  REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV,
  REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV,
} from "./local-audio-process.js";

const baseEnv = {
  OPENAI_API_KEY: "sk-test",
  [OPERATOR_ALERT_VOICE_ENABLE_ENV]: "1",
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

function alertEvent(overrides: Partial<OperatorAlertEvent> = {}): OperatorAlertEvent {
  return {
    schemaVersion: 1,
    id: "alert-1",
    type: "workflow.approval.requested",
    source: "workflows",
    createdAt: "2026-04-27T00:00:00.000Z",
    severity: "action_required",
    privacy: "private",
    title: "Approve deploy",
    summary: "Deploy workflow is waiting.",
    body: "Approve the deployment after review.",
    workflow: {
      workflowId: "wf-1",
      workflowName: "Deploy workflow",
      runId: "run-1",
      nodeId: "approval",
      nodeLabel: "Approval",
    },
    approval: {
      approvalId: "approval-1",
      sideEffectClass: "external_write",
      previousOutputPreview: {
        command: "curl https://example.com?token=secret",
        env: "OPENAI_API_KEY=sk-should-not-be-spoken",
      },
    },
    actions: [
      {
        id: "approve",
        label: "Approve",
        kind: "approve",
        method: "workflows.approve",
        params: { approvalId: "approval-1", token: "secret" },
      },
    ],
    audit: {
      requestedAt: "2026-04-27T00:00:00.000Z",
      requestedBy: "workflow",
      requiresOperatorDecision: true,
    },
    ...overrides,
  };
}

describe("operator alert voice route", () => {
  it("renders title-only speech without command bodies or previous output", () => {
    const spoken = renderOperatorAlertVoicePrompt(alertEvent(), "title-only");

    expect(spoken).toContain("Operator action required");
    expect(spoken).toContain("Approve deploy");
    expect(spoken).toContain("Approval is waiting");
    expect(spoken).not.toContain("Deploy workflow is waiting");
    expect(spoken).not.toContain("OPENAI_API_KEY");
    expect(spoken).not.toContain("curl");
    expect(spoken).not.toContain("secret");
  });

  it("blocks by default before starting voice output", async () => {
    const runSmoke = vi.fn();
    const result = await runOperatorAlertVoiceRoute(alertEvent(), {
      env: {
        OPENAI_API_KEY: "sk-test",
        [REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV]: "1",
        [REALTIME_LOCAL_AUDIO_CONFIRM_LIVE_ENV]: "1",
      },
      platform: "darwin",
      probe: probe(),
      runSmoke,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      failureType: "voice_route_not_enabled",
    });
    expect(runSmoke).not.toHaveBeenCalled();
  });

  it("reports route and audio preflight issues without running smoke", () => {
    const preflight = preflightOperatorAlertVoiceRoute(alertEvent(), {
      enabled: true,
      env: {
        [REALTIME_LOCAL_AUDIO_PROCESS_ENABLE_ENV]: "1",
        [OPERATOR_ALERT_VOICE_PROVIDER_ENV]: "elevenlabs",
      },
      mode: "process",
      platform: "darwin",
      probe: probe({ ffmpeg: false, ffplay: false }),
      providerId: "elevenlabs",
    });

    expect(preflight.issues.map((issue) => issue.type)).toEqual([
      "unsupported_provider",
      "missing_audio_live_confirmation",
      "missing_openai_api_key",
      "missing_ffmpeg",
      "missing_ffplay",
    ]);
  });

  it("blocks sensitive alerts from summary speech", () => {
    const preflight = preflightOperatorAlertVoiceRoute(alertEvent({ privacy: "sensitive" }), {
      env: {
        ...baseEnv,
        [OPERATOR_ALERT_VOICE_PRIVACY_ENV]: "summary",
      },
      platform: "darwin",
      probe: probe(),
    });

    expect(preflight.issues).toContainEqual({
      type: "privacy_policy_blocked",
      message: "Sensitive operator alerts may only be spoken with title-only privacy mode.",
    });
    expect(preflight.spokenText).toBeUndefined();
  });

  it("runs dry-run alert voice route with sanitized summary text", async () => {
    const evidence: RealtimeLocalAudioLiveSmokeResult = {
      ok: true,
      mode: "dry-run",
      realDeviceEvidence: false,
      providerId: "openai",
      providerLabel: "OpenAI Realtime",
      finalAssistantTranscript: "Operator action required. Approve deploy.",
      audioChunkCount: 2,
      eventTypes: ["ready", "transcript", "audio"],
    };
    const runSmoke = vi.fn(async () => evidence);

    const result = await runOperatorAlertVoiceRoute(alertEvent(), {
      env: {
        ...baseEnv,
        [OPERATOR_ALERT_VOICE_PRIVACY_ENV]: "summary",
      },
      mode: "dry-run",
      platform: "darwin",
      probe: probe(),
      runSmoke,
      timeoutMs: 42,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "passed",
      alertId: "alert-1",
      correlationId: "run-1",
      mode: "dry-run",
      providerId: "openai",
      realDeviceEvidence: false,
      evidence,
    });
    expect(result.spokenText).toContain("Deploy workflow is waiting");
    expect(result.spokenText).not.toContain("OPENAI_API_KEY");
    expect(result.spokenText).not.toContain("curl");
    expect(runSmoke).toHaveBeenCalledWith({
      env: {
        ...baseEnv,
        [OPERATOR_ALERT_VOICE_PRIVACY_ENV]: "summary",
      },
      instructions:
        "Speak the operator alert exactly once. Do not add secrets, commands, or approval decisions.",
      mode: "dry-run",
      platform: "darwin",
      prompt: result.spokenText,
      timeoutMs: 42,
    });
  });

  it("maps process permission failures to the existing voice failure label", async () => {
    const result = await runOperatorAlertVoiceRoute(alertEvent(), {
      env: baseEnv,
      mode: "process",
      platform: "darwin",
      probe: probe(),
      runSmoke: async () => {
        throw new Error("AVFoundation input device permission denied");
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      failureType: "microphone_or_speaker_permission",
      error:
        "Microphone or speaker permission/runtime failure: AVFoundation input device permission denied",
    });
  });
});
