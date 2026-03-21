import { describe, expect, it } from "vitest";
import type { MemoryAdapter } from "../../data/adapter.js";
import type { ExtractedFact, MemoryItem } from "../memu-types.js";
import { contentHash } from "../memu-store.js";
import { deduplicateFacts } from "./dedupe.js";

function buildItem(id: string, summary: string, memoryType: MemoryItem["memoryType"]): MemoryItem {
  return {
    id,
    resourceId: null,
    memoryType,
    summary,
    embedding: null,
    happenedAt: null,
    contentHash: contentHash(summary),
    reinforcementCount: 1,
    lastReinforcedAt: null,
    extra: {},
    emotionalValence: 0,
    emotionalArousal: 0,
    moodAtCapture: null,
    significance: "routine",
    reflection: null,
    lesson: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("deduplicateFacts", () => {
  it("collapses low-signal operational profile snapshots with changing counters", async () => {
    const existing = buildItem(
      "existing-profile",
      "Atera status snapshot: open alerts 7, queued tickets 12",
      "profile",
    );
    const reinforcements: string[] = [];
    const store = {
      findItemByHash: async () => null,
      listItems: async () => [existing],
      reinforceItem: async (id: string) => {
        reinforcements.push(id);
      },
    } as unknown as MemoryAdapter;

    const facts: ExtractedFact[] = [
      {
        memoryType: "profile",
        summary: "Atera status snapshot: open alerts 9, queued tickets 14",
        categoryNames: [],
      },
    ];

    const result = await deduplicateFacts(store, facts);
    expect(result.newFacts).toHaveLength(0);
    expect(result.reinforcedItems).toHaveLength(1);
    expect(reinforcements).toEqual(["existing-profile"]);
  });

  it("does not collapse normal profile facts that are not operational snapshots", async () => {
    const existing = buildItem("existing-profile", "Jason has two dogs.", "profile");
    const store = {
      findItemByHash: async () => null,
      listItems: async () => [existing],
      reinforceItem: async () => {},
    } as unknown as MemoryAdapter;

    const facts: ExtractedFact[] = [
      {
        memoryType: "profile",
        summary: "Jason has three dogs.",
        categoryNames: [],
      },
    ];

    const result = await deduplicateFacts(store, facts);
    expect(result.newFacts).toHaveLength(1);
    expect(result.reinforcedItems).toHaveLength(0);
  });
});
