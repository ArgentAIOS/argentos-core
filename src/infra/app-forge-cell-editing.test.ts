import { describe, expect, it } from "vitest";
import {
  isValidEmailInput,
  isValidNumberInput,
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

describe("app-forge cell editing — number validation", () => {
  it("treats empty input as valid (clears the cell)", () => {
    expect(isValidNumberInput("")).toBe(true);
    expect(isValidNumberInput("   ")).toBe(true);
  });

  it("accepts numeric input including signed, decimal, and exponent forms", () => {
    expect(isValidNumberInput("0")).toBe(true);
    expect(isValidNumberInput("42")).toBe(true);
    expect(isValidNumberInput("-3.14")).toBe(true);
    expect(isValidNumberInput("1e3")).toBe(true);
    expect(isValidNumberInput("  7 ")).toBe(true);
  });

  it("rejects non-numeric and ambiguous input", () => {
    expect(isValidNumberInput("abc")).toBe(false);
    expect(isValidNumberInput("12 dogs")).toBe(false);
    expect(isValidNumberInput("1.2.3")).toBe(false);
    expect(isValidNumberInput("Infinity")).toBe(false);
    expect(isValidNumberInput("NaN")).toBe(false);
  });
});

describe("app-forge cell editing — email validation", () => {
  it("treats empty input as valid (clears the cell)", () => {
    expect(isValidEmailInput("")).toBe(true);
    expect(isValidEmailInput("   ")).toBe(true);
  });

  it("accepts well-formed addresses", () => {
    expect(isValidEmailInput("ada@example.com")).toBe(true);
    expect(isValidEmailInput("ada+tag@example.co")).toBe(true);
    expect(isValidEmailInput(" ada@example.com ")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmailInput("ada")).toBe(false);
    expect(isValidEmailInput("ada@")).toBe(false);
    expect(isValidEmailInput("ada@localhost")).toBe(false);
    expect(isValidEmailInput("ada @example.com")).toBe(false);
  });
});
