/**
 * aos-lcm — Message Ingestion
 *
 * Captures messages flowing through the agent pipeline and feeds them
 * into LCM's immutable store. Uses the `agent_end` hook to capture
 * the full message history after each agent run.
 *
 * Strategy:
 * - On agent_end, diff the message history against what we've already ingested
 * - Ingest only new messages (incremental)
 * - Large tool results are detected and routed to the large file handler
 */

import type { LcmContextEngine } from "./engine.js";
import type { LcmConfig } from "./types.js";

/**
 * Extract text content from an agent message.
 * Handles both string content and structured content blocks.
 */
function extractContent(message: Record<string, unknown>): string {
  const content = message.content;

  // String content (simple user messages)
  if (typeof content === "string") return content;

  // Array of content blocks (assistant responses, tool results)
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
      } else if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          parts.push(b.text);
        } else if (b.type === "tool_use") {
          parts.push(
            `[Tool: ${String(b.name ?? "unknown")}] ${JSON.stringify(b.input ?? {}).slice(0, 500)}`,
          );
        } else if (b.type === "tool_result" || b.type === "toolResult") {
          const resultContent =
            typeof b.content === "string"
              ? b.content
              : Array.isArray(b.content)
                ? (b.content as Array<Record<string, unknown>>)
                    .filter((c) => c.type === "text")
                    .map((c) => String(c.text ?? ""))
                    .join("\n")
                : JSON.stringify(b.content ?? "").slice(0, 1000);
          parts.push(`[Result: ${String(b.toolName ?? b.toolUseId ?? "")}] ${resultContent}`);
        } else if (b.type === "thinking" && typeof b.thinking === "string") {
          parts.push(`[Thinking] ${b.thinking}`);
        }
      }
    }
    return parts.join("\n");
  }

  return String(content ?? "");
}

/**
 * Map agent message role to LCM role.
 */
function mapRole(message: Record<string, unknown>): "user" | "assistant" | "system" {
  const role = String(message.role ?? "");
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "toolResult" || role === "tool_result") return "assistant";
  return "system";
}

/**
 * Rough token estimate for content.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Process the full message history from an agent_end event.
 * Ingests any messages we haven't seen yet.
 *
 * Returns the count of newly ingested messages.
 */
export async function ingestFromAgentEnd(
  engine: LcmContextEngine,
  messages: unknown[],
  config: LcmConfig,
): Promise<number> {
  if (!engine.sessionId) return 0;

  // Get the count of messages we've already ingested
  const existingCount = engine.conversationStore.count(engine.sessionId);

  // Only process messages beyond what we've already captured
  const newMessages = messages.slice(existingCount);
  if (newMessages.length === 0) return 0;

  let ingested = 0;

  for (const raw of newMessages) {
    if (!raw || typeof raw !== "object") continue;
    const msg = raw as Record<string, unknown>;

    const role = mapRole(msg);
    const content = extractContent(msg);
    const tokens = estimateTokens(content);

    // Check for large file content in tool results
    if (
      (msg.role === "toolResult" || msg.role === "tool_result") &&
      tokens > config.largeFileTokenThreshold
    ) {
      // Extract file path if available
      const toolName = String(msg.toolName ?? msg.tool_name ?? "");
      const filePath = extractFilePath(msg) ?? `tool-result-${toolName}-${Date.now()}`;

      const replacement = await engine.handleLargeFile(filePath, content, tokens);
      if (replacement) {
        // Ingest the compact reference instead of the full content
        engine.ingest(role, replacement, estimateTokens(replacement), {
          toolCallId: typeof msg.toolCallId === "string" ? msg.toolCallId : undefined,
        });
        ingested++;
        continue;
      }
    }

    // Normal ingestion
    engine.ingest(role, content, tokens, {
      toolCallId: typeof msg.toolCallId === "string" ? msg.toolCallId : undefined,
    });
    ingested++;
  }

  return ingested;
}

/**
 * Try to extract a file path from a tool result message.
 * Common tool results that contain file paths: read_file, cat, etc.
 */
function extractFilePath(msg: Record<string, unknown>): string | null {
  // Check tool params for file_path or path
  const params = msg.params as Record<string, unknown> | undefined;
  if (params) {
    if (typeof params.file_path === "string") return params.file_path;
    if (typeof params.path === "string") return params.path;
    if (typeof params.filePath === "string") return params.filePath;
  }

  // Check the tool name for file-related tools
  const toolName = String(msg.toolName ?? msg.tool_name ?? "");
  if (toolName.includes("read") || toolName.includes("file") || toolName.includes("cat")) {
    // Try to extract path from the content itself
    const content = typeof msg.content === "string" ? msg.content : "";
    const pathMatch = content.match(/^(?:File|Reading|Contents of)\s+[`"]?([^\n`"]+)/i);
    if (pathMatch) return pathMatch[1];
  }

  return null;
}
