import type { AppForgeBase, AppForgeRecord, AppForgeTable } from "./app-forge-model.js";

export const APPFORGE_WORKFLOW_EVENT_TYPES = [
  "forge.table.created",
  "forge.table.updated",
  "forge.table.deleted",
  "forge.record.created",
  "forge.record.updated",
  "forge.record.deleted",
  "forge.review.requested",
  "forge.review.completed",
  "forge.capability.completed",
] as const;

export type AppForgeWorkflowEventType = (typeof APPFORGE_WORKFLOW_EVENT_TYPES)[number];

export type AppForgeWorkflowEventInput = {
  eventType?: string;
  type?: string;
  action?: string;
  appId?: string;
  baseId?: string;
  capabilityId?: string;
  workflowRunId?: string;
  runId?: string;
  nodeId?: string;
  tableId?: string;
  viewId?: string;
  recordId?: string;
  reviewId?: string;
  decision?: string;
  payload?: Record<string, unknown>;
  emittedAt?: string;
};

export type NormalizedAppForgeWorkflowEvent = {
  eventType: string;
  appId: string;
  capabilityId?: string;
  workflowRunId?: string;
  nodeId?: string;
  payload: Record<string, unknown>;
};

type AppForgeTableMutationAction = "created" | "updated" | "deleted";
type AppForgeRecordMutationAction = "created" | "updated" | "deleted";

type BuildAppForgeTableMutationEventOptions = {
  action: AppForgeTableMutationAction;
  base: AppForgeBase;
  table: AppForgeTable;
  nextActiveTableId?: string;
  payload?: Record<string, unknown>;
};

type BuildAppForgeRecordMutationEventOptions = {
  action: AppForgeRecordMutationAction;
  base: AppForgeBase;
  table: AppForgeTable;
  record: AppForgeRecord;
  payload?: Record<string, unknown>;
};

const EVENT_ALIASES: Record<string, AppForgeWorkflowEventType> = {
  "table.created": "forge.table.created",
  table_created: "forge.table.created",
  "forge.table.created": "forge.table.created",
  "table.updated": "forge.table.updated",
  table_updated: "forge.table.updated",
  "forge.table.updated": "forge.table.updated",
  "table.deleted": "forge.table.deleted",
  table_deleted: "forge.table.deleted",
  "forge.table.deleted": "forge.table.deleted",
  created: "forge.record.created",
  "record.created": "forge.record.created",
  record_created: "forge.record.created",
  "forge.record.created": "forge.record.created",
  updated: "forge.record.updated",
  "record.updated": "forge.record.updated",
  record_updated: "forge.record.updated",
  "forge.record.updated": "forge.record.updated",
  deleted: "forge.record.deleted",
  "record.deleted": "forge.record.deleted",
  record_deleted: "forge.record.deleted",
  "forge.record.deleted": "forge.record.deleted",
  "review.requested": "forge.review.requested",
  review_requested: "forge.review.requested",
  "forge.review.requested": "forge.review.requested",
  "review.completed": "forge.review.completed",
  review_completed: "forge.review.completed",
  "forge.review.completed": "forge.review.completed",
  "capability.completed": "forge.capability.completed",
  capability_completed: "forge.capability.completed",
  "forge.capability.completed": "forge.capability.completed",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function eventTypeFrom(input: AppForgeWorkflowEventInput): string {
  const raw = stringValue(input.eventType) ?? stringValue(input.type) ?? stringValue(input.action);
  if (!raw) {
    throw new Error("eventType is required");
  }
  return EVENT_ALIASES[raw.trim().toLowerCase()] ?? raw.trim();
}

function optionalField(
  target: Record<string, unknown>,
  key: string,
  value: string | undefined,
): void {
  if (value) {
    target[key] = value;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function valuesMatch(actual: unknown, expected: unknown): boolean {
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      return false;
    }
    return Object.entries(expected).every(([key, expectedValue]) =>
      valuesMatch(actual[key], expectedValue),
    );
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return false;
    }
    return expected.every((expectedValue, index) => valuesMatch(actual[index], expectedValue));
  }
  return actual === expected;
}

function configEventTypes(config: Record<string, unknown>): string[] {
  const eventType = stringValue(config.eventType);
  const rawEventTypes = Array.isArray(config.eventTypes) ? config.eventTypes : [];
  return [
    ...(eventType ? [eventType] : []),
    ...rawEventTypes.map(stringValue).filter((value): value is string => Boolean(value)),
  ];
}

export function normalizeAppForgeWorkflowEvent(
  input: AppForgeWorkflowEventInput | Record<string, unknown>,
): NormalizedAppForgeWorkflowEvent {
  const source = input as AppForgeWorkflowEventInput;
  const appId = stringValue(source.appId);
  if (!appId) {
    throw new Error("appId is required");
  }

  const eventType = eventTypeFrom(source);
  const capabilityId = stringValue(source.capabilityId);
  const workflowRunId = stringValue(source.workflowRunId) ?? stringValue(source.runId);
  const nodeId = stringValue(source.nodeId);
  const emittedAt = stringValue(source.emittedAt) ?? new Date().toISOString();
  const payload: Record<string, unknown> = {
    ...(isRecord(source.payload) ? source.payload : {}),
    source: "appforge",
    eventType,
    appId,
    emittedAt,
  };

  optionalField(payload, "capabilityId", capabilityId);
  optionalField(payload, "baseId", stringValue(source.baseId));
  optionalField(payload, "workflowRunId", workflowRunId);
  optionalField(payload, "nodeId", nodeId);
  optionalField(payload, "tableId", stringValue(source.tableId));
  optionalField(payload, "viewId", stringValue(source.viewId));
  optionalField(payload, "recordId", stringValue(source.recordId));
  optionalField(payload, "reviewId", stringValue(source.reviewId));
  optionalField(payload, "decision", stringValue(source.decision));

  return {
    eventType,
    appId,
    capabilityId,
    workflowRunId,
    nodeId,
    payload,
  };
}

export function appForgeEventMatchesTriggerConfig(
  event: NormalizedAppForgeWorkflowEvent,
  triggerConfig: unknown,
): boolean {
  if (!isPlainObject(triggerConfig)) {
    return true;
  }

  const appId = stringValue(triggerConfig.appId) ?? stringValue(triggerConfig.appForgeAppId);
  if (appId && appId !== event.appId) {
    return false;
  }

  const capabilityId =
    stringValue(triggerConfig.capabilityId) ?? stringValue(triggerConfig.appForgeCapabilityId);
  if (capabilityId && capabilityId !== event.capabilityId) {
    return false;
  }

  const eventTypes = configEventTypes(triggerConfig);
  if (eventTypes.length && !eventTypes.includes(event.eventType)) {
    return false;
  }

  const eventFilter = isPlainObject(triggerConfig.eventFilter)
    ? triggerConfig.eventFilter
    : isPlainObject(triggerConfig.filter)
      ? triggerConfig.filter
      : undefined;
  if (eventFilter && !valuesMatch(event.payload, eventFilter)) {
    return false;
  }

  return true;
}

function cloneRecordValues(values: AppForgeRecord["values"]): Record<string, unknown> {
  return { ...values };
}

function tableMutationPayload(
  action: AppForgeTableMutationAction,
  base: AppForgeBase,
  table: AppForgeTable,
  payload: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    baseId: base.id,
    baseRevision: base.revision,
    tableId: table.id,
    tableName: table.name,
    tableRevision: table.revision,
    fieldIds: table.fields.map((field) => field.id),
    recordCount: table.records.length,
    changeType: `table.${action}`,
    ...payload,
  };
}

function recordMutationPayload(
  action: AppForgeRecordMutationAction,
  base: AppForgeBase,
  table: AppForgeTable,
  record: AppForgeRecord,
  payload: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    baseId: base.id,
    baseRevision: base.revision,
    tableId: table.id,
    tableName: table.name,
    tableRevision: table.revision,
    recordId: record.id,
    recordRevision: record.revision,
    values: cloneRecordValues(record.values),
    changeType: `record.${action}`,
    ...payload,
  };
}

export function buildAppForgeTableMutationEvent(
  options: BuildAppForgeTableMutationEventOptions,
): AppForgeWorkflowEventInput {
  const { action, base, table, nextActiveTableId, payload } = options;
  return {
    eventType: `forge.table.${action}`,
    appId: base.appId,
    baseId: base.id,
    tableId: table.id,
    payload: tableMutationPayload(action, base, table, {
      ...payload,
      ...(nextActiveTableId ? { nextActiveTableId } : {}),
    }),
  };
}

export function buildAppForgeRecordMutationEvent(
  options: BuildAppForgeRecordMutationEventOptions,
): AppForgeWorkflowEventInput {
  const { action, base, table, record, payload } = options;
  return {
    eventType: `forge.record.${action}`,
    appId: base.appId,
    baseId: base.id,
    tableId: table.id,
    recordId: record.id,
    payload: recordMutationPayload(action, base, table, record, payload),
  };
}
