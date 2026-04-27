import type postgres from "postgres";
import {
  createInMemoryAppForgeAdapter,
  type AppForgeAdapter,
  type AppForgeBaseWrite,
  type AppForgeRecordWriteOptions,
  type AppForgeRecordWriteResult,
  type AppForgeTableWriteOptions,
  type AppForgeTableWriteResult,
  type AppForgeWriteResult,
} from "./app-forge-adapter.js";
import {
  checkAppForgeRevision,
  type AppForgeBase,
  type AppForgeField,
  type AppForgeRecord,
  type AppForgeRecordValue,
  type AppForgeTable,
} from "./app-forge-model.js";

export type AppForgeStore = AppForgeAdapter;
export type { AppForgeAdapter };

type SqlClient = postgres.Sql;

type RevisionConflict = Exclude<AppForgeWriteResult, { ok: true }>;

type SqlClientWithUnsafe = SqlClient & {
  unsafe?: (query: string, params?: unknown[]) => Promise<unknown>;
};

export const APP_FORGE_STORAGE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS appforge_bases (
  id              TEXT PRIMARY KEY,
  app_id          TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  active_table_id TEXT,
  revision        INTEGER NOT NULL DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appforge_bases_app
  ON appforge_bases(app_id);

CREATE INDEX IF NOT EXISTS idx_appforge_bases_updated
  ON appforge_bases(updated_at);

CREATE TABLE IF NOT EXISTS appforge_tables (
  id         TEXT PRIMARY KEY,
  base_id    TEXT NOT NULL REFERENCES appforge_bases(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  fields     JSONB NOT NULL DEFAULT '[]',
  revision   INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  metadata   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appforge_tables_base
  ON appforge_tables(base_id);

CREATE INDEX IF NOT EXISTS idx_appforge_tables_base_position
  ON appforge_tables(base_id, position);

CREATE TABLE IF NOT EXISTS appforge_records (
  id         TEXT PRIMARY KEY,
  base_id    TEXT NOT NULL REFERENCES appforge_bases(id) ON DELETE CASCADE,
  table_id   TEXT NOT NULL REFERENCES appforge_tables(id) ON DELETE CASCADE,
  "values"   JSONB NOT NULL DEFAULT '{}',
  revision   INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appforge_records_table
  ON appforge_records(table_id);

CREATE INDEX IF NOT EXISTS idx_appforge_records_base_table
  ON appforge_records(base_id, table_id);

CREATE INDEX IF NOT EXISTS idx_appforge_records_table_updated
  ON appforge_records(table_id, updated_at);

CREATE TABLE IF NOT EXISTS appforge_idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  operation       TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  resource_id     TEXT NOT NULL,
  response        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appforge_idempotency_resource
  ON appforge_idempotency_keys(resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_appforge_idempotency_created
  ON appforge_idempotency_keys(created_at);
`;

type AppForgeBaseRow = {
  id: string;
  appId?: string;
  app_id?: string;
  name: string;
  description?: string | null;
  activeTableId?: string | null;
  active_table_id?: string | null;
  revision: number;
  updatedAt?: Date | string;
  updated_at?: Date | string;
};

type AppForgeTableRow = {
  id: string;
  baseId?: string;
  base_id?: string;
  name: string;
  fields: unknown;
  revision: number;
  position: number;
  updatedAt?: Date | string;
  updated_at?: Date | string;
};

type AppForgeRecordRow = {
  id: string;
  baseId?: string;
  base_id?: string;
  tableId?: string;
  table_id?: string;
  values: unknown;
  revision: number;
  position: number;
  createdAt?: Date | string;
  created_at?: Date | string;
  updatedAt?: Date | string;
  updated_at?: Date | string;
};

type IdempotencyRow = {
  response: unknown;
};

function nowIso(): string {
  return new Date().toISOString();
}

function toIso(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ?? nowIso();
}

function missingConflict(
  resource: string,
  identifier: string,
  expectedRevision?: number,
): RevisionConflict {
  return {
    ok: false,
    code: "revision_conflict",
    expectedRevision: expectedRevision ?? 0,
    actualRevision: 0,
    message: `${resource} ${identifier} does not exist.`,
  };
}

function cloneRecord(record: AppForgeRecord): AppForgeRecord {
  return {
    ...record,
    values: { ...record.values },
  };
}

function cloneTable(table: AppForgeTable): AppForgeTable {
  return {
    ...table,
    fields: table.fields.map((field) => ({
      ...field,
      options: field.options ? [...field.options] : undefined,
    })),
    records: table.records.map(cloneRecord),
  };
}

function cloneBase(base: AppForgeBase): AppForgeBase {
  return {
    ...base,
    tables: base.tables.map(cloneTable),
  };
}

function fieldsFromJson(value: unknown): AppForgeField[] {
  return Array.isArray(value) ? (value as AppForgeField[]) : [];
}

function valuesFromJson(value: unknown): Record<string, AppForgeRecordValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, AppForgeRecordValue>)
    : {};
}

function baseRowToBase(row: AppForgeBaseRow, tables: AppForgeTable[]): AppForgeBase {
  return {
    id: row.id,
    appId: row.appId ?? row.app_id ?? "",
    name: row.name,
    description: row.description ?? undefined,
    activeTableId: row.activeTableId ?? row.active_table_id ?? tables[0]?.id ?? "",
    revision: row.revision,
    updatedAt: toIso(row.updatedAt ?? row.updated_at),
    tables,
  };
}

function tableRowToTable(row: AppForgeTableRow, records: AppForgeRecord[]): AppForgeTable {
  return {
    id: row.id,
    name: row.name,
    fields: fieldsFromJson(row.fields),
    records,
    revision: row.revision,
  };
}

function recordRowToRecord(row: AppForgeRecordRow): AppForgeRecord {
  return {
    id: row.id,
    values: valuesFromJson(row.values),
    revision: row.revision,
    createdAt: toIso(row.createdAt ?? row.created_at),
    updatedAt: toIso(row.updatedAt ?? row.updated_at),
  };
}

function responseFromIdempotency<T>(value: unknown): T | null {
  return value !== null && typeof value === "object" ? (value as T) : null;
}

function transactionSql(tx: postgres.TransactionSql): SqlClient {
  return tx as unknown as SqlClient;
}

async function readIdempotency<T>(
  sql: SqlClient,
  idempotencyKey: string | undefined,
): Promise<T | null> {
  if (!idempotencyKey) {
    return null;
  }
  const rows = await sql<IdempotencyRow[]>`
    SELECT response
    FROM appforge_idempotency_keys
    WHERE idempotency_key = ${idempotencyKey}
    LIMIT 1
  `;
  return rows[0] ? responseFromIdempotency<T>(rows[0].response) : null;
}

async function writeIdempotency(
  tx: SqlClient,
  params: {
    idempotencyKey?: string;
    operation: string;
    resourceType: string;
    resourceId: string;
    response: unknown;
  },
): Promise<void> {
  if (!params.idempotencyKey) {
    return;
  }
  await tx`
    INSERT INTO appforge_idempotency_keys (
      idempotency_key,
      operation,
      resource_type,
      resource_id,
      response
    )
    VALUES (
      ${params.idempotencyKey},
      ${params.operation},
      ${params.resourceType},
      ${params.resourceId},
      ${tx.json(params.response as postgres.JSONValue)}
    )
    ON CONFLICT (idempotency_key) DO NOTHING
  `;
}

async function selectBaseRow(sql: SqlClient, baseId: string): Promise<AppForgeBaseRow | null> {
  const rows = await sql<AppForgeBaseRow[]>`
    SELECT
      id,
      app_id AS "appId",
      name,
      description,
      active_table_id AS "activeTableId",
      revision,
      updated_at AS "updatedAt"
    FROM appforge_bases
    WHERE id = ${baseId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function selectTableRow(
  sql: SqlClient,
  baseId: string,
  tableId: string,
): Promise<AppForgeTableRow | null> {
  const rows = await sql<AppForgeTableRow[]>`
    SELECT
      id,
      base_id AS "baseId",
      name,
      fields,
      revision,
      position,
      updated_at AS "updatedAt"
    FROM appforge_tables
    WHERE base_id = ${baseId} AND id = ${tableId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function selectRecordRow(
  sql: SqlClient,
  baseId: string,
  tableId: string,
  recordId: string,
): Promise<AppForgeRecordRow | null> {
  const rows = await sql<AppForgeRecordRow[]>`
    SELECT
      id,
      base_id AS "baseId",
      table_id AS "tableId",
      "values" AS values,
      revision,
      position,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM appforge_records
    WHERE base_id = ${baseId} AND table_id = ${tableId} AND id = ${recordId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function listTableRows(sql: SqlClient, baseId: string): Promise<AppForgeTableRow[]> {
  return await sql<AppForgeTableRow[]>`
    SELECT
      id,
      base_id AS "baseId",
      name,
      fields,
      revision,
      position,
      updated_at AS "updatedAt"
    FROM appforge_tables
    WHERE base_id = ${baseId}
    ORDER BY position ASC, created_at ASC, id ASC
  `;
}

async function listRecordRows(
  sql: SqlClient,
  baseId: string,
  tableId: string,
): Promise<AppForgeRecordRow[]> {
  return await sql<AppForgeRecordRow[]>`
    SELECT
      id,
      base_id AS "baseId",
      table_id AS "tableId",
      "values" AS values,
      revision,
      position,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM appforge_records
    WHERE base_id = ${baseId} AND table_id = ${tableId}
    ORDER BY position ASC, created_at ASC, id ASC
  `;
}

async function hydrateTable(sql: SqlClient, baseId: string, row: AppForgeTableRow) {
  const recordRows = await listRecordRows(sql, baseId, row.id);
  return tableRowToTable(row, recordRows.map(recordRowToRecord));
}

async function hydrateBase(sql: SqlClient, row: AppForgeBaseRow): Promise<AppForgeBase> {
  const tableRows = await listTableRows(sql, row.id);
  const tables = await Promise.all(
    tableRows.map((tableRow) => hydrateTable(sql, row.id, tableRow)),
  );
  return baseRowToBase(row, tables);
}

async function insertTableTree(
  tx: SqlClient,
  baseId: string,
  table: AppForgeTable,
  position: number,
): Promise<void> {
  const timestamp = nowIso();
  await tx`
    INSERT INTO appforge_tables (
      id,
      base_id,
      name,
      fields,
      revision,
      position,
      updated_at
    )
    VALUES (
      ${table.id},
      ${baseId},
      ${table.name},
      ${tx.json(table.fields as postgres.JSONValue)},
      ${table.revision},
      ${position},
      ${timestamp}
    )
  `;

  for (const [recordPosition, record] of table.records.entries()) {
    await tx`
      INSERT INTO appforge_records (
        id,
        base_id,
        table_id,
        "values",
        revision,
        position,
        created_at,
        updated_at
      )
      VALUES (
        ${record.id},
        ${baseId},
        ${table.id},
        ${tx.json(record.values as postgres.JSONValue)},
        ${record.revision},
        ${recordPosition},
        ${record.createdAt},
        ${record.updatedAt}
      )
    `;
  }
}

export function createInMemoryAppForgeStore(seed: AppForgeBase[] = []): AppForgeStore {
  return createInMemoryAppForgeAdapter(seed);
}

export async function ensurePostgresAppForgeSchema(sql: SqlClient): Promise<void> {
  const unsafe = (sql as SqlClientWithUnsafe).unsafe;
  if (typeof unsafe !== "function") {
    throw new Error("Postgres client does not support raw schema execution.");
  }
  await unsafe.call(sql, APP_FORGE_STORAGE_SCHEMA_SQL);
}

export function createPostgresAppForgeStore(sql: SqlClient): AppForgeStore {
  let schemaReady: Promise<void> | null = null;
  async function ensureReady() {
    schemaReady ??= ensurePostgresAppForgeSchema(sql).catch((error) => {
      schemaReady = null;
      throw error;
    });
    await schemaReady;
  }

  return {
    async listBases(opts) {
      await ensureReady();
      const rows = opts?.appId
        ? await sql<AppForgeBaseRow[]>`
            SELECT
              id,
              app_id AS "appId",
              name,
              description,
              active_table_id AS "activeTableId",
              revision,
              updated_at AS "updatedAt"
            FROM appforge_bases
            WHERE app_id = ${opts.appId}
            ORDER BY updated_at DESC, id ASC
          `
        : await sql<AppForgeBaseRow[]>`
            SELECT
              id,
              app_id AS "appId",
              name,
              description,
              active_table_id AS "activeTableId",
              revision,
              updated_at AS "updatedAt"
            FROM appforge_bases
            ORDER BY updated_at DESC, id ASC
          `;
      return Promise.all(rows.map((row) => hydrateBase(sql, row)));
    },

    async getBase(baseId) {
      await ensureReady();
      const row = await selectBaseRow(sql, baseId);
      return row ? hydrateBase(sql, row) : null;
    },

    async putBase(write: AppForgeBaseWrite): Promise<AppForgeWriteResult> {
      await ensureReady();
      const replay = await readIdempotency<AppForgeWriteResult>(sql, write.idempotencyKey);
      if (replay) {
        return replay;
      }

      return await sql.begin(async (transaction) => {
        const tx = transactionSql(transaction);
        const current = await selectBaseRow(tx, write.base.id);
        const revisionCheck = checkAppForgeRevision(current?.revision ?? 0, write.expectedRevision);
        if (!revisionCheck.ok) {
          return revisionCheck;
        }

        const timestamp = nowIso();
        const nextBase = cloneBase({
          ...write.base,
          revision: (current?.revision ?? 0) + 1,
          updatedAt: timestamp,
        });

        await tx`
          INSERT INTO appforge_bases (
            id,
            app_id,
            name,
            description,
            active_table_id,
            revision,
            updated_at
          )
          VALUES (
            ${nextBase.id},
            ${nextBase.appId},
            ${nextBase.name},
            ${nextBase.description ?? null},
            ${nextBase.activeTableId || null},
            ${nextBase.revision},
            ${timestamp}
          )
          ON CONFLICT (id) DO UPDATE SET
            app_id = EXCLUDED.app_id,
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            active_table_id = EXCLUDED.active_table_id,
            revision = EXCLUDED.revision,
            updated_at = EXCLUDED.updated_at
        `;
        await tx`DELETE FROM appforge_tables WHERE base_id = ${nextBase.id}`;
        for (const [position, table] of nextBase.tables.entries()) {
          await insertTableTree(tx, nextBase.id, table, position);
        }

        const response: AppForgeWriteResult = { ok: true, base: cloneBase(nextBase) };
        await writeIdempotency(tx, {
          idempotencyKey: write.idempotencyKey,
          operation: "base.put",
          resourceType: "base",
          resourceId: nextBase.id,
          response,
        });
        return response;
      });
    },

    async deleteBase(baseId, opts): Promise<AppForgeWriteResult> {
      await ensureReady();
      return await sql.begin(async (transaction) => {
        const tx = transactionSql(transaction);
        const currentRow = await selectBaseRow(tx, baseId);
        if (!currentRow) {
          return missingConflict("Base", baseId, opts?.expectedRevision);
        }
        const revisionCheck = checkAppForgeRevision(currentRow.revision, opts?.expectedRevision);
        if (!revisionCheck.ok) {
          return revisionCheck;
        }

        const currentBase = await hydrateBase(tx, currentRow);
        await tx`DELETE FROM appforge_bases WHERE id = ${baseId}`;
        return {
          ok: true,
          base: cloneBase({ ...currentBase, revision: currentBase.revision + 1 }),
        };
      });
    },

    async listTables(baseId) {
      await ensureReady();
      const tableRows = await listTableRows(sql, baseId);
      return Promise.all(tableRows.map((row) => hydrateTable(sql, baseId, row)));
    },

    async getTable(baseId, tableId) {
      await ensureReady();
      const tableRow = await selectTableRow(sql, baseId, tableId);
      return tableRow ? hydrateTable(sql, baseId, tableRow) : null;
    },

    async putTable(
      baseId: string,
      table: AppForgeTable,
      opts?: AppForgeTableWriteOptions,
    ): Promise<AppForgeTableWriteResult> {
      await ensureReady();
      const replay = await readIdempotency<AppForgeTableWriteResult>(sql, opts?.idempotencyKey);
      if (replay) {
        return replay;
      }

      return await sql.begin(async (transaction) => {
        const tx = transactionSql(transaction);
        const baseRow = await selectBaseRow(tx, baseId);
        if (!baseRow) {
          return missingConflict("Base", baseId, opts?.expectedBaseRevision);
        }

        const baseRevisionCheck = checkAppForgeRevision(
          baseRow.revision,
          opts?.expectedBaseRevision,
        );
        if (!baseRevisionCheck.ok) {
          return baseRevisionCheck;
        }

        const currentTableRow = await selectTableRow(tx, baseId, table.id);
        const tableRevisionCheck = checkAppForgeRevision(
          currentTableRow?.revision ?? 0,
          opts?.expectedTableRevision,
        );
        if (!tableRevisionCheck.ok) {
          return tableRevisionCheck;
        }

        const tableCount = await tx<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM appforge_tables
          WHERE base_id = ${baseId}
        `;
        const position = currentTableRow?.position ?? Number(tableCount[0]?.count ?? 0);
        const timestamp = nowIso();
        const nextTable = cloneTable({
          ...table,
          revision: (currentTableRow?.revision ?? 0) + 1,
        });

        await tx`
          INSERT INTO appforge_tables (
            id,
            base_id,
            name,
            fields,
            revision,
            position,
            updated_at
          )
          VALUES (
            ${nextTable.id},
            ${baseId},
            ${nextTable.name},
            ${tx.json(nextTable.fields as postgres.JSONValue)},
            ${nextTable.revision},
            ${position},
            ${timestamp}
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            fields = EXCLUDED.fields,
            revision = EXCLUDED.revision,
            position = EXCLUDED.position,
            updated_at = EXCLUDED.updated_at
        `;
        await tx`DELETE FROM appforge_records WHERE base_id = ${baseId} AND table_id = ${nextTable.id}`;
        for (const [recordPosition, record] of nextTable.records.entries()) {
          await tx`
            INSERT INTO appforge_records (
              id,
              base_id,
              table_id,
              "values",
              revision,
              position,
              created_at,
              updated_at
            )
            VALUES (
              ${record.id},
              ${baseId},
              ${nextTable.id},
              ${tx.json(record.values as postgres.JSONValue)},
              ${record.revision},
              ${recordPosition},
              ${record.createdAt},
              ${record.updatedAt}
            )
          `;
        }

        const nextActiveTableId = baseRow.activeTableId ?? baseRow.active_table_id ?? nextTable.id;
        const updatedRows = await tx<AppForgeBaseRow[]>`
          UPDATE appforge_bases
          SET
            active_table_id = ${nextActiveTableId || nextTable.id},
            revision = revision + 1,
            updated_at = ${timestamp}
          WHERE id = ${baseId}
          RETURNING
            id,
            app_id AS "appId",
            name,
            description,
            active_table_id AS "activeTableId",
            revision,
            updated_at AS "updatedAt"
        `;
        const nextBase = await hydrateBase(tx, updatedRows[0]);
        const response: AppForgeTableWriteResult = {
          ok: true,
          base: cloneBase(nextBase),
          table: cloneTable(nextTable),
        };
        await writeIdempotency(tx, {
          idempotencyKey: opts?.idempotencyKey,
          operation: "table.put",
          resourceType: "table",
          resourceId: nextTable.id,
          response,
        });
        return response;
      });
    },

    async deleteTable(baseId, tableId, opts): Promise<AppForgeTableWriteResult> {
      await ensureReady();
      return await sql.begin(async (transaction) => {
        const tx = transactionSql(transaction);
        const baseRow = await selectBaseRow(tx, baseId);
        if (!baseRow) {
          return missingConflict("Base", baseId, opts?.expectedBaseRevision);
        }

        const baseRevisionCheck = checkAppForgeRevision(
          baseRow.revision,
          opts?.expectedBaseRevision,
        );
        if (!baseRevisionCheck.ok) {
          return baseRevisionCheck;
        }

        const currentTableRow = await selectTableRow(tx, baseId, tableId);
        if (!currentTableRow) {
          return missingConflict(`Table ${tableId} in base`, baseId, opts?.expectedTableRevision);
        }

        const tableRevisionCheck = checkAppForgeRevision(
          currentTableRow.revision,
          opts?.expectedTableRevision,
        );
        if (!tableRevisionCheck.ok) {
          return tableRevisionCheck;
        }

        const currentTable = await hydrateTable(tx, baseId, currentTableRow);
        await tx`DELETE FROM appforge_tables WHERE base_id = ${baseId} AND id = ${tableId}`;
        const remainingRows = await listTableRows(tx, baseId);
        const currentActiveTableId = baseRow.activeTableId ?? baseRow.active_table_id ?? "";
        const nextActiveTableId =
          currentActiveTableId === tableId ? (remainingRows[0]?.id ?? "") : currentActiveTableId;
        const updatedRows = await tx<AppForgeBaseRow[]>`
          UPDATE appforge_bases
          SET
            active_table_id = ${nextActiveTableId || null},
            revision = revision + 1,
            updated_at = ${nowIso()}
          WHERE id = ${baseId}
          RETURNING
            id,
            app_id AS "appId",
            name,
            description,
            active_table_id AS "activeTableId",
            revision,
            updated_at AS "updatedAt"
        `;
        const nextBase = await hydrateBase(tx, updatedRows[0]);
        return {
          ok: true,
          base: cloneBase(nextBase),
          table: cloneTable({ ...currentTable, revision: currentTable.revision + 1 }),
        };
      });
    },

    async listRecords(baseId, tableId) {
      await ensureReady();
      const rows = await listRecordRows(sql, baseId, tableId);
      return rows.map(recordRowToRecord);
    },

    async putRecord(
      baseId: string,
      tableId: string,
      record: AppForgeRecord,
      opts?: AppForgeRecordWriteOptions,
    ): Promise<AppForgeRecordWriteResult> {
      await ensureReady();
      const replay = await readIdempotency<AppForgeRecordWriteResult>(sql, opts?.idempotencyKey);
      if (replay) {
        return replay;
      }

      return await sql.begin(async (transaction) => {
        const tx = transactionSql(transaction);
        const baseRow = await selectBaseRow(tx, baseId);
        if (!baseRow) {
          return missingConflict("Base", baseId, opts?.expectedBaseRevision);
        }
        const baseRevisionCheck = checkAppForgeRevision(
          baseRow.revision,
          opts?.expectedBaseRevision,
        );
        if (!baseRevisionCheck.ok) {
          return baseRevisionCheck;
        }

        const tableRow = await selectTableRow(tx, baseId, tableId);
        if (!tableRow) {
          return missingConflict(`Table ${tableId} in base`, baseId, opts?.expectedTableRevision);
        }
        const tableRevisionCheck = checkAppForgeRevision(
          tableRow.revision,
          opts?.expectedTableRevision,
        );
        if (!tableRevisionCheck.ok) {
          return tableRevisionCheck;
        }

        const currentRecordRow = await selectRecordRow(tx, baseId, tableId, record.id);
        const recordRevisionCheck = checkAppForgeRevision(
          currentRecordRow?.revision ?? 0,
          opts?.expectedRecordRevision,
        );
        if (!recordRevisionCheck.ok) {
          return recordRevisionCheck;
        }

        const recordCount = await tx<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM appforge_records
          WHERE base_id = ${baseId} AND table_id = ${tableId}
        `;
        const timestamp = nowIso();
        const position = currentRecordRow?.position ?? Number(recordCount[0]?.count ?? 0);
        const nextRecord = cloneRecord({
          ...record,
          revision: (currentRecordRow?.revision ?? 0) + 1,
          createdAt: toIso(
            currentRecordRow?.createdAt ?? currentRecordRow?.created_at ?? record.createdAt,
          ),
          updatedAt: timestamp,
        });

        await tx`
          INSERT INTO appforge_records (
            id,
            base_id,
            table_id,
            "values",
            revision,
            position,
            created_at,
            updated_at
          )
          VALUES (
            ${nextRecord.id},
            ${baseId},
            ${tableId},
            ${tx.json(nextRecord.values as postgres.JSONValue)},
            ${nextRecord.revision},
            ${position},
            ${nextRecord.createdAt},
            ${nextRecord.updatedAt}
          )
          ON CONFLICT (id) DO UPDATE SET
            "values" = EXCLUDED."values",
            revision = EXCLUDED.revision,
            position = EXCLUDED.position,
            updated_at = EXCLUDED.updated_at
        `;
        await tx`
          UPDATE appforge_tables
          SET revision = revision + 1, updated_at = ${timestamp}
          WHERE base_id = ${baseId} AND id = ${tableId}
        `;
        const updatedBaseRows = await tx<AppForgeBaseRow[]>`
          UPDATE appforge_bases
          SET revision = revision + 1, updated_at = ${timestamp}
          WHERE id = ${baseId}
          RETURNING
            id,
            app_id AS "appId",
            name,
            description,
            active_table_id AS "activeTableId",
            revision,
            updated_at AS "updatedAt"
        `;
        const updatedTableRow = await selectTableRow(tx, baseId, tableId);
        const nextTable = updatedTableRow ? await hydrateTable(tx, baseId, updatedTableRow) : null;
        const nextBase = await hydrateBase(tx, updatedBaseRows[0]);
        const response: AppForgeRecordWriteResult = {
          ok: true,
          base: cloneBase(nextBase),
          table: cloneTable(nextTable!),
          record: cloneRecord(nextRecord),
        };
        await writeIdempotency(tx, {
          idempotencyKey: opts?.idempotencyKey,
          operation: "record.put",
          resourceType: "record",
          resourceId: nextRecord.id,
          response,
        });
        return response;
      });
    },

    async deleteRecord(baseId, tableId, recordId, opts): Promise<AppForgeRecordWriteResult> {
      await ensureReady();
      return await sql.begin(async (transaction) => {
        const tx = transactionSql(transaction);
        const baseRow = await selectBaseRow(tx, baseId);
        if (!baseRow) {
          return missingConflict("Base", baseId, opts?.expectedBaseRevision);
        }
        const baseRevisionCheck = checkAppForgeRevision(
          baseRow.revision,
          opts?.expectedBaseRevision,
        );
        if (!baseRevisionCheck.ok) {
          return baseRevisionCheck;
        }

        const tableRow = await selectTableRow(tx, baseId, tableId);
        if (!tableRow) {
          return missingConflict(`Table ${tableId} in base`, baseId, opts?.expectedTableRevision);
        }
        const tableRevisionCheck = checkAppForgeRevision(
          tableRow.revision,
          opts?.expectedTableRevision,
        );
        if (!tableRevisionCheck.ok) {
          return tableRevisionCheck;
        }

        const currentRecordRow = await selectRecordRow(tx, baseId, tableId, recordId);
        if (!currentRecordRow) {
          return missingConflict(
            `Record ${recordId} in table ${tableId}`,
            baseId,
            opts?.expectedRecordRevision,
          );
        }
        const recordRevisionCheck = checkAppForgeRevision(
          currentRecordRow.revision,
          opts?.expectedRecordRevision,
        );
        if (!recordRevisionCheck.ok) {
          return recordRevisionCheck;
        }

        const currentRecord = recordRowToRecord(currentRecordRow);
        const timestamp = nowIso();
        await tx`
          DELETE FROM appforge_records
          WHERE base_id = ${baseId} AND table_id = ${tableId} AND id = ${recordId}
        `;
        await tx`
          UPDATE appforge_tables
          SET revision = revision + 1, updated_at = ${timestamp}
          WHERE base_id = ${baseId} AND id = ${tableId}
        `;
        const updatedBaseRows = await tx<AppForgeBaseRow[]>`
          UPDATE appforge_bases
          SET revision = revision + 1, updated_at = ${timestamp}
          WHERE id = ${baseId}
          RETURNING
            id,
            app_id AS "appId",
            name,
            description,
            active_table_id AS "activeTableId",
            revision,
            updated_at AS "updatedAt"
        `;
        const updatedTableRow = await selectTableRow(tx, baseId, tableId);
        const nextTable = updatedTableRow ? await hydrateTable(tx, baseId, updatedTableRow) : null;
        const nextBase = await hydrateBase(tx, updatedBaseRows[0]);
        return {
          ok: true,
          base: cloneBase(nextBase),
          table: cloneTable(nextTable!),
          record: cloneRecord({ ...currentRecord, revision: currentRecord.revision + 1 }),
        };
      });
    },
  };
}
