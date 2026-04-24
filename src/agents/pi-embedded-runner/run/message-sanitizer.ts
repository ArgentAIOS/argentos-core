import type { AgentMessage } from "../../../agent-core/core.js";

type SanitizeResult = {
  messages: AgentMessage[];
  changed: boolean;
  repairs: string[];
};

function isContentBlockArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value);
}

function fallbackText(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value == null) {
    return "No result provided";
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}" ? serialized : "No result provided";
  } catch {
    return "Unserializable result";
  }
}

export function sanitizeMessagesForModelAdapter(messages: AgentMessage[]): SanitizeResult {
  let changed = false;
  const repairs: string[] = [];
  const sanitized: AgentMessage[] = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") {
      changed = true;
      repairs.push("dropped non-object message");
      continue;
    }

    const role = (message as { role?: unknown }).role;
    if (role === "user") {
      const content = (message as { content?: unknown }).content;
      if (typeof content === "string" || isContentBlockArray(content)) {
        sanitized.push(message);
        continue;
      }
      changed = true;
      repairs.push("repaired user message with missing content");
      sanitized.push({
        ...message,
        content: fallbackText(content),
      } as AgentMessage);
      continue;
    }

    if (role === "assistant") {
      const content = (message as { content?: unknown }).content;
      if (isContentBlockArray(content)) {
        sanitized.push(message);
        continue;
      }
      changed = true;
      repairs.push("repaired assistant message with missing content");
      sanitized.push({
        ...message,
        content: [],
      } as AgentMessage);
      continue;
    }

    if (role === "toolResult") {
      const toolCallId = (message as { toolCallId?: unknown }).toolCallId;
      if (typeof toolCallId !== "string" || !toolCallId.trim()) {
        changed = true;
        repairs.push("dropped tool result with missing toolCallId");
        continue;
      }

      const content = (message as { content?: unknown; details?: unknown }).content;
      if (isContentBlockArray(content)) {
        sanitized.push(message);
        continue;
      }
      changed = true;
      repairs.push("repaired tool result with missing content");
      sanitized.push({
        ...message,
        content: [{ type: "text", text: fallbackText(content ?? message.details) }],
      } as AgentMessage);
      continue;
    }

    changed = true;
    repairs.push(`dropped unsupported message role: ${String(role)}`);
  }

  return { messages: sanitized, changed, repairs };
}
