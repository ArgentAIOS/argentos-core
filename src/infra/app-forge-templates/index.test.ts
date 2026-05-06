import { describe, expect, it } from "vitest";
import { getAppForgeTemplate, listAppForgeTemplates, normalizeAppForgeTemplate } from "./index.js";

describe("app-forge templates registry", () => {
  it("lists at least the airtable-crm template with required tables", () => {
    const templates = listAppForgeTemplates();
    const ids = templates.map((template) => template.id);
    expect(ids).toContain("airtable-crm");
    const crm = templates.find((template) => template.id === "airtable-crm");
    expect(crm).toBeDefined();
    const tableIds = (crm?.tables ?? []).map((table) => table.id);
    expect(tableIds).toEqual(
      expect.arrayContaining(["contacts", "companies", "deals", "activities"]),
    );
  });

  it("returns deep-cloned templates so callers can mutate without poisoning the registry", () => {
    const first = getAppForgeTemplate("airtable-crm");
    expect(first).not.toBeNull();
    if (!first) {
      return;
    }
    first.name = "Mutated";
    first.tables[0].fields[0].name = "Mutated field";
    const second = getAppForgeTemplate("airtable-crm");
    expect(second).not.toBeNull();
    expect(second?.name).toBe("Airtable CRM");
    expect(second?.tables[0].fields[0].name).not.toBe("Mutated field");
  });

  it("returns null for unknown template ids", () => {
    expect(getAppForgeTemplate("does-not-exist")).toBeNull();
    expect(getAppForgeTemplate("")).toBeNull();
  });

  it("normalizes templates and rejects malformed seeds", () => {
    const ok = normalizeAppForgeTemplate({
      id: "tpl",
      name: "Tpl",
      category: "Test",
      description: "test",
      tables: [
        {
          id: "tbl",
          name: "Tbl",
          fields: [
            { id: "name", name: "Name", type: "text", required: true },
            { id: "tags", name: "Tags", type: "multi_select", options: ["A", "B"] },
            { id: "site", name: "Site", type: "url" },
            { id: "linked", name: "Linked", type: "linked_record", linkedTableId: "other" },
          ],
          views: [
            { id: "v1", name: "All", type: "grid", sortFieldId: "name" },
            { id: "v2", name: "Bad type", type: "weird-type" },
          ],
        },
        // Reject tables with no fields
        { id: "empty", name: "Empty", fields: [], views: [] },
      ],
    });
    expect(ok).not.toBeNull();
    expect(ok?.tables).toHaveLength(1);
    expect(ok?.tables[0].views[0].type).toBe("grid");
    // Bad view type was coerced to "grid"
    expect(ok?.tables[0].views[1].type).toBe("grid");
    expect(ok?.tables[0].fields[1].type).toBe("multi_select");
    expect(ok?.tables[0].fields[1].options).toEqual(["A", "B"]);
    expect(ok?.tables[0].fields[3].linkedTableId).toBe("other");

    expect(normalizeAppForgeTemplate({ id: "x" })).toBeNull();
    expect(normalizeAppForgeTemplate(null)).toBeNull();
    expect(normalizeAppForgeTemplate({ id: "x", name: "y", tables: [] })).toBeNull();
  });
});
