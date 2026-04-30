import { describe, expect, it } from "vitest";
import { resolveTranscriptPolicy } from "./transcript-policy.js";

describe("resolveTranscriptPolicy", () => {
  it("repairs OpenAI Responses tool result pairing without synthetic guard output", () => {
    const policy = resolveTranscriptPolicy({
      modelApi: "openai-responses",
      provider: "openai",
      modelId: "gpt-5.4-mini",
    });

    expect(policy.repairToolUseResultPairing).toBe(true);
    expect(policy.allowSyntheticToolResults).toBe(false);
    expect(policy.sanitizeMode).toBe("images-only");
  });
});
