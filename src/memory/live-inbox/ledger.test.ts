import { describe, expect, it, vi } from "vitest";
import { buildLiveInboxLedger } from "./ledger.js";

describe("buildLiveInboxLedger", () => {
  it("returns null when store has no relevant data", () => {
    const mockStore = {
      listLiveCandidates: vi.fn().mockReturnValue([]),
      listItems: vi.fn().mockReturnValue([]),
    } as any;

    const result = buildLiveInboxLedger({ store: mockStore });
    expect(result).toBeNull();
  });

  it("includes recently promoted candidates", () => {
    const now = new Date().toISOString();
    const mockStore = {
      listLiveCandidates: vi.fn().mockReturnValue([
        {
          id: "cand-1",
          candidateType: "preference",
          factText: "I prefer dark mode in my editor",
          status: "promoted",
          updatedAt: now,
          createdAt: now,
        },
        {
          id: "cand-2",
          candidateType: "directive",
          factText: "Always run tests before committing",
          status: "promoted",
          updatedAt: now,
          createdAt: now,
        },
      ]),
      listItems: vi.fn().mockReturnValue([]),
    } as any;

    const result = buildLiveInboxLedger({ store: mockStore });
    expect(result).not.toBeNull();
    expect(result).toContain("Recently Captured Truths");
    expect(result).toContain("dark mode");
    expect(result).toContain("preference");
  });

  it("includes high-significance memories", () => {
    const mockStore = {
      listLiveCandidates: vi.fn().mockReturnValue([]),
      listItems: vi.fn().mockImplementation((opts: any) => {
        if (opts?.significance === "core") {
          return [
            {
              id: "item-1",
              memoryType: "self",
              summary: "My name is Argent",
              significance: "core",
              createdAt: new Date().toISOString(),
            },
          ];
        }
        return [];
      }),
    } as any;

    const result = buildLiveInboxLedger({ store: mockStore });
    expect(result).not.toBeNull();
    expect(result).toContain("Core Knowledge");
    expect(result).toContain("My name is Argent");
    expect(result).toContain("CORE");
  });

  it("respects maxItems limit", () => {
    const now = new Date().toISOString();
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      id: `cand-${i}`,
      candidateType: "preference",
      factText: `Preference item ${i}`,
      status: "promoted",
      updatedAt: now,
      createdAt: now,
    }));

    const mockStore = {
      listLiveCandidates: vi.fn().mockReturnValue(candidates),
      listItems: vi.fn().mockReturnValue([]),
    } as any;

    const result = buildLiveInboxLedger({ store: mockStore, maxItems: 10 });
    expect(result).not.toBeNull();
    // Should cap at maxItems/2 = 5 promoted candidates
    const prefLines = result!.split("\n").filter((l) => l.includes("Preference item"));
    expect(prefLines.length).toBeLessThanOrEqual(5);
  });

  it("filters out old promoted candidates (>7 days)", () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const mockStore = {
      listLiveCandidates: vi.fn().mockReturnValue([
        {
          id: "cand-old",
          candidateType: "preference",
          factText: "Old preference that should be excluded",
          status: "promoted",
          updatedAt: oldDate,
          createdAt: oldDate,
        },
      ]),
      listItems: vi.fn().mockReturnValue([]),
    } as any;

    const result = buildLiveInboxLedger({ store: mockStore });
    // Should be null since only old candidates exist
    expect(result).toBeNull();
  });

  it("includes Live Inbox Ledger header", () => {
    const now = new Date().toISOString();
    const mockStore = {
      listLiveCandidates: vi.fn().mockReturnValue([
        {
          id: "cand-1",
          candidateType: "directive",
          factText: "Always use TypeScript",
          status: "promoted",
          updatedAt: now,
          createdAt: now,
        },
      ]),
      listItems: vi.fn().mockReturnValue([]),
    } as any;

    const result = buildLiveInboxLedger({ store: mockStore });
    expect(result).toContain("# Live Inbox Ledger");
    expect(result).toContain("memory_recall");
  });
});
