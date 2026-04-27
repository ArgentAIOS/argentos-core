import type { OperatorAlertEvent } from "../../../../src/infra/operator-alerts.js";
import type { RealtimeLocalAudioProbe } from "./local-audio-process.js";
import {
  runRealtimeLocalAudioLiveSmoke,
  type RealtimeLocalAudioLiveSmokeMode,
  type RealtimeLocalAudioLiveSmokeOptions,
  type RealtimeLocalAudioLiveSmokeResult,
} from "./local-audio-live-smoke.js";
import {
  createRealtimeOperatorVoiceCliPreflight,
  type RealtimeOperatorVoiceCliFailureType,
  type RealtimeOperatorVoiceCliPreflight,
  type RealtimeOperatorVoiceCliPreflightIssue,
  type RealtimeOperatorVoiceCliStatus,
} from "./operator-voice-cli.js";

export const OPERATOR_ALERT_VOICE_ENABLE_ENV = "ARGENT_OPERATOR_ALERT_VOICE_ENABLE";
export const OPERATOR_ALERT_VOICE_MODE_ENV = "ARGENT_OPERATOR_ALERT_VOICE_MODE";
export const OPERATOR_ALERT_VOICE_PRIVACY_ENV = "ARGENT_OPERATOR_ALERT_VOICE_PRIVACY";
export const OPERATOR_ALERT_VOICE_PROVIDER_ENV = "ARGENT_OPERATOR_ALERT_VOICE_PROVIDER";

export type OperatorAlertVoicePrivacyMode = "title-only" | "summary";
export type OperatorAlertVoiceProviderId = "openai";

export type OperatorAlertVoiceRouteIssue =
  | RealtimeOperatorVoiceCliPreflightIssue
  | {
      type:
        | "voice_route_not_enabled"
        | "unsupported_provider"
        | "expired_alert"
        | "privacy_policy_blocked";
      message: string;
    };

export type OperatorAlertVoiceRoutePreflight = {
  alertId: string;
  mode: RealtimeLocalAudioLiveSmokeMode;
  providerId: string;
  privacyMode: OperatorAlertVoicePrivacyMode;
  spokenText?: string;
  voice: RealtimeOperatorVoiceCliPreflight;
  issues: OperatorAlertVoiceRouteIssue[];
};

export type OperatorAlertVoiceRouteResult = {
  ok: boolean;
  status: RealtimeOperatorVoiceCliStatus;
  alertId: string;
  correlationId?: string;
  mode: RealtimeLocalAudioLiveSmokeMode;
  providerId: string;
  privacyMode: OperatorAlertVoicePrivacyMode;
  realDeviceEvidence: boolean;
  spokenText?: string;
  preflight: OperatorAlertVoiceRoutePreflight;
  evidence?: RealtimeLocalAudioLiveSmokeResult;
  failureType?: RealtimeOperatorVoiceCliFailureType | OperatorAlertVoiceRouteIssue["type"];
  error?: string;
};

export type OperatorAlertVoiceRouteOptions = {
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  mode?: RealtimeLocalAudioLiveSmokeMode;
  now?: Date;
  platform?: NodeJS.Platform;
  privacyMode?: OperatorAlertVoicePrivacyMode;
  probe?: RealtimeLocalAudioProbe;
  providerId?: string;
  runSmoke?: (
    options: RealtimeLocalAudioLiveSmokeOptions,
  ) => Promise<RealtimeLocalAudioLiveSmokeResult>;
  timeoutMs?: number;
};

function envEnabled(env: NodeJS.ProcessEnv, key: string): boolean {
  return env[key] === "1" || env[key]?.toLowerCase() === "true";
}

function modeFromEnv(env: NodeJS.ProcessEnv): RealtimeLocalAudioLiveSmokeMode {
  return env[OPERATOR_ALERT_VOICE_MODE_ENV] === "process" ? "process" : "dry-run";
}

function privacyModeFromEnv(env: NodeJS.ProcessEnv): OperatorAlertVoicePrivacyMode {
  return env[OPERATOR_ALERT_VOICE_PRIVACY_ENV] === "summary" ? "summary" : "title-only";
}

function providerFromEnv(env: NodeJS.ProcessEnv): string {
  return env[OPERATOR_ALERT_VOICE_PROVIDER_ENV]?.trim() || "openai";
}

function truncate(value: string, max = 220): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function redactForSpeech(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[redacted key]")
    .replace(/\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)=\S+/giu, "[redacted secret]")
    .replace(/\bhttps?:\/\/\S*(?:token|secret|key|password)\S*/giu, "[redacted link]")
    .replace(/\s+/gu, " ")
    .trim();
}

function severityPhrase(event: OperatorAlertEvent): string {
  switch (event.severity) {
    case "critical":
      return "Critical operator alert";
    case "action_required":
      return "Operator action required";
    case "warning":
      return "Operator warning";
    case "info":
      return "Operator alert";
  }
}

function isExpired(event: OperatorAlertEvent, now: Date): boolean {
  if (!event.timeout?.at) {
    return false;
  }
  const timeoutAt = Date.parse(event.timeout.at);
  return Number.isFinite(timeoutAt) && timeoutAt <= now.getTime();
}

export function renderOperatorAlertVoicePrompt(
  event: OperatorAlertEvent,
  privacyMode: OperatorAlertVoicePrivacyMode = "title-only",
): string {
  const parts = [severityPhrase(event), redactForSpeech(event.title)];
  if (privacyMode === "summary") {
    const summary = redactForSpeech(event.summary);
    if (summary) {
      parts.push(truncate(summary));
    }
  }
  if (event.approval?.approvalId || event.audit.requiresOperatorDecision) {
    parts.push("Approval is waiting. Use the dashboard or configured approval channel to decide.");
  }
  return parts.filter(Boolean).join(". ");
}

export function preflightOperatorAlertVoiceRoute(
  event: OperatorAlertEvent,
  {
    enabled,
    env = process.env,
    mode = modeFromEnv(env),
    now = new Date(),
    platform = process.platform,
    privacyMode = privacyModeFromEnv(env),
    probe,
    providerId = providerFromEnv(env),
  }: OperatorAlertVoiceRouteOptions = {},
): OperatorAlertVoiceRoutePreflight {
  const voice = createRealtimeOperatorVoiceCliPreflight({ env, mode, platform, probe });
  const issues: OperatorAlertVoiceRouteIssue[] = [];

  if (!(enabled ?? envEnabled(env, OPERATOR_ALERT_VOICE_ENABLE_ENV))) {
    issues.push({
      type: "voice_route_not_enabled",
      message: `${OPERATOR_ALERT_VOICE_ENABLE_ENV}=1 is required for optional voice alerts.`,
    });
  }
  if (providerId !== "openai") {
    issues.push({
      type: "unsupported_provider",
      message: `Operator alert voice route only supports provider "openai"; received "${providerId}".`,
    });
  }
  if (isExpired(event, now)) {
    issues.push({
      type: "expired_alert",
      message: "Operator alert voice route will not speak an expired alert.",
    });
  }
  if (event.privacy === "sensitive" && privacyMode !== "title-only") {
    issues.push({
      type: "privacy_policy_blocked",
      message: "Sensitive operator alerts may only be spoken with title-only privacy mode.",
    });
  }

  issues.push(...voice.issues);

  return {
    alertId: event.id,
    mode,
    providerId,
    privacyMode,
    spokenText: issues.some((issue) => issue.type === "privacy_policy_blocked")
      ? undefined
      : renderOperatorAlertVoicePrompt(event, privacyMode),
    voice,
    issues,
  };
}

function isLikelyMicPermissionError(message: string): boolean {
  return /permission|not authorized|privacy|avfoundation|input device|Operation not permitted/iu.test(
    message,
  );
}

export async function runOperatorAlertVoiceRoute(
  event: OperatorAlertEvent,
  {
    env = process.env,
    mode = modeFromEnv(env),
    platform = process.platform,
    providerId = providerFromEnv(env),
    runSmoke = runRealtimeLocalAudioLiveSmoke,
    timeoutMs,
    ...preflightOptions
  }: OperatorAlertVoiceRouteOptions = {},
): Promise<OperatorAlertVoiceRouteResult> {
  const preflight = preflightOperatorAlertVoiceRoute(event, {
    ...preflightOptions,
    env,
    mode,
    platform,
    providerId,
  });
  const base = {
    alertId: event.id,
    correlationId: event.workflow?.runId,
    mode,
    providerId,
    privacyMode: preflight.privacyMode,
    preflight,
    realDeviceEvidence: false,
    spokenText: preflight.spokenText,
  };

  if (preflight.issues.length > 0) {
    return {
      ...base,
      ok: false,
      status: "blocked",
      failureType: preflight.issues[0]?.type,
      error: preflight.issues.map((issue) => issue.message).join(" "),
    };
  }

  try {
    const evidence = await runSmoke({
      env,
      instructions:
        "Speak the operator alert exactly once. Do not add secrets, commands, or approval decisions.",
      mode,
      platform,
      prompt: preflight.spokenText,
      timeoutMs,
    });
    return {
      ...base,
      ok: evidence.ok,
      status: evidence.ok ? "passed" : "failed",
      evidence,
      failureType: evidence.ok ? undefined : "smoke_failed",
      realDeviceEvidence: evidence.realDeviceEvidence,
      error: evidence.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permissionFailure = isLikelyMicPermissionError(message);
    return {
      ...base,
      ok: false,
      status: "failed",
      failureType: permissionFailure ? "microphone_or_speaker_permission" : "runtime_error",
      error: permissionFailure
        ? `Microphone or speaker permission/runtime failure: ${message}`
        : message,
    };
  }
}
