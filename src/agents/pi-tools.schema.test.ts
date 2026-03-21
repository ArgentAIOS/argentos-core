import { describe, expect, it } from "vitest";
import { normalizeToolParameters } from "./pi-tools.schema.js";

describe("normalizeToolParameters strict validation", () => {
  it("throws with tool index/name when schema is invalid in strict mode", () => {
    const invalidTool = {
      name: "bad_tool",
      description: "bad schema",
      parameters: { type: 42 },
      call: async () => ({ content: [] }),
    } as any;

    expect(() => normalizeToolParameters(invalidTool, { strict: true, toolIndex: 57 })).toThrow(
      /tools\.57\.bad_tool\.input_schema/,
    );
  });

  it("falls back to empty object schema when strict mode is off", () => {
    const invalidTool = {
      name: "bad_tool",
      description: "bad schema",
      parameters: { type: 42 },
      call: async () => ({ content: [] }),
    } as any;

    const normalized = normalizeToolParameters(invalidTool);
    expect((normalized.parameters as any).type).toBe("object");
  });
});
