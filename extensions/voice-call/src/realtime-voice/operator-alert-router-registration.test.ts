import { describe, expect, it, vi } from "vitest";
import type { OperatorAlertSink } from "../../../../src/infra/operator-alert-router.js";
import type { OperatorAlertEvent } from "../../../../src/infra/operator-alerts.js";
import type { OperatorAlertVoiceRouteResult } from "./operator-alert-voice-route.js";
import {
  createOperatorAlertVoiceSink,
  mapOperatorAlertVoiceRouteResult,
  OPERATOR_ALERT_VOICE_SINK_ID,
  registerOperatorAlertVoiceSink,
} from "./operator-alert-router-registration.js";

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
    actions: [],
    audit: {
      requestedAt: "2026-04-27T00:00:00.000Z",
      requestedBy: "workflow",
      requiresOperatorDecision: true,
    },
    ...overrides,
  };
}

function routeResult(
  overrides: Partial<OperatorAlertVoiceRouteResult> = {},
): OperatorAlertVoiceRouteResult {
  return {
    ok: true,
    status: "passed",
    alertId: "alert-1",
    mode: "dry-run",
    providerId: "openai",
    privacyMode: "title-only",
    realDeviceEvidence: false,
    preflight: {
      alertId: "alert-1",
      mode: "dry-run",
      providerId: "openai",
      privacyMode: "title-only",
      voice: {
        mode: "dry-run",
        openAiKeyConfigured: true,
        rawAudioCapturePathConfigured: false,
        probe: {
          platform: "darwin",
          enabled: true,
          liveConfirmed: true,
          defaultInputDevice: "MacBook Pro Microphone",
          defaultOutputDevice: "MacBook Pro Speakers",
          tools: {
            ffmpeg: { name: "ffmpeg", command: "ffmpeg", available: true },
            ffplay: { name: "ffplay", command: "ffplay", available: true },
          },
        },
        issues: [],
      },
      issues: [],
    },
    ...overrides,
  };
}

describe("operator alert voice sink registration", () => {
  it("maps successful voice route evidence to a sent sink result", () => {
    expect(
      mapOperatorAlertVoiceRouteResult(
        routeResult({
          realDeviceEvidence: true,
          evidence: {
            ok: true,
            mode: "process",
            providerId: "openai",
            providerLabel: "OpenAI Realtime",
            realDeviceEvidence: true,
            audioChunkCount: 3,
            eventTypes: ["ready", "audio"],
          },
        }),
      ),
    ).toEqual({
      status: "sent",
      message: "Operator alert voice route completed.",
      details: {
        alertId: "alert-1",
        mode: "dry-run",
        providerId: "openai",
        realDeviceEvidence: true,
        status: "passed",
      },
    });
  });

  it("maps disabled optional voice route to skipped, not failed", () => {
    expect(
      mapOperatorAlertVoiceRouteResult(
        routeResult({
          ok: false,
          status: "blocked",
          failureType: "voice_route_not_enabled",
          error: "ARGENT_OPERATOR_ALERT_VOICE_ENABLE=1 is required.",
        }),
      ),
    ).toMatchObject({
      status: "skipped",
      message: "ARGENT_OPERATOR_ALERT_VOICE_ENABLE=1 is required.",
      details: {
        failureType: "voice_route_not_enabled",
      },
    });
  });

  it("maps configured voice route setup failures to failed", () => {
    expect(
      mapOperatorAlertVoiceRouteResult(
        routeResult({
          ok: false,
          status: "blocked",
          failureType: "missing_openai_api_key",
          error: "OPENAI_API_KEY is required.",
        }),
      ),
    ).toMatchObject({
      status: "failed",
      message: "OPENAI_API_KEY is required.",
      details: {
        failureType: "missing_openai_api_key",
      },
    });
  });

  it("creates a sink that calls the voice route with configured options", async () => {
    const runRoute = vi.fn(async () => routeResult({ ok: false, failureType: "expired_alert" }));
    const sink = createOperatorAlertVoiceSink({
      enabled: true,
      mode: "dry-run",
      runRoute,
      sinkId: "test.voice",
    });

    await expect(sink.route(alertEvent(), { source: "unit" })).resolves.toMatchObject({
      status: "skipped",
      details: {
        failureType: "expired_alert",
      },
    });
    expect(runRoute).toHaveBeenCalledWith(alertEvent(), {
      enabled: true,
      mode: "dry-run",
    });
    expect(sink.id).toBe("test.voice");
  });

  it("registers the default OpenClaw voice sink through the supplied router register function", () => {
    const registered: OperatorAlertSink[] = [];
    const unregister = vi.fn(() => true);
    const register = vi.fn((sink: OperatorAlertSink) => {
      registered.push(sink);
      return unregister;
    });

    expect(registerOperatorAlertVoiceSink({}, register)).toBe(unregister);
    expect(register).toHaveBeenCalledOnce();
    expect(registered[0]?.id).toBe(OPERATOR_ALERT_VOICE_SINK_ID);
  });
});
