import { describe, expect, it } from "vitest";
import {
  CATEGORY_SUMMARY_WITH_REFS_PROMPT,
  buildCategorySummaryPrompt,
  buildCategorySummaryWithRefsPrompt,
  deriveItemRefId,
} from "./prompts.js";
import {
  extractCategorySummaryRefs,
  sanitizeCategorySummary,
  stripCategorySummaryRefs,
} from "./sanitize.js";

describe("buildCategorySummaryPrompt (baseline)", () => {
  it("does NOT emit [ref:...] tokens — existing call sites stay byte-for-byte unchanged", () => {
    const out = buildCategorySummaryPrompt({
      name: "Preferences",
      description: "User preferences",
      itemSummaries: ["Prefers dark mode", "Lives in Texas"],
    });
    expect(out).not.toMatch(/\[ref:/);
    expect(out).toContain("1. Prefers dark mode");
    expect(out).toContain("2. Lives in Texas");
  });
});

describe("buildCategorySummaryWithRefsPrompt", () => {
  it("uses the with-refs template (not the baseline one)", () => {
    const out = buildCategorySummaryWithRefsPrompt({
      name: "Preferences",
      description: null,
      items: [{ id: "abcdefgh-1111-2222-3333-444444444444", summary: "x" }],
    });
    // The two prompts diverge in the items header — assert on with-refs marker.
    expect(out).toContain("each followed by an inline [ref:<id>] token");
    expect(out).toContain("[ref:");
    // Description fallback is the same as the baseline template.
    expect(out).toContain("Current description: (none)");
    // Sanity: the with-refs constant is what got rendered.
    expect(CATEGORY_SUMMARY_WITH_REFS_PROMPT).toContain(
      "each followed by an inline [ref:<id>] token",
    );
  });

  it("attaches a [ref:<id>] token to every item summary line", () => {
    const items = [
      { id: "11111111-aaaa-bbbb-cccc-000000000001", summary: "Prefers dark mode" },
      {
        id: "22222222-aaaa-bbbb-cccc-000000000002",
        summary: "Drinks coffee black",
        contentHash: "deadbeef".repeat(8), // 64-char hex
      },
      { id: "33333333-aaaa-bbbb-cccc-000000000003", summary: "Lives in Texas" },
    ];

    const prompt = buildCategorySummaryWithRefsPrompt({
      name: "Preferences",
      description: "User preferences",
      items,
    });

    // One ref token per item, in order, appended to the numbered line.
    const ref1 = deriveItemRefId(items[0]);
    const ref2 = deriveItemRefId(items[1]);
    const ref3 = deriveItemRefId(items[2]);

    expect(prompt).toContain(`1. Prefers dark mode [ref:${ref1}]`);
    expect(prompt).toContain(`2. Drinks coffee black [ref:${ref2}]`);
    expect(prompt).toContain(`3. Lives in Texas [ref:${ref3}]`);

    // contentHash-derived id is the hash-prefix slice (7 chars).
    expect(ref2).toBe("deadbee");
    // id-derived ids strip dashes and take 8 chars.
    expect(ref1).toBe("11111111");
    expect(ref3).toBe("33333333");

    // Every item is represented exactly once with a [ref:...] token.
    const matches = prompt.match(/\[ref:[A-Za-z0-9_-]+\]/g) ?? [];
    expect(matches).toHaveLength(items.length);
  });

  it("collapses multi-line item summaries so the [ref:...] token always lives at the end of the line", () => {
    const out = buildCategorySummaryWithRefsPrompt({
      name: "Notes",
      description: null,
      items: [
        {
          id: "abcd1234-aaaa-bbbb-cccc-dddddddddddd",
          summary: "Line one\n  with continuation\nand more",
        },
      ],
    });
    expect(out).toMatch(/1\. Line one with continuation and more \[ref:[A-Za-z0-9_-]+\]/);
  });
});

describe("deriveItemRefId", () => {
  it("prefers a 7-char prefix of the SHA-256 content hash when present", () => {
    expect(
      deriveItemRefId({
        id: "irrelevant",
        contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      }),
    ).toBe("0123456");
  });

  it("falls back to the first 8 chars of the id (dashes stripped) when no hash is present", () => {
    expect(deriveItemRefId({ id: "abcd1234-aaaa-bbbb-cccc-ddddddddeeee" })).toBe("abcd1234");
    expect(deriveItemRefId({ id: "abcd1234-aaaa-bbbb-cccc-ddddddddeeee", contentHash: null })).toBe(
      "abcd1234",
    );
  });

  it("falls back to the id when the contentHash is too short or non-hex", () => {
    expect(deriveItemRefId({ id: "abcd1234-xxxx", contentHash: "nope" })).toBe("abcd1234");
  });
});

describe("sanitize / ref-token interop", () => {
  it("sanitizeCategorySummary preserves [ref:...] tokens verbatim", () => {
    const input = "  The user prefers dark mode [ref:abc1234] and lives in Texas [ref:deadbee].  ";
    const out = sanitizeCategorySummary(input);
    expect(out).toBe("The user prefers dark mode [ref:abc1234] and lives in Texas [ref:deadbee].");
  });

  it("META_SUMMARY_PATTERNS do not match inside a [ref:...] token", () => {
    // The patterns include things like /\blet me\b/i; "letme" inside a ref id
    // (no word break) must NOT cause the sanitizer to drop a valid summary.
    const out = sanitizeCategorySummary("Contains user preferences [ref:letme123].");
    expect(out).toBe("Contains user preferences [ref:letme123].");
  });

  it("sanitizeCategorySummary still rejects meta-reasoning even when refs are present", () => {
    expect(sanitizeCategorySummary("Let me think about [ref:abc1234] dark mode.")).toBeNull();
  });

  it("stripCategorySummaryRefs removes tokens and tidies punctuation (round-trip with the builder)", () => {
    const items = [
      { id: "11111111-aaaa-bbbb-cccc-000000000001", summary: "Prefers dark mode" },
      { id: "22222222-aaaa-bbbb-cccc-000000000002", summary: "Lives in Texas" },
    ];
    const ref1 = deriveItemRefId(items[0]);
    const ref2 = deriveItemRefId(items[1]);

    const llmOutput = `The user prefers dark mode [ref:${ref1}] and lives in Texas [ref:${ref2}].`;
    const sanitized = sanitizeCategorySummary(llmOutput);
    expect(sanitized).toBe(llmOutput);

    const plain = stripCategorySummaryRefs(sanitized ?? "");
    expect(plain).toBe("The user prefers dark mode and lives in Texas.");
  });

  it("stripCategorySummaryRefs handles empty + token-only input safely", () => {
    expect(stripCategorySummaryRefs("")).toBe("");
    expect(stripCategorySummaryRefs("[ref:abc1234]")).toBe("");
    expect(stripCategorySummaryRefs("[ref:abc1234]   [ref:def5678]  ")).toBe("");
  });

  it("extractCategorySummaryRefs returns refs in first-seen order, deduplicated", () => {
    const text =
      "Likes dark mode [ref:abc1234], lives in Texas [ref:deadbee]; reaffirms dark mode [ref:abc1234].";
    expect(extractCategorySummaryRefs(text)).toEqual(["abc1234", "deadbee"]);
  });

  it("extractCategorySummaryRefs returns [] for input with no tokens", () => {
    expect(extractCategorySummaryRefs("plain summary")).toEqual([]);
    expect(extractCategorySummaryRefs("")).toEqual([]);
  });
});
