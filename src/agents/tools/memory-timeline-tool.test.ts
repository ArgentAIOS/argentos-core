import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../../config/config.js";

const ITEMS = [
  {
    id: "richard-1",
    memoryType: "knowledge",
    summary: "Richard asked for more visibility into company reporting",
    significance: "important",
    createdAt: "2026-03-10T15:00:00Z",
    happenedAt: null,
    emotionalValence: 0,
  },
  {
    id: "richard-2",
    memoryType: "event",
    summary: "Dashboard for Richard went live with Atera metrics",
    significance: "important",
    createdAt: "2026-03-07T15:00:00Z",
    happenedAt: null,
    emotionalValence: 0,
  },
  {
    id: "contam-1",
    memoryType: "knowledge",
    summary: "Jason prefers direct operator approvals for maintenance windows",
    significance: "routine",
    createdAt: "2026-03-08T15:00:00Z",
    happenedAt: null,
    emotionalValence: 0,
  },
  {
    id: "profile-1",
    memoryType: "knowledge",
    summary: "Richard Avery is your business partner and co-founder on ArgentOS",
    significance: "important",
    createdAt: "2026-03-14T15:00:00Z",
    happenedAt: null,
    emotionalValence: 0,
  },
  {
    id: "profile-2",
    memoryType: "knowledge",
    summary: "Richard Avery co-runs Amp Telecom and has a deep cert footprint",
    significance: "important",
    createdAt: "2026-03-13T15:00:00Z",
    happenedAt: null,
    emotionalValence: 0,
  },
  {
    id: "old-1",
    memoryType: "knowledge",
    summary: "Richard helped pull Jason through dark places",
    significance: "core",
    createdAt: "2026-01-01T15:00:00Z",
    happenedAt: null,
    emotionalValence: 0,
  },
];

const ENTITIES = [
  { id: "ent-richard", name: "Richard" },
  { id: "ent-richard-avery", name: "Richard Avery" },
  { id: "ent-jason", name: "Jason Brashear" },
];

const ENTITY_ITEMS: Record<string, string[]> = {
  "ent-richard": ["profile-1", "profile-2", "old-1"],
  "ent-richard-avery": ["richard-1", "richard-2", "contam-1"],
  "ent-jason": ["contam-1"],
};

const ITEM_ENTITIES: Record<string, string[]> = {
  "richard-1": ["Richard"],
  "richard-2": ["Richard"],
  "contam-1": ["Richard", "Jason Brashear"],
  "profile-1": ["Richard"],
  "profile-2": ["Richard"],
  "old-1": ["Richard"],
};

const mockMemory = {
  findEntityByName: vi.fn(
    async (name: string) =>
      ENTITIES.find((entity) => entity.name.toLowerCase() === name.toLowerCase()) ?? null,
  ),
  listCategories: vi.fn(async () => []),
  getCategoryItems: vi.fn(async () => []),
  getItemCategories: vi.fn(async () => []),
  searchByVector: vi.fn(async () => []),
  reinforceItem: vi.fn(async () => {}),
  listEntities: vi.fn(async () => ENTITIES),
  getEntityItems: vi.fn(async (entityId: string) => {
    const itemIds = ENTITY_ITEMS[entityId] ?? [];
    return itemIds
      .map((id) => ITEMS.find((item) => item.id === id))
      .filter((item): item is (typeof ITEMS)[number] => Boolean(item));
  }),
  searchByKeyword: vi.fn(async () => []),
  searchKnowledgeObservations: vi.fn(async () => []),
  listItems: vi.fn(async () => ITEMS),
  getItemEntities: vi.fn(async (itemId: string) =>
    (ITEM_ENTITIES[itemId] ?? []).map((name, index) => ({
      id: `${itemId}-ent-${index}`,
      name,
    })),
  ),
};

vi.mock("../../data/storage-factory.js", () => ({
  getStorageAdapter: async () => ({
    memory: mockMemory,
  }),
}));

vi.mock("../../memory/memu-embed.js", () => ({
  getMemuEmbedder: async () => ({
    embed: async () => [0.1, 0.2, 0.3],
  }),
}));

import { createMemoryTimelineTool } from "./memory-timeline-tool.js";

type TimelineToolDetails = {
  count: number;
  days: number;
  entityInferred?: boolean;
  filters?: {
    entity?: string;
  };
  timeline?: string;
};

const defaultConfig = { agents: { list: [{ id: "main", default: true }] } } as ArgentConfig;

describe("memory timeline tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory.searchKnowledgeObservations.mockResolvedValue([]);
  });

  it("infers entity and date range from a natural-language Richard query and suppresses linked-only contamination", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T14:30:00Z"));
    try {
      const tool = createMemoryTimelineTool({
        config: defaultConfig,
      });
      if (!tool) {
        throw new Error("tool missing");
      }

      const result = await tool.execute("call_timeline_1", {
        query: "Show me memories about Richard from the past month",
      });
      const data = result.details as TimelineToolDetails;

      expect(data.count).toBe(2);
      expect(data.days).toBe(30);
      expect(data.filters?.entity).toBe("Richard");
      expect(data.entityInferred).toBe(true);
      expect(String(data.timeline)).toContain("Richard asked for more visibility");
      expect(String(data.timeline)).toContain("Dashboard for Richard went live");
      expect(String(data.timeline)).not.toContain("maintenance windows");
      expect(String(data.timeline)).not.toContain("business partner and co-founder");
      expect(String(data.timeline)).not.toContain("Amp Telecom");
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats conversational remember-about phrasing as the same Richard month timeline query", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T14:30:00Z"));
    try {
      const tool = createMemoryTimelineTool({
        config: defaultConfig,
      });
      if (!tool) {
        throw new Error("tool missing");
      }

      const result = await tool.execute("call_timeline_2", {
        query: "What do you remember about Richard from the last month?",
      });
      const data = result.details as TimelineToolDetails;

      expect(data.count).toBe(2);
      expect(data.days).toBe(30);
      expect(data.filters?.entity).toBe("Richard");
      expect(data.entityInferred).toBe(true);
      expect(String(data.timeline)).toContain("Richard asked for more visibility");
      expect(String(data.timeline)).toContain("Dashboard for Richard went live");
      expect(String(data.timeline)).not.toContain("maintenance windows");
      expect(String(data.timeline)).not.toContain("business partner and co-founder");
      expect(String(data.timeline)).not.toContain("Amp Telecom");
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds a current-state header when observation retrieval is enabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T14:30:00Z"));
    mockMemory.searchKnowledgeObservations.mockResolvedValue([
      {
        observation: {
          summary: "Richard currently prefers async project status updates",
          confidence: 0.87,
          freshness: 0.92,
        },
      },
    ]);

    try {
      const tool = createMemoryTimelineTool({
        config: {
          agents: { list: [{ id: "main", default: true }] },
          memory: {
            observations: {
              enabled: true,
              retrieval: { enabled: true },
            },
          },
        } as ArgentConfig,
      });
      if (!tool) {
        throw new Error("tool missing");
      }

      const result = await tool.execute("call_timeline_3", {
        query: "Show me memories about Richard from the past month",
      });
      const data = result.details as TimelineToolDetails;

      expect(String(data.timeline)).toContain("### Current State");
      expect(String(data.timeline)).toContain("prefers async project status updates");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to hybrid retrieval when keyword search misses a semantically relevant topic", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T14:30:00Z"));
    mockMemory.searchByKeyword.mockResolvedValueOnce([]);
    mockMemory.searchByVector.mockResolvedValueOnce([
      {
        item: ITEMS[0],
        score: 0.88,
      },
    ]);

    try {
      const tool = createMemoryTimelineTool({
        config: defaultConfig,
      });
      if (!tool) {
        throw new Error("tool missing");
      }

      const result = await tool.execute("call_timeline_4", {
        query: "Jasons, INFRA Data Rack",
        limit: 10,
        days: 365,
      });
      const data = result.details as TimelineToolDetails;

      expect(data.count).toBe(1);
      expect(String(data.timeline)).toContain("Richard asked for more visibility");
      expect(mockMemory.searchByKeyword).toHaveBeenCalledWith("Jasons, INFRA Data Rack", 120);
      expect(mockMemory.searchByVector).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not crash when query is omitted and only days/limit are provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T14:30:00Z"));

    try {
      const tool = createMemoryTimelineTool({
        config: defaultConfig,
      });
      if (!tool) {
        throw new Error("tool missing");
      }

      const result = await tool.execute("call_timeline_no_query", {
        days: 1,
        limit: 10,
      });
      const data = result.details as TimelineToolDetails;

      expect(data.count).toBeTypeOf("number");
      expect(data.days).toBe(1);
      expect(String(data.timeline ?? "")).not.toContain("undefined");
    } finally {
      vi.useRealTimers();
    }
  });
});
