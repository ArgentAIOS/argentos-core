import type {
  OperatorAlertSink,
  OperatorAlertSinkResult,
  OperatorAlertUnregister,
} from "../../../../src/infra/operator-alert-router.js";
import { registerOperatorAlertSink } from "../../../../src/infra/operator-alert-router.js";
import {
  runOperatorAlertVoiceRoute,
  type OperatorAlertVoiceRouteOptions,
  type OperatorAlertVoiceRouteResult,
} from "./operator-alert-voice-route.js";

export const OPERATOR_ALERT_VOICE_SINK_ID = "openclaw.voice.operator-alert";

export type OperatorAlertVoiceSinkOptions = OperatorAlertVoiceRouteOptions & {
  sinkId?: string;
  runRoute?: typeof runOperatorAlertVoiceRoute;
};

function isOptionalSkip(result: OperatorAlertVoiceRouteResult): boolean {
  return (
    result.failureType === "voice_route_not_enabled" ||
    result.failureType === "expired_alert" ||
    result.failureType === "privacy_policy_blocked"
  );
}

export function mapOperatorAlertVoiceRouteResult(
  result: OperatorAlertVoiceRouteResult,
): OperatorAlertSinkResult {
  if (result.ok) {
    return {
      status: "sent",
      message: "Operator alert voice route completed.",
      details: {
        alertId: result.alertId,
        mode: result.mode,
        providerId: result.providerId,
        realDeviceEvidence: result.realDeviceEvidence,
        status: result.status,
      },
    };
  }

  return {
    status: isOptionalSkip(result) ? "skipped" : "failed",
    message: result.error,
    details: {
      alertId: result.alertId,
      failureType: result.failureType,
      mode: result.mode,
      providerId: result.providerId,
      realDeviceEvidence: result.realDeviceEvidence,
      status: result.status,
    },
  };
}

export function createOperatorAlertVoiceSink({
  sinkId = OPERATOR_ALERT_VOICE_SINK_ID,
  runRoute = runOperatorAlertVoiceRoute,
  ...routeOptions
}: OperatorAlertVoiceSinkOptions = {}): OperatorAlertSink {
  return {
    id: sinkId,
    async route(event) {
      const result = await runRoute(event, routeOptions);
      return mapOperatorAlertVoiceRouteResult(result);
    },
  };
}

export function registerOperatorAlertVoiceSink(
  options: OperatorAlertVoiceSinkOptions = {},
  register: (sink: OperatorAlertSink) => OperatorAlertUnregister = registerOperatorAlertSink,
): OperatorAlertUnregister {
  return register(createOperatorAlertVoiceSink(options));
}
