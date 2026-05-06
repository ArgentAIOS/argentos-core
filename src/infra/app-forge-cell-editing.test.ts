import { describe, expect, it } from "vitest";
import {
  isValidUrlInput,
  parseMultiSelectValue,
  serializeMultiSelectValue,
} from "./app-forge-cell-editing.js";

describe("app-forge cell editing — multi-select helpers", () => {
  it("parses comma- and newline-separated input into a deduped trimmed list", () => {
    expect(parseMultiSelectValue("VIP, Investor\nVIP, Partner ")).toEqual([
      "VIP",
      "Investor",
      "Partner",
    ]);
  });

  it("returns an empty array for empty or whitespace input", () => {
    expect(parseMultiSelectValue("")).toEqual([]);
    expect(parseMultiSelectValue("   ")).toEqual([]);
  });

  it("serializes a list of selected labels with comma separators and dedupes", () => {
    expect(serializeMultiSelectValue(["A", "B", "A", ""])).toBe("A, B");
  });

  it("round-trips parse/serialize idempotently", () => {
    const initial = "Strategic, Quick win, Renewal";
    const round = serializeMultiSelectValue(parseMultiSelectValue(initial));
    expect(round).toBe(initial);
  });
});

describe("app-forge cell editing — URL validation", () => {
  it("treats empty input as valid (clears the cell)", () => {
    expect(isValidUrlInput("")).toBe(true);
    expect(isValidUrlInput("   ")).toBe(true);
  });

  it("accepts well-formed URLs", () => {
    expect(isValidUrlInput("https://example.com")).toBe(true);
    expect(isValidUrlInput("http://localhost:8092/path?x=1")).toBe(true);
    expect(isValidUrlInput("mailto:test@example.com")).toBe(true);
  });

  it("rejects malformed URL input", () => {
    expect(isValidUrlInput("not a url")).toBe(false);
    expect(isValidUrlInput("just-a-bare-word")).toBe(false);
  });
});
