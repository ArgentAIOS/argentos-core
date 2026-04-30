import type { ArgentConfig } from "../config/config.js";
import type {
  ConsciousnessKernelOperatorRequestState,
  ConsciousnessKernelSelfState,
} from "./consciousness-kernel-state.js";
import type { OutboundDeliveryResult } from "./outbound/deliver.js";
import { normalizeMessageChannel, isDeliverableMessageChannel } from "../utils/message-channel.js";
import { resolveConsciousnessKernelOperatorRequest } from "./consciousness-kernel-state.js";
import { deliverOutboundPayloads } from "./outbound/deliver.js";

const DEFAULT_OPERATOR_NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000;

export type ConsciousnessKernelOperatorNotificationResult =
  | { status: "disabled" }
  | { status: "no-request" }
  | { status: "no-targets" }
  | { status: "cooldown"; signature: string }
  | {
      status: "sent";
      signature: string;
      delivered: OutboundDeliveryResult[];
      errors: string[];
    }
  | { status: "failed"; signature: string; errors: string[] };

export type ConsciousnessKernelOperatorNotificationDeps = {
  deliver?: typeof deliverOutboundPayloads;
};

function buildOperatorRequestSignature(request: ConsciousnessKernelOperatorRequestState): string {
  return JSON.stringify({
    source: request.source ?? "",
    question: request.question ?? "",
    reason: request.reason ?? "",
  });
}

function buildOperatorNotificationText(request: ConsciousnessKernelOperatorRequestState): string {
  const lines = ["Argent needs operator input."];
  if (request.question) {
    lines.push("", request.question);
  }
  if (request.reason) {
    lines.push("", `Reason: ${request.reason}`);
  }
  if (request.source) {
    lines.push(`Source: ${request.source}`);
  }
  lines.push("", "Reply with the decision or policy so Argent can continue safely.");
  return lines.join("\n");
}

function shouldHoldForCooldown(params: {
  selfState: ConsciousnessKernelSelfState;
  signature: string;
  now: string;
  cooldownMs: number;
}): boolean {
  if (params.selfState.operatorNotifications.lastSignature !== params.signature) {
    return false;
  }
  const lastNotifiedAt = params.selfState.operatorNotifications.lastNotifiedAt;
  if (!lastNotifiedAt) {
    return false;
  }
  const lastMs = Date.parse(lastNotifiedAt);
  const nowMs = Date.parse(params.now);
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) {
    return false;
  }
  return nowMs - lastMs < params.cooldownMs;
}

export async function maybeNotifyConsciousnessKernelOperatorRequest(params: {
  cfg: ArgentConfig;
  selfState: ConsciousnessKernelSelfState;
  now: string;
  deps?: ConsciousnessKernelOperatorNotificationDeps;
}): Promise<ConsciousnessKernelOperatorNotificationResult> {
  const config = params.cfg.agents?.defaults?.kernel?.operatorNotifications;
  if (config?.enabled !== true) {
    return { status: "disabled" };
  }

  const request = resolveConsciousnessKernelOperatorRequest(params.selfState);
  if (!request.needed) {
    return { status: "no-request" };
  }

  const targets = (config.targets ?? []).filter((target) => target.channel && target.to);
  if (targets.length === 0) {
    return { status: "no-targets" };
  }

  const signature = buildOperatorRequestSignature(request);
  const cooldownMs =
    typeof config.cooldownMs === "number" && Number.isFinite(config.cooldownMs)
      ? Math.max(0, Math.floor(config.cooldownMs))
      : DEFAULT_OPERATOR_NOTIFICATION_COOLDOWN_MS;
  if (
    shouldHoldForCooldown({
      selfState: params.selfState,
      signature,
      now: params.now,
      cooldownMs,
    })
  ) {
    return { status: "cooldown", signature };
  }

  const deliver = params.deps?.deliver ?? deliverOutboundPayloads;
  const text = buildOperatorNotificationText(request);
  const delivered: OutboundDeliveryResult[] = [];
  const errors: string[] = [];

  for (const target of targets) {
    const channel = normalizeMessageChannel(target.channel);
    if (!channel || !isDeliverableMessageChannel(channel)) {
      errors.push(`Unsupported operator notification channel: ${target.channel}`);
      continue;
    }
    try {
      delivered.push(
        ...(await deliver({
          cfg: params.cfg,
          channel,
          to: target.to,
          accountId: target.accountId,
          threadId: target.threadId,
          payloads: [{ text }],
          bestEffort: true,
        })),
      );
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (delivered.length === 0) {
    return { status: "failed", signature, errors };
  }

  params.selfState.operatorNotifications.lastSignature = signature;
  params.selfState.operatorNotifications.lastNotifiedAt = params.now;
  return { status: "sent", signature, delivered, errors };
}
