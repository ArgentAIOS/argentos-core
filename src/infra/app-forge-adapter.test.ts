import { describe, expect, it } from "vitest";
import type { AppForgeBase } from "./app-forge-model.js";
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
});
