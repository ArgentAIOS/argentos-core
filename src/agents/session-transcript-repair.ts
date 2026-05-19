import type { AgentMessage } from "../agent-core/core.js";

type ToolCallLike = {
  id: string;
  name?: string;
};

const TOOL_CALL_TYPES = new Set(["toolCall", "toolUse", "functionCall"]);

type ToolCallBlock = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  arguments?: unknown;
};

function extractToolCallsFromAssistant(
  msg: Extract<AgentMessage, { role: "assistant" }>,
): ToolCallLike[] {
  const content = msg.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const toolCalls: ToolCallLike[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const rec = block as { type?: unknown; id?: unknown; name?: unknown };
    if (typeof rec.id !== "string" || !rec.id) {
      continue;
    }

    if (rec.type === "toolCall" || rec.type === "toolUse" || rec.type === "functionCall") {
      toolCalls.push({
        id: rec.id,
        name: typeof rec.name === "string" ? rec.name : undefined,
      });
    }
  }
  return toolCalls;
}

function isToolCallBlock(block: unknown): block is ToolCallBlock {
  if (!block || typeof block !== "object") {
    return false;
  }
  const type = (block as { type?: unknown }).type;
  return typeof type === "string" && TOOL_CALL_TYPES.has(type);
}

function hasToolCallInput(block: ToolCallBlock): boolean {
  const hasInput = "input" in block ? block.input !== undefined && block.input !== null : false;
  const hasArguments =
    "arguments" in block ? block.arguments !== undefined && block.arguments !== null : false;
  return hasInput || hasArguments;
}

function extractToolResultId(msg: Extract<AgentMessage, { role: "toolResult" }>): string | null {
  const toolCallId = (msg as { toolCallId?: unknown }).toolCallId;
  if (typeof toolCallId === "string" && toolCallId) {
    return toolCallId;
  }
  const toolUseId = (msg as { toolUseId?: unknown }).toolUseId;
  if (typeof toolUseId === "string" && toolUseId) {
    return toolUseId;
  }
  return null;
}

function makeMissingToolResult(params: {
  toolCallId: string;
  toolName?: string;
}): Extract<AgentMessage, { role: "toolResult" }> {
  return {
    role: "toolResult",
    toolCallId: params.toolCallId,
    toolName: params.toolName ?? "unknown",
    content: [
      {
        type: "text",
        text: "[argent] missing tool result in session history; inserted synthetic error result for transcript repair.",
      },
    ],
    isError: true,
    timestamp: Date.now(),
  } as Extract<AgentMessage, { role: "toolResult" }>;
}

export { makeMissingToolResult };

export type ToolCallInputRepairReport = {
  messages: AgentMessage[];
  droppedToolCalls: number;
  droppedAssistantMessages: number;
};

export function repairToolCallInputs(messages: AgentMessage[]): ToolCallInputRepairReport {
  let droppedToolCalls = 0;
  let droppedAssistantMessages = 0;
  let changed = false;
  const out: AgentMessage[] = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") {
      out.push(msg);
      continue;
    }

    if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
      out.push(msg);
      continue;
    }

    const nextContent = [];
    let droppedInMessage = 0;

    for (const block of msg.content) {
      if (isToolCallBlock(block) && !hasToolCallInput(block)) {
        droppedToolCalls += 1;
        droppedInMessage += 1;
        changed = true;
        continue;
      }
      nextContent.push(block);
    }

    if (droppedInMessage > 0) {
      if (nextContent.length === 0) {
        droppedAssistantMessages += 1;
        changed = true;
        continue;
      }
      out.push({ ...msg, content: nextContent });
      continue;
    }

    out.push(msg);
  }

  return {
    messages: changed ? out : messages,
    droppedToolCalls,
    droppedAssistantMessages,
  };
}

export function sanitizeToolCallInputs(messages: AgentMessage[]): AgentMessage[] {
  return repairToolCallInputs(messages).messages;
}

export function sanitizeToolUseResultPairing(messages: AgentMessage[]): AgentMessage[] {
  return repairToolUseResultPairing(messages).messages;
}

/**
 * Strip tool_use/tool_result blocks from session history for non-Anthropic providers.
 *
 * When the model router switches from Anthropic to an OpenAI-compatible provider
 * (e.g. MiniMax) mid-session, the history contains Anthropic-format tool calls
 * with `toolu_01...` IDs that the new provider can't parse (HTTP 400).
 *
 * Tool blocks are silently dropped — no placeholder text is injected. Previous
 * versions used `[Used tool: X]` placeholders, but models learned to imitate
 * that pattern as text output instead of making real tool calls.
 */
export function stripToolBlocksForNonAnthropicProvider(messages: AgentMessage[]): AgentMessage[] {
  const out: AgentMessage[] = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") {
      out.push(msg);
      continue;
    }

    // Drop toolResult messages entirely
    if (msg.role === "toolResult") {
      continue;
    }

    // Strip tool_use/thinking blocks from assistant messages, keep only text
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const textBlocks: Array<{ type: "text"; text: string }> = [];

      for (const block of msg.content) {
        if (!block || typeof block !== "object") continue;
        const rec = block as { type?: string; text?: string; name?: string };

        if (TOOL_CALL_TYPES.has(rec.type ?? "")) {
          // Silently drop tool blocks — no placeholder to avoid model imitation
          continue;
        } else if (rec.type === "text" && typeof rec.text === "string") {
          textBlocks.push({ type: "text", text: rec.text });
        } else if (rec.type === "thinking" || rec.type === "redacted_thinking") {
          // Drop thinking blocks for non-Anthropic providers
          continue;
        } else {
          // Preserve other block types as-is
          textBlocks.push(block as { type: "text"; text: string });
        }
      }

      // If all content was tool calls (no text at all), keep a minimal
      // non-imitable placeholder to preserve turn ordering
      if (textBlocks.length === 0) {
        textBlocks.push({ type: "text", text: "..." });
      }

      out.push({ ...msg, content: textBlocks });
      continue;
    }

    out.push(msg);
  }

  return out;
}

/**
 * Strip simulated tool call text patterns from session history.
 *
 * When MiniMax (or another non-Anthropic provider) handles messages, real tool_use
 * blocks get converted to `[Used tool: X]` text by stripToolBlocksForNonAnthropicProvider.
 * If the session later switches back to Anthropic, these text patterns remain in the
 * history and cause Haiku/Sonnet to *imitate* the pattern — writing tool calls as text
 * instead of making real tool_use blocks.
 *
 * This function removes those contamination patterns so Anthropic models don't see them.
 */
export function stripSimulatedToolCallText(messages: AgentMessage[]): AgentMessage[] {
  const SIMULATED_PATTERN = /^\[Used tool: \w+\]$|^\[Performed tool operations\]$/;

  return messages.map((msg) => {
    if (!msg || typeof msg !== "object") return msg;
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg;

    const filtered = (msg.content as Array<{ type?: string; text?: string }>).filter((block) => {
      if (block.type === "text" && typeof block.text === "string") {
        return !SIMULATED_PATTERN.test(block.text.trim());
      }
      return true;
    });

    // If all blocks were simulated tool text, keep at least one block
    if (filtered.length === 0) {
      return msg; // Preserve original rather than create an empty content array
    }

    return { ...msg, content: filtered } as AgentMessage;
  });
}

export type ToolUseRepairReport = {
  messages: AgentMessage[];
  added: Array<Extract<AgentMessage, { role: "toolResult" }>>;
  droppedDuplicateCount: number;
  droppedOrphanCount: number;
  moved: boolean;
};

export function repairToolUseResultPairing(messages: AgentMessage[]): ToolUseRepairReport {
  // Anthropic (and Cloud Code Assist) reject transcripts where assistant tool calls are not
  // immediately followed by matching tool results. Session files can end up with results
  // displaced (e.g. after user turns) or duplicated. Repair by:
  // - moving matching toolResult messages directly after their assistant toolCall turn
  // - inserting synthetic error toolResults for missing ids
  // - dropping duplicate toolResults for the same id (anywhere in the transcript)
  const out: AgentMessage[] = [];
  const added: Array<Extract<AgentMessage, { role: "toolResult" }>> = [];
  const seenToolResultIds = new Set<string>();
  let droppedDuplicateCount = 0;
  let droppedOrphanCount = 0;
  let moved = false;
  let changed = false;

  const pushToolResult = (msg: Extract<AgentMessage, { role: "toolResult" }>) => {
    const id = extractToolResultId(msg);
    if (id && seenToolResultIds.has(id)) {
      droppedDuplicateCount += 1;
      changed = true;
      return;
    }
    if (id) {
      seenToolResultIds.add(id);
    }
    out.push(msg);
  };

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") {
      out.push(msg);
      continue;
    }

    const role = (msg as { role?: unknown }).role;
    if (role !== "assistant") {
      // Tool results must only appear directly after the matching assistant tool call turn.
      // Any "free-floating" toolResult entries in session history can make strict providers
      // (Anthropic-compatible APIs, MiniMax, Cloud Code Assist) reject the entire request.
      if (role !== "toolResult") {
        out.push(msg);
      } else {
        droppedOrphanCount += 1;
        changed = true;
      }
      continue;
    }

    const assistant = msg as Extract<AgentMessage, { role: "assistant" }>;
    const toolCalls = extractToolCallsFromAssistant(assistant);
    if (toolCalls.length === 0) {
      out.push(msg);
      continue;
    }

    const toolCallIds = new Set(toolCalls.map((t) => t.id));

    const spanResultsById = new Map<string, Extract<AgentMessage, { role: "toolResult" }>>();
    const remainder: AgentMessage[] = [];

    let j = i + 1;
    for (; j < messages.length; j += 1) {
      const next = messages[j];
      if (!next || typeof next !== "object") {
        remainder.push(next);
        continue;
      }

      const nextRole = (next as { role?: unknown }).role;
      if (nextRole === "assistant") {
        break;
      }

      if (nextRole === "toolResult") {
        const toolResult = next as Extract<AgentMessage, { role: "toolResult" }>;
        const id = extractToolResultId(toolResult);
        if (id && toolCallIds.has(id)) {
          if (seenToolResultIds.has(id)) {
            droppedDuplicateCount += 1;
            changed = true;
            continue;
          }
          if (!spanResultsById.has(id)) {
            spanResultsById.set(id, toolResult);
          }
          continue;
        }
      }

      // Drop tool results that don't match the current assistant tool calls.
      if (nextRole !== "toolResult") {
        remainder.push(next);
      } else {
        droppedOrphanCount += 1;
        changed = true;
      }
    }

    out.push(msg);

    if (spanResultsById.size > 0 && remainder.length > 0) {
      moved = true;
      changed = true;
    }

    for (const call of toolCalls) {
      const existing = spanResultsById.get(call.id);
      if (existing) {
        pushToolResult(existing);
      } else {
        const missing = makeMissingToolResult({
          toolCallId: call.id,
          toolName: call.name,
        });
        added.push(missing);
        changed = true;
        pushToolResult(missing);
      }
    }

    for (const rem of remainder) {
      if (!rem || typeof rem !== "object") {
        out.push(rem);
        continue;
      }
      out.push(rem);
    }
    i = j - 1;
  }

  const changedOrMoved = changed || moved;
  return {
    messages: changedOrMoved ? out : messages,
    added,
    droppedDuplicateCount,
    droppedOrphanCount,
    moved: changedOrMoved,
  };
}
