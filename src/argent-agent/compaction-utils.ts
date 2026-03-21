/**
 * Argent Agent — Compaction Utilities
 *
 * Argent-native implementations of estimateTokens and generateSummary.
 * Replaces @mariozechner/pi-coding-agent compaction exports.
 *
 * @module argent-agent/compaction-utils
 */

import type { Message, Model, Api } from "../argent-ai/types.js";
import { completeSimple } from "../argent-ai/complete.js";

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Estimate token count for a message using chars/4 heuristic.
 * This is conservative (overestimates tokens).
 *
 * Handles all AgentMessage roles:
 * - user: text content (string or content blocks)
 * - assistant: text, thinking, and toolCall content
 * - toolResult/custom: text content
 * - bashExecution: command + output
 * - branchSummary/compactionSummary: summary text
 */
export function estimateTokens(message: AgentMessageLike): number {
  let chars = 0;
  const role = message.role;

  switch (role) {
    case "user": {
      const content = (message as UserMessageLike).content;
      if (typeof content === "string") {
        chars = content.length;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            chars += block.text.length;
          }
        }
      }
      return Math.ceil(chars / 4);
    }

    case "assistant": {
      const assistant = message as AssistantMessageLike;
      if (Array.isArray(assistant.content)) {
        for (const block of assistant.content) {
          if (block.type === "text") {
            chars += block.text?.length || 0;
          } else if (block.type === "thinking") {
            chars += block.thinking?.length || 0;
          } else if (block.type === "toolCall") {
            chars += (block.name?.length || 0) + JSON.stringify(block.arguments || {}).length;
          }
        }
      }
      return Math.ceil(chars / 4);
    }

    case "custom":
    case "toolResult": {
      const content = (message as ToolResultMessageLike).content;
      if (typeof content === "string") {
        chars = content.length;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            chars += block.text.length;
          }
          if (block.type === "image") {
            chars += 4800; // Estimate images as 4000 chars, or 1200 tokens
          }
        }
      }
      return Math.ceil(chars / 4);
    }

    case "bashExecution": {
      const bash = message as BashExecutionMessageLike;
      chars = (bash.command?.length || 0) + (bash.output?.length || 0);
      return Math.ceil(chars / 4);
    }

    case "branchSummary":
    case "compactionSummary": {
      const summary = message as SummaryMessageLike;
      chars = summary.summary?.length || 0;
      return Math.ceil(chars / 4);
    }

    default:
      return 0;
  }
}

// ============================================================================
// Summary Generation
// ============================================================================

const SUMMARIZATION_SYSTEM_PROMPT = `You are a conversation summarizer. Your job is to create concise, accurate summaries of conversations that preserve the key context needed to continue the work.`;

const SUMMARIZATION_PROMPT = `Summarize the conversation above. Focus on:
1. Key decisions and conclusions
2. Current state of any work in progress
3. Important context that would be needed to continue
4. Any pending actions or commitments

Keep the summary concise but complete. Use bullet points for clarity.`;

const UPDATE_SUMMARIZATION_PROMPT = `Update the previous summary with new information from the conversation above. Focus on:
1. New decisions and conclusions since the previous summary
2. Changes to the state of work in progress
3. New context that has emerged
4. Updated pending actions or commitments

Merge new information with the previous summary. Remove outdated information. Keep the result concise but complete.`;

/**
 * Serialize conversation messages to text format for summarization.
 */
function serializeConversation(messages: AgentMessageLike[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "user": {
        const content = (msg as UserMessageLike).content;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content
                  .filter((b) => b.type === "text")
                  .map((b) => b.text)
                  .join("\n")
              : "";
        if (text) lines.push(`User: ${text}`);
        break;
      }
      case "assistant": {
        const assistant = msg as AssistantMessageLike;
        if (Array.isArray(assistant.content)) {
          const textParts = assistant.content
            .filter((b) => b.type === "text")
            .map((b) => b.text || "");
          if (textParts.length > 0) {
            lines.push(`Assistant: ${textParts.join("\n")}`);
          }
          const toolCalls = assistant.content.filter((b) => b.type === "toolCall");
          for (const tc of toolCalls) {
            lines.push(`Assistant [tool call: ${tc.name}]: ${JSON.stringify(tc.arguments || {})}`);
          }
        }
        break;
      }
      case "toolResult": {
        const content = (msg as ToolResultMessageLike).content;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content
                  .filter((b) => b.type === "text")
                  .map((b) => b.text)
                  .join("\n")
              : "";
        if (text) lines.push(`Tool Result: ${text.slice(0, 500)}${text.length > 500 ? "..." : ""}`);
        break;
      }
      case "bashExecution": {
        const bash = msg as BashExecutionMessageLike;
        lines.push(`Bash: ${bash.command}`);
        if (bash.output) {
          lines.push(
            `Output: ${bash.output.slice(0, 300)}${bash.output.length > 300 ? "..." : ""}`,
          );
        }
        break;
      }
      case "custom": {
        const content = (msg as ToolResultMessageLike).content;
        const text = typeof content === "string" ? content : "";
        if (text) lines.push(`Custom: ${text}`);
        break;
      }
      case "branchSummary":
      case "compactionSummary": {
        const summary = (msg as SummaryMessageLike).summary;
        if (summary) lines.push(`[Previous Summary]: ${summary}`);
        break;
      }
    }
  }

  return lines.join("\n\n");
}

/**
 * Generate a summary of the conversation using the LLM.
 * If previousSummary is provided, uses the update prompt to merge.
 *
 * @param currentMessages - Messages to summarize
 * @param model - Model to use for summarization
 * @param reserveTokens - Max tokens to reserve for the summary
 * @param apiKey - API key for the model
 * @param signal - Optional abort signal
 * @param customInstructions - Optional additional instructions
 * @param previousSummary - Optional previous summary to update
 */
export async function generateSummary(
  currentMessages: AgentMessageLike[],
  model: Model<Api>,
  reserveTokens: number,
  apiKey: string,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
): Promise<string> {
  const maxTokens = Math.floor(0.8 * reserveTokens);

  let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
  }

  const conversationText = serializeConversation(currentMessages);

  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  promptText += basePrompt;

  const summarizationMessages: Message[] = [
    {
      role: "user",
      content: [{ type: "text", text: promptText }],
    },
  ];

  const response = await completeSimple(
    model,
    {
      systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
      messages: summarizationMessages,
    },
    {
      maxTokens,
      signal,
      apiKey,
      ...(model.reasoning ? { reasoning: "high" as const } : {}),
    },
  );

  if (response.stopReason === "error") {
    throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);
  }

  const textContent = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n");

  return textContent;
}

// ============================================================================
// Internal Types (loose shapes for AgentMessage compat)
// ============================================================================

/** Loose type covering all message roles used in agent-core */
interface AgentMessageLike {
  role: string;
  [key: string]: unknown;
}

interface UserMessageLike extends AgentMessageLike {
  role: "user";
  content: string | Array<{ type: string; text?: string }>;
}

interface AssistantMessageLike extends AgentMessageLike {
  role: "assistant";
  content: Array<{
    type: string;
    text?: string;
    thinking?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  }>;
}

interface ToolResultMessageLike extends AgentMessageLike {
  role: "toolResult" | "custom";
  content: string | Array<{ type: string; text?: string }>;
}

interface BashExecutionMessageLike extends AgentMessageLike {
  role: "bashExecution";
  command: string;
  output: string;
}

interface SummaryMessageLike extends AgentMessageLike {
  role: "branchSummary" | "compactionSummary";
  summary: string;
}
