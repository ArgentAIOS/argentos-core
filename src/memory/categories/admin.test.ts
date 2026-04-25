import { describe, expect, it, vi } from "vitest";
import type { MemoryAdapter } from "../../data/adapter.js";
import type { MemoryCategory, MemoryItem } from "../memu-types.js";
import {
  listMemoryCategoriesWithCounts,
  mergeMemoryCategories,
  planMemoryCategoryCleanup,
  renameMemoryCategory,
} from "./admin.js";

function category(id: string, name: string): MemoryCategory {
  return {
    id,
    name,
    description: null,
    summary: null,
    embedding: null,
    createdAt: "2026-04-25T00:00:00.000Z",
    updatedAt: "2026-04-25T00:00:00.000Z",
  };
}

function item(id: string): MemoryItem {
  return {
    id,
    resourceId: "r1",
    memoryType: "knowledge",
    summary: id,
    contentHash: id,
    embedding: null,
    emotionalValence: 0,
    emotionalArousal: 0,
    moodAtCapture: null,
    significance: "routine",
    reflection: null,
    lesson: null,
    reinforcementCount: 0,
    lastReinforcedAt: null,
    happenedAt: null,
    createdAt: "2026-04-25T00:00:00.000Z",
    updatedAt: "2026-04-25T00:00:00.000Z",
    extra: {},
  };
}

function items(prefix: string, count: number): MemoryItem[] {
  return Array.from({ length: count }, (_entry, index) => item(`${prefix}-${index}`));
}

function makeMemory() {
  const categories = new Map<string, MemoryCategory>([
    ["clean", category("clean", "11 Labs V3")],
    ["variant", category("variant", "11 Labs V3 2026 2026")],
    ["empty", category("empty", "Empty Shell")],
    ["other", category("other", "Deployment Notes")],
  ]);
  const categoryItems = new Map<string, MemoryItem[]>([
    ["clean", [item("a"), item("b")]],
    ["variant", [item("c")]],
    ["empty", []],
    ["other", [item("d"), item("e"), item("f")]],
  ]);
  const linked: Array<[string, string]> = [];
  const memory = {
    listCategories: vi.fn(async () => Array.from(categories.values())),
    getCategory: vi.fn(async (id: string) => categories.get(id) ?? null),
    getCategoryByName: vi.fn(async (name: string) => {
      return Array.from(categories.values()).find((entry) => entry.name === name) ?? null;
    }),
    getCategoryItemCount: vi.fn(async (id: string) => categoryItems.get(id)?.length ?? 0),
    getCategoryItems: vi.fn(async (id: string) => categoryItems.get(id) ?? []),
    linkItemToCategory: vi.fn(async (itemId: string, categoryId: string) => {
      linked.push([itemId, categoryId]);
    }),
    deleteCategory: vi.fn(async (id: string) => {
      categories.delete(id);
      categoryItems.delete(id);
    }),
    updateCategoryName: vi.fn(async (id: string, name: string) => {
      const existing = categories.get(id);
      if (!existing) {
        return null;
      }
      const updated = { ...existing, name };
      categories.set(id, updated);
      return updated;
    }),
  } as unknown as MemoryAdapter;
  return { memory, linked };
}

describe("memory category admin", () => {
  it("filters and sorts categories by item count", async () => {
    const { memory } = makeMemory();
    const rows = await listMemoryCategoriesWithCounts(memory, {
      minItems: 1,
      sort: "itemCount",
      sortDirection: "asc",
      limit: 2,
    });

    expect(rows.map((row) => row.name)).toEqual(["11 Labs V3 2026 2026", "11 Labs V3"]);
  });

  it("renames a category without touching links", async () => {
    const { memory } = makeMemory();
    const updated = await renameMemoryCategory({
      memory,
      categoryId: "clean",
      newName: "ElevenLabs V3",
    });

    expect(updated.name).toBe("ElevenLabs V3");
    expect(memory.updateCategoryName).toHaveBeenCalledWith("clean", "ElevenLabs V3");
  });

  it("merges source category items into target and deletes the source", async () => {
    const { memory, linked } = makeMemory();
    const result = await mergeMemoryCategories({
      memory,
      sourceCategoryIds: ["variant"],
      targetCategoryId: "clean",
    });

    expect(result.totalLinkedItems).toBe(1);
    expect(linked).toEqual([["c", "clean"]]);
    expect(memory.deleteCategory).toHaveBeenCalledWith("variant");
  });

  it("plans empty deletion and clean-name subset merges", async () => {
    const { memory } = makeMemory();
    const plan = await planMemoryCategoryCleanup(memory, {
      dryRun: true,
      similarityThreshold: 0.8,
    });

    expect(plan.emptyCategories.map((entry) => entry.id)).toEqual(["empty"]);
    expect(plan.merges).toContainEqual(
      expect.objectContaining({
        sourceCategoryId: "variant",
        targetCategoryId: "clean",
        reason: "subset",
      }),
    );
  });

  it("does not auto-merge established keeper categories into broader parents", async () => {
    const categories = new Map<string, MemoryCategory>([
      ["base", category("base", "11 Labs V3")],
      ["audio", category("audio", "11 Labs V3 Audio Tags")],
      ["voice", category("voice", "11 Labs V3 Voice Model")],
      ["spelling", category("spelling", "11labs V3")],
      ["year", category("year", "2026 11labs 3")],
      [
        "junk",
        category("junk", "11 Labs V3 2026 2026 A2a Automated Alerting Audio Tags Voice Model"),
      ],
    ]);
    const categoryItems = new Map<string, MemoryItem[]>([
      ["base", items("base", 176)],
      ["audio", items("audio", 44)],
      ["voice", items("voice", 70)],
      ["spelling", items("spelling", 23)],
      ["year", items("year", 10)],
      ["junk", items("junk", 1)],
    ]);
    const memory = {
      listCategories: vi.fn(async () => Array.from(categories.values())),
      getCategoryItemCount: vi.fn(async (id: string) => categoryItems.get(id)?.length ?? 0),
    } as unknown as MemoryAdapter;

    const plan = await planMemoryCategoryCleanup(memory, { dryRun: true });

    expect(plan.merges.map((merge) => merge.sourceCategoryId)).toEqual(["junk"]);
    expect(plan.merges[0]).toEqual(
      expect.objectContaining({
        targetCategoryId: "base",
        reason: "subset",
      }),
    );
  });
});
