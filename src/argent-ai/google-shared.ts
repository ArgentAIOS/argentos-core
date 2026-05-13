/**
 * Argent AI — Google Shared Conversion Utilities
 *
 * Argent-native implementations of the Gemini message/tool conversion helpers
 * that translate Argent's internal `Message`/`Tool` shape into Google
 * `Content[]` / `functionDeclarations` payloads.
 *
 * These were previously re-exported from
 * `@earendil-works/pi-ai/dist/providers/google-shared.js`, but that path is
 * blocked by upstream's `exports` map and forced a known-failing TS2307. This
 * module now inlines the upstream behavior so callers can stay on a single
 * argent-native seam (`src/agent-core/google-shared.ts` -> here).
 *
 * Protocol references:
 * - Gemini thought signatures: https://ai.google.dev/gemini-api/docs/thought-signatures
 * - Gemini 3+ multimodal function responses: parts nested inside
 *   `functionResponse.parts`; older Gemini versions and Claude-over-Vertex
 *   require a separate user turn carrying the image.
 *
 * @module argent-ai/google-shared
 */
import type {
  Api,
  AssistantMessage,
  Context,
  ImageContent,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
} from "./types.js";

// ---------------------------------------------------------------------------
// Local structural types compatible with @google/genai's Content/Part shapes.
//
// @google/genai is only a transitive dependency of @earendil-works/pi-ai;
// importing it directly would re-introduce the kind of cross-package coupling
// this module is meant to eliminate. The fields below match Google's wire
// format and are sufficient for both convertMessages output and call sites
// inside argent-core (which type-check against pi-ai's Content[] re-export).
// ---------------------------------------------------------------------------

/** Google Generative AI / Vertex AI inline data block (base64 image, etc.). */
interface InlineDataPart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

/** Function call emitted by the model. */
interface FunctionCallPart {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
    id?: string;
  };
  thoughtSignature?: string;
}

/** Tool result returned to the model. */
interface FunctionResponsePart {
  functionResponse: {
    name: string;
    response: { output: string } | { error: string };
    parts?: InlineDataPart[];
    id?: string;
  };
}

/** Text part (optionally a thought summary). */
interface TextPart {
  text: string;
  thought?: boolean;
  thoughtSignature?: string;
}

/** Union of all part shapes we emit. */
export type Part = TextPart | InlineDataPart | FunctionCallPart | FunctionResponsePart;

/** Google `Content` envelope: a role + ordered parts. */
export interface Content {
  role: "user" | "model";
  parts: Part[];
}

// ---------------------------------------------------------------------------
// Surrogate sanitization (mirrors @earendil-works/pi-ai/utils/sanitize-unicode)
// ---------------------------------------------------------------------------

/**
 * Removes unpaired Unicode surrogate characters from a string.
 *
 * Unpaired high (0xD800-0xDBFF) or low (0xDC00-0xDFFF) surrogates cause
 * JSON serialization failures in several provider SDKs. Valid emoji (which
 * use properly paired surrogates) are preserved.
 */
function sanitizeSurrogates(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "",
  );
}

// ---------------------------------------------------------------------------
// Cross-provider message transformation (inlined from pi-ai transform-messages)
// ---------------------------------------------------------------------------

const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";

type UserOrToolImageContent = TextContent | ImageContent;

function replaceImagesWithPlaceholder(
  content: UserOrToolImageContent[],
  placeholder: string,
): UserOrToolImageContent[] {
  const result: UserOrToolImageContent[] = [];
  let previousWasPlaceholder = false;
  for (const block of content) {
    if (block.type === "image") {
      if (!previousWasPlaceholder) {
        result.push({ type: "text", text: placeholder });
      }
      previousWasPlaceholder = true;
      continue;
    }
    result.push(block);
    previousWasPlaceholder = block.type === "text" && block.text === placeholder;
  }
  return result;
}

function downgradeUnsupportedImages<TApi extends Api>(
  messages: Message[],
  model: Model<TApi>,
): Message[] {
  if (model.input.includes("image")) {
    return messages;
  }
  return messages.map((msg) => {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: replaceImagesWithPlaceholder(msg.content, NON_VISION_USER_IMAGE_PLACEHOLDER),
      };
    }
    if (msg.role === "toolResult") {
      return {
        ...msg,
        content: replaceImagesWithPlaceholder(msg.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER),
      };
    }
    return msg;
  });
}

/**
 * Optional thinking block extension: upstream's `ThinkingContent` carries a
 * `redacted: true` flag for opaque encrypted reasoning that must only be
 * replayed to the same provider/model. Argent's type doesn't declare it, so we
 * narrow defensively at the use sites with this helper.
 */
function isRedactedThinking(block: ThinkingContent): boolean {
  return (block as ThinkingContent & { redacted?: boolean }).redacted === true;
}

/**
 * Normalize messages for cross-provider compatibility before they hit the
 * Gemini wire format.
 *
 *   1. Downgrades images on non-vision models to text placeholders.
 *   2. Drops cross-model thinking blocks (keeping signatures only for the same
 *      provider + api + model triple — opaque tokens can't be verified by a
 *      different model).
 *   3. Normalizes tool call IDs (upstream APIs like OpenAI Responses emit
 *      450+ char IDs with `|`; Anthropic-flavored APIs require
 *      `^[a-zA-Z0-9_-]+$`, max 64 chars) and propagates the normalization to
 *      matching tool results.
 *   4. Skips errored/aborted assistant turns — they have partial state
 *      (reasoning without message, half-finished tool calls) and replaying
 *      them can crash the next turn.
 *
 * Intentionally does NOT synthesize empty results for unresolved tool calls;
 * Argent's session layer guarantees every tool call has a matching result
 * (see `src/providers/google-shared.ensures-function-call-comes-after-user-turn.test.ts`).
 */
function transformMessages<TApi extends Api>(
  messages: Message[],
  model: Model<TApi>,
  normalizeToolCallId?: (id: string, model: Model<TApi>, source: AssistantMessage) => string,
): Message[] {
  const toolCallIdMap = new Map<string, string>();
  const imageAwareMessages = downgradeUnsupportedImages(messages, model);

  const transformed: Message[] = imageAwareMessages.map((msg) => {
    if (msg.role === "user") {
      return msg;
    }
    if (msg.role === "toolResult") {
      const normalizedId = toolCallIdMap.get(msg.toolCallId);
      if (normalizedId && normalizedId !== msg.toolCallId) {
        return { ...msg, toolCallId: normalizedId };
      }
      return msg;
    }
    if (msg.role === "assistant") {
      const isSameModel =
        msg.provider === model.provider && msg.api === model.api && msg.model === model.id;
      const transformedContent = msg.content.flatMap<TextContent | ThinkingContent | ToolCall>(
        (block) => {
          if (block.type === "thinking") {
            if (isRedactedThinking(block)) {
              return isSameModel ? [block] : [];
            }
            // Same model: keep thinking blocks with signatures (needed for
            // replay) even if the thinking text is empty (OpenAI encrypted
            // reasoning).
            if (isSameModel && block.thinkingSignature) return [block];
            // Skip empty thinking blocks; otherwise either keep (same model)
            // or convert to plain text (cross-model — strip tags to avoid the
            // target model mimicking them).
            if (!block.thinking || block.thinking.trim() === "") return [];
            if (isSameModel) return [block];
            return [
              {
                type: "text" as const,
                text: block.thinking,
              },
            ];
          }
          if (block.type === "text") {
            if (isSameModel) return [block];
            return [
              {
                type: "text" as const,
                text: block.text,
              },
            ];
          }
          if (block.type === "toolCall") {
            let normalizedToolCall: ToolCall = block;
            if (!isSameModel && block.thoughtSignature) {
              normalizedToolCall = { ...block };
              delete (normalizedToolCall as { thoughtSignature?: string }).thoughtSignature;
            }
            if (!isSameModel && normalizeToolCallId) {
              const normalizedId = normalizeToolCallId(block.id, model, msg);
              if (normalizedId !== block.id) {
                toolCallIdMap.set(block.id, normalizedId);
                normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
              }
            }
            return [normalizedToolCall];
          }
          return [block];
        },
      );
      return { ...msg, content: transformedContent };
    }
    return msg;
  });

  // Second pass: drop errored/aborted assistant turns. Their partial state
  // (reasoning without a message, half-finished tool calls) is unsafe to
  // replay — the model should retry from the last valid state instead.
  const result: Message[] = [];
  for (const msg of transformed) {
    if (msg.role === "assistant" && (msg.stopReason === "error" || msg.stopReason === "aborted")) {
      continue;
    }
    result.push(msg);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Gemini-specific helpers
// ---------------------------------------------------------------------------

/** Set of Google-flavored APIs that this module's helpers target. */
export type GoogleApiType = "google-generative-ai" | "google-vertex" | "google-gemini-cli";

/**
 * Models routed through Google APIs that nevertheless require explicit
 * `id` fields on `functionCall` / `functionResponse` parts. These are the
 * non-Gemini families (Claude on Vertex, `gpt-oss-*` mirrors) whose underlying
 * Anthropic-style protocol cannot match calls to responses positionally.
 */
export function requiresToolCallId(modelId: string): boolean {
  return modelId.startsWith("claude-") || modelId.startsWith("gpt-oss-");
}

// Thought signatures must be base64 for Google APIs (TYPE_BYTES).
const base64SignaturePattern = /^[A-Za-z0-9+/]+={0,2}$/;

function isValidThoughtSignature(signature: string | undefined): signature is string {
  if (!signature) return false;
  if (signature.length % 4 !== 0) return false;
  return base64SignaturePattern.test(signature);
}

/**
 * Only keep signatures from the same provider/model and with valid base64,
 * to avoid sending opaque tokens that the target model can't verify.
 */
function resolveThoughtSignature(
  isSameProviderAndModel: boolean,
  signature: string | undefined,
): string | undefined {
  return isSameProviderAndModel && isValidThoughtSignature(signature) ? signature : undefined;
}

function getGeminiMajorVersion(modelId: string): number | undefined {
  const match = modelId.toLowerCase().match(/^gemini(?:-live)?-(\d+)/);
  if (!match) return undefined;
  return Number.parseInt(match[1], 10);
}

function supportsMultimodalFunctionResponse(modelId: string): boolean {
  const geminiMajorVersion = getGeminiMajorVersion(modelId);
  if (geminiMajorVersion !== undefined) {
    return geminiMajorVersion >= 3;
  }
  // Non-Gemini routes (Claude-on-Vertex, OSS models) handle images inline.
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert Argent's internal `Message[]` into Gemini `Content[]`.
 *
 * - User messages become `{ role: "user", parts: [text|inlineData...] }`.
 * - Assistant messages become `{ role: "model", parts: [text|functionCall...] }`,
 *   preserving thought signatures only when the source matches the target
 *   provider+api+model triple.
 * - Tool results become `functionResponse` parts merged onto the prior user
 *   turn when Cloud Code Assist groups them, otherwise a fresh user turn.
 * - Images returned from tools are nested inside `functionResponse.parts` for
 *   Gemini 3+; older versions get a separate user turn with the image.
 */
export function convertMessages<TApi extends GoogleApiType>(
  model: Model<TApi>,
  context: Context,
): Content[] {
  const contents: Content[] = [];
  const normalizeToolCallId = (id: string): string => {
    if (!requiresToolCallId(model.id)) return id;
    return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  };
  const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);

  for (const msg of transformedMessages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        contents.push({
          role: "user",
          parts: [{ text: sanitizeSurrogates(msg.content) }],
        });
      } else {
        const parts: Part[] = msg.content.map((item) => {
          if (item.type === "text") {
            return { text: sanitizeSurrogates(item.text) };
          }
          return {
            inlineData: {
              mimeType: item.mimeType,
              data: item.data,
            },
          };
        });
        if (parts.length === 0) continue;
        contents.push({ role: "user", parts });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const parts: Part[] = [];
      const isSameProviderAndModel = msg.provider === model.provider && msg.model === model.id;

      for (const block of msg.content) {
        if (block.type === "text") {
          if (!block.text || block.text.trim() === "") continue;
          const thoughtSignature = resolveThoughtSignature(
            isSameProviderAndModel,
            block.textSignature,
          );
          parts.push({
            text: sanitizeSurrogates(block.text),
            ...(thoughtSignature ? { thoughtSignature } : {}),
          });
        } else if (block.type === "thinking") {
          if (!block.thinking || block.thinking.trim() === "") continue;
          // Only keep as thinking block if same provider AND same model.
          // Otherwise convert to plain text (no tags — avoids the next model
          // learning to mimic them).
          if (isSameProviderAndModel) {
            const thoughtSignature = resolveThoughtSignature(
              isSameProviderAndModel,
              block.thinkingSignature,
            );
            parts.push({
              thought: true,
              text: sanitizeSurrogates(block.thinking),
              ...(thoughtSignature ? { thoughtSignature } : {}),
            });
          } else {
            parts.push({ text: sanitizeSurrogates(block.thinking) });
          }
        } else if (block.type === "toolCall") {
          const thoughtSignature = resolveThoughtSignature(
            isSameProviderAndModel,
            block.thoughtSignature,
          );
          const part: FunctionCallPart = {
            functionCall: {
              name: block.name,
              args: block.arguments ?? {},
              ...(requiresToolCallId(model.id) ? { id: block.id } : {}),
            },
            ...(thoughtSignature ? { thoughtSignature } : {}),
          };
          parts.push(part);
        }
      }
      if (parts.length === 0) continue;
      contents.push({ role: "model", parts });
      continue;
    }

    if (msg.role === "toolResult") {
      const textContent = msg.content.filter((c): c is TextContent => c.type === "text");
      const textResult = textContent.map((c) => c.text).join("\n");
      const imageContent = model.input.includes("image")
        ? msg.content.filter((c): c is ImageContent => c.type === "image")
        : [];
      const hasText = textResult.length > 0;
      const hasImages = imageContent.length > 0;

      // Gemini 3+ supports multimodal function responses with images nested
      // inside functionResponse.parts. Claude-on-Vertex and Gemini <3 need a
      // separate user image turn.
      const modelSupportsMultimodalFunctionResponse = supportsMultimodalFunctionResponse(model.id);
      const responseValue = hasText
        ? sanitizeSurrogates(textResult)
        : hasImages
          ? "(see attached image)"
          : "";
      const imageParts: InlineDataPart[] = imageContent.map((imageBlock) => ({
        inlineData: {
          mimeType: imageBlock.mimeType,
          data: imageBlock.data,
        },
      }));
      const includeId = requiresToolCallId(model.id);
      const functionResponsePart: FunctionResponsePart = {
        functionResponse: {
          name: msg.toolName,
          response: msg.isError ? { error: responseValue } : { output: responseValue },
          ...(hasImages && modelSupportsMultimodalFunctionResponse ? { parts: imageParts } : {}),
          ...(includeId ? { id: msg.toolCallId } : {}),
        },
      };

      // Cloud Code Assist requires all function responses in a single user
      // turn — merge onto the prior user turn if it already carries one.
      const lastContent = contents[contents.length - 1];
      if (
        lastContent?.role === "user" &&
        lastContent.parts?.some(
          (p): p is FunctionResponsePart =>
            typeof p === "object" && p !== null && "functionResponse" in p,
        )
      ) {
        lastContent.parts.push(functionResponsePart);
      } else {
        contents.push({ role: "user", parts: [functionResponsePart] });
      }

      // For Gemini <3, attach images in a separate user message.
      if (hasImages && !modelSupportsMultimodalFunctionResponse) {
        contents.push({
          role: "user",
          parts: [{ text: "Tool result image:" }, ...imageParts],
        });
      }
    }
  }

  return contents;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const JSON_SCHEMA_META_DECLARATIONS = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$vocabulary",
  "$comment",
  "$defs",
  // pre-draft-2019-09 equivalent of $defs
  "definitions",
]);

/**
 * Strip JSON Schema meta-declarations from a schema object so it survives the
 * narrower OpenAPI 3.03 schema that Cloud Code Assist exposes to Claude. Pure
 * function; recursive; preserves arrays and primitives untouched.
 */
function sanitizeForOpenApi(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return schema;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (JSON_SCHEMA_META_DECLARATIONS.has(key)) continue;
    result[key] = sanitizeForOpenApi(value);
  }
  return result;
}

/**
 * Convert Argent tools to Gemini function declarations.
 *
 * Defaults to `parametersJsonSchema`, which carries full JSON Schema
 * (`anyOf`, `oneOf`, `const`, ...). Set `useParameters` to fall back to the
 * legacy OpenAPI 3.03 `parameters` field — required for Cloud Code Assist
 * with Claude models, where the API translates `parameters` into Anthropic's
 * `input_schema`.
 */
export function convertTools(
  tools: Tool[],
  useParameters = false,
):
  | {
      functionDeclarations: Record<string, unknown>[];
    }[]
  | undefined {
  if (tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        ...(useParameters
          ? { parameters: sanitizeForOpenApi(tool.parameters) }
          : { parametersJsonSchema: tool.parameters }),
      })),
    },
  ];
}
