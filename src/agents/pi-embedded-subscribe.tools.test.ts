import { describe, expect, it } from "vitest";
import { sanitizeToolResult } from "./pi-embedded-subscribe.tools.js";

describe("sanitizeToolResult", () => {
  it("synthesizes a text block when content is missing", () => {
    const sanitized = sanitizeToolResult({
      details: { status: "completed" },
    }) as { content?: unknown[] };

    expect(sanitized.content).toEqual([{ type: "text", text: "(no output)" }]);
  });

  it("synthesizes a text block when content is an empty array", () => {
    const sanitized = sanitizeToolResult({
      content: [],
      details: { status: "completed" },
    }) as { content?: unknown[] };

    expect(sanitized.content).toEqual([{ type: "text", text: "(no output)" }]);
  });
});
