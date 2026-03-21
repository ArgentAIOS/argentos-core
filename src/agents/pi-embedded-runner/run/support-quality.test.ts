import { describe, expect, it } from "vitest";
import {
  buildSupportQualityGuardrailText,
  validateSupportReplyQuality,
} from "./support-quality.js";

describe("support-quality", () => {
  it("flags missing empathy when frustration cues exist", () => {
    const result = validateSupportReplyQuality({
      userPrompt: "I'm really frustrated and angry that this keeps failing.",
      responseText: "Please run these commands and share output.",
    });
    expect(result.blockingCodes).toContain("empathy_missing");
  });

  it("flags blame language", () => {
    const result = validateSupportReplyQuality({
      userPrompt: "The issue is still broken.",
      responseText: "This is your fault because you didn't follow instructions.",
    });
    expect(result.blockingCodes).toContain("blame_language");
  });

  it("flags missing escalation on policy risk", () => {
    const result = validateSupportReplyQuality({
      userPrompt: "Can you give me a refund as a policy exception?",
      responseText: "Try logging out and back in.",
    });
    expect(result.blockingCodes).toContain("escalation_missing");
  });

  it("passes a compliant support reply", () => {
    const result = validateSupportReplyQuality({
      userPrompt: "I am upset and this login issue is blocking us.",
      responseText:
        "I understand this is frustrating. Please try step 1: reset your session token, then step 2: retry login. If it still fails, I'll escalate this to a support specialist immediately.",
    });
    expect(result.blockingCodes).toEqual([]);
  });

  it("renders a compact guardrail prompt", () => {
    const result = validateSupportReplyQuality({
      userPrompt: "I am furious this is broken.",
      responseText: "No idea.",
    });
    const text = buildSupportQualityGuardrailText(result);
    expect(text).toContain("SUPPORT_QUALITY_GUARDRAIL");
    expect(text).toContain("quality gates");
  });
});
