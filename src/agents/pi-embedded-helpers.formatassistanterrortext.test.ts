import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../agent-core/ai.js";
import { formatAssistantErrorText } from "./pi-embedded-helpers.js";

describe("formatAssistantErrorText", () => {
  const makeAssistantError = (errorMessage: string): AssistantMessage =>
    ({
      stopReason: "error",
      errorMessage,
    }) as AssistantMessage;

  it("returns a friendly message for context overflow", () => {
    const msg = makeAssistantError("request_too_large");
    expect(formatAssistantErrorText(msg)).toContain("Context overflow");
  });
  it("preserves specific context overflow guidance when already user-facing", () => {
    const msg = makeAssistantError(
      "Context overflow: this single message is too large for the current model context. Split it into smaller parts or summarize logs before sending.",
    );
    expect(formatAssistantErrorText(msg)).toContain("single message is too large");
  });
  it("returns context overflow for Anthropic 'Request size exceeds model context window'", () => {
    // This is the new Anthropic error format that wasn't being detected.
    // Without the fix, this falls through to the invalidRequest regex and returns
    // "LLM request rejected: Request size exceeds model context window"
    // instead of the context overflow message, preventing auto-compaction.
    const msg = makeAssistantError(
      '{"type":"error","error":{"type":"invalid_request_error","message":"Request size exceeds model context window"}}',
    );
    expect(formatAssistantErrorText(msg)).toContain("Context overflow");
  });
  it("returns a friendly message for Anthropic role ordering", () => {
    const msg = makeAssistantError('messages: roles must alternate between "user" and "assistant"');
    expect(formatAssistantErrorText(msg)).toContain("Message ordering conflict");
  });
  it("returns a friendly message for Anthropic overload errors", () => {
    const msg = makeAssistantError(
      '{"type":"error","error":{"details":null,"type":"overloaded_error","message":"Overloaded"},"request_id":"req_123"}',
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "The AI service is temporarily overloaded. Please try again in a moment.",
    );
  });
  it("returns a recovery hint when tool call input is missing", () => {
    const msg = makeAssistantError("tool_use.input: Field required");
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("Session history looks corrupted");
    expect(result).toContain("/new");
  });
  it("handles JSON-wrapped role errors", () => {
    const msg = makeAssistantError('{"error":{"message":"400 Incorrect role information"}}');
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("Message ordering conflict");
    expect(result).not.toContain("400");
  });
  it("suppresses raw error JSON payloads that are not otherwise classified", () => {
    const msg = makeAssistantError(
      '{"type":"error","error":{"message":"Something exploded","type":"server_error"}}',
    );
    expect(formatAssistantErrorText(msg)).toBe("LLM error server_error: Something exploded");
  });

  it("does not expose internal JavaScript adapter errors to the operator", () => {
    const msg = makeAssistantError("Cannot read properties of undefined (reading 'some')");
    expect(formatAssistantErrorText(msg)).toBe(
      "The model provider returned a malformed response after a tool turn. " +
        "The transcript was protected for the next retry; try again or switch models if it repeats.",
    );
  });

  // GH #224 — preserve the actionable `Re-authenticate with `<command>``
  // hint that the runtime emits inside OAuth refresh errors (see
  // parseCodexRefreshError in src/agents/openai-codex-auth.ts). When the
  // hint is missing from raw, leave the formatted output alone — synthesis
  // is intentionally out of scope (team-lead spec).
  it("preserves Re-authenticate hint when present, falls back to generic when not (GH #224)", () => {
    // Case 1: raw contains the hint inline — output must still contain it.
    const withHint = makeAssistantError(
      "OAuth token refresh failed for openai-codex: Codex refresh token was already " +
        "consumed by another client. " +
        "Re-authenticate with `argent models auth login --provider openai-codex`. " +
        "Re-authentication is required.. Please try again or re-authenticate.",
    );
    const withHintResult = formatAssistantErrorText(withHint);
    expect(withHintResult).toBeTruthy();
    expect(withHintResult).toContain(
      "Re-authenticate with `argent models auth login --provider openai-codex`",
    );

    // Case 1b: raw is a JSON-wrapped API payload whose inner message
    // already contains the hint — preservation still required, defensively.
    const wrapped = makeAssistantError(
      '{"type":"error","error":{"type":"invalid_request_error",' +
        '"message":"Your authentication token has been invalidated. ' +
        'Re-authenticate with `argent models auth login --provider openai-codex`."}}',
    );
    const wrappedResult = formatAssistantErrorText(wrapped);
    expect(wrappedResult).toContain(
      "Re-authenticate with `argent models auth login --provider openai-codex`",
    );

    // Case 2: raw has no hint (different auth failure) — generic message
    // passes through unchanged; we don't fabricate a command.
    const withoutHint = makeAssistantError(
      '{"type":"error","error":{"type":"invalid_request_error",' +
        '"message":"Your authentication token has been invalidated. Please try signing in again."}}',
    );
    const withoutHintResult = formatAssistantErrorText(withoutHint);
    expect(withoutHintResult).toBeTruthy();
    expect(withoutHintResult).toContain("Your authentication token has been invalidated");
    expect(withoutHintResult).not.toContain("Re-authenticate with");
  });
});
