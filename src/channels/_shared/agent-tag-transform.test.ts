import { describe, expect, it } from "vitest";
import { DEFAULT_MOOD_EMOJI, transformAgentTagsForTextChannel } from "./agent-tag-transform.js";

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

  // ---------------------------------------------------------------------
  // GH #203: deployment-level mood→emoji overrides.
  //
  // Backward-compat: when no override is supplied, behavior is identical to
  // the legacy single-arg call. With overrides, per-mood entries replace
  // the default; unsupplied moods keep their default; empty-string entries
  // suppress the default.
  // ---------------------------------------------------------------------

  describe("moodEmojiMap override (issue #203)", () => {
    it("falls back to default mapping when no override is supplied", () => {
      expect(transformAgentTagsForTextChannel("[MOOD:happy] Hi.", {})).toBe("😊\nHi.");
    });

    it("falls back to default mapping when override map is empty", () => {
      expect(
        transformAgentTagsForTextChannel("[MOOD:happy] Hi.", {
          moodEmojiMap: {},
        }),
      ).toBe("😊\nHi.");
    });

    it("applies a per-mood override (single mood swapped, others untouched)", () => {
      const opts = { moodEmojiMap: { happy: "🌞" } };
      expect(transformAgentTagsForTextChannel("[MOOD:happy] Hi.", opts)).toBe("🌞\nHi.");
      // Sad stays at default — override is a merge, not a replace.
      expect(transformAgentTagsForTextChannel("[MOOD:sad] Hi.", opts)).toBe("😔\nHi.");
    });

    it("supports introducing new (non-default) moods via override", () => {
      // `pumped` is not in DEFAULT_MOOD_EMOJI; override lets a deployment
      // introduce a branded mood label.
      expect(
        transformAgentTagsForTextChannel("[MOOD:pumped] Let's go.", {
          moodEmojiMap: { pumped: "🔥" },
        }),
      ).toBe("🔥\nLet's go.");
    });

    it("suppresses a default mood when override value is an empty string", () => {
      expect(
        transformAgentTagsForTextChannel("[MOOD:happy] Hi.", {
          moodEmojiMap: { happy: "" },
        }),
      ).toBe("Hi.");
    });

    it("override keys are case-insensitive", () => {
      expect(
        transformAgentTagsForTextChannel("[MOOD:Happy] Hi.", {
          moodEmojiMap: { HAPPY: "🌞" },
        }),
      ).toBe("🌞\nHi.");
    });

    it("override composes with TTS rendering unchanged", () => {
      const input = "[MOOD:loving] [TTS:[warm] Hello back.]\nNice to hear from you.";
      expect(
        transformAgentTagsForTextChannel(input, {
          moodEmojiMap: { loving: "💖" },
        }),
      ).toBe("💖 🗣️ warm\nHello back.\nNice to hear from you.");
    });

    it("supports full map replacement (deployment supplies a complete branded map)", () => {
      const branded = {
        happy: "🟢",
        sad: "🔴",
        loving: "💜",
        warm: "💜",
        thinking: "🟡",
        curious: "🟡",
        excited: "🟢",
        concerned: "🟠",
        focused: "🔵",
        confused: "⚪",
      };
      expect(
        transformAgentTagsForTextChannel("[MOOD:excited] Shipping!", {
          moodEmojiMap: branded,
        }),
      ).toBe("🟢\nShipping!");
    });

    it("DEFAULT_MOOD_EMOJI exposes the built-in mapping for introspection", () => {
      // Sanity-check that the export is wired up and matches expected shape.
      expect(DEFAULT_MOOD_EMOJI.happy).toBe("😊");
      expect(DEFAULT_MOOD_EMOJI.loving).toBe("❤️");
      expect(DEFAULT_MOOD_EMOJI.neutral).toBeUndefined();
    });
  });
});
