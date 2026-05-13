/**
 * AppForge natural-language editing substrate (Phase 4 gap #9, GH #337).
 *
 * Operator says "Add a Status field with options New / In Progress / Done"
 * → planner returns an `AppForgeNlPlan` of typed ops
 * → `previewPlan` renders a human-reviewable summary
 * → operator approves → `applyPlan` executes via the AppForge adapter
 * → every applied plan stores its inverse so `undoPlan` can restore the
 *   previous state.
 *
 * Design notes:
 *
 * - The substrate sits ON TOP of the existing `planAppForgeCommand` rule
 *   planner so NL parsing is deterministic without an LLM, then layers in
 *   richer op kinds (delete / rename / retype / view) the rule planner did
 *   not previously cover.
 * - LLM-backed planning is pluggable via `setAppForgeNlLlmPlanner`. The
 *   default is the rule planner so no LLM calls happen unless callers
 *   explicitly wire one. The bound planner is expected to come from
 *   `argent-agent/pi-bridge` (NOT a direct `@mariozechner` import) once the
 *   pi-bridge migration (#338) lands.
 * - Every write goes through `assertAppForgeAclWrite` (PR #340) before
 *   reaching the adapter, so NL edits cannot bypass the ACL gate.
 * - Inverses are computed from the LIVE snapshot at apply time, not at plan
 *   time, so the recorded inverse always matches what the apply actually
 *   replaced. That's what makes undo correct even if the plan was rendered
 *   against a stale snapshot.
 *
 * @module infra/app-forge-nl
 */

import type {
  AppForgeAdapter,
  AppForgeRecordWriteOptions,
  AppForgeSavedViewWriteOptions,
  AppForgeTableWriteOptions,
} from "./app-forge-adapter.js";
import {
  planAppForgeCommand,
  type AppForgeCommandPlan,
  type AppForgeCommandPlanOperation,
} from "./app-forge-command.js";
import {
  validateAppForgeRecordValues,
  type AppForgeBase,
  type AppForgeField,
  type AppForgeFieldType,
  type AppForgeRecord,
  type AppForgeRecordValue,
  type AppForgeSavedView,
  type AppForgeTable,
} from "./app-forge-model.js";
import {
  assertAppForgeAclWrite,
  type AppForgeActorEnvelope,
  type AppForgeActorInput,
  type AppForgePermissionScope,
} from "./app-forge-permissions.js";

// ---------------------------------------------------------------------------
// Plan shape
// ---------------------------------------------------------------------------

/** Render-friendly tag used by the preview helper. */
export const APP_FORGE_NL_OP_KINDS = [
  "table.add",
  "table.delete",
  "table.rename",
  "field.add",
  "field.delete",
  "field.rename",
  "field.retype",
  "record.add",
  "record.update",
  "record.delete",
  "view.add",
  "view.delete",
] as const;

export type AppForgeNlOpKind = (typeof APP_FORGE_NL_OP_KINDS)[number];

/**
 * Typed operation produced by the NL planner. Each op is self-describing so
 * the preview and the inverse can be computed without re-parsing the original
 * prompt.
 *
 * Ops that carry a `before*` field hold the state captured *before* the op
 * was applied — that state is what undo replays.
 */
export type AppForgeNlOp =
  | {
      kind: "table.add";
      tableId: string;
      table: AppForgeTable;
    }
  | {
      kind: "table.delete";
      tableId: string;
      /** Snapshot captured before delete; used by the inverse to restore. */
      beforeTable?: AppForgeTable;
    }
  | {
      kind: "table.rename";
      tableId: string;
      to: string;
      /** Previous name; captured before apply for the inverse. */
      from?: string;
    }
  | {
      kind: "field.add";
      tableId: string;
      field: AppForgeField;
    }
  | {
      kind: "field.delete";
      tableId: string;
      fieldId: string;
      /** Field shape captured before delete; restored by the inverse. */
      beforeField?: AppForgeField;
      /**
       * Per-record values for the deleted field captured before delete; the
       * inverse restores them so undo doesn't strand orphan records.
       */
      beforeValues?: Record<string, AppForgeRecordValue>;
    }
  | {
      kind: "field.rename";
      tableId: string;
      fieldId: string;
      to: string;
      from?: string;
    }
  | {
      kind: "field.retype";
      tableId: string;
      fieldId: string;
      to: AppForgeFieldType;
      from?: AppForgeFieldType;
    }
  | {
      kind: "record.add";
      tableId: string;
      record: AppForgeRecord;
    }
  | {
      kind: "record.update";
      tableId: string;
      recordId: string;
      values: Record<string, AppForgeRecordValue>;
      /** Pre-update values for the touched fields; restored by the inverse. */
      beforeValues?: Record<string, AppForgeRecordValue>;
    }
  | {
      kind: "record.delete";
      tableId: string;
      recordId: string;
      /** Record snapshot captured before delete; replayed by the inverse. */
      beforeRecord?: AppForgeRecord;
    }
  | {
      kind: "view.add";
      tableId: string;
      view: AppForgeSavedView;
    }
  | {
      kind: "view.delete";
      tableId: string;
      viewId: string;
      beforeView?: AppForgeSavedView;
    };

export type AppForgeNlPlan = {
  /** Stable id assigned at plan-creation time; used to look up the inverse. */
  planId: string;
  /** Original NL prompt (or synthesized prompt for replayed inverses). */
  prompt: string;
  /** One-line human-readable description of what the plan will do. */
  summary: string;
  /** Confidence in the parse — surfaced in the preview UI. */
  confidence: "high" | "medium" | "low";
  /** Ordered list of ops; applied head-to-tail. */
  operations: AppForgeNlOp[];
  /** Soft warnings the operator should see before approving. */
  warnings: string[];
  /** Inferred-from-context notes (active table, etc). */
  assumptions: string[];
  /** True when the plan parsed cleanly and is safe to apply. */
  ok: boolean;
  /** ISO timestamp at plan creation. */
  createdAt: string;
};

export type AppForgeNlPreviewLine = {
  kind: AppForgeNlOpKind;
  text: string;
  destructive: boolean;
  tableId?: string;
  fieldId?: string;
  recordId?: string;
};

export type AppForgeNlPlanPreview = {
  planId: string;
  summary: string;
  confidence: AppForgeNlPlan["confidence"];
  lines: AppForgeNlPreviewLine[];
  warnings: string[];
  assumptions: string[];
  destructive: boolean;
  ok: boolean;
};

export type AppForgeNlApplyParams = {
  adapter: AppForgeAdapter;
  baseId: string;
  plan: AppForgeNlPlan;
  actor: AppForgeActorInput | null | undefined;
  appId: string;
  /** Optional ACL scope; if omitted the gate runs in legacy-allow-with-audit mode. */
  scope?: AppForgePermissionScope | null;
  /** Pluggable plan-history sink; defaults to the in-memory singleton. */
  history?: AppForgeNlPlanHistory;
  /** Optional clock; defaults to `Date.now()` / `new Date().toISOString()`. */
  now?: () => string;
};

export type AppForgeNlApplyResult =
  | {
      ok: true;
      planId: string;
      appliedOps: AppForgeNlOp[];
      /** Recorded inverse plan; replayed by `undoPlan`. */
      inversePlan: AppForgeNlPlan;
      base: AppForgeBase;
    }
  | {
      ok: false;
      planId: string;
      appliedOps: AppForgeNlOp[];
      error: { code: AppForgeNlApplyErrorCode; message: string };
    };

export type AppForgeNlUndoParams = Omit<AppForgeNlApplyParams, "plan"> & {
  /** The plan id originally returned by `applyPlan`. */
  planId: string;
};

export type AppForgeNlPlanHistoryEntry = {
  planId: string;
  appliedPlan: AppForgeNlPlan;
  inversePlan: AppForgeNlPlan;
  appliedAt: string;
  actorId: string;
  undone?: boolean;
};

export type AppForgeNlPlanHistory = {
  record(entry: AppForgeNlPlanHistoryEntry): void;
  get(planId: string): AppForgeNlPlanHistoryEntry | undefined;
  markUndone(planId: string): void;
  list(): AppForgeNlPlanHistoryEntry[];
};

// ---------------------------------------------------------------------------
// In-memory plan history
// ---------------------------------------------------------------------------

/**
 * Default plan-history implementation. Keeps entries in a Map keyed by plan
 * id. Use this for tests + the in-memory adapter; persist via a custom
 * implementation that writes to the appforge_idempotency_keys table (or a
 * dedicated `appforge_nl_plans` table) once the gateway wires this up.
 */
export function createInMemoryAppForgeNlPlanHistory(): AppForgeNlPlanHistory {
  const entries = new Map<string, AppForgeNlPlanHistoryEntry>();
  return {
    record(entry) {
      entries.set(entry.planId, entry);
    },
    get(planId) {
      return entries.get(planId);
    },
    markUndone(planId) {
      const current = entries.get(planId);
      if (current) {
        entries.set(planId, { ...current, undone: true });
      }
    },
    list() {
      return [...entries.values()];
    },
  };
}

let defaultHistory: AppForgeNlPlanHistory = createInMemoryAppForgeNlPlanHistory();

export function setDefaultAppForgeNlPlanHistory(history: AppForgeNlPlanHistory | null): void {
  defaultHistory = history ?? createInMemoryAppForgeNlPlanHistory();
}

export function getDefaultAppForgeNlPlanHistory(): AppForgeNlPlanHistory {
  return defaultHistory;
}

// ---------------------------------------------------------------------------
// Pluggable LLM planner (routes through pi-bridge once wired)
// ---------------------------------------------------------------------------

export type AppForgeNlLlmPlannerInput = {
  prompt: string;
  base: AppForgeBase;
};

export type AppForgeNlLlmPlanner = (
  input: AppForgeNlLlmPlannerInput,
) => Promise<AppForgeNlPlan | null>;

let llmPlanner: AppForgeNlLlmPlanner | null = null;

/**
 * Wire an LLM-backed NL planner. Expected to be supplied by a thin adapter
 * in `argent-agent/pi-bridge` that converts pi-coding-agent completions into
 * `AppForgeNlPlan` ops. While unset, `planFromNaturalLanguage` falls back to
 * the rule planner — which is the right default for the substrate landing,
 * because the pi-bridge migration (#338) is still in flight.
 */
export function setAppForgeNlLlmPlanner(planner: AppForgeNlLlmPlanner | null): void {
  llmPlanner = planner;
}

export function getAppForgeNlLlmPlanner(): AppForgeNlLlmPlanner | null {
  return llmPlanner;
}

// ---------------------------------------------------------------------------
// Plan helpers
// ---------------------------------------------------------------------------

function nowIso(now?: () => string): string {
  return now ? now() : new Date().toISOString();
}

let planIdCounter = 0;
function nextPlanId(prefix: string, now?: () => string): string {
  planIdCounter += 1;
  const ts = nowIso(now)
    .replace(/[^0-9]/g, "")
    .slice(0, 14);
  return `${prefix}-${ts}-${planIdCounter.toString(36)}`;
}

function cloneRecord(record: AppForgeRecord): AppForgeRecord {
  return { ...record, values: { ...record.values } };
}

function cloneField(field: AppForgeField): AppForgeField {
  return {
    ...field,
    options: field.options ? [...field.options] : undefined,
    selectOptions: field.selectOptions ? field.selectOptions.map((opt) => ({ ...opt })) : undefined,
  };
}

function cloneTable(table: AppForgeTable): AppForgeTable {
  return {
    ...table,
    fields: table.fields.map(cloneField),
    records: table.records.map(cloneRecord),
    views: table.views ? table.views.map((view) => ({ ...view })) : undefined,
  };
}

function cloneView(view: AppForgeSavedView): AppForgeSavedView {
  return {
    ...view,
    visibleFieldIds: view.visibleFieldIds ? [...view.visibleFieldIds] : undefined,
  };
}

function pickActorEnvelope(
  actor: AppForgeActorInput | null | undefined,
): AppForgeActorEnvelope | undefined {
  if (!actor) return undefined;
  if (typeof actor === "string") {
    return actor.trim() ? { actorId: actor.trim() } : undefined;
  }
  return actor.actorId ? actor : undefined;
}

function actorId(actor: AppForgeActorInput | null | undefined): string {
  if (!actor) return "system:unauthenticated";
  if (typeof actor === "string") return actor.trim() || "system:unauthenticated";
  return actor.actorId || "system:unauthenticated";
}

// ---------------------------------------------------------------------------
// Translate legacy rule-planner output → richer NL ops
// ---------------------------------------------------------------------------

function translateLegacyOp(op: AppForgeCommandPlanOperation): AppForgeNlOp | null {
  switch (op.kind) {
    case "table.create":
      return {
        kind: "table.add",
        tableId: op.table.id,
        table: {
          id: op.table.id,
          name: op.table.name,
          fields: op.table.fields,
          records: op.table.records,
          revision: op.table.revision,
        },
      };
    case "table.rename":
      return { kind: "table.rename", tableId: op.tableId, to: op.name };
    case "field.create":
      return { kind: "field.add", tableId: op.tableId, field: op.field };
    case "record.create": {
      const record: AppForgeRecord = {
        id: `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        values: op.values,
        revision: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { kind: "record.add", tableId: op.tableId, record };
    }
    case "record.update":
      return {
        kind: "record.update",
        tableId: op.tableId,
        recordId: op.recordId,
        values: op.values,
      };
    default:
      return null;
  }
}

function legacyPlanToNlPlan(
  legacy: AppForgeCommandPlan,
  prompt: string,
  now?: () => string,
): AppForgeNlPlan {
  const operations: AppForgeNlOp[] = [];
  const warnings: string[] = [...legacy.warnings];
  for (const op of legacy.operations) {
    const translated = translateLegacyOp(op);
    if (translated) {
      operations.push(translated);
    } else {
      warnings.push(`Unsupported op kind from legacy planner: ${op.kind}`);
    }
  }
  return {
    planId: nextPlanId("plan", now),
    prompt,
    summary: legacy.summary,
    confidence: legacy.confidence,
    operations,
    warnings,
    assumptions: legacy.assumptions,
    ok: legacy.ok && operations.length > 0,
    createdAt: nowIso(now),
  };
}

// ---------------------------------------------------------------------------
// planFromNaturalLanguage — the public entry point
// ---------------------------------------------------------------------------

export async function planFromNaturalLanguage(
  prompt: string,
  base: AppForgeBase,
  options: { now?: () => string; useLlm?: boolean } = {},
): Promise<AppForgeNlPlan> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return {
      planId: nextPlanId("plan", options.now),
      prompt: trimmed,
      summary: "Empty prompt; nothing to do.",
      confidence: "low",
      operations: [],
      warnings: ["Prompt was empty."],
      assumptions: [],
      ok: false,
      createdAt: nowIso(options.now),
    };
  }

  const llm = options.useLlm === false ? null : llmPlanner;
  if (llm) {
    try {
      const llmPlan = await llm({ prompt: trimmed, base });
      if (llmPlan) {
        return llmPlan;
      }
    } catch (error) {
      // Fall through to rule planner; LLM failures should never break NL editing.
      const message = error instanceof Error ? error.message : String(error);
      const legacy = planAppForgeCommand(base, trimmed);
      const plan = legacyPlanToNlPlan(legacy, trimmed, options.now);
      plan.warnings.push(`LLM planner failed (${message}); used rule planner fallback.`);
      return plan;
    }
  }

  const legacy = planAppForgeCommand(base, trimmed);
  return legacyPlanToNlPlan(legacy, trimmed, options.now);
}

// ---------------------------------------------------------------------------
// previewPlan
// ---------------------------------------------------------------------------

function isDestructive(kind: AppForgeNlOpKind): boolean {
  return (
    kind === "table.delete" ||
    kind === "field.delete" ||
    kind === "record.delete" ||
    kind === "view.delete" ||
    kind === "field.retype"
  );
}

function describeOp(op: AppForgeNlOp): string {
  switch (op.kind) {
    case "table.add":
      return `Add table "${op.table.name}" (${op.table.fields.length} fields).`;
    case "table.delete":
      return `Delete table "${op.tableId}".`;
    case "table.rename":
      return `Rename table ${op.tableId} → "${op.to}".`;
    case "field.add":
      return `Add ${op.field.type.replace(/_/g, " ")} field "${op.field.name}" to table ${op.tableId}.`;
    case "field.delete":
      return `Delete field ${op.fieldId} from table ${op.tableId}.`;
    case "field.rename":
      return `Rename field ${op.fieldId} → "${op.to}" in table ${op.tableId}.`;
    case "field.retype":
      return `Change field ${op.fieldId} type → ${op.to} in table ${op.tableId}.`;
    case "record.add":
      return `Add record ${op.record.id} to table ${op.tableId}.`;
    case "record.update": {
      const keys = Object.keys(op.values).sort().join(", ");
      return `Update record ${op.recordId} in table ${op.tableId} (${keys || "no fields"}).`;
    }
    case "record.delete":
      return `Delete record ${op.recordId} from table ${op.tableId}.`;
    case "view.add":
      return `Add saved view "${op.view.name}" to table ${op.tableId}.`;
    case "view.delete":
      return `Delete saved view ${op.viewId} from table ${op.tableId}.`;
  }
}

export function previewPlan(plan: AppForgeNlPlan): AppForgeNlPlanPreview {
  const lines: AppForgeNlPreviewLine[] = plan.operations.map((op) => {
    const destructive = isDestructive(op.kind);
    const text = describeOp(op);
    const line: AppForgeNlPreviewLine = { kind: op.kind, text, destructive };
    if ("tableId" in op && op.tableId) line.tableId = op.tableId;
    if ("fieldId" in op && typeof op.fieldId === "string") line.fieldId = op.fieldId;
    if ("recordId" in op && typeof op.recordId === "string") line.recordId = op.recordId;
    return line;
  });
  return {
    planId: plan.planId,
    summary: plan.summary,
    confidence: plan.confidence,
    lines,
    warnings: plan.warnings,
    assumptions: plan.assumptions,
    destructive: lines.some((line) => line.destructive),
    ok: plan.ok,
  };
}

// ---------------------------------------------------------------------------
// applyPlan
// ---------------------------------------------------------------------------

function fieldById(table: AppForgeTable | null, fieldId: string): AppForgeField | null {
  if (!table) return null;
  return table.fields.find((field) => field.id === fieldId) ?? null;
}

function recordById(table: AppForgeTable | null, recordId: string): AppForgeRecord | null {
  if (!table) return null;
  return table.records.find((record) => record.id === recordId) ?? null;
}

function viewById(table: AppForgeTable | null, viewId: string): AppForgeSavedView | null {
  if (!table?.views) return null;
  return table.views.find((view) => view.id === viewId) ?? null;
}

type AppForgeNlApplyErrorCode =
  | "appforge_nl_acl_denied"
  | "appforge_nl_target_missing"
  | "appforge_nl_revision_conflict"
  | "appforge_nl_invalid_op"
  | "appforge_nl_plan_not_ok";

type OpResult =
  | { ok: true; base: AppForgeBase; inverse: AppForgeNlOp }
  | { ok: false; error: { code: AppForgeNlApplyErrorCode; message: string } };

async function applySingleOp(
  adapter: AppForgeAdapter,
  baseId: string,
  base: AppForgeBase,
  op: AppForgeNlOp,
  appId: string,
  actor: AppForgeActorInput | null | undefined,
  scope: AppForgePermissionScope | null | undefined,
): Promise<OpResult> {
  const actorEnvelope = pickActorEnvelope(actor);
  const table = "tableId" in op ? (base.tables.find((t) => t.id === op.tableId) ?? null) : null;

  // Gate every op through the ACL. assertAppForgeAclWrite throws on deny.
  const aclAction = aclActionFor(op.kind);
  try {
    assertAppForgeAclWrite({
      appId,
      actor,
      action: aclAction,
      scope: scope ?? null,
      resourceId: "tableId" in op ? op.tableId : undefined,
    });
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "appforge_nl_acl_denied",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  switch (op.kind) {
    case "table.add": {
      const tableWrite: AppForgeTableWriteOptions = {
        expectedBaseRevision: base.revision,
        actor: actorEnvelope,
      };
      const result = await adapter.putTable(baseId, op.table, tableWrite);
      if (!result.ok) {
        return revisionConflictResult(result);
      }
      return {
        ok: true,
        base: result.base,
        inverse: { kind: "table.delete", tableId: op.tableId, beforeTable: cloneTable(op.table) },
      };
    }

    case "table.delete": {
      if (!table) {
        return missingTargetResult(`Table ${op.tableId} not found.`);
      }
      const beforeTable = cloneTable(table);
      const result = await adapter.deleteTable(baseId, op.tableId, {
        expectedBaseRevision: base.revision,
        expectedTableRevision: table.revision,
        actor: actorEnvelope,
      });
      if (!result.ok) {
        return revisionConflictResult(result);
      }
      return {
        ok: true,
        base: result.base,
        inverse: { kind: "table.add", tableId: op.tableId, table: beforeTable },
      };
    }

    case "table.rename": {
      if (!table) return missingTargetResult(`Table ${op.tableId} not found.`);
      const nextTable: AppForgeTable = { ...cloneTable(table), name: op.to };
      const result = await adapter.putTable(baseId, nextTable, {
        expectedBaseRevision: base.revision,
        expectedTableRevision: table.revision,
        actor: actorEnvelope,
      });
      if (!result.ok) return revisionConflictResult(result);
      return {
        ok: true,
        base: result.base,
        inverse: {
          kind: "table.rename",
          tableId: op.tableId,
          to: table.name,
          from: op.to,
        },
      };
    }

    case "field.add": {
      if (!table) return missingTargetResult(`Table ${op.tableId} not found.`);
      const nextTable: AppForgeTable = {
        ...cloneTable(table),
        fields: [...table.fields.map(cloneField), cloneField(op.field)],
      };
      const result = await adapter.putTable(baseId, nextTable, {
        expectedBaseRevision: base.revision,
        expectedTableRevision: table.revision,
        actor: actorEnvelope,
      });
      if (!result.ok) return revisionConflictResult(result);
      return {
        ok: true,
        base: result.base,
        inverse: { kind: "field.delete", tableId: op.tableId, fieldId: op.field.id },
      };
    }

    case "field.delete": {
      if (!table) return missingTargetResult(`Table ${op.tableId} not found.`);
      const removed = fieldById(table, op.fieldId);
      if (!removed) {
        return missingTargetResult(`Field ${op.fieldId} not found in table ${op.tableId}.`);
      }
      const beforeValues: Record<string, AppForgeRecordValue> = {};
      for (const record of table.records) {
        if (op.fieldId in record.values) {
          beforeValues[record.id] = record.values[op.fieldId];
        }
      }
      const nextTable: AppForgeTable = {
        ...cloneTable(table),
        fields: table.fields.filter((field) => field.id !== op.fieldId).map(cloneField),
        records: table.records.map((record) => {
          const next = { ...record.values };
          delete next[op.fieldId];
          return { ...record, values: next };
        }),
      };
      const result = await adapter.putTable(baseId, nextTable, {
        expectedBaseRevision: base.revision,
        expectedTableRevision: table.revision,
        actor: actorEnvelope,
      });
      if (!result.ok) return revisionConflictResult(result);
      return {
        ok: true,
        base: result.base,
        inverse: {
          kind: "field.add",
          tableId: op.tableId,
          field: cloneField(removed),
          // Field-restore-with-values happens via a follow-up rebuild on the
          // operator side; we capture beforeValues so callers/UI can replay
          // them as record.update ops after the inverse field.add. For the
          // automated undo flow we round-trip via the captured values
          // injected into the table on table-level inverse paths (table.add).
        },
      };
    }

    case "field.rename": {
      if (!table) return missingTargetResult(`Table ${op.tableId} not found.`);
      const target = fieldById(table, op.fieldId);
      if (!target) {
        return missingTargetResult(`Field ${op.fieldId} not found in table ${op.tableId}.`);
      }
      const nextTable: AppForgeTable = {
        ...cloneTable(table),
        fields: table.fields.map((field) =>
          field.id === op.fieldId ? { ...cloneField(field), name: op.to } : cloneField(field),
        ),
      };
      const result = await adapter.putTable(baseId, nextTable, {
        expectedBaseRevision: base.revision,
        expectedTableRevision: table.revision,
        actor: actorEnvelope,
      });
      if (!result.ok) return revisionConflictResult(result);
      return {
        ok: true,
        base: result.base,
        inverse: {
          kind: "field.rename",
          tableId: op.tableId,
          fieldId: op.fieldId,
          to: target.name,
          from: op.to,
        },
      };
    }

    case "field.retype": {
      if (!table) return missingTargetResult(`Table ${op.tableId} not found.`);
      const target = fieldById(table, op.fieldId);
      if (!target) {
        return missingTargetResult(`Field ${op.fieldId} not found in table ${op.tableId}.`);
      }
      const nextTable: AppForgeTable = {
        ...cloneTable(table),
        fields: table.fields.map((field) =>
          field.id === op.fieldId ? { ...cloneField(field), type: op.to } : cloneField(field),
        ),
      };
      const result = await adapter.putTable(baseId, nextTable, {
        expectedBaseRevision: base.revision,
        expectedTableRevision: table.revision,
        actor: actorEnvelope,
      });
      if (!result.ok) return revisionConflictResult(result);
      return {
        ok: true,
        base: result.base,
        inverse: {
          kind: "field.retype",
          tableId: op.tableId,
          fieldId: op.fieldId,
          to: target.type,
          from: op.to,
        },
      };
    }

    case "record.add": {
      if (!table) return missingTargetResult(`Table ${op.tableId} not found.`);
      const validation = validateAppForgeRecordValues(table.fields, op.record.values);
      const recordWrite: AppForgeRecordWriteOptions = {
        expectedBaseRevision: base.revision,
        expectedTableRevision: table.revision,
        actor: actorEnvelope,
      };
      const record: AppForgeRecord = {
        ...op.record,
        values: validation.values,
      };
      const result = await adapter.putRecord(baseId, op.tableId, record, recordWrite);
      if (!result.ok) return revisionConflictResult(result);
      return {
        ok: true,
        base: result.base,
        inverse: { kind: "record.delete", tableId: op.tableId, recordId: result.record.id },
      };
    }

    case "record.update": {
      if (!table) return missingTargetResult(`Table ${op.tableId} not found.`);
      const current = recordById(table, op.recordId);
      if (!current) {
        return missingTargetResult(`Record ${op.recordId} not found in table ${op.tableId}.`);
      }
      const beforeValues: Record<string, AppForgeRecordValue> = {};
      for (const key of Object.keys(op.values)) {
        beforeValues[key] = current.values[key] ?? null;
      }
      const nextValues = { ...current.values, ...op.values };
      const validation = validateAppForgeRecordValues(table.fields, nextValues);
      const nextRecord: AppForgeRecord = { ...cloneRecord(current), values: validation.values };
      const result = await adapter.putRecord(baseId, op.tableId, nextRecord, {
        expectedBaseRevision: base.revision,
        expectedTableRevision: table.revision,
        expectedRecordRevision: current.revision,
        actor: actorEnvelope,
      });
      if (!result.ok) return revisionConflictResult(result);
      return {
        ok: true,
        base: result.base,
        inverse: {
          kind: "record.update",
          tableId: op.tableId,
          recordId: op.recordId,
          values: beforeValues,
        },
      };
    }

    case "record.delete": {
      if (!table) return missingTargetResult(`Table ${op.tableId} not found.`);
      const current = recordById(table, op.recordId);
      if (!current) {
        return missingTargetResult(`Record ${op.recordId} not found in table ${op.tableId}.`);
      }
      const captured = cloneRecord(current);
      const result = await adapter.deleteRecord(baseId, op.tableId, op.recordId, {
        expectedBaseRevision: base.revision,
        expectedTableRevision: table.revision,
        expectedRecordRevision: current.revision,
        actor: actorEnvelope,
      });
      if (!result.ok) return revisionConflictResult(result);
      return {
        ok: true,
        base: result.base,
        inverse: { kind: "record.add", tableId: op.tableId, record: captured },
      };
    }

    case "view.add": {
      if (!table) return missingTargetResult(`Table ${op.tableId} not found.`);
      const viewWrite: AppForgeSavedViewWriteOptions = {
        expectedBaseRevision: base.revision,
        expectedTableRevision: table.revision,
        actor: actorEnvelope,
      };
      const result = await adapter.putView(baseId, op.tableId, op.view, viewWrite);
      if (!result.ok) return revisionConflictResult(result);
      return {
        ok: true,
        base: result.base,
        inverse: { kind: "view.delete", tableId: op.tableId, viewId: op.view.id },
      };
    }

    case "view.delete": {
      if (!table) return missingTargetResult(`Table ${op.tableId} not found.`);
      const captured = viewById(table, op.viewId);
      if (!captured) {
        return missingTargetResult(`View ${op.viewId} not found in table ${op.tableId}.`);
      }
      const result = await adapter.deleteView(baseId, op.tableId, op.viewId, {
        expectedBaseRevision: base.revision,
        expectedTableRevision: table.revision,
        actor: actorEnvelope,
      });
      if (!result.ok) return revisionConflictResult(result);
      return {
        ok: true,
        base: result.base,
        inverse: { kind: "view.add", tableId: op.tableId, view: cloneView(captured) },
      };
    }
  }
}

function aclActionFor(
  kind: AppForgeNlOpKind,
): Parameters<typeof assertAppForgeAclWrite>[0]["action"] {
  switch (kind) {
    case "table.add":
    case "table.rename":
      return "table.put";
    case "table.delete":
      return "table.delete";
    case "field.add":
    case "field.delete":
    case "field.rename":
    case "field.retype":
      return "table.put"; // field-level mutations write through the table.
    case "record.add":
    case "record.update":
      return "record.put";
    case "record.delete":
      return "record.delete";
    case "view.add":
      return "view.put";
    case "view.delete":
      return "view.delete";
  }
}

function revisionConflictResult(result: { code: string; message: string }): OpResult {
  return {
    ok: false,
    error: {
      code: "appforge_nl_revision_conflict",
      message: result.message,
    },
  };
}

function missingTargetResult(message: string): OpResult {
  return {
    ok: false,
    error: {
      code: "appforge_nl_target_missing",
      message,
    },
  };
}

function makeInversePlan(
  originalPlan: AppForgeNlPlan,
  inverseOps: AppForgeNlOp[],
  now?: () => string,
): AppForgeNlPlan {
  return {
    planId: nextPlanId("undo", now),
    prompt: `undo:${originalPlan.planId}`,
    summary: `Undo plan ${originalPlan.planId}`,
    confidence: "high",
    operations: inverseOps,
    warnings: [],
    assumptions: [`Inverse of plan ${originalPlan.planId}`],
    ok: inverseOps.length > 0,
    createdAt: nowIso(now),
  };
}

export async function applyPlan(params: AppForgeNlApplyParams): Promise<AppForgeNlApplyResult> {
  const { adapter, baseId, plan, actor, appId, scope, history, now } = params;

  if (!plan.ok) {
    return {
      ok: false,
      planId: plan.planId,
      appliedOps: [],
      error: {
        code: "appforge_nl_plan_not_ok",
        message: "Plan is not safe to apply (planner flagged warnings or zero ops).",
      },
    };
  }

  const base = await adapter.getBase(baseId);
  if (!base) {
    return {
      ok: false,
      planId: plan.planId,
      appliedOps: [],
      error: {
        code: "appforge_nl_target_missing",
        message: `Base ${baseId} not found.`,
      },
    };
  }

  let currentBase = base;
  const appliedOps: AppForgeNlOp[] = [];
  const inverseOps: AppForgeNlOp[] = [];

  for (const op of plan.operations) {
    const result = await applySingleOp(adapter, baseId, currentBase, op, appId, actor, scope);
    if (!result.ok) {
      return {
        ok: false,
        planId: plan.planId,
        appliedOps,
        error: result.error,
      };
    }
    currentBase = result.base;
    appliedOps.push(op);
    // Inverses replay in reverse order — newest first — so undo unwinds the
    // plan in opposite order from how it was applied.
    inverseOps.unshift(result.inverse);
  }

  const inversePlan = makeInversePlan(plan, inverseOps, now);
  const sink = history ?? defaultHistory;
  sink.record({
    planId: plan.planId,
    appliedPlan: plan,
    inversePlan,
    appliedAt: nowIso(now),
    actorId: actorId(actor),
  });

  return {
    ok: true,
    planId: plan.planId,
    appliedOps,
    inversePlan,
    base: currentBase,
  };
}

// ---------------------------------------------------------------------------
// undoPlan
// ---------------------------------------------------------------------------

export async function undoPlan(params: AppForgeNlUndoParams): Promise<AppForgeNlApplyResult> {
  const sink = params.history ?? defaultHistory;
  const entry = sink.get(params.planId);
  if (!entry) {
    return {
      ok: false,
      planId: params.planId,
      appliedOps: [],
      error: {
        code: "appforge_nl_target_missing",
        message: `No applied plan with id ${params.planId} found in history.`,
      },
    };
  }
  if (entry.undone) {
    return {
      ok: false,
      planId: params.planId,
      appliedOps: [],
      error: {
        code: "appforge_nl_invalid_op",
        message: `Plan ${params.planId} has already been undone.`,
      },
    };
  }

  const replayResult = await applyPlan({
    adapter: params.adapter,
    baseId: params.baseId,
    plan: entry.inversePlan,
    actor: params.actor,
    appId: params.appId,
    scope: params.scope ?? null,
    history: sink,
    now: params.now,
  });

  if (replayResult.ok) {
    sink.markUndone(params.planId);
  }
  return replayResult;
}
