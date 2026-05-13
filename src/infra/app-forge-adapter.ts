import type { AppForgeActorEnvelope } from "./app-forge-permissions.js";
import {
  checkAppForgeRevision,
  normalizeAppForgeSavedView,
  type AppForgeBase,
  type AppForgeRecord,
  type AppForgeRevisionCheck,
  type AppForgeSavedView,
  type AppForgeTable,
} from "./app-forge-model.js";

export type AppForgeBaseWrite = {
  base: AppForgeBase;
  expectedRevision?: number;
  idempotencyKey?: string;
  /** Actor that initiated the write — threaded for audit trail (#336). */
  actor?: AppForgeActorEnvelope;
};

type AppForgeRevisionConflict = Exclude<AppForgeRevisionCheck, { ok: true }>;

export type AppForgeWriteResult = { ok: true; base: AppForgeBase } | AppForgeRevisionConflict;

export type AppForgeTableWriteOptions = {
  expectedBaseRevision?: number;
  expectedTableRevision?: number;
  idempotencyKey?: string;
  /** Actor that initiated the write — threaded for audit trail (#336). */
  actor?: AppForgeActorEnvelope;
};

export type AppForgeTableWriteResult =
  | {
      ok: true;
      base: AppForgeBase;
      table: AppForgeTable;
    }
  | AppForgeRevisionConflict;

export type AppForgeRecordWriteOptions = {
  expectedBaseRevision?: number;
  expectedTableRevision?: number;
  expectedRecordRevision?: number;
  idempotencyKey?: string;
  /** Actor that initiated the write — threaded for audit trail (#336). */
  actor?: AppForgeActorEnvelope;
};

export type AppForgeRecordWriteResult =
  | {
      ok: true;
      base: AppForgeBase;
      table: AppForgeTable;
      record: AppForgeRecord;
    }
  | AppForgeRevisionConflict;

export type AppForgeSavedViewWriteOptions = {
  expectedBaseRevision?: number;
  expectedTableRevision?: number;
  idempotencyKey?: string;
  /** Actor that initiated the write — threaded for audit trail (#336). */
  actor?: AppForgeActorEnvelope;
};

export type AppForgeSavedViewWriteResult =
  | {
      ok: true;
      base: AppForgeBase;
      table: AppForgeTable;
      view: AppForgeSavedView;
    }
  | AppForgeRevisionConflict;

export interface AppForgeAdapter {
  listBases(opts?: { appId?: string }): Promise<AppForgeBase[]>;
  getBase(baseId: string): Promise<AppForgeBase | null>;
  putBase(write: AppForgeBaseWrite): Promise<AppForgeWriteResult>;
  deleteBase(baseId: string, opts?: { expectedRevision?: number }): Promise<AppForgeWriteResult>;
  listTables(baseId: string): Promise<AppForgeTable[]>;
  getTable(baseId: string, tableId: string): Promise<AppForgeTable | null>;
  putTable(
    baseId: string,
    table: AppForgeTable,
    opts?: AppForgeTableWriteOptions,
  ): Promise<AppForgeTableWriteResult>;
  deleteTable(
    baseId: string,
    tableId: string,
    opts?: Omit<AppForgeTableWriteOptions, "idempotencyKey">,
  ): Promise<AppForgeTableWriteResult>;
  listRecords(baseId: string, tableId: string): Promise<AppForgeRecord[]>;
  putRecord(
    baseId: string,
    tableId: string,
    record: AppForgeRecord,
    opts?: AppForgeRecordWriteOptions,
  ): Promise<AppForgeRecordWriteResult>;
  deleteRecord(
    baseId: string,
    tableId: string,
    recordId: string,
    opts?: Omit<AppForgeRecordWriteOptions, "idempotencyKey">,
  ): Promise<AppForgeRecordWriteResult>;
  /**
   * Saved-view CRUD (Phase 4 gap #1). Views live as durable table metadata,
   * not in operator-local localStorage. Permissions inherit from the parent
   * table — anyone who can write the table may upsert/delete views on it.
   *
   * `listViews` always returns `[]` (not `null`) for tables without views so
   * callers don't have to disambiguate "table not found" from "no views" —
   * that's what `getTable` is for.
   */
  listViews(baseId: string, tableId: string): Promise<AppForgeSavedView[]>;
  putView(
    baseId: string,
    tableId: string,
    view: AppForgeSavedView,
    opts?: AppForgeSavedViewWriteOptions,
  ): Promise<AppForgeSavedViewWriteResult>;
  deleteView(
    baseId: string,
    tableId: string,
    viewId: string,
    opts?: Omit<AppForgeSavedViewWriteOptions, "idempotencyKey">,
  ): Promise<AppForgeSavedViewWriteResult>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function missingConflict(
  resource: string,
  identifier: string,
  expectedRevision?: number,
): AppForgeRevisionConflict {
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

function cloneSavedView(view: AppForgeSavedView): AppForgeSavedView {
  return {
    ...view,
    visibleFieldIds: view.visibleFieldIds ? [...view.visibleFieldIds] : undefined,
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
    views: table.views ? table.views.map(cloneSavedView) : undefined,
    activeCell: table.activeCell ? { ...table.activeCell } : undefined,
  };
}

function cloneBase(base: AppForgeBase): AppForgeBase {
  return {
    ...base,
    tables: base.tables.map(cloneTable),
  };
}

export function createInMemoryAppForgeAdapter(seed: AppForgeBase[] = []): AppForgeAdapter {
  const bases = new Map(seed.map((base) => [base.id, cloneBase(base)]));
  const appliedBaseIdempotencyKeys = new Map<string, AppForgeBase>();
  const appliedTableIdempotencyKeys = new Map<
    string,
    { base: AppForgeBase; table: AppForgeTable }
  >();
  const appliedRecordIdempotencyKeys = new Map<
    string,
    { base: AppForgeBase; table: AppForgeTable; record: AppForgeRecord }
  >();
  const appliedSavedViewIdempotencyKeys = new Map<
    string,
    { base: AppForgeBase; table: AppForgeTable; view: AppForgeSavedView }
  >();

  return {
    async listBases(opts) {
      return [...bases.values()]
        .filter((base) => !opts?.appId || base.appId === opts.appId)
        .map(cloneBase);
    },

    async getBase(baseId) {
      const base = bases.get(baseId);
      return base ? cloneBase(base) : null;
    },

    async putBase(write) {
      if (write.idempotencyKey) {
        const applied = appliedBaseIdempotencyKeys.get(write.idempotencyKey);
        if (applied) {
          return { ok: true, base: cloneBase(applied) };
        }
      }

      const current = bases.get(write.base.id);
      const revisionCheck = checkAppForgeRevision(current?.revision ?? 0, write.expectedRevision);
      if (!revisionCheck.ok) {
        return revisionCheck;
      }

      const nextBase = cloneBase({
        ...write.base,
        revision: (current?.revision ?? 0) + 1,
        updatedAt: nowIso(),
      });
      bases.set(nextBase.id, nextBase);
      if (write.idempotencyKey) {
        appliedBaseIdempotencyKeys.set(write.idempotencyKey, nextBase);
      }
      return { ok: true, base: cloneBase(nextBase) };
    },

    async deleteBase(baseId, opts) {
      const current = bases.get(baseId);
      if (!current) {
        return {
          ok: false,
          code: "revision_conflict",
          expectedRevision: opts?.expectedRevision ?? 0,
          actualRevision: 0,
          message: `Base ${baseId} does not exist.`,
        };
      }

      const revisionCheck = checkAppForgeRevision(current.revision, opts?.expectedRevision);
      if (!revisionCheck.ok) {
        return revisionCheck;
      }

      bases.delete(baseId);
      return { ok: true, base: cloneBase({ ...current, revision: current.revision + 1 }) };
    },

    async listTables(baseId) {
      const base = bases.get(baseId);
      return base ? base.tables.map(cloneTable) : [];
    },

    async getTable(baseId, tableId) {
      const base = bases.get(baseId);
      const table = base?.tables.find((item) => item.id === tableId);
      return table ? cloneTable(table) : null;
    },

    async putTable(baseId, table, opts) {
      if (opts?.idempotencyKey) {
        const applied = appliedTableIdempotencyKeys.get(opts.idempotencyKey);
        if (applied) {
          return {
            ok: true,
            base: cloneBase(applied.base),
            table: cloneTable(applied.table),
          };
        }
      }

      const base = bases.get(baseId);
      if (!base) {
        return missingConflict("Base", baseId, opts?.expectedBaseRevision);
      }

      const baseRevisionCheck = checkAppForgeRevision(base.revision, opts?.expectedBaseRevision);
      if (!baseRevisionCheck.ok) {
        return baseRevisionCheck;
      }

      const currentTable = base.tables.find((item) => item.id === table.id);
      const tableRevisionCheck = checkAppForgeRevision(
        currentTable?.revision ?? 0,
        opts?.expectedTableRevision,
      );
      if (!tableRevisionCheck.ok) {
        return tableRevisionCheck;
      }

      const nextTable = cloneTable({
        ...table,
        revision: (currentTable?.revision ?? 0) + 1,
      });
      const nextTables = currentTable
        ? base.tables.map((item) => (item.id === nextTable.id ? nextTable : item))
        : [...base.tables, nextTable];
      const nextBase = cloneBase({
        ...base,
        activeTableId: base.activeTableId || nextTable.id,
        tables: nextTables,
        revision: base.revision + 1,
        updatedAt: nowIso(),
      });

      bases.set(baseId, nextBase);
      if (opts?.idempotencyKey) {
        appliedTableIdempotencyKeys.set(opts.idempotencyKey, {
          base: nextBase,
          table: nextTable,
        });
      }
      return {
        ok: true,
        base: cloneBase(nextBase),
        table: cloneTable(nextTable),
      };
    },

    async deleteTable(baseId, tableId, opts) {
      const base = bases.get(baseId);
      if (!base) {
        return missingConflict("Base", baseId, opts?.expectedBaseRevision);
      }

      const baseRevisionCheck = checkAppForgeRevision(base.revision, opts?.expectedBaseRevision);
      if (!baseRevisionCheck.ok) {
        return baseRevisionCheck;
      }

      const currentTable = base.tables.find((item) => item.id === tableId);
      if (!currentTable) {
        return missingConflict(`Table ${tableId} in base`, baseId, opts?.expectedTableRevision);
      }

      const tableRevisionCheck = checkAppForgeRevision(
        currentTable.revision,
        opts?.expectedTableRevision,
      );
      if (!tableRevisionCheck.ok) {
        return tableRevisionCheck;
      }

      const nextTables = base.tables.filter((item) => item.id !== tableId);
      const nextBase = cloneBase({
        ...base,
        activeTableId:
          base.activeTableId === tableId ? (nextTables[0]?.id ?? "") : base.activeTableId,
        tables: nextTables,
        revision: base.revision + 1,
        updatedAt: nowIso(),
      });

      bases.set(baseId, nextBase);
      return {
        ok: true,
        base: cloneBase(nextBase),
        table: cloneTable({ ...currentTable, revision: currentTable.revision + 1 }),
      };
    },

    async listRecords(baseId, tableId) {
      const base = bases.get(baseId);
      const table = base?.tables.find((item) => item.id === tableId);
      return table ? table.records.map(cloneRecord) : [];
    },

    async putRecord(baseId, tableId, record, opts) {
      if (opts?.idempotencyKey) {
        const applied = appliedRecordIdempotencyKeys.get(opts.idempotencyKey);
        if (applied) {
          return {
            ok: true,
            base: cloneBase(applied.base),
            table: cloneTable(applied.table),
            record: cloneRecord(applied.record),
          };
        }
      }

      const base = bases.get(baseId);
      if (!base) {
        return missingConflict("Base", baseId, opts?.expectedBaseRevision);
      }

      const baseRevisionCheck = checkAppForgeRevision(base.revision, opts?.expectedBaseRevision);
      if (!baseRevisionCheck.ok) {
        return baseRevisionCheck;
      }

      const currentTable = base.tables.find((item) => item.id === tableId);
      if (!currentTable) {
        return missingConflict(`Table ${tableId} in base`, baseId, opts?.expectedTableRevision);
      }

      const tableRevisionCheck = checkAppForgeRevision(
        currentTable.revision,
        opts?.expectedTableRevision,
      );
      if (!tableRevisionCheck.ok) {
        return tableRevisionCheck;
      }

      const currentRecord = currentTable.records.find((item) => item.id === record.id);
      const recordRevisionCheck = checkAppForgeRevision(
        currentRecord?.revision ?? 0,
        opts?.expectedRecordRevision,
      );
      if (!recordRevisionCheck.ok) {
        return recordRevisionCheck;
      }

      const timestamp = nowIso();
      const nextRecord = cloneRecord({
        ...record,
        revision: (currentRecord?.revision ?? 0) + 1,
        createdAt: currentRecord?.createdAt ?? record.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
      const nextTable = cloneTable({
        ...currentTable,
        records: currentRecord
          ? currentTable.records.map((item) => (item.id === nextRecord.id ? nextRecord : item))
          : [...currentTable.records, nextRecord],
        revision: currentTable.revision + 1,
      });
      const nextBase = cloneBase({
        ...base,
        tables: base.tables.map((item) => (item.id === tableId ? nextTable : item)),
        revision: base.revision + 1,
        updatedAt: timestamp,
      });

      bases.set(baseId, nextBase);
      if (opts?.idempotencyKey) {
        appliedRecordIdempotencyKeys.set(opts.idempotencyKey, {
          base: nextBase,
          table: nextTable,
          record: nextRecord,
        });
      }
      return {
        ok: true,
        base: cloneBase(nextBase),
        table: cloneTable(nextTable),
        record: cloneRecord(nextRecord),
      };
    },

    async deleteRecord(baseId, tableId, recordId, opts) {
      const base = bases.get(baseId);
      if (!base) {
        return missingConflict("Base", baseId, opts?.expectedBaseRevision);
      }

      const baseRevisionCheck = checkAppForgeRevision(base.revision, opts?.expectedBaseRevision);
      if (!baseRevisionCheck.ok) {
        return baseRevisionCheck;
      }

      const currentTable = base.tables.find((item) => item.id === tableId);
      if (!currentTable) {
        return missingConflict(`Table ${tableId} in base`, baseId, opts?.expectedTableRevision);
      }

      const tableRevisionCheck = checkAppForgeRevision(
        currentTable.revision,
        opts?.expectedTableRevision,
      );
      if (!tableRevisionCheck.ok) {
        return tableRevisionCheck;
      }

      const currentRecord = currentTable.records.find((item) => item.id === recordId);
      if (!currentRecord) {
        return missingConflict(
          `Record ${recordId} in table ${tableId}`,
          baseId,
          opts?.expectedRecordRevision,
        );
      }

      const recordRevisionCheck = checkAppForgeRevision(
        currentRecord.revision,
        opts?.expectedRecordRevision,
      );
      if (!recordRevisionCheck.ok) {
        return recordRevisionCheck;
      }

      const timestamp = nowIso();
      const nextTable = cloneTable({
        ...currentTable,
        records: currentTable.records.filter((item) => item.id !== recordId),
        revision: currentTable.revision + 1,
      });
      const nextBase = cloneBase({
        ...base,
        tables: base.tables.map((item) => (item.id === tableId ? nextTable : item)),
        revision: base.revision + 1,
        updatedAt: timestamp,
      });

      bases.set(baseId, nextBase);
      return {
        ok: true,
        base: cloneBase(nextBase),
        table: cloneTable(nextTable),
        record: cloneRecord({ ...currentRecord, revision: currentRecord.revision + 1 }),
      };
    },

    async listViews(baseId, tableId) {
      const base = bases.get(baseId);
      const table = base?.tables.find((item) => item.id === tableId);
      if (!table?.views) {
        return [];
      }
      return table.views.map(cloneSavedView);
    },

    async putView(baseId, tableId, view, opts) {
      if (opts?.idempotencyKey) {
        const applied = appliedSavedViewIdempotencyKeys.get(opts.idempotencyKey);
        if (applied) {
          return {
            ok: true,
            base: cloneBase(applied.base),
            table: cloneTable(applied.table),
            view: cloneSavedView(applied.view),
          };
        }
      }

      const normalized = normalizeAppForgeSavedView(view);
      if (!normalized) {
        return {
          ok: false,
          code: "revision_conflict",
          expectedRevision: opts?.expectedTableRevision ?? 0,
          actualRevision: 0,
          message: `View ${view?.id ?? ""} in table ${tableId} requires id, name, and type.`,
        };
      }

      const base = bases.get(baseId);
      if (!base) {
        return missingConflict("Base", baseId, opts?.expectedBaseRevision);
      }
      const baseRevisionCheck = checkAppForgeRevision(base.revision, opts?.expectedBaseRevision);
      if (!baseRevisionCheck.ok) {
        return baseRevisionCheck;
      }

      const currentTable = base.tables.find((item) => item.id === tableId);
      if (!currentTable) {
        return missingConflict(`Table ${tableId} in base`, baseId, opts?.expectedTableRevision);
      }
      const tableRevisionCheck = checkAppForgeRevision(
        currentTable.revision,
        opts?.expectedTableRevision,
      );
      if (!tableRevisionCheck.ok) {
        return tableRevisionCheck;
      }

      const timestamp = nowIso();
      const existingViews = currentTable.views ?? [];
      const existingView = existingViews.find((item) => item.id === normalized.id);
      const nextView: AppForgeSavedView = {
        ...normalized,
        createdAt: existingView?.createdAt ?? normalized.createdAt ?? timestamp,
        updatedAt: normalized.updatedAt ?? timestamp,
      };
      const nextViews = existingView
        ? existingViews.map((item) => (item.id === nextView.id ? nextView : item))
        : [...existingViews, nextView];
      const nextTable = cloneTable({
        ...currentTable,
        views: nextViews,
        revision: currentTable.revision + 1,
      });
      const nextBase = cloneBase({
        ...base,
        tables: base.tables.map((item) => (item.id === tableId ? nextTable : item)),
        revision: base.revision + 1,
        updatedAt: timestamp,
      });

      bases.set(baseId, nextBase);
      if (opts?.idempotencyKey) {
        appliedSavedViewIdempotencyKeys.set(opts.idempotencyKey, {
          base: nextBase,
          table: nextTable,
          view: nextView,
        });
      }
      return {
        ok: true,
        base: cloneBase(nextBase),
        table: cloneTable(nextTable),
        view: cloneSavedView(nextView),
      };
    },

    async deleteView(baseId, tableId, viewId, opts) {
      const base = bases.get(baseId);
      if (!base) {
        return missingConflict("Base", baseId, opts?.expectedBaseRevision);
      }
      const baseRevisionCheck = checkAppForgeRevision(base.revision, opts?.expectedBaseRevision);
      if (!baseRevisionCheck.ok) {
        return baseRevisionCheck;
      }

      const currentTable = base.tables.find((item) => item.id === tableId);
      if (!currentTable) {
        return missingConflict(`Table ${tableId} in base`, baseId, opts?.expectedTableRevision);
      }
      const tableRevisionCheck = checkAppForgeRevision(
        currentTable.revision,
        opts?.expectedTableRevision,
      );
      if (!tableRevisionCheck.ok) {
        return tableRevisionCheck;
      }

      const existingViews = currentTable.views ?? [];
      const removed = existingViews.find((item) => item.id === viewId);
      if (!removed) {
        return missingConflict(
          `View ${viewId} in table ${tableId}`,
          baseId,
          opts?.expectedTableRevision,
        );
      }
      const nextViews = existingViews.filter((item) => item.id !== viewId);
      const timestamp = nowIso();
      const nextTable = cloneTable({
        ...currentTable,
        views: nextViews,
        // Clear the activeViewId when the operator deletes the active view so
        // the next render picks a surviving view (or none) — without this,
        // selectView would dangle on a stale id.
        activeViewId:
          currentTable.activeViewId === viewId ? nextViews[0]?.id : currentTable.activeViewId,
        defaultViewId:
          currentTable.defaultViewId === viewId ? undefined : currentTable.defaultViewId,
        revision: currentTable.revision + 1,
      });
      const nextBase = cloneBase({
        ...base,
        tables: base.tables.map((item) => (item.id === tableId ? nextTable : item)),
        revision: base.revision + 1,
        updatedAt: timestamp,
      });
      bases.set(baseId, nextBase);
      return {
        ok: true,
        base: cloneBase(nextBase),
        table: cloneTable(nextTable),
        view: cloneSavedView(removed),
      };
    },
  };
}
