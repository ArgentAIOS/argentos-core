import crypto from "node:crypto";
import type { AgentToolResult } from "../agent-core/core.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { callGatewayTool, type GatewayCallOptions } from "./tools/gateway.js";

const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;
const DEFAULT_APPROVAL_REQUEST_TIMEOUT_MS = 30_000;
const APPROVAL_SLUG_LENGTH = 8;

export const APPROVAL_BACKED_TOOLS = new Set([
  "exec",
  "message",
  "send_payload",
  "email_delivery",
  "namecheap_dns",
]);

function createApprovalSlug(id: string) {
  return id.slice(0, APPROVAL_SLUG_LENGTH);
}

function truncate(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

function extractResultText(result: AgentToolResult<unknown>): string {
  const content = Array.isArray(result?.content) ? result.content : [];
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const rec = block as { type?: unknown; text?: unknown };
    if (rec.type === "text" && typeof rec.text === "string" && rec.text.trim()) {
      parts.push(rec.text.trim());
    }
  }
  return truncate(parts.join("\n"), 600);
}

function summarizeToolParams(toolName: string, params: unknown): string {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return toolName;
  }
  const record = params as Record<string, unknown>;
  const parts: string[] = [toolName];
  if (typeof record.action === "string" && record.action.trim()) {
    parts.push(`action=${record.action.trim()}`);
  }
  if (typeof record.domain === "string" && record.domain.trim()) {
    parts.push(`domain=${record.domain.trim()}`);
  }
  if (typeof record.target === "string" && record.target.trim()) {
    parts.push(`target=${record.target.trim()}`);
  }
  if (typeof record.channel === "string" && record.channel.trim()) {
    parts.push(`channel=${record.channel.trim()}`);
  }
  if (typeof record.subject === "string" && record.subject.trim()) {
    parts.push(`subject=${truncate(record.subject.trim(), 80)}`);
  }
  if (Array.isArray(record.to) && record.to.length > 0) {
    parts.push(`to=${record.to.slice(0, 3).join(",")}`);
  }
  return truncate(parts.join(" "), 240);
}

export function toolPolicyRequiresApproval(toolName: string, params: unknown): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (normalized === "exec") return true;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return APPROVAL_BACKED_TOOLS.has(normalized) && normalized !== "exec";
  }
  const record = params as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action.trim().toLowerCase() : "";

  if (normalized === "send_payload") {
    return true;
  }
  if (normalized === "email_delivery") {
    return action.startsWith("send_");
  }
  if (normalized === "namecheap_dns") {
    return action === "set_hosts" || action === "raw";
  }
  if (normalized === "message") {
    return [
      "send",
      "sendwitheffect",
      "sendattachment",
      "reply",
      "thread-reply",
      "broadcast",
    ].includes(action);
  }
  return false;
}

function emitToolApprovalEvent(text: string, sessionKey?: string, contextKey?: string) {
  const normalized = sessionKey?.trim();
  if (!normalized) return;
  enqueueSystemEvent(text, { sessionKey: normalized, contextKey });
  requestHeartbeatNow({ reason: "tool-approval-event" });
}

export function wrapToolWithApprovalPolicy(
  tool: AnyAgentTool,
  opts: {
    gateway?: GatewayCallOptions;
    sessionKey?: string;
    agentId?: string;
    approvalRequired?: boolean;
  },
): AnyAgentTool {
  if (!opts.approvalRequired || !tool.execute) {
    return tool;
  }

  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (!toolPolicyRequiresApproval(tool.name || "tool", params)) {
        return await tool.execute(toolCallId, params, signal, onUpdate);
      }

      const approvalId = crypto.randomUUID();
      const approvalSlug = createApprovalSlug(approvalId);
      const expiresAtMs = Date.now() + DEFAULT_APPROVAL_TIMEOUT_MS;
      const summary = summarizeToolParams(tool.name || "tool", params);
      const contextKey = `tool:${tool.name}:${approvalId}`;

      void (async () => {
        let decision: string | null = null;
        try {
          const decisionResult = await callGatewayTool<{ decision: string }>(
            "exec.approval.request",
            { ...(opts.gateway || {}), timeoutMs: DEFAULT_APPROVAL_REQUEST_TIMEOUT_MS },
            {
              id: approvalId,
              command: `[TOOL_APPROVAL] ${summary}`,
              host: "tool",
              security: "approval",
              ask: "always",
              agentId: opts.agentId,
              sessionKey: opts.sessionKey,
              timeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
            },
          );
          const rawDecision =
            decisionResult && typeof decisionResult === "object"
              ? (decisionResult as { decision?: unknown }).decision
              : undefined;
          decision = typeof rawDecision === "string" ? rawDecision : null;
        } catch {
          emitToolApprovalEvent(
            `Tool approval failed to open for ${summary}. Request denied.`,
            opts.sessionKey,
            contextKey,
          );
          return;
        }

        if (decision !== "allow-once" && decision !== "allow-always") {
          emitToolApprovalEvent(`Tool use denied for ${summary}.`, opts.sessionKey, contextKey);
          return;
        }

        emitToolApprovalEvent(
          `Tool use approved for ${summary}. Running now.`,
          opts.sessionKey,
          contextKey,
        );

        try {
          const result = await tool.execute(toolCallId, params, signal, onUpdate);
          const resultText = extractResultText(result);
          emitToolApprovalEvent(
            resultText
              ? `Tool ${tool.name} finished: ${resultText}`
              : `Tool ${tool.name} finished successfully.`,
            opts.sessionKey,
            contextKey,
          );
        } catch (err) {
          emitToolApprovalEvent(
            `Tool ${tool.name} failed after approval: ${String(err)}`,
            opts.sessionKey,
            contextKey,
          );
        }
      })();

      return {
        content: [
          {
            type: "text",
            text:
              `Approval required (id ${approvalSlug}) before ${tool.name} can run. ` +
              "Approve to continue; updates will arrive after completion.",
          },
        ],
        details: {
          status: "approval-pending",
          approvalId,
          approvalSlug,
          expiresAtMs,
          tool: tool.name,
          summary,
        },
      } satisfies AgentToolResult<unknown>;
    },
  };
}
