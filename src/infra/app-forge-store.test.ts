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
    fields: [
      {
        id: "status",
        name: "Status",
        type: "single_select",
        options: ["Open", "Done"],
        selectOptions: [
          { id: "opt-open", label: "Open", color: "sky" },
          { id: "opt-done", label: "Done", color: "emerald" },
        ],
        defaultValue: "Open",
      },
    ],
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

function createFakeDurableSql() {
  type StoredBase = {
    id: string;
    appId: string;
    name: string;
    description: string | null;
    activeTableId: string | null;
    revision: number;
    updatedAt: string;
  };
  type StoredTable = {
    id: string;
    baseId: string;
    name: string;
    fields: unknown;
    revision: number;
    position: number;
    metadata: unknown;
    updatedAt: string;
  };
  type StoredRecord = {
    id: string;
    baseId: string;
    tableId: string;
    values: unknown;
    revision: number;
    position: number;
    createdAt: string;
    updatedAt: string;
  };

  const state = {
    bases: new Map<string, StoredBase>(),
    tables: new Map<string, StoredTable>(),
    records: new Map<string, StoredRecord>(),
    idempotency: new Map<string, unknown>(),
    schemaEnsuredCount: 0,
  };

  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();

    if (query.includes("SELECT response FROM appforge_idempotency_keys")) {
      const response = state.idempotency.get(String(values[0]));
      return response === undefined ? [] : [{ response }];
    }

    if (query.includes("INSERT INTO appforge_idempotency_keys")) {
      const key = String(values[0]);
      if (!state.idempotency.has(key)) {
        state.idempotency.set(key, values[4]);
      }
      return [];
    }

    if (query.includes("INSERT INTO appforge_bases")) {
      const [id, appId, name, description, activeTableId, revision, updatedAt] = values;
      state.bases.set(String(id), {
        id: String(id),
        appId: String(appId),
        name: String(name),
        description: typeof description === "string" ? description : null,
        activeTableId: typeof activeTableId === "string" ? activeTableId : null,
        revision: Number(revision),
        updatedAt: String(updatedAt),
      });
      return [];
    }

    if (query.includes("DELETE FROM appforge_tables WHERE base_id")) {
      const baseId = String(values[0]);
      for (const [tableId, storedTable] of state.tables) {
        if (storedTable.baseId === baseId) {
          state.tables.delete(tableId);
        }
      }
      for (const [recordId, storedRecord] of state.records) {
        if (storedRecord.baseId === baseId) {
          state.records.delete(recordId);
        }
      }
      return [];
    }

    if (query.includes("INSERT INTO appforge_tables")) {
      const [id, baseId, name, fields, revision, position, metadata, updatedAt] = values;
      state.tables.set(String(id), {
        id: String(id),
        baseId: String(baseId),
        name: String(name),
        fields,
        revision: Number(revision),
        position: Number(position),
        metadata,
        updatedAt: String(updatedAt),
      });
      return [];
    }

    if (query.includes("INSERT INTO appforge_records")) {
      const [id, baseId, tableId, recordValues, revision, position, createdAt, updatedAt] = values;
      state.records.set(String(id), {
        id: String(id),
        baseId: String(baseId),
        tableId: String(tableId),
        values: recordValues,
        revision: Number(revision),
        position: Number(position),
        createdAt: String(createdAt),
        updatedAt: String(updatedAt),
      });
      return [];
    }

    if (query.includes("FROM appforge_bases") && query.includes("WHERE id")) {
      const row = state.bases.get(String(values[0]));
      return row
        ? [
            {
              id: row.id,
              appId: row.appId,
              name: row.name,
              description: row.description,
              activeTableId: row.activeTableId,
              revision: row.revision,
              updatedAt: row.updatedAt,
            },
          ]
        : [];
    }

    if (query.includes("FROM appforge_bases") && query.includes("WHERE app_id")) {
      return Array.from(state.bases.values())
        .filter((row) => row.appId === String(values[0]))
        .map((row) => ({
          id: row.id,
          appId: row.appId,
          name: row.name,
          description: row.description,
          activeTableId: row.activeTableId,
          revision: row.revision,
          updatedAt: row.updatedAt,
        }));
    }

    if (query.includes("FROM appforge_bases")) {
      return Array.from(state.bases.values()).map((row) => ({
        id: row.id,
        appId: row.appId,
        name: row.name,
        description: row.description,
        activeTableId: row.activeTableId,
        revision: row.revision,
        updatedAt: row.updatedAt,
      }));
    }

    if (query.includes("FROM appforge_tables") && query.includes("WHERE base_id")) {
      const baseId = String(values[0]);
      const tableId = values.length > 1 ? String(values[1]) : null;
      return Array.from(state.tables.values())
        .filter((row) => row.baseId === baseId && (!tableId || row.id === tableId))
        .toSorted((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .map((row) => ({
          id: row.id,
          baseId: row.baseId,
          name: row.name,
          fields: row.fields,
          revision: row.revision,
          position: row.position,
          metadata: row.metadata,
          updatedAt: row.updatedAt,
        }));
    }

    if (query.includes("FROM appforge_records") && query.includes("WHERE base_id")) {
      const baseId = String(values[0]);
      const tableId = String(values[1]);
      const recordId = values.length > 2 ? String(values[2]) : null;
      return Array.from(state.records.values())
        .filter(
          (row) =>
            row.baseId === baseId && row.tableId === tableId && (!recordId || row.id === recordId),
        )
        .toSorted((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .map((row) => ({
          id: row.id,
          baseId: row.baseId,
          tableId: row.tableId,
          values: row.values,
          revision: row.revision,
          position: row.position,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }));
    }

    throw new Error(`Unhandled fake AppForge SQL query: ${query}`);
  };

  sql.unsafe = async (query: string) => {
    expect(query).toContain("CREATE TABLE IF NOT EXISTS appforge_bases");
    state.schemaEnsuredCount += 1;
    return [];
  };
  sql.begin = async <T>(callback: (tx: typeof sql) => Promise<T>) => callback(sql);
  sql.json = (value: unknown) => value;

  return { sql: sql as unknown as Parameters<typeof createPostgresAppForgeStore>[0], state };
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
              {
                id: "status",
                name: "Status",
                type: "single_select",
                options: ["Open", "Done"],
                selectOptions: [
                  { id: "opt-open", label: "Open", color: "sky" },
                  { id: "opt-done", label: "Done", color: "emerald" },
                ],
                defaultValue: "Open",
              },
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
          {
            id: "status",
            name: "Status",
            type: "single_select",
            options: ["Open", "Done"],
            selectOptions: [
              { id: "opt-open", label: "Open", color: "sky" },
              { id: "opt-done", label: "Done", color: "emerald" },
            ],
            defaultValue: "Open",
          },
        ],
      }),
    ]);
  });

  it("preserves in-memory table view state across base writes and list reloads", async () => {
    const store = createInMemoryAppForgeStore();
    const durableBase = base({
      id: "base-memory",
      appId: "app-memory",
      activeTableId: "table-memory",
      revision: 0,
      tables: [
        {
          id: "table-memory",
          name: "Leads",
          revision: 0,
          activeViewId: "view-status",
          defaultViewId: "view-status",
          selectedFieldId: "status",
          activeCell: { recordId: "record-memory", fieldId: "status" },
          fields: [
            { id: "name", name: "Name", type: "text", required: true },
            { id: "status", name: "Status", type: "single_select", options: ["New", "Won"] },
          ],
          records: [
            record({
              id: "record-memory",
              values: { name: "Gateway lead", status: "New" },
            }),
          ],
          views: [
            {
              id: "view-status",
              name: "By status",
              type: "kanban",
              groupFieldId: "status",
              visibleFieldIds: ["name", "status"],
            },
            {
              id: "view-review",
              name: "Follow-up queue",
              type: "review",
              filterText: "New",
              sortFieldId: "name",
              visibleFieldIds: ["status", "name"],
            },
          ],
        } as AppForgeTable,
      ],
    });

    await expect(store.putBase({ base: durableBase, expectedRevision: 0 })).resolves.toMatchObject({
      ok: true,
      base: { id: "base-memory", revision: 1 },
    });

    await expect(store.listBases({ appId: "app-memory" })).resolves.toEqual([
      expect.objectContaining({
        id: "base-memory",
        tables: [
          expect.objectContaining({
            id: "table-memory",
            activeViewId: "view-status",
            defaultViewId: "view-status",
            selectedFieldId: "status",
            activeCell: { recordId: "record-memory", fieldId: "status" },
            views: [
              expect.objectContaining({ id: "view-status", name: "By status" }),
              expect.objectContaining({ id: "view-review", name: "Follow-up queue" }),
            ],
          }),
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

  it("preserves live gateway base, table, saved view, selected field, and records across store recreation", async () => {
    const { sql, state } = createFakeDurableSql();
    const firstStore = createPostgresAppForgeStore(sql);
    const durableBase = base({
      id: "base-live",
      appId: "app-live",
      name: "Live Persistence Smoke",
      description: "Durable close/reopen proof",
      activeTableId: "table-live",
      revision: 0,
      updatedAt: "2026-04-30T22:00:00.000Z",
      tables: [
        {
          id: "table-live",
          name: "Launch Reviews",
          revision: 0,
          activeViewId: "view-review",
          defaultViewId: "view-review",
          selectedFieldId: "status",
          activeCell: { recordId: "record-live", fieldId: "status" },
          fields: [
            { id: "name", name: "Name", type: "text", required: true },
            {
              id: "status",
              name: "Status",
              type: "single_select",
              options: ["Planning", "Review", "Done"],
            },
          ],
          records: [
            record({
              id: "record-live",
              values: { name: "Operator smoke", status: "Review" },
            }),
          ],
          views: [
            {
              id: "view-review",
              name: "Review queue",
              type: "grid",
              filterText: "review",
              sortFieldId: "name",
              sortDirection: "asc",
              groupFieldId: "status",
              visibleFieldIds: ["status", "name"],
              createdAt: "2026-04-30T22:00:00.000Z",
              updatedAt: "2026-04-30T22:05:00.000Z",
            },
          ],
        } as AppForgeTable,
      ],
    });

    await expect(
      firstStore.putBase({
        base: durableBase,
        expectedRevision: 0,
        idempotencyKey: "live-persistence-smoke",
      }),
    ).resolves.toMatchObject({
      ok: true,
      base: { id: "base-live", revision: 1 },
    });

    const reopenedStore = createPostgresAppForgeStore(sql);
    const storedTable = state.tables.get("table-live");
    if (storedTable) {
      storedTable.fields = JSON.stringify(storedTable.fields);
      storedTable.metadata = JSON.stringify(storedTable.metadata);
    }
    const storedRecord = state.records.get("record-live");
    if (storedRecord) {
      storedRecord.values = JSON.stringify(storedRecord.values);
    }

    await expect(reopenedStore.listBases({ appId: "app-live" })).resolves.toEqual([
      expect.objectContaining({
        id: "base-live",
        appId: "app-live",
        name: "Live Persistence Smoke",
        activeTableId: "table-live",
        revision: 1,
        tables: [
          expect.objectContaining({
            id: "table-live",
            name: "Launch Reviews",
            activeViewId: "view-review",
            defaultViewId: "view-review",
            selectedFieldId: "status",
            activeCell: { recordId: "record-live", fieldId: "status" },
            views: [
              expect.objectContaining({
                id: "view-review",
                filterText: "review",
                sortFieldId: "name",
                sortDirection: "asc",
                groupFieldId: "status",
                visibleFieldIds: ["status", "name"],
              }),
            ],
            records: [
              expect.objectContaining({
                id: "record-live",
                values: { name: "Operator smoke", status: "Review" },
              }),
            ],
          }),
        ],
      }),
    ]);

    await expect(reopenedStore.listTables("base-live")).resolves.toEqual([
      expect.objectContaining({
        id: "table-live",
        fields: expect.arrayContaining([
          expect.objectContaining({ id: "name", name: "Name", type: "text", required: true }),
          expect.objectContaining({
            id: "status",
            name: "Status",
            type: "single_select",
            options: ["Planning", "Review", "Done"],
          }),
        ]),
      }),
    ]);
    expect(state.schemaEnsuredCount).toBe(2);
  });
});
