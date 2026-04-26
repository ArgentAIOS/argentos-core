import { describe, expect, it } from "vitest";
import type { AppForgeBase } from "./app-forge-model.js";
import { planAppForgeCommand } from "./app-forge-command.js";

function base(overrides: Partial<AppForgeBase> = {}): AppForgeBase {
  return {
    id: "base-1",
    appId: "app-1",
    name: "Campaign Review",
    description: "Review workspace",
    activeTableId: "table-1",
    revision: 1,
    updatedAt: "2026-04-25T20:00:00.000Z",
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
            createdAt: "2026-04-25T20:00:00.000Z",
            updatedAt: "2026-04-25T20:00:00.000Z",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("AppForge natural-language command planning", () => {
  it("plans table and field creation commands", () => {
    const createTable = planAppForgeCommand(base(), "create table Vendors");
    expect(createTable).toMatchObject({
      ok: true,
      operations: [{ kind: "table.create", table: { id: "vendors", name: "Vendors" } }],
    });

    const addField = planAppForgeCommand(base(), "add number field Score to Reviews");
    expect(addField).toMatchObject({
      ok: true,
      operations: [
        {
          kind: "field.create",
          tableId: "table-1",
          field: { id: "score", name: "Score", type: "number" },
        },
      ],
    });
  });

  it("plans a record update against matched table, field, and record context", () => {
    const plan = planAppForgeCommand(base(), "set status to Approved for Asset A in Reviews");

    expect(plan).toMatchObject({
      ok: true,
      confidence: "high",
      operations: [
        {
          kind: "record.update",
          tableId: "table-1",
          recordId: "record-1",
          values: { status: "Approved" },
        },
      ],
    });
    expect(plan.warnings).toEqual([]);
  });

  it("uses active-table context for record creation and reports missing required fields", () => {
    const plan = planAppForgeCommand(base(), "add record to Reviews with status=Planning");

    expect(plan.ok).toBe(false);
    expect(plan.operations).toEqual([
      {
        kind: "record.create",
        tableId: "table-1",
        values: {
          name: "",
          status: "Planning",
          score: "",
        },
      },
    ]);
    expect(plan.warnings).toContain("Name is required.");
  });

  it("fails safely when the command target is ambiguous or unknown", () => {
    const plan = planAppForgeCommand(base(), "rename table Missing to Archive");

    expect(plan).toMatchObject({
      ok: false,
      confidence: "low",
      operations: [],
    });
    expect(plan.warnings[0]).toContain('No AppForge table matched "Missing"');
  });
});
