import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AppForgeBase, AppForgeRecord, AppForgeTable } from "./app-forge-model.js";
import * as pgSchema from "../data/pg/schema.js";
import {
  APP_FORGE_STORAGE_SCHEMA_SQL,
  createInMemoryAppForgeStore,
  createPostgresAppForgeStore,
} from "./app-forge-store.js";

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
        records: [],
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
    id: "record-1",
    revision: 1,
    values: { status: "Open" },
    createdAt: "2026-04-25T21:00:00.000Z",
    updatedAt: "2026-04-25T21:00:00.000Z",
    ...overrides,
  };
}

describe("AppForge store contract", () => {
  it("round trips bases, tables, records, revisions, and idempotent writes", async () => {
    const store = createInMemoryAppForgeStore([base()]);

    const createdTable = await store.putTable("base-1", table(), {
      expectedBaseRevision: 1,
      expectedTableRevision: 0,
      idempotencyKey: "table-create-1",
    });
    expect(createdTable).toMatchObject({
      ok: true,
      base: { revision: 2 },
      table: { id: "table-2", revision: 1 },
    });

    const replayedTable = await store.putTable("base-1", table({ name: "Ignored" }), {
      expectedBaseRevision: 1,
      expectedTableRevision: 0,
      idempotencyKey: "table-create-1",
    });
    expect(replayedTable).toEqual(createdTable);

    const createdRecord = await store.putRecord("base-1", "table-2", record(), {
      expectedBaseRevision: 2,
      expectedTableRevision: 1,
      expectedRecordRevision: 0,
      idempotencyKey: "record-create-1",
    });
    expect(createdRecord).toMatchObject({
      ok: true,
      base: { revision: 3 },
      table: { revision: 2 },
      record: { id: "record-1", revision: 1 },
    });

    await expect(store.listRecords("base-1", "table-2")).resolves.toEqual([
      expect.objectContaining({ id: "record-1", values: { status: "Open" } }),
    ]);
    await expect(store.listBases({ appId: "app-1" })).resolves.toEqual([
      expect.objectContaining({
        id: "base-1",
        appId: "app-1",
        name: "Campaign Review",
        revision: 3,
        tables: expect.arrayContaining([
          expect.objectContaining({
            id: "table-2",
            fields: [
              { id: "status", name: "Status", type: "single_select", options: ["Open", "Done"] },
            ],
            records: [expect.objectContaining({ id: "record-1" })],
          }),
        ]),
      }),
    ]);
    await expect(store.listTables("base-1")).resolves.toEqual([
      expect.objectContaining({ id: "table-1", name: "Reviews" }),
      expect.objectContaining({
        id: "table-2",
        name: "Approvals",
        fields: [
          { id: "status", name: "Status", type: "single_select", options: ["Open", "Done"] },
        ],
      }),
    ]);
  });

  it("keeps AppForge schema exports aligned with the durable migration", () => {
    expect(pgSchema.appForgeBases).toBeDefined();
    expect(pgSchema.appForgeTables).toBeDefined();
    expect(pgSchema.appForgeRecords).toBeDefined();
    expect(pgSchema.appForgeIdempotencyKeys).toBeDefined();

    const migration = readFileSync(
      new URL("../data/pg/migrations/032_appforge_storage.sql", import.meta.url),
      "utf-8",
    );
    const ensureScript = readFileSync(
      new URL("../../scripts/ensure-pg-tables.sh", import.meta.url),
      "utf-8",
    );
    for (const tableName of [
      "appforge_bases",
      "appforge_tables",
      "appforge_records",
      "appforge_idempotency_keys",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`);
      expect(APP_FORGE_STORAGE_SCHEMA_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`);
      expect(ensureScript).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`);
    }
    for (const indexName of [
      "idx_appforge_bases_app",
      "idx_appforge_tables_base_position",
      "idx_appforge_records_table_updated",
      "idx_appforge_idempotency_resource",
    ]) {
      expect(migration).toContain(indexName);
      expect(APP_FORGE_STORAGE_SCHEMA_SQL).toContain(indexName);
      expect(ensureScript).toContain(indexName);
    }
  });

  it("self-heals missing AppForge tables before the first Postgres query", async () => {
    let schemaEnsured = false;
    const calls: string[] = [];
    const sql = (async (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      calls.push(query);
      if (!schemaEnsured && query.includes("appforge_bases")) {
        throw Object.assign(new Error('relation "appforge_bases" does not exist'), {
          code: "42P01",
        });
      }
      return [];
    }) as unknown as Parameters<typeof createPostgresAppForgeStore>[0] & {
      unsafe: (query: string) => Promise<unknown>;
    };
    sql.unsafe = async (query: string) => {
      calls.push(query);
      expect(query).toContain("CREATE TABLE IF NOT EXISTS appforge_bases");
      expect(query).toContain("CREATE TABLE IF NOT EXISTS appforge_idempotency_keys");
      schemaEnsured = true;
      return [];
    };

    const store = createPostgresAppForgeStore(sql);

    await expect(store.listBases()).resolves.toEqual([]);
    expect(schemaEnsured).toBe(true);
    expect(calls.some((query) => query.includes("FROM appforge_bases"))).toBe(true);
  });
});
