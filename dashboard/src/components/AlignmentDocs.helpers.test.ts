/**
 * AlignmentDocs helper tests.
 *
 * Regression guards for the
 *   `TypeError: undefined is not an object (evaluating 'be.agents.length')`
 * crash that hit Settings → Alignment in dev.17 when
 * `/api/settings/alignment` returned a 401 with `{error: "..."}` and the
 * component blindly stored the body as state.
 *
 * The dashboard test suite uses vitest with no jsdom — these are pure,
 * deterministic helper tests that match the existing pattern used by
 * `composioSettings.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { normalizeAlignmentState } from "./AlignmentDocs.helpers";

describe("normalizeAlignmentState", () => {
  it("returns null for non-object payloads (string body, etc.)", () => {
    expect(normalizeAlignmentState(undefined)).toBeNull();
    expect(normalizeAlignmentState(null)).toBeNull();
    expect(normalizeAlignmentState("not json at all")).toBeNull();
    expect(normalizeAlignmentState(42)).toBeNull();
    expect(normalizeAlignmentState([])).toBeNull();
  });

  it("returns null for pure error envelopes (the 401 case)", () => {
    // Real-world shape that triggered the production crash.
    expect(normalizeAlignmentState({ error: "Unauthorized" })).toBeNull();
    expect(normalizeAlignmentState({ error: "Failed to list agents" })).toBeNull();
  });

  it("defaults missing agents/docs fields to empty arrays", () => {
    expect(normalizeAlignmentState({})).toEqual({ agents: [], docs: [] });
    expect(normalizeAlignmentState({ agents: [] })).toEqual({ agents: [], docs: [] });
    expect(normalizeAlignmentState({ docs: [] })).toEqual({ agents: [], docs: [] });
  });

  it("coerces non-array agents/docs to empty arrays without crashing", () => {
    expect(normalizeAlignmentState({ agents: "nope", docs: { not: "an array" } })).toEqual({
      agents: [],
      docs: [],
    });
  });

  it("preserves valid agents and falls back label to id", () => {
    const result = normalizeAlignmentState({
      agents: [
        { id: "__main__", label: "Argent" },
        { id: "namedAgent" }, // no label — should fall back to id
      ],
      docs: [],
    });
    expect(result).toEqual({
      agents: [
        { id: "__main__", label: "Argent" },
        { id: "namedAgent", label: "namedAgent" },
      ],
      docs: [],
    });
  });

  it("filters out malformed agent entries (missing id, wrong types)", () => {
    const result = normalizeAlignmentState({
      agents: [{ id: "ok", label: "OK" }, { id: "" }, { label: "no-id" }, null, "string-entry", 42],
      docs: [],
    });
    expect(result).toEqual({
      agents: [{ id: "ok", label: "OK" }],
      docs: [],
    });
  });

  it("preserves valid docs and defaults missing label/description", () => {
    const result = normalizeAlignmentState({
      agents: [],
      docs: [
        { file: "SOUL.md", label: "Soul", description: "core values" },
        { file: "IDENTITY.md" },
      ],
    });
    expect(result).toEqual({
      agents: [],
      docs: [
        { file: "SOUL.md", label: "Soul", description: "core values" },
        { file: "IDENTITY.md", label: "IDENTITY.md", description: "" },
      ],
    });
  });

  it("the renormalized state is always safe to read .length / .map / .find on", () => {
    // This is the contract the React component depends on. If this ever
    // regresses, the Alignment panel will start crashing again.
    const cases: unknown[] = [
      undefined,
      { error: "Unauthorized" },
      {},
      { agents: null, docs: null },
      { agents: [{ id: "x", label: "X" }], docs: [{ file: "SOUL.md" }] },
    ];
    for (const data of cases) {
      const normalized = normalizeAlignmentState(data);
      const agents = normalized?.agents ?? [];
      const docs = normalized?.docs ?? [];
      // None of these should throw — that's the whole point.
      expect(typeof agents.length).toBe("number");
      expect(typeof docs.length).toBe("number");
      expect(() => agents.map((a) => a.id)).not.toThrow();
      expect(() => docs.find((d) => d.file === "SOUL.md")).not.toThrow();
    }
  });
});
