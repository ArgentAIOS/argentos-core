/**
 * Argent Agent — Proxy Stream
 *
 * Argent-native implementation of proxy streaming for apps that route
 * LLM calls through a server. The server manages auth and proxies
 * requests to LLM providers.
 *
 * Replaces @mariozechner/pi-agent-core streamProxy.
 *
 * @module argent-agent/proxy-stream
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  Api,
  SimpleStreamOptions,
  StopReason,
  Usage,
} from "../argent-ai/types.js";
import { createAssistantMessageEventStream } from "../argent-ai/utils/event-stream.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Proxy event types — server sends these with partial field stripped
 * to reduce bandwidth. Client reconstructs partial message.
 */
export type ProxyAssistantMessageEvent =
  | { type: "start" }
  | { type: "text_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; contentSignature?: string }
  | { type: "thinking_start"; contentIndex: number }
  | { type: "thinking_delta"; contentIndex: number; delta: string }
  | { type: "thinking_end"; contentIndex: number; contentSignature?: string }
  | { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
  | { type: "toolcall_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_end"; contentIndex: number }
  | {
      type: "done";
      reason: Extract<StopReason, "stop" | "length" | "toolUse">;
      usage: Usage;
    }
  | {
      type: "error";
      reason: Extract<StopReason, "aborted" | "error">;
      errorMessage?: string;
      usage: Usage;
    };

export interface ProxyStreamOptions extends SimpleStreamOptions {
  /** Auth token for the proxy server */
  authToken: string;
  /** Proxy server URL (e.g., "https://genai.example.com") */
  proxyUrl: string;
}

// ============================================================================
// JSON Parse Helper
// ============================================================================

/**
 * Attempt to parse partial/streaming JSON, returning null on failure.
 */
function parseStreamingJson(partial: string): Record<string, unknown> | null {
  try {
    return JSON.parse(partial) as Record<string, unknown>;
  } catch {
    // Try to close unclosed braces/brackets for streaming partial parse
    let attempt = partial;
    const openBraces = (attempt.match(/{/g) || []).length;
    const closeBraces = (attempt.match(/}/g) || []).length;
    const openBrackets = (attempt.match(/\[/g) || []).length;
    const closeBrackets = (attempt.match(/]/g) || []).length;

    for (let i = 0; i < openBrackets - closeBrackets; i++) attempt += "]";
    for (let i = 0; i < openBraces - closeBraces; i++) attempt += "}";

    try {
      return JSON.parse(attempt) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Default Usage
// ============================================================================

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

// ============================================================================
// Process Proxy Event
// ============================================================================

function processProxyEvent(
  proxyEvent: ProxyAssistantMessageEvent,
  partial: AssistantMessage,
): AssistantMessageEvent | undefined {
  switch (proxyEvent.type) {
    case "start":
      return { type: "start", partial };

    case "text_start":
      partial.content[proxyEvent.contentIndex] = { type: "text", text: "" };
      return { type: "text_start", contentIndex: proxyEvent.contentIndex, partial };

    case "text_delta": {
      const content = partial.content[proxyEvent.contentIndex];
      if (content?.type === "text") {
        content.text += proxyEvent.delta;
        return {
          type: "text_delta",
          contentIndex: proxyEvent.contentIndex,
          delta: proxyEvent.delta,
          partial,
        };
      }
      throw new Error("Received text_delta for non-text content");
    }

    case "text_end": {
      const content = partial.content[proxyEvent.contentIndex];
      if (content?.type === "text") {
        (content as Record<string, unknown>).textSignature = proxyEvent.contentSignature;
        return {
          type: "text_end",
          contentIndex: proxyEvent.contentIndex,
          content: content.text,
          partial,
        };
      }
      throw new Error("Received text_end for non-text content");
    }

    case "thinking_start":
      partial.content[proxyEvent.contentIndex] = { type: "thinking", thinking: "" };
      return { type: "thinking_start", contentIndex: proxyEvent.contentIndex, partial };

    case "thinking_delta": {
      const content = partial.content[proxyEvent.contentIndex];
      if (content?.type === "thinking") {
        content.thinking += proxyEvent.delta;
        return {
          type: "thinking_delta",
          contentIndex: proxyEvent.contentIndex,
          delta: proxyEvent.delta,
          partial,
        };
      }
      throw new Error("Received thinking_delta for non-thinking content");
    }

    case "thinking_end": {
      const content = partial.content[proxyEvent.contentIndex];
      if (content?.type === "thinking") {
        (content as Record<string, unknown>).thinkingSignature = proxyEvent.contentSignature;
        return {
          type: "thinking_end",
          contentIndex: proxyEvent.contentIndex,
          content: content.thinking,
          partial,
        };
      }
      throw new Error("Received thinking_end for non-thinking content");
    }

    case "toolcall_start":
      partial.content[proxyEvent.contentIndex] = {
        type: "toolCall",
        id: proxyEvent.id,
        name: proxyEvent.toolName,
        arguments: {},
      };
      return { type: "toolcall_start", contentIndex: proxyEvent.contentIndex, partial };

    case "toolcall_delta": {
      const content = partial.content[proxyEvent.contentIndex];
      if (content?.type === "toolCall") {
        const ext = content as Record<string, unknown>;
        const partialJson = ((ext.partialJson as string) || "") + proxyEvent.delta;
        ext.partialJson = partialJson;
        content.arguments = parseStreamingJson(partialJson) || {};
        // Trigger reactivity by spreading
        partial.content[proxyEvent.contentIndex] = { ...content };
        return {
          type: "toolcall_delta",
          contentIndex: proxyEvent.contentIndex,
          delta: proxyEvent.delta,
          partial,
        };
      }
      throw new Error("Received toolcall_delta for non-toolCall content");
    }

    case "toolcall_end": {
      const content = partial.content[proxyEvent.contentIndex];
      if (content?.type === "toolCall") {
        const ext = content as Record<string, unknown>;
        delete ext.partialJson;
        return {
          type: "toolcall_end",
          contentIndex: proxyEvent.contentIndex,
          toolCall: content,
          partial,
        };
      }
      return undefined;
    }

    case "done":
      partial.stopReason = proxyEvent.reason;
      partial.usage = proxyEvent.usage;
      return { type: "done", reason: proxyEvent.reason, message: partial };

    case "error":
      partial.stopReason = proxyEvent.reason;
      partial.errorMessage = proxyEvent.errorMessage;
      partial.usage = proxyEvent.usage;
      return { type: "error", reason: proxyEvent.reason, error: partial };

    default: {
      // Unhandled event type — log and skip
      console.warn(
        `[proxy-stream] Unhandled proxy event type: ${(proxyEvent as { type: string }).type}`,
      );
      return undefined;
    }
  }
}

// ============================================================================
// Stream Proxy
// ============================================================================

/**
 * Stream function that proxies through a server instead of calling LLM
 * providers directly. The server strips the partial field from delta
 * events to reduce bandwidth. We reconstruct the partial message client-side.
 *
 * Use this as the `streamFn` option when creating an Agent that needs
 * to go through a proxy.
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   streamFn: (model, context, options) =>
 *     streamProxy(model, context, {
 *       ...options,
 *       authToken: await getAuthToken(),
 *       proxyUrl: "https://genai.example.com",
 *     }),
 * });
 * ```
 */
export function streamProxy(
  model: Model<Api>,
  context: Context,
  options: ProxyStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  const partial: AssistantMessage = {
    role: "assistant",
    stopReason: "stop",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    timestamp: Date.now(),
  };

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  const abortHandler = () => {
    if (reader) {
      reader.cancel("Request aborted by user").catch(() => {});
    }
  };

  if (options.signal) {
    options.signal.addEventListener("abort", abortHandler);
  }

  void (async () => {
    try {
      const response = await fetch(`${options.proxyUrl}/api/stream`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          context,
          options: {
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            reasoning: options.reasoning,
          },
        }),
        signal: options.signal,
      });

      if (!response.ok) {
        let errorMessage = `Proxy error: ${response.status} ${response.statusText}`;
        try {
          const errorData = (await response.json()) as { error?: string };
          if (errorData.error) {
            errorMessage = `Proxy error: ${errorData.error}`;
          }
        } catch {
          // Couldn't parse error response
        }
        throw new Error(errorMessage);
      }

      reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (options.signal?.aborted) {
          throw new Error("Request aborted by user");
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data) {
              const proxyEvent = JSON.parse(data) as ProxyAssistantMessageEvent;
              const event = processProxyEvent(proxyEvent, partial);
              if (event) {
                stream.push(event);
              }
            }
          }
        }
      }

      if (options.signal?.aborted) {
        throw new Error("Request aborted by user");
      }

      stream.end();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const reason: StopReason = options.signal?.aborted ? "aborted" : "error";
      partial.stopReason = reason;
      partial.errorMessage = errorMessage;
      stream.push({ type: "error", reason, error: partial });
      stream.end();
    } finally {
      if (options.signal) {
        options.signal.removeEventListener("abort", abortHandler);
      }
    }
  })();

  return stream as unknown as AssistantMessageEventStream;
}
