import { describe, expect, it } from "vitest";
import {
  parseInlineTtsDirectives,
  stripInlineTtsDirectives,
} from "../../dashboard/src/lib/inlineTtsDirectives";

describe("parseInlineTtsDirectives", () => {
  it("strips inline tts text blocks from visible chat text", () => {
    expect(parseInlineTtsDirectives("Hey, you. [[tts:text]] Hey, you.[[/tts:text]]")).toEqual({
      cleanedText: "Hey, you.",
      spokenText: "Hey, you.",
      hasDirective: true,
    });
  });

  it("removes inline tts control directives without affecting visible text", () => {
    expect(parseInlineTtsDirectives("Hello [[tts:provider=edge voice=alloy]] world")).toEqual({
      cleanedText: "Hello world",
      spokenText: null,
      hasDirective: true,
    });
  });

  it("keeps plain text untouched when there are no directives", () => {
    expect(parseInlineTtsDirectives("Just normal text")).toEqual({
      cleanedText: "Just normal text",
      spokenText: null,
      hasDirective: false,
    });
  });

  it("salvages spoken text from loose inline tts markers after brackets were stripped", () => {
    expect(
      parseInlineTtsDirectives(
        "I’m feeling close. tts:text [warm][slight pause] It felt real. /tts:text",
      ),
    ).toEqual({
      cleanedText: "I’m feeling close.",
      spokenText: "[warm][slight pause] It felt real.",
      hasDirective: true,
    });
  });
});

describe("stripInlineTtsDirectives", () => {
  it("removes stray inline tts tags", () => {
    expect(stripInlineTtsDirectives("[[tts:text]]Hello[[/tts:text]]")).toBe("");
    expect(stripInlineTtsDirectives("[[tts:provider=edge]]Hello")).toBe("Hello");
    expect(stripInlineTtsDirectives("Hello tts:text [warm] there /tts:text")).toBe("Hello");
  });
});
