import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { __testing, categorizeFacts } from "./categorize.js";

function createStubStore(resourceUrl: string) {
  return {
    getResource: async () => ({
      id: "resource-1",
      url: resourceUrl,
      modality: "text",
      localPath: null,
      caption: null,
      embedding: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    listCategories: async () => [],
    createItem: async (input: any) => ({
      id: crypto.randomUUID(),
      resourceId: input.resourceId,
      memoryType: input.memoryType,
      summary: input.summary,
      embedding: null,
      happenedAt: input.happenedAt ?? null,
      contentHash: null,
      reinforcementCount: 1,
      lastReinforcedAt: null,
      extra: {},
      emotionalValence: 0,
      emotionalArousal: 0,
      moodAtCapture: null,
      significance: input.significance,
      reflection: null,
      lesson: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    getOrCreateCategory: async (name: string) => ({
      id: name,
      name,
      description: null,
      embedding: null,
      summary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    linkItemToCategory: async () => {},
    getCategoryByName: async (name: string) => ({
      id: name,
      name,
      description: null,
      embedding: null,
      summary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    updateItemEmbedding: async () => {},
  };
}

describe("categorizeFacts significance inference", () => {
  it("keeps operational event extraction routine", async () => {
    const store = createStubStore("heartbeat://2026-03-12T00:00:00.000Z");
    const result = await categorizeFacts({
      store: store as any,
      embedder: null,
      resourceId: "resource-1",
      facts: [
        { memoryType: "event", summary: "Heartbeat ran and sent a response.", categoryNames: [] },
      ],
    });

    expect(result.items[0]?.significance).toBe("routine");
  });

  it("promotes operational knowledge extraction to noteworthy", async () => {
    const store = createStubStore("cron://daily-report/2026-03-12T00:00:00.000Z");
    const result = await categorizeFacts({
      store: store as any,
      embedder: null,
      resourceId: "resource-1",
      facts: [
        {
          memoryType: "knowledge",
          summary: "Daily report captured a recurring customer incident trend.",
          categoryNames: [],
        },
      ],
    });

    expect(result.items[0]?.significance).toBe("noteworthy");
  });

  it("marks non-operational profile knowledge as noteworthy by default", async () => {
    const store = createStubStore("session://chat/abc123");
    const result = await categorizeFacts({
      store: store as any,
      embedder: null,
      resourceId: "resource-1",
      facts: [
        {
          memoryType: "profile",
          summary: "Jason prefers operator-visible status before any risky change.",
          categoryNames: [],
        },
      ],
    });

    expect(result.items[0]?.significance).toBe("noteworthy");
  });

  it("promotes high-signal decisions to important", async () => {
    const store = createStubStore("session://chat/abc123");
    const result = await categorizeFacts({
      store: store as any,
      embedder: null,
      resourceId: "resource-1",
      facts: [
        {
          memoryType: "knowledge",
          summary: "The operator approved the production cutover decision after the outage review.",
          categoryNames: [],
        },
      ],
    });

    expect(result.items[0]?.significance).toBe("important");
  });
});

describe("category normalization", () => {
  it("collapses obvious operational synonyms", () => {
    expect(__testing.normalizeExtractedCategoryName("cron jobs")).toBe("Automated Scheduling");
    expect(__testing.normalizeExtractedCategoryName("automation")).toBe("Automated Operations");
    expect(__testing.normalizeExtractedCategoryName("heartbeat")).toBe("Monitoring");
    expect(__testing.normalizeExtractedCategoryName("Atera Integration")).toBe("Atera");
  });

  it("drops low-value temporal categories", () => {
    expect(__testing.normalizeExtractedCategoryName("2026")).toBeNull();
  });

  it("title-cases normal categories", () => {
    expect(__testing.normalizeExtractedCategoryName("customer support")).toBe("Customer Support");
  });
});
