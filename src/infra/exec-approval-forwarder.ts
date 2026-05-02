import type { ArgentConfig } from "../config/config.js";
import type { ExecApprovalRequestPayload } from "../gateway/exec-approval-manager.js";
import type { ExecApprovalDecision } from "./exec-approvals.js";

export type ExecApprovalForwardTarget = {
  channel: string;
  to: string;
  accountId?: string;
  threadId?: string | number;
};

export type ExecApprovalDeliveryPayload = {
  text: string;
};

export type ExecApprovalDeliverParams = {
  target: ExecApprovalForwardTarget;
  payloads: ExecApprovalDeliveryPayload[];
};

export type ExecApprovalForwarder = {
  handleRequested(params: {
    id: string;
    request: ExecApprovalRequestPayload;
    createdAtMs: number;
    expiresAtMs: number;
  }): Promise<void>;
  handleResolved(params: {
    id: string;
    decision: ExecApprovalDecision;
    resolvedBy?: string | null;
    ts: number;
  }): Promise<void>;
  stop(): void;
};

function targetKey(target: ExecApprovalForwardTarget): string {
  return `${target.channel}\0${target.accountId ?? ""}\0${target.to}\0${target.threadId ?? ""}`;
}

function dedupeTargets(targets: ExecApprovalForwardTarget[]): ExecApprovalForwardTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = targetKey(target);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function createExecApprovalForwarder(opts: {
  getConfig: () => ArgentConfig;
  deliver: (params: ExecApprovalDeliverParams) => Promise<unknown>;
  nowMs?: () => number;
  resolveSessionTarget: (request: ExecApprovalRequestPayload) => ExecApprovalForwardTarget | null;
}): ExecApprovalForwarder;
export function createExecApprovalForwarder(): ExecApprovalForwarder;
export function createExecApprovalForwarder(opts?: {
  getConfig: () => ArgentConfig;
  deliver: (params: ExecApprovalDeliverParams) => Promise<unknown>;
  nowMs?: () => number;
  resolveSessionTarget: (request: ExecApprovalRequestPayload) => ExecApprovalForwardTarget | null;
}): ExecApprovalForwarder {
  if (!opts) {
    return {
      handleRequested: async () => {},
      handleResolved: async () => {},
      stop: () => {},
    };
  }
  const nowMs = opts.nowMs ?? (() => Date.now());
  const pending = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; targets: ExecApprovalForwardTarget[]; isTool: boolean }
  >();

  const resolveTargets = (request: ExecApprovalRequestPayload): ExecApprovalForwardTarget[] => {
    const cfg = opts.getConfig().approvals?.exec;
    if (!cfg?.enabled) {
      return [];
    }

    const targets: ExecApprovalForwardTarget[] = [];
    if (cfg.mode === undefined || cfg.mode === "session" || cfg.mode === "both") {
      const sessionTarget = opts.resolveSessionTarget(request);
      if (sessionTarget) {
        targets.push(sessionTarget);
      }
    }
    if (cfg.mode === "targets" || cfg.mode === "both") {
      for (const target of cfg.targets ?? []) {
        targets.push({
          channel: target.channel,
          to: target.to,
          accountId: target.accountId,
          threadId: target.threadId,
        });
      }
    }
    return dedupeTargets(targets);
  };

  const deliverAll = async (targets: ExecApprovalForwardTarget[], text: string) => {
    await Promise.all(
      targets.map((target) =>
        opts.deliver({
          target,
          payloads: [{ text }],
        }),
      ),
    );
  };

  return {
    async handleRequested(params) {
      const targets = resolveTargets(params.request);
      if (targets.length === 0) {
        return;
      }

      const isTool = params.request.command.startsWith("[TOOL_APPROVAL]");
      const title = isTool ? "Tool approval required" : "Exec approval required";
      const commandLabel = isTool
        ? params.request.command.replace(/^\[TOOL_APPROVAL\]\s*/, "Tool: ")
        : `Command: ${params.request.command}`;
      await deliverAll(targets, `🔒 ${title}\n${commandLabel}`);

      const delayMs = Math.max(0, params.expiresAtMs - nowMs());
      const timer = setTimeout(() => {
        pending.delete(params.id);
        void deliverAll(
          targets,
          isTool ? "⏱️ Tool approval expired." : "⏱️ Exec approval expired.",
        ).catch(() => {});
      }, delayMs);
      pending.set(params.id, { timer, targets, isTool });
    },

    async handleResolved(params) {
      const entry = pending.get(params.id);
      if (!entry) {
        return;
      }
      clearTimeout(entry.timer);
      pending.delete(params.id);

      const decisionText =
        params.decision === "allow-once"
          ? "allowed once"
          : params.decision === "allow-always"
            ? "allowed always"
            : "denied";
      const subject = entry.isTool ? "Tool approval" : "Exec approval";
      const icon = params.decision === "deny" ? "❌" : "✅";
      await deliverAll(entry.targets, `${icon} ${subject} ${decisionText}.`);
    },

    stop() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
      }
      pending.clear();
    },
  };
}
