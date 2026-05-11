import { describe, expect, it } from "vitest";
import { transformAgentTagsForTextChannel } from "./agent-tag-transform.js";

describe("transformAgentTagsForTextChannel", () => {
  it("renders the canonical MOOD + TTS example from issue #198", () => {
    const input =
      "[MOOD:loving] [TTS:[warm and reassuring] Yeah, I know… and I'm really glad you're back through now.]\n" +
      "Totally fair. It's been rough.";
    const expected =
      "❤️ 🗣️ warm and reassuring\n" +
      "Yeah, I know… and I'm really glad you're back through now.\n" +
      "Totally fair. It's been rough.";
    expect(transformAgentTagsForTextChannel(input)).toBe(expected);
  });

  it("renders MOOD only (no TTS)", () => {
    const input = "[MOOD:happy] Hey, found it!";
    const expected = "😊\nHey, found it!";
    expect(transformAgentTagsForTextChannel(input)).toBe(expected);
  });

  it("renders TTS only (no MOOD)", () => {
    const input = "[TTS:[focused] Pushing the patch.]\nDone.";
    const expected = "🗣️ focused\nPushing the patch.\nDone.";
    expect(transformAgentTagsForTextChannel(input)).toBe(expected);
  });

  it("is a no-op when no tags are present", () => {
    const input = "Just a plain message.\nSecond line.";
    expect(transformAgentTagsForTextChannel(input)).toBe(input);
  });

  it("skips the prefix for unknown moods (treats as neutral)", () => {
    const input = "[MOOD:bemused] Hmm.";
    expect(transformAgentTagsForTextChannel(input)).toBe("Hmm.");
  });

  it("skips the prefix for explicit neutral mood", () => {
    const input = "[MOOD:neutral] Just facts.";
    expect(transformAgentTagsForTextChannel(input)).toBe("Just facts.");
  });

  it("uses only the first MOOD tag and strips duplicates", () => {
    const input = "[MOOD:happy] [MOOD:sad] Mixed signals.";
    expect(transformAgentTagsForTextChannel(input)).toBe("😊\nMixed signals.");
  });

  it("handles TTS without a tone descriptor", () => {
    const input = "[TTS:Just say this out loud.]";
    expect(transformAgentTagsForTextChannel(input)).toBe("🗣️\nJust say this out loud.");
  });

  it("leaves a malformed MOOD tag intact rather than crashing", () => {
    const input = "[MOOD:happy Hey there";
    // Malformed: missing closing bracket. Output should be unchanged
    // (best-effort) and definitely should not throw.
    expect(transformAgentTagsForTextChannel(input)).toBe(input);
  });

  it("preserves unicode in spoken text", () => {
    const input = "[MOOD:excited] [TTS:[celebratory] 你好！ 🚀 café]";
    const expected = "🎉 🗣️ celebratory\n你好！ 🚀 café";
    expect(transformAgentTagsForTextChannel(input)).toBe(expected);
  });

  it("recognizes warm as a loving-family mood", () => {
    expect(transformAgentTagsForTextChannel("[MOOD:warm] Here for you.")).toBe("❤️\nHere for you.");
  });

  it("returns the input unchanged when given an empty string", () => {
    expect(transformAgentTagsForTextChannel("")).toBe("");
  });

  it("renders MOOD + TTS without descriptor", () => {
    const input = "[MOOD:focused] [TTS:On it now.]\nWorking on the patch.";
    const expected = "🎯 🗣️\nOn it now.\nWorking on the patch.";
    expect(transformAgentTagsForTextChannel(input)).toBe(expected);
  });

  it("recognizes TTS_NOW: variant", () => {
    const input = "[MOOD:happy] [TTS_NOW:On it.]\nDone.";
    const expected = "😊 🗣️\nOn it.\nDone.";
    expect(transformAgentTagsForTextChannel(input)).toBe(expected);
  });

  it("preserves indentation in body lines after the first", () => {
    const input = "[MOOD:happy] Here are the items:\n- one\n   - nested\n- two";
    const expected = "😊\nHere are the items:\n- one\n   - nested\n- two";
    expect(transformAgentTagsForTextChannel(input)).toBe(expected);
  });

  it("does not crash on null-ish input shapes", () => {
    // The function expects string but should still degrade for empty.
    expect(transformAgentTagsForTextChannel("")).toBe("");
  });
});
