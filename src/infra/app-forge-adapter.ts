import {
  checkAppForgeRevision,
  type AppForgeBase,
  type AppForgeRevisionCheck,
} from "./app-forge-model.js";

export type AppForgeBaseWrite = {
  base: AppForgeBase;
  expectedRevision?: number;
  idempotencyKey?: string;
};

type AppForgeRevisionConflict = Exclude<AppForgeRevisionCheck, { ok: true }>;

export type AppForgeWriteResult = { ok: true; base: AppForgeBase } | AppForgeRevisionConflict;

export interface AppForgeAdapter {
  listBases(opts?: { appId?: string }): Promise<AppForgeBase[]>;
  getBase(baseId: string): Promise<AppForgeBase | null>;
  putBase(write: AppForgeBaseWrite): Promise<AppForgeWriteResult>;
  deleteBase(baseId: string, opts?: { expectedRevision?: number }): Promise<AppForgeWriteResult>;
}

function cloneBase(base: AppForgeBase): AppForgeBase {
  return {
    ...base,
    tables: base.tables.map((table) => ({
      ...table,
      fields: table.fields.map((field) => ({
        ...field,
        options: field.options ? [...field.options] : undefined,
      })),
      records: table.records.map((record) => ({
        ...record,
        values: { ...record.values },
      })),
    })),
  };
}

export function createInMemoryAppForgeAdapter(seed: AppForgeBase[] = []): AppForgeAdapter {
  const bases = new Map(seed.map((base) => [base.id, cloneBase(base)]));
  const appliedIdempotencyKeys = new Map<string, AppForgeBase>();

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
        const applied = appliedIdempotencyKeys.get(write.idempotencyKey);
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
        updatedAt: new Date().toISOString(),
      });
      bases.set(nextBase.id, nextBase);
      if (write.idempotencyKey) {
        appliedIdempotencyKeys.set(write.idempotencyKey, nextBase);
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
  };
}
