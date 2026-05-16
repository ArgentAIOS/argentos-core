import { describe, expect, it } from "vitest";
import type { ForgeStructuredField } from "../../hooks/useForgeStructuredData";
import {
  buildDependencyGraph,
  buildGanttEntries,
  computeHierarchyOrder,
  dependencyEdge,
  findCriticalPath,
  normalizeLinkValue,
  resolveDependencyField,
  resolveParentField,
} from "./gantt-bucket";

function field(
  id: string,
  type: ForgeStructuredField["type"],
  extras: Partial<ForgeStructuredField> = {},
): ForgeStructuredField {
  return { id, name: id, type, ...extras };
}

describe("resolveParentField", () => {
  it("auto-detects the first self-referential linked_record field", () => {
    const fields = [
      field("name", "text"),
      field("parent", "linked_record", { linkedTableId: "table-projects" }),
      field("blocked_by", "linked_record", { linkedTableId: "table-projects" }),
    ];
    expect(resolveParentField(fields, "table-projects")?.id).toBe("parent");
  });

  it("honors a caller-supplied preference when it points to a self-referential link", () => {
    const fields = [
      field("parent_a", "linked_record", { linkedTableId: "table-projects" }),
      field("parent_b", "linked_record", { linkedTableId: "table-projects" }),
    ];
    expect(resolveParentField(fields, "table-projects", "parent_b")?.id).toBe("parent_b");
  });

  it("falls back when the preference points to a cross-table link", () => {
    const fields = [
      field("parent", "linked_record", { linkedTableId: "table-projects" }),
      field("owner", "linked_record", { linkedTableId: "table-people" }),
    ];
    expect(resolveParentField(fields, "table-projects", "owner")?.id).toBe("parent");
  });

  it("returns null when no self-referential link exists", () => {
    const fields = [
      field("name", "text"),
      field("owner", "linked_record", { linkedTableId: "table-people" }),
    ];
    expect(resolveParentField(fields, "table-projects")).toBeNull();
  });
});

describe("resolveDependencyField", () => {
  it("picks the first linked_record that isn't the parent field", () => {
    const fields = [
      field("parent", "linked_record", { linkedTableId: "table-projects" }),
      field("blocked_by", "linked_record", { linkedTableId: "table-projects" }),
    ];
    expect(resolveDependencyField(fields, "parent")?.id).toBe("blocked_by");
  });

  it("returns null when only the parent link field exists", () => {
    const fields = [field("parent", "linked_record", { linkedTableId: "table-projects" })];
    expect(resolveDependencyField(fields, "parent")).toBeNull();
  });

  it("honors a caller-supplied preference (any linked_record id)", () => {
    const fields = [
      field("parent", "linked_record", { linkedTableId: "table-projects" }),
      field("blocked_by", "linked_record", { linkedTableId: "table-projects" }),
      field("informs", "linked_record", { linkedTableId: "table-projects" }),
    ];
    expect(resolveDependencyField(fields, "parent", "informs")?.id).toBe("informs");
  });

  it("when no parent exists, picks the first linked_record overall", () => {
    const fields = [
      field("name", "text"),
      field("blocked_by", "linked_record", { linkedTableId: "table-projects" }),
    ];
    expect(resolveDependencyField(fields, null)?.id).toBe("blocked_by");
  });
});

describe("normalizeLinkValue", () => {
  it("turns a bare string id into a single-element array", () => {
    expect(normalizeLinkValue("rec-1")).toEqual(["rec-1"]);
  });

  it("dedups and trims array ids, dropping empties and non-strings", () => {
    expect(normalizeLinkValue(["rec-1", "  rec-2  ", "rec-1", "", null, 42, "rec-2"])).toEqual([
      "rec-1",
      "rec-2",
    ]);
  });

  it("returns empty for null / undefined / empty string", () => {
    expect(normalizeLinkValue(null)).toEqual([]);
    expect(normalizeLinkValue(undefined)).toEqual([]);
    expect(normalizeLinkValue("")).toEqual([]);
    expect(normalizeLinkValue([])).toEqual([]);
  });
});

describe("computeHierarchyOrder", () => {
  type Rec = { id: string; values: Record<string, unknown> };

  it("returns input order with depth 0 when no parent field is supplied", () => {
    const records: Rec[] = [
      { id: "a", values: {} },
      { id: "b", values: {} },
    ];
    expect(computeHierarchyOrder(records, null)).toEqual([
      { record: records[0], depth: 0 },
      { record: records[1], depth: 0 },
    ]);
  });

  it("indents children under parents in input order", () => {
    const records: Rec[] = [
      { id: "epic", values: { parent: null } },
      { id: "task-1", values: { parent: "epic" } },
      { id: "task-2", values: { parent: "epic" } },
      { id: "lone", values: { parent: null } },
    ];
    const parent = field("parent", "linked_record", { linkedTableId: "t" });
    const out = computeHierarchyOrder(records, parent);
    expect(out.map((row) => `${row.depth}:${row.record.id}`)).toEqual([
      "0:epic",
      "1:task-1",
      "1:task-2",
      "0:lone",
    ]);
  });

  it("supports multiple depth levels (grandchildren)", () => {
    const records: Rec[] = [
      { id: "root", values: { parent: null } },
      { id: "mid", values: { parent: "root" } },
      { id: "leaf", values: { parent: "mid" } },
    ];
    const parent = field("parent", "linked_record", { linkedTableId: "t" });
    const out = computeHierarchyOrder(records, parent);
    expect(out.map((row) => `${row.depth}:${row.record.id}`)).toEqual([
      "0:root",
      "1:mid",
      "2:leaf",
    ]);
  });

  it("treats orphans (parent id not in input set) as roots", () => {
    const records: Rec[] = [
      { id: "lone-a", values: { parent: "missing-epic" } },
      { id: "lone-b", values: { parent: null } },
    ];
    const parent = field("parent", "linked_record", { linkedTableId: "t" });
    const out = computeHierarchyOrder(records, parent);
    expect(out.map((row) => `${row.depth}:${row.record.id}`)).toEqual(["0:lone-a", "0:lone-b"]);
  });

  it("breaks 2-cycles deterministically (back-reference reverts to root)", () => {
    const records: Rec[] = [
      { id: "a", values: { parent: "b" } },
      { id: "b", values: { parent: "a" } },
    ];
    const parent = field("parent", "linked_record", { linkedTableId: "t" });
    const out = computeHierarchyOrder(records, parent);
    // a's parent is b → b appears first as root → a becomes child of b.
    // (Algorithm: parent-cycle check rejects b→a since a already lists b as parent.)
    expect(out).toHaveLength(2);
    expect(out.every((row) => row.depth === 0 || row.depth === 1)).toBe(true);
  });

  it("ignores self-parent references", () => {
    const records: Rec[] = [{ id: "a", values: { parent: "a" } }];
    const parent = field("parent", "linked_record", { linkedTableId: "t" });
    const out = computeHierarchyOrder(records, parent);
    expect(out).toEqual([{ record: records[0], depth: 0 }]);
  });
});

describe("buildDependencyGraph", () => {
  type Rec = { id: string; values: Record<string, unknown> };

  it("returns an empty map when no dependency field is supplied", () => {
    const records: Rec[] = [{ id: "a", values: { dep: "b" } }];
    expect(buildDependencyGraph(records, null).size).toBe(0);
  });

  it("emits predecessor edges that point to records in the input set", () => {
    const records: Rec[] = [
      { id: "a", values: { dep: null } },
      { id: "b", values: { dep: "a" } },
      { id: "c", values: { dep: ["b", "a"] } },
    ];
    const dep = field("dep", "linked_record", { linkedTableId: "t" });
    const graph = buildDependencyGraph(records, dep);
    expect(graph.get("a")).toBeUndefined();
    expect(graph.get("b")).toEqual(["a"]);
    expect(graph.get("c")).toEqual(["b", "a"]);
  });

  it("drops self-references and stale ids", () => {
    const records: Rec[] = [
      { id: "a", values: { dep: ["a", "ghost"] } },
      { id: "b", values: { dep: ["a", "ghost", "b"] } },
    ];
    const dep = field("dep", "linked_record", { linkedTableId: "t" });
    const graph = buildDependencyGraph(records, dep);
    expect(graph.get("a")).toBeUndefined();
    expect(graph.get("b")).toEqual(["a"]);
  });
});

describe("findCriticalPath", () => {
  type Rec = { id: string; values: Record<string, unknown> };
  const day = (year: number, month: number, dayOfMonth: number) =>
    new Date(year, month, dayOfMonth);

  function recordEntries(spec: Array<{ id: string; start: Date; end: Date }>) {
    return spec.map((row) => ({
      record: { id: row.id, values: {} } as Rec,
      startDate: row.start,
      endDate: row.end,
      laneKey: "",
      laneLabel: "All",
    }));
  }

  it("returns an empty set when the graph has no edges", () => {
    const entries = recordEntries([{ id: "a", start: day(2026, 4, 16), end: day(2026, 4, 18) }]);
    expect(findCriticalPath(entries, new Map())).toEqual(new Set());
  });

  it("identifies the longest dependent chain by cumulative duration", () => {
    const entries = recordEntries([
      { id: "a", start: day(2026, 4, 16), end: day(2026, 4, 17) }, // 2d
      { id: "b", start: day(2026, 4, 18), end: day(2026, 4, 20) }, // 3d
      { id: "c", start: day(2026, 4, 21), end: day(2026, 4, 21) }, // 1d (parallel branch)
      { id: "d", start: day(2026, 4, 22), end: day(2026, 4, 25) }, // 4d
    ]);
    const graph = new Map<string, string[]>([
      ["b", ["a"]],
      ["c", ["a"]],
      ["d", ["b"]],
    ]);
    // longest chain: a (2) + b (3) + d (4) = 9 days
    expect(findCriticalPath(entries, graph)).toEqual(new Set(["a", "b", "d"]));
  });
});

describe("dependencyEdge", () => {
  it("connects the right edge of a predecessor to the left edge of a successor at their midlines", () => {
    const edge = dependencyEdge(
      { laneRowTop: 100, rowTop: 8, barLeft: 200, barWidth: 60, barHeight: 22 },
      { laneRowTop: 200, rowTop: 8, barLeft: 320, barWidth: 40, barHeight: 22 },
    );
    expect(edge).toEqual({
      x1: 260, // 200 + 60
      y1: 119, // 100 + 8 + 11
      x2: 320,
      y2: 219, // 200 + 8 + 11
    });
  });
});

describe("re-exports from timeline-bucket integrate correctly", () => {
  it("buildGanttEntries delegates to the timeline parser contract", () => {
    type Rec = { id: string; start: string; end?: string };
    const records: Rec[] = [
      { id: "r1", start: "2026-05-10", end: "2026-05-14" },
      { id: "r2", start: "not-a-date" },
    ];
    const entries = buildGanttEntries(records, {
      extractStart: (r) => r.start,
      extractEnd: (r) => r.end,
    });
    expect(entries.map((e) => e.record.id)).toEqual(["r1"]);
  });
});
