import { describe, expect, it } from "vitest";
import type { AppForgeBase, AppForgeRecord, AppForgeTable } from "./app-forge-model.js";
import { createInMemoryAppForgeAdapter } from "./app-forge-adapter.js";

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
        fields: [{ id: "name", name: "Name", type: "text", required: true }],
        records: [
          {
            id: "record-1",
            revision: 1,
            values: { name: "Asset" },
            createdAt: "2026-04-25T20:00:00.000Z",
            updatedAt: "2026-04-25T20:00:00.000Z",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function table(overrides: Partial<AppForgeTable> = {}): AppForgeTable {
  return {
    id: "table-2",
    name: "Approvals",
    revision: 1,
    fields: [{ id: "status", name: "Status", type: "single_select", options: ["Open", "Done"] }],
    records: [],
    ...overrides,
  };
}

function record(overrides: Partial<AppForgeRecord> = {}): AppForgeRecord {
  return {
    id: "record-2",
    revision: 1,
    values: { name: "Asset 2" },
    createdAt: "2026-04-25T21:00:00.000Z",
    updatedAt: "2026-04-25T21:00:00.000Z",
    ...overrides,
  };
}

describe("AppForge adapter contract", () => {
  it("lists and returns cloned bases by app id", async () => {
    const adapter = createInMemoryAppForgeAdapter([
      base(),
      base({ id: "base-2", appId: "app-2", name: "Other" }),
    ]);

    const appBases = await adapter.listBases({ appId: "app-1" });
    expect(appBases.map((item) => item.id)).toEqual(["base-1"]);

    const [appBase] = appBases;
    expect(appBase).toBeDefined();
    appBase.tables[0].records[0].values.name = "Mutated outside adapter";
    const stored = await adapter.getBase("base-1");
    expect(stored?.tables[0]?.records[0]?.values.name).toBe("Asset");
  });

  it("increments revisions on writes and rejects stale updates", async () => {
    const adapter = createInMemoryAppForgeAdapter([base()]);

    const first = await adapter.putBase({
      base: base({ name: "Updated" }),
      expectedRevision: 1,
    });
    expect(first).toMatchObject({ ok: true, base: { revision: 2, name: "Updated" } });

    const stale = await adapter.putBase({
      base: base({ name: "Stale" }),
      expectedRevision: 1,
    });
    expect(stale).toEqual({
      ok: false,
      code: "revision_conflict",
      expectedRevision: 1,
      actualRevision: 2,
      message: "Expected revision 1, found 2.",
    });
  });

  it("deduplicates idempotent writes", async () => {
    const adapter = createInMemoryAppForgeAdapter([base()]);

    const first = await adapter.putBase({
      base: base({ name: "Idempotent" }),
      expectedRevision: 1,
      idempotencyKey: "write-1",
    });
    const second = await adapter.putBase({
      base: base({ name: "Ignored replay" }),
      expectedRevision: 1,
      idempotencyKey: "write-1",
    });

    expect(first).toMatchObject({ ok: true, base: { revision: 2, name: "Idempotent" } });
    expect(second).toEqual(first);
  });

  it("checks revisions before deleting bases", async () => {
    const adapter = createInMemoryAppForgeAdapter([base()]);

    const stale = await adapter.deleteBase("base-1", { expectedRevision: 2 });
    expect(stale).toMatchObject({
      ok: false,
      code: "revision_conflict",
      expectedRevision: 2,
      actualRevision: 1,
    });

    const deleted = await adapter.deleteBase("base-1", { expectedRevision: 1 });
    expect(deleted).toMatchObject({ ok: true, base: { id: "base-1", revision: 2 } });
    await expect(adapter.getBase("base-1")).resolves.toBeNull();
  });

  it("lists cloned tables and records", async () => {
    const adapter = createInMemoryAppForgeAdapter([base()]);

    const tables = await adapter.listTables("base-1");
    expect(tables.map((item) => item.id)).toEqual(["table-1"]);
    tables[0].fields[0].name = "Mutated field";

    const records = await adapter.listRecords("base-1", "table-1");
    expect(records.map((item) => item.id)).toEqual(["record-1"]);
    records[0].values.name = "Mutated record";

    const storedTable = await adapter.getTable("base-1", "table-1");
    expect(storedTable?.fields[0]?.name).toBe("Name");
    expect(storedTable?.records[0]?.values.name).toBe("Asset");
  });

  it("writes tables with revision checks and idempotency", async () => {
    const adapter = createInMemoryAppForgeAdapter([base()]);

    const created = await adapter.putTable("base-1", table(), {
      expectedBaseRevision: 1,
      expectedTableRevision: 0,
      idempotencyKey: "table-write-1",
    });
    expect(created).toMatchObject({
      ok: true,
      base: { revision: 2 },
      table: { id: "table-2", revision: 1, name: "Approvals" },
    });

    const replay = await adapter.putTable("base-1", table({ name: "Ignored replay" }), {
      expectedBaseRevision: 1,
      expectedTableRevision: 0,
      idempotencyKey: "table-write-1",
    });
    expect(replay).toEqual(created);

    const stale = await adapter.putTable("base-1", table({ name: "Stale" }), {
      expectedBaseRevision: 1,
      expectedTableRevision: 0,
    });
    expect(stale).toEqual({
      ok: false,
      code: "revision_conflict",
      expectedRevision: 1,
      actualRevision: 2,
      message: "Expected revision 1, found 2.",
    });
  });

  it("deletes tables with nested revision checks and keeps the base valid", async () => {
    const adapter = createInMemoryAppForgeAdapter([base()]);

    const created = await adapter.putTable("base-1", table(), {
      expectedBaseRevision: 1,
      expectedTableRevision: 0,
    });
    expect(created).toMatchObject({ ok: true, base: { revision: 2 } });

    const stale = await adapter.deleteTable("base-1", "table-1", {
      expectedBaseRevision: 2,
      expectedTableRevision: 2,
    });
    expect(stale).toEqual({
      ok: false,
      code: "revision_conflict",
      expectedRevision: 2,
      actualRevision: 1,
      message: "Expected revision 2, found 1.",
    });

    const deleted = await adapter.deleteTable("base-1", "table-1", {
      expectedBaseRevision: 2,
      expectedTableRevision: 1,
    });
    expect(deleted).toMatchObject({
      ok: true,
      base: { revision: 3, activeTableId: "table-2" },
      table: { id: "table-1", revision: 2 },
    });
    await expect(adapter.getTable("base-1", "table-1")).resolves.toBeNull();
  });

  it("writes and deletes records with nested revision checks and idempotency", async () => {
    const adapter = createInMemoryAppForgeAdapter([base()]);

    const created = await adapter.putRecord("base-1", "table-1", record(), {
      expectedBaseRevision: 1,
      expectedTableRevision: 1,
      expectedRecordRevision: 0,
      idempotencyKey: "record-write-1",
    });
    expect(created).toMatchObject({
      ok: true,
      base: { revision: 2 },
      table: { revision: 2 },
      record: { id: "record-2", revision: 1, createdAt: "2026-04-25T21:00:00.000Z" },
    });

    const replay = await adapter.putRecord(
      "base-1",
      "table-1",
      record({ values: { name: "Ignored replay" } }),
      {
        expectedBaseRevision: 1,
        expectedTableRevision: 1,
        expectedRecordRevision: 0,
        idempotencyKey: "record-write-1",
      },
    );
    expect(replay).toEqual(created);

    const stale = await adapter.putRecord("base-1", "table-1", record({ id: "record-1" }), {
      expectedBaseRevision: 2,
      expectedTableRevision: 2,
      expectedRecordRevision: 0,
    });
    expect(stale).toEqual({
      ok: false,
      code: "revision_conflict",
      expectedRevision: 0,
      actualRevision: 1,
      message: "Expected revision 0, found 1.",
    });

    const deleted = await adapter.deleteRecord("base-1", "table-1", "record-2", {
      expectedBaseRevision: 2,
      expectedTableRevision: 2,
      expectedRecordRevision: 1,
    });
    expect(deleted).toMatchObject({
      ok: true,
      base: { revision: 3 },
      table: { revision: 3 },
      record: { id: "record-2", revision: 2 },
    });
    await expect(adapter.listRecords("base-1", "table-1")).resolves.toEqual([
      expect.objectContaining({ id: "record-1" }),
    ]);
  });
});
