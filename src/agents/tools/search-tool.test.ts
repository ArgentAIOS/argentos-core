import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isStrictPostgresOnly: vi.fn(),
  resolveRuntimeStorageConfig: vi.fn(() => ({ backend: "postgres" })),
  getDataAPI: vi.fn(),
  getStorageAdapter: vi.fn(),
}));

vi.mock("../../data/storage-config.js", () => ({
  isStrictPostgresOnly: (...args: unknown[]) => mocks.isStrictPostgresOnly(...args),
}));

vi.mock("../../data/storage-resolver.js", () => ({
  resolveRuntimeStorageConfig: (...args: unknown[]) => mocks.resolveRuntimeStorageConfig(...args),
}));

vi.mock("../../data/index.js", () => ({
  getDataAPI: (...args: unknown[]) => mocks.getDataAPI(...args),
}));

vi.mock("../../data/storage-factory.js", () => ({
  getStorageAdapter: (...args: unknown[]) => mocks.getStorageAdapter(...args),
}));

import { createSearchTool } from "./search-tool.js";

describe("argent_search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isStrictPostgresOnly.mockReturnValue(false);
    mocks.getDataAPI.mockResolvedValue({
      unifiedSearch: vi.fn(async () => []),
    });
    mocks.getStorageAdapter.mockResolvedValue({
      tasks: { list: vi.fn(async () => []) },
      memory: { searchByKeyword: vi.fn(async () => []) },
    });
  });

  it("uses PostgreSQL storage search instead of disabling the tool in strict mode", async () => {
    mocks.isStrictPostgresOnly.mockReturnValue(true);
    mocks.getStorageAdapter.mockResolvedValue({
      tasks: {
        list: vi.fn(async () => [
          {
            id: "task-1",
            title: "Repair dashboard handshake",
            description: "Fix gateway-client connect params",
            status: "pending",
            priority: "high",
            source: "agent",
            createdAt: 1777310000000,
            updatedAt: 1777310000000,
            tags: ["gateway"],
          },
        ]),
      },
      memory: {
        searchByKeyword: vi.fn(async () => [
          {
            item: {
              id: "mem-1",
              memoryType: "event",
              summary: "Dashboard handshake failed on Richard's dev rail",
              reflection: null,
              lesson: null,
              createdAt: "2026-04-27T18:00:00.000Z",
            },
            score: 0.8,
          },
        ]),
      },
    });

    const tool = createSearchTool({ agentId: "sapphire" });
    const result = await tool.execute("call-search", { query: "dashboard", limit: 5 });
    const text = String(result.content?.[0]?.text ?? "");

    expect(text).toContain('Found 2 result(s) for "dashboard"');
    expect(text).toContain("Repair dashboard handshake");
    expect(text).toContain("Dashboard handshake failed");
    expect(text).not.toContain("temporarily unavailable");
    expect(mocks.getDataAPI).not.toHaveBeenCalled();
  });
});
