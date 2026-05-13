import { beforeEach, describe, expect, it } from "vitest";
import type { AppForgeBase, AppForgeSavedView } from "./app-forge-model.js";
import { createInMemoryAppForgeAdapter } from "./app-forge-adapter.js";
import {
  applyPlan,
  createInMemoryAppForgeNlPlanHistory,
  planFromNaturalLanguage,
  previewPlan,
  setAppForgeNlLlmPlanner,
  setDefaultAppForgeNlPlanHistory,
  undoPlan,
  type AppForgeNlPlan,
} from "./app-forge-nl.js";

function seedBase(overrides: Partial<AppForgeBase> = {}): AppForgeBase {
  return {
    id: "base-1",
    appId: "app-1",
    name: "Campaign Review",
    description: "Review workspace",
    activeTableId: "table-1",
    revision: 1,
    updatedAt: "2026-05-13T10:00:00.000Z",
    tables: [
      {
        id: "table-1",
        name: "Reviews",
        revision: 1,
        fields: [
          { id: "name", name: "Name", type: "text", required: true },
          {
            id: "status",
            name: "Status",
            type: "single_select",
            options: ["Planning", "Review", "Approved"],
          },
          { id: "score", name: "Score", type: "number" },
        ],
        records: [
          {
            id: "record-1",
            revision: 1,
            values: { name: "Asset A", status: "Review", score: 1 },
            createdAt: "2026-05-13T10:00:00.000Z",
            updatedAt: "2026-05-13T10:00:00.000Z",
          },
          {
            id: "record-2",
            revision: 1,
            values: { name: "Asset B", status: "Planning", score: 2 },
            createdAt: "2026-05-13T10:00:00.000Z",
            updatedAt: "2026-05-13T10:00:00.000Z",
          },
        ],
        views: [
          {
            id: "view-default",
            name: "All reviews",
            type: "grid",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("planFromNaturalLanguage", () => {
  beforeEach(() => {
    setAppForgeNlLlmPlanner(null);
    setDefaultAppForgeNlPlanHistory(createInMemoryAppForgeNlPlanHistory());
  });

  it("falls back to the rule planner when no LLM planner is wired", async () => {
    const plan = await planFromNaturalLanguage("add number field Velocity to Reviews", seedBase());

    expect(plan.ok).toBe(true);
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({
      kind: "field.add",
      tableId: "table-1",
      field: { name: "Velocity", type: "number" },
    });
    expect(plan.planId).toBeTruthy();
    expect(plan.prompt).toBe("add number field Velocity to Reviews");
  });

  it("treats empty prompts as not-ok rather than throwing", async () => {
    const plan = await planFromNaturalLanguage("   ", seedBase());
    expect(plan.ok).toBe(false);
    expect(plan.operations).toEqual([]);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it("invokes the bound LLM planner and falls back to rules on LLM failure", async () => {
    setAppForgeNlLlmPlanner(async () => {
      throw new Error("network unavailable");
    });
    const plan = await planFromNaturalLanguage("add text field Notes to Reviews", seedBase());
    expect(plan.ok).toBe(true);
    expect(plan.operations[0]).toMatchObject({ kind: "field.add" });
    expect(plan.warnings.some((w) => w.includes("LLM planner failed"))).toBe(true);
  });
});

describe("previewPlan", () => {
  it("renders one line per op and flags destructive ops", async () => {
    const plan: AppForgeNlPlan = {
      planId: "plan-x",
      prompt: "test",
      summary: "test",
      confidence: "high",
      operations: [
        {
          kind: "field.add",
          tableId: "table-1",
          field: { id: "notes", name: "Notes", type: "text" },
        },
        { kind: "record.delete", tableId: "table-1", recordId: "record-1" },
      ],
      warnings: [],
      assumptions: [],
      ok: true,
      createdAt: "2026-05-13T10:00:00.000Z",
    };

    const preview = previewPlan(plan);
    expect(preview.lines).toHaveLength(2);
    expect(preview.lines[0]).toMatchObject({ kind: "field.add", destructive: false });
    expect(preview.lines[1]).toMatchObject({ kind: "record.delete", destructive: true });
    expect(preview.destructive).toBe(true);
  });
});

describe("applyPlan / undoPlan round-trip", () => {
  beforeEach(() => {
    setAppForgeNlLlmPlanner(null);
    setDefaultAppForgeNlPlanHistory(createInMemoryAppForgeNlPlanHistory());
  });

  it("adds a field, records the inverse, and undoPlan removes the field", async () => {
    const adapter = createInMemoryAppForgeAdapter([seedBase()]);
    const history = createInMemoryAppForgeNlPlanHistory();

    const plan = await planFromNaturalLanguage(
      "add single select field Priority to Reviews",
      (await adapter.getBase("base-1"))!,
    );
    expect(plan.ok).toBe(true);

    const applied = await applyPlan({
      adapter,
      baseId: "base-1",
      plan,
      actor: "operator-1",
      appId: "app-1",
      history,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const tableAfterAdd = applied.base.tables.find((t) => t.id === "table-1")!;
    expect(tableAfterAdd.fields.map((f) => f.name)).toContain("Priority");

    const undone = await undoPlan({
      adapter,
      baseId: "base-1",
      planId: plan.planId,
      actor: "operator-1",
      appId: "app-1",
      history,
    });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    const tableAfterUndo = undone.base.tables.find((t) => t.id === "table-1")!;
    expect(tableAfterUndo.fields.map((f) => f.name)).not.toContain("Priority");
  });

  it("updates a record then undoes the update back to original values", async () => {
    const adapter = createInMemoryAppForgeAdapter([seedBase()]);
    const history = createInMemoryAppForgeNlPlanHistory();
    const base = (await adapter.getBase("base-1"))!;

    const plan = await planFromNaturalLanguage(
      "set status to Approved for Asset A in Reviews",
      base,
    );
    expect(plan.ok).toBe(true);

    const applied = await applyPlan({
      adapter,
      baseId: "base-1",
      plan,
      actor: "operator-1",
      appId: "app-1",
      history,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const recordAfter = applied.base.tables
      .find((t) => t.id === "table-1")!
      .records.find((r) => r.id === "record-1")!;
    expect(recordAfter.values.status).toBe("Approved");

    // Inverse op should restore the prior `status` value (was "Review").
    expect(applied.inversePlan.operations[0]).toMatchObject({
      kind: "record.update",
      recordId: "record-1",
      values: { status: "Review" },
    });

    const undone = await undoPlan({
      adapter,
      baseId: "base-1",
      planId: plan.planId,
      actor: "operator-1",
      appId: "app-1",
      history,
    });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    const recordRestored = undone.base.tables
      .find((t) => t.id === "table-1")!
      .records.find((r) => r.id === "record-1")!;
    expect(recordRestored.values.status).toBe("Review");
  });

  it("deletes a record then undoes by re-creating it with prior values", async () => {
    const adapter = createInMemoryAppForgeAdapter([seedBase()]);
    const history = createInMemoryAppForgeNlPlanHistory();

    const plan: AppForgeNlPlan = {
      planId: "plan-del-1",
      prompt: "delete record-2 from Reviews",
      summary: "Delete record-2 from Reviews.",
      confidence: "high",
      operations: [{ kind: "record.delete", tableId: "table-1", recordId: "record-2" }],
      warnings: [],
      assumptions: [],
      ok: true,
      createdAt: "2026-05-13T10:00:00.000Z",
    };

    const applied = await applyPlan({
      adapter,
      baseId: "base-1",
      plan,
      actor: "operator-1",
      appId: "app-1",
      history,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const afterDelete = applied.base.tables.find((t) => t.id === "table-1")!;
    expect(afterDelete.records.map((r) => r.id)).not.toContain("record-2");

    expect(applied.inversePlan.operations[0]).toMatchObject({
      kind: "record.add",
      tableId: "table-1",
      record: { id: "record-2", values: { name: "Asset B" } },
    });

    const undone = await undoPlan({
      adapter,
      baseId: "base-1",
      planId: plan.planId,
      actor: "operator-1",
      appId: "app-1",
      history,
    });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    const restored = undone.base.tables.find((t) => t.id === "table-1")!;
    expect(restored.records.map((r) => r.id)).toContain("record-2");
    const restoredRecord = restored.records.find((r) => r.id === "record-2")!;
    expect(restoredRecord.values.name).toBe("Asset B");
  });

  it("adds + removes a saved view and round-trips the inverse", async () => {
    const adapter = createInMemoryAppForgeAdapter([seedBase()]);
    const history = createInMemoryAppForgeNlPlanHistory();

    const view: AppForgeSavedView = {
      id: "view-kanban",
      name: "Kanban by Status",
      type: "kanban",
      groupFieldId: "status",
    };

    const addPlan: AppForgeNlPlan = {
      planId: "plan-view-add-1",
      prompt: "add kanban view",
      summary: "Add a kanban view grouped by status.",
      confidence: "high",
      operations: [{ kind: "view.add", tableId: "table-1", view }],
      warnings: [],
      assumptions: [],
      ok: true,
      createdAt: "2026-05-13T10:00:00.000Z",
    };

    const applied = await applyPlan({
      adapter,
      baseId: "base-1",
      plan: addPlan,
      actor: "operator-1",
      appId: "app-1",
      history,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const tableAfter = applied.base.tables.find((t) => t.id === "table-1")!;
    expect(tableAfter.views?.map((v) => v.id)).toContain("view-kanban");

    const undone = await undoPlan({
      adapter,
      baseId: "base-1",
      planId: addPlan.planId,
      actor: "operator-1",
      appId: "app-1",
      history,
    });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    const tableAfterUndo = undone.base.tables.find((t) => t.id === "table-1")!;
    expect(tableAfterUndo.views?.map((v) => v.id)).not.toContain("view-kanban");
  });

  it("rejects apply on a not-ok plan and emits the right error code", async () => {
    const adapter = createInMemoryAppForgeAdapter([seedBase()]);
    const history = createInMemoryAppForgeNlPlanHistory();
    const plan: AppForgeNlPlan = {
      planId: "plan-bad",
      prompt: "garbage",
      summary: "Command was not recognized.",
      confidence: "low",
      operations: [],
      warnings: ["Supported commands ..."],
      assumptions: [],
      ok: false,
      createdAt: "2026-05-13T10:00:00.000Z",
    };

    const result = await applyPlan({
      adapter,
      baseId: "base-1",
      plan,
      actor: "operator-1",
      appId: "app-1",
      history,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("appforge_nl_plan_not_ok");
  });

  it("enforces the ACL gate when a scope is supplied", async () => {
    const adapter = createInMemoryAppForgeAdapter([seedBase()]);
    const history = createInMemoryAppForgeNlPlanHistory();

    const plan = await planFromNaturalLanguage(
      "add text field Notes to Reviews",
      (await adapter.getBase("base-1"))!,
    );
    expect(plan.ok).toBe(true);

    const result = await applyPlan({
      adapter,
      baseId: "base-1",
      plan,
      actor: "intruder",
      appId: "app-1",
      scope: {
        owners: [{ actorId: "operator-1", addedAt: "2026-05-13T10:00:00.000Z" }],
        editors: [],
        viewers: [],
      },
      history,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("appforge_nl_acl_denied");
  });

  it("refuses to undo a plan twice", async () => {
    const adapter = createInMemoryAppForgeAdapter([seedBase()]);
    const history = createInMemoryAppForgeNlPlanHistory();
    const base = (await adapter.getBase("base-1"))!;
    const plan = await planFromNaturalLanguage("add number field Velocity to Reviews", base);

    const applied = await applyPlan({
      adapter,
      baseId: "base-1",
      plan,
      actor: "operator-1",
      appId: "app-1",
      history,
    });
    expect(applied.ok).toBe(true);

    const undoneOnce = await undoPlan({
      adapter,
      baseId: "base-1",
      planId: plan.planId,
      actor: "operator-1",
      appId: "app-1",
      history,
    });
    expect(undoneOnce.ok).toBe(true);

    const undoneTwice = await undoPlan({
      adapter,
      baseId: "base-1",
      planId: plan.planId,
      actor: "operator-1",
      appId: "app-1",
      history,
    });
    expect(undoneTwice.ok).toBe(false);
    if (undoneTwice.ok) return;
    expect(undoneTwice.error.code).toBe("appforge_nl_invalid_op");
  });
});
