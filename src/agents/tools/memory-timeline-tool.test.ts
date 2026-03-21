import { beforeEach, describe, expect, it, vi } from "vitest";

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
  listEntities: vi.fn(async () => ENTITIES),
  getEntityItems: vi.fn(async (entityId: string) => {
    const itemIds = ENTITY_ITEMS[entityId] ?? [];
    return itemIds
      .map((id) => ITEMS.find((item) => item.id === id))
      .filter((item): item is (typeof ITEMS)[number] => Boolean(item));
  }),
  searchByKeyword: vi.fn(async () => []),
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

import { createMemoryTimelineTool } from "./memory-timeline-tool.js";

describe("memory timeline tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("infers entity and date range from a natural-language Richard query and suppresses linked-only contamination", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T14:30:00Z"));
    try {
      const tool = createMemoryTimelineTool({
        config: { agents: { list: [{ id: "main", default: true }] } } as any,
      });
      if (!tool) throw new Error("tool missing");

      const result = await tool.execute("call_timeline_1", {
        query: "Show me memories about Richard from the past month",
      });
      const data = result.details as any;

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
        config: { agents: { list: [{ id: "main", default: true }] } } as any,
      });
      if (!tool) throw new Error("tool missing");

      const result = await tool.execute("call_timeline_2", {
        query: "What do you remember about Richard from the last month?",
      });
      const data = result.details as any;

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
});
