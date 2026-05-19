import type { GatewayRequestHandlers } from "./types.js";
import { isStrictPostgresOnly } from "../../data/storage-config.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import { resolveRuntimeStorageConfig } from "../../data/storage-resolver.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

const log = createSubsystemLogger("gateway/workforce");
let workforceStorageLogged = false;

function isDevLikeRuntime(env: NodeJS.ProcessEnv): boolean {
  const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();
  return nodeEnv === "development" || nodeEnv === "test" || Boolean(env.VITEST);
}

function enforceWorkforceStoragePolicy(env: NodeJS.ProcessEnv = process.env): void {
  const cfg = resolveRuntimeStorageConfig(env);
  if (isStrictPostgresOnly(cfg)) return;
  if (isDevLikeRuntime(env) || env.ARGENT_ALLOW_NON_PG_WORKFORCE === "1") return;

  const writeTo = cfg.writeTo.join(",");
  throw new Error(
    `workforce requires PostgreSQL-canonical storage in production (backend=${cfg.backend}, readFrom=${cfg.readFrom}, writeTo=${writeTo}). Set storage.backend=postgres with read/write on postgres only.`,
  );
}

async function getWorkforceStorageAdapter() {
  enforceWorkforceStoragePolicy(process.env);
  const adapter = await getStorageAdapter();
  if (!workforceStorageLogged) {
    const cfg = resolveRuntimeStorageConfig(process.env);
    const adapterClass = adapter?.constructor?.name ?? "unknown";
    log.info(
      `workforce storage mode backend=${cfg.backend} readFrom=${cfg.readFrom} writeTo=${cfg.writeTo.join(",")} adapter=${adapterClass}`,
    );
    workforceStorageLogged = true;
  }
  return adapter;
}

function readOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRequiredString(params: Record<string, unknown>, key: string): string {
  const value = readOptionalString(params, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function readOptionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function readOptionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function readOptionalStringArray(
  params: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array`);
  }
  const values = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function readOptionalJobEventSource(
  params: Record<string, unknown>,
  key: string,
): "internal_hook" | "webhook" | "manual" | "system" | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  const trimmed = value.trim();
  switch (trimmed) {
    case "internal_hook":
    case "webhook":
    case "manual":
    case "system":
      return trimmed;
    default:
      throw new Error(`${key} must be one of: internal_hook, webhook, manual, system`);
  }
}

function eventLinkValues(event: {
  metadata?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}): Set<string> {
  const keys = [
    "runId",
    "jobRunId",
    "taskId",
    "jobTaskId",
    "assignmentId",
    "jobAssignmentId",
    "templateId",
    "jobTemplateId",
  ] as const;
  const out = new Set<string>();
  for (const key of keys) {
    const metadataValue = event.metadata?.[key];
    if (typeof metadataValue === "string" && metadataValue.trim().length > 0) {
      out.add(metadataValue.trim());
    }
    const payloadValue = event.payload?.[key];
    if (typeof payloadValue === "string" && payloadValue.trim().length > 0) {
      out.add(payloadValue.trim());
    }
  }
  return out;
}

function readOptionalObject(
  params: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readOptionalDeploymentStage(
  params: Record<string, unknown>,
  key: string,
): "simulate" | "shadow" | "limited-live" | "live" | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  const trimmed = value.trim();
  switch (trimmed) {
    case "shadow":
    case "limited-live":
    case "live":
    case "simulate":
      return trimmed;
    default:
      return "simulate";
  }
}

function readOptionalPromotionState(
  params: Record<string, unknown>,
  key: string,
): "draft" | "in-review" | "approved-next-stage" | "held" | "rolled-back" | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  const trimmed = value.trim();
  switch (trimmed) {
    case "in-review":
    case "approved-next-stage":
    case "held":
    case "rolled-back":
      return trimmed;
    case "draft":
    default:
      return "draft";
  }
}

function readOptionalReviewStatus(
  params: Record<string, unknown>,
  key: string,
): "pending" | "approved" | "held" | "rolled-back" | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  const trimmed = value.trim();
  switch (trimmed) {
    case "approved":
    case "held":
    case "rolled-back":
      return trimmed;
    case "pending":
    default:
      return "pending";
  }
}

function readOptionalRunOutcomeStatus(
  params: Record<string, unknown>,
  key: string,
): "completed" | "blocked" | "failed" | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  const trimmed = value.trim();
  switch (trimmed) {
    case "blocked":
    case "failed":
      return trimmed;
    case "completed":
    default:
      return "completed";
  }
}

async function emitAuditEvent(
  storage: Awaited<ReturnType<typeof getWorkforceStorageAdapter>>,
  input: {
    eventType: string;
    source?: "manual" | "system";
    targetAgentId?: string;
    payload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const enqueue = (storage.jobs as { enqueueEvent?: unknown }).enqueueEvent;
    if (typeof enqueue !== "function") return;
    await enqueue.call(storage.jobs, {
      eventType: input.eventType,
      source: input.source ?? "manual",
      targetAgentId: input.targetAgentId,
      payload: input.payload,
      metadata: input.metadata,
    });
  } catch {
    // Audit events are best effort; never block primary workforce operations.
  }
}

function dispatchExecutionWorker(
  context: {
    executionWorkerRunner?: {
      dispatchNow?: (opts?: { agentId?: string; reason?: string }) => unknown;
    };
  },
  input?: { agentId?: string; reason?: string },
) {
  try {
    context.executionWorkerRunner?.dispatchNow?.(input);
  } catch {
    // Dispatch is best effort; never block primary workforce operations.
  }
}

function templateAuditSnapshot(template: {
  id: string;
  name: string;
  departmentId?: string;
  defaultMode: "simulate" | "live";
  defaultStage?: string;
  toolsAllow?: string[];
  toolsDeny?: string[];
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    id: template.id,
    name: template.name,
    departmentId: template.departmentId ?? null,
    defaultMode: template.defaultMode,
    defaultStage: template.defaultStage ?? "simulate",
    toolsAllow: template.toolsAllow ?? [],
    toolsDeny: template.toolsDeny ?? [],
    lifecycleStatus:
      typeof template.metadata?.lifecycleStatus === "string"
        ? template.metadata.lifecycleStatus
        : null,
  };
}

function assignmentAuditSnapshot(assignment: {
  id: string;
  templateId: string;
  agentId: string;
  title: string;
  enabled: boolean;
  cadenceMinutes: number;
  executionMode: "simulate" | "live";
  deploymentStage?: string;
  promotionState?: string;
  scopeLimit?: string;
  reviewRequired?: boolean;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    id: assignment.id,
    templateId: assignment.templateId,
    agentId: assignment.agentId,
    title: assignment.title,
    enabled: assignment.enabled,
    cadenceMinutes: assignment.cadenceMinutes,
    executionMode: assignment.executionMode,
    deploymentStage: assignment.deploymentStage ?? "simulate",
    promotionState: assignment.promotionState ?? "draft",
    scopeLimit: assignment.scopeLimit ?? null,
    reviewRequired: assignment.reviewRequired ?? true,
    eventTriggers: Array.isArray(assignment.metadata?.eventTriggers)
      ? assignment.metadata.eventTriggers
      : [],
    retired:
      assignment.metadata && typeof assignment.metadata.retired === "object"
        ? assignment.metadata.retired
        : null,
  };
}

function shallowAuditDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of keys) {
    const left = before[key];
    const right = after[key];
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      diff[key] = { before: left, after: right };
    }
  }
  return diff;
}

export const jobsHandlers: GatewayRequestHandlers = {
  "jobs.templates.list": async ({ respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      respond(true, { templates: await storage.jobs.listTemplates() }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.templates.create": async ({ params, respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const created = await storage.jobs.createTemplate({
        name: readRequiredString(params, "name"),
        departmentId: readOptionalString(params, "departmentId"),
        description: readOptionalString(params, "description"),
        rolePrompt: readRequiredString(params, "rolePrompt"),
        sop: readOptionalString(params, "sop"),
        successDefinition: readOptionalString(params, "successDefinition"),
        defaultMode: params.defaultMode === "live" ? "live" : "simulate",
        defaultStage: readOptionalDeploymentStage(params, "defaultStage"),
        toolsAllow: readOptionalStringArray(params, "toolsAllow"),
        toolsDeny: readOptionalStringArray(params, "toolsDeny"),
        relationshipContract: readOptionalObject(params, "relationshipContract"),
        tags: readOptionalStringArray(params, "tags"),
      });
      respond(true, { template: created }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.templates.update": async ({ params, respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const templateId = readRequiredString(params, "templateId");
      const existing = await storage.jobs.getTemplate(templateId);
      if (!existing) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "template not found"));
        return;
      }
      const updated = await storage.jobs.updateTemplate(templateId, {
        name: readOptionalString(params, "name"),
        departmentId:
          params.departmentId === null ? "" : readOptionalString(params, "departmentId"),
        description: params.description === null ? "" : readOptionalString(params, "description"),
        rolePrompt: readOptionalString(params, "rolePrompt"),
        sop: params.sop === null ? "" : readOptionalString(params, "sop"),
        successDefinition:
          params.successDefinition === null ? "" : readOptionalString(params, "successDefinition"),
        defaultMode:
          params.defaultMode === undefined
            ? undefined
            : params.defaultMode === "live"
              ? "live"
              : "simulate",
        defaultStage: readOptionalDeploymentStage(params, "defaultStage"),
        toolsAllow: readOptionalStringArray(params, "toolsAllow"),
        toolsDeny: readOptionalStringArray(params, "toolsDeny"),
        relationshipContract: readOptionalObject(params, "relationshipContract"),
        tags: readOptionalStringArray(params, "tags"),
        metadata: readOptionalObject(params, "metadata"),
      });
      if (!updated) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "template not found"));
        return;
      }
      const before = templateAuditSnapshot(existing);
      const after = templateAuditSnapshot(updated);
      await emitAuditEvent(storage, {
        eventType: "template.updated",
        payload: {
          templateId,
          actor: "operator",
          changedFields: Object.keys(params).filter((key) => key !== "templateId"),
          before,
          after,
          diff: shallowAuditDiff(before, after),
        },
        metadata: { templateId, actor: "operator" },
      });
      respond(true, { template: updated }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.templates.retire": async ({ params, respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const templateId = readRequiredString(params, "templateId");
      const force = readOptionalBoolean(params, "force") ?? false;
      const disableLinkedAssignments =
        readOptionalBoolean(params, "disableLinkedAssignments") ?? true;
      const retiredBy = readOptionalString(params, "retiredBy") ?? "operator";
      const reason = readOptionalString(params, "reason") ?? "retired by operator";

      const template = await storage.jobs.getTemplate(templateId);
      if (!template) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "template not found"));
        return;
      }
      const before = templateAuditSnapshot(template);

      const linkedAssignments = (await storage.jobs.listAssignments()).filter(
        (item) => item.templateId === templateId,
      );
      const enabledLinked = linkedAssignments.filter((item) => item.enabled);
      if (enabledLinked.length > 0 && !force) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `template has ${enabledLinked.length} enabled assignment(s); set force=true to retire and disable them`,
          ),
        );
        return;
      }

      let disabledAssignments = 0;
      if (disableLinkedAssignments && enabledLinked.length > 0) {
        const retiredAt = new Date().toISOString();
        for (const assignment of enabledLinked) {
          await storage.jobs.updateAssignment(assignment.id, {
            enabled: false,
            promotionState: "held",
            metadata: {
              ...(assignment.metadata ?? {}),
              retired: {
                retiredAt,
                retiredBy,
                reason,
                templateId,
              },
            },
          });
          disabledAssignments += 1;
        }
      }

      const retiredAt = new Date().toISOString();
      const retired = await storage.jobs.updateTemplate(templateId, {
        metadata: {
          ...((template.metadata as Record<string, unknown> | undefined) ?? {}),
          lifecycleStatus: "retired",
          retired: {
            retiredAt,
            retiredBy,
            reason,
            disabledAssignments,
          },
        },
      });
      const after = templateAuditSnapshot(retired ?? template);
      await emitAuditEvent(storage, {
        eventType: "template.retired",
        payload: {
          templateId,
          actor: retiredBy,
          reason,
          disabledAssignments,
          linkedAssignments: linkedAssignments.length,
          before,
          after,
          diff: shallowAuditDiff(before, after),
        },
        metadata: { templateId, actor: retiredBy, reason },
      });
      respond(
        true,
        {
          template: retired ?? template,
          disabledAssignments,
          linkedAssignments: linkedAssignments.length,
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.assignments.list": async ({ params, respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const agentId = readOptionalString(params, "agentId");
      const enabled = readOptionalBoolean(params, "enabled");
      respond(
        true,
        {
          assignments: await storage.jobs.listAssignments({ agentId, enabled }),
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.assignments.create": async ({ params, respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const assignment = await storage.jobs.createAssignment({
        templateId: readRequiredString(params, "templateId"),
        agentId: readRequiredString(params, "agentId"),
        title: readOptionalString(params, "title"),
        cadenceMinutes: readOptionalNumber(params, "cadenceMinutes"),
        executionMode: params.executionMode === "live" ? "live" : "simulate",
        deploymentStage: readOptionalDeploymentStage(params, "deploymentStage"),
        promotionState: readOptionalPromotionState(params, "promotionState"),
        scopeLimit: readOptionalString(params, "scopeLimit"),
        reviewRequired: readOptionalBoolean(params, "reviewRequired"),
        enabled: readOptionalBoolean(params, "enabled"),
        nextRunAt: readOptionalNumber(params, "nextRunAt"),
        metadata: readOptionalObject(params, "metadata"),
      });
      respond(true, { assignment }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.assignments.update": async ({ params, respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const assignmentId = readRequiredString(params, "assignmentId");
      const existing = await storage.jobs.getAssignment(assignmentId);
      if (!existing) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "assignment not found"));
        return;
      }
      const updated = await storage.jobs.updateAssignment(assignmentId, {
        enabled: readOptionalBoolean(params, "enabled"),
        cadenceMinutes: readOptionalNumber(params, "cadenceMinutes"),
        executionMode:
          params.executionMode === undefined
            ? undefined
            : params.executionMode === "live"
              ? "live"
              : "simulate",
        deploymentStage: readOptionalDeploymentStage(params, "deploymentStage"),
        promotionState: readOptionalPromotionState(params, "promotionState"),
        scopeLimit: params.scopeLimit === null ? null : readOptionalString(params, "scopeLimit"),
        reviewRequired: readOptionalBoolean(params, "reviewRequired"),
        nextRunAt: params.nextRunAt === null ? null : readOptionalNumber(params, "nextRunAt"),
        title: readOptionalString(params, "title"),
        metadata: readOptionalObject(params, "metadata"),
      });
      if (!updated) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "assignment not found"));
        return;
      }
      const before = assignmentAuditSnapshot(existing);
      const after = assignmentAuditSnapshot(updated);
      await emitAuditEvent(storage, {
        eventType: "assignment.updated",
        targetAgentId: updated.agentId,
        payload: {
          assignmentId,
          templateId: updated.templateId,
          agentId: updated.agentId,
          actor: "operator",
          changedFields: Object.keys(params).filter((key) => key !== "assignmentId"),
          before,
          after,
          diff: shallowAuditDiff(before, after),
        },
        metadata: { assignmentId, templateId: updated.templateId, actor: "operator" },
      });
      respond(true, { assignment: updated }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.assignments.retire": async ({ params, respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const assignmentId = readRequiredString(params, "assignmentId");
      const force = readOptionalBoolean(params, "force") ?? false;
      const retiredBy = readOptionalString(params, "retiredBy") ?? "operator";
      const reason = readOptionalString(params, "reason") ?? "retired by operator";
      const assignment = await storage.jobs.getAssignment(assignmentId);
      if (!assignment) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "assignment not found"));
        return;
      }
      const before = assignmentAuditSnapshot(assignment);

      const runningRuns = (await storage.jobs.listRuns({ assignmentId, limit: 200 })).filter(
        (run) => run.status === "running",
      );
      if (runningRuns.length > 0 && !force) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `assignment has ${runningRuns.length} running run(s); set force=true to retire anyway`,
          ),
        );
        return;
      }

      const retiredAt = new Date().toISOString();
      const retired = await storage.jobs.updateAssignment(assignmentId, {
        enabled: false,
        promotionState: "held",
        metadata: {
          ...(assignment.metadata ?? {}),
          retired: {
            retiredAt,
            retiredBy,
            reason,
            runningRuns: runningRuns.length,
          },
        },
      });
      if (!retired) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "assignment not found"));
        return;
      }
      const after = assignmentAuditSnapshot(retired);
      await emitAuditEvent(storage, {
        eventType: "assignment.retired",
        targetAgentId: retired.agentId,
        payload: {
          assignmentId,
          templateId: retired.templateId,
          agentId: retired.agentId,
          actor: retiredBy,
          reason,
          runningRuns: runningRuns.length,
          before,
          after,
          diff: shallowAuditDiff(before, after),
        },
        metadata: {
          assignmentId,
          templateId: retired.templateId,
          actor: retiredBy,
          reason,
        },
      });
      respond(
        true,
        {
          assignment: retired,
          runningRuns: runningRuns.length,
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.assignments.runNow": async ({ params, respond, context }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const assignmentId = readRequiredString(params, "assignmentId");
      const assignment = await storage.jobs.getAssignment(assignmentId);
      if (!assignment) {
        throw new Error(`assignment not found: ${assignmentId}`);
      }
      const now = Date.now();
      await storage.jobs.updateAssignment(assignmentId, {
        nextRunAt: now,
      });
      const queuedTasks = await storage.jobs.ensureDueTasks({
        now,
        agentId: assignment.agentId,
      });
      if (queuedTasks > 0) {
        dispatchExecutionWorker(context, {
          agentId: assignment.agentId,
          reason: "assignment-run-now",
        });
      }
      await emitAuditEvent(storage, {
        eventType: "assignment.run_now",
        targetAgentId: assignment.agentId,
        payload: {
          assignmentId,
          templateId: assignment.templateId,
          agentId: assignment.agentId,
          queuedTasks,
          actor: "operator",
        },
        metadata: { assignmentId, templateId: assignment.templateId, actor: "operator" },
      });
      respond(
        true,
        {
          ok: true,
          assignmentId,
          queuedTasks,
          dispatched: queuedTasks > 0,
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.runs.list": async ({ params, respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const runs = await storage.jobs.listRuns({
        assignmentId: readOptionalString(params, "assignmentId"),
        taskId: readOptionalString(params, "taskId"),
        limit: readOptionalNumber(params, "limit"),
      });
      respond(true, { runs }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.events.list": async ({ params, respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const source = readOptionalJobEventSource(params, "source");
      const targetAgentId = readOptionalString(params, "targetAgentId");
      const runId = readOptionalString(params, "runId");
      const taskId = readOptionalString(params, "taskId");
      const assignmentId = readOptionalString(params, "assignmentId");
      const templateId = readOptionalString(params, "templateId");
      const events = await storage.jobs.listEvents({
        eventType: readOptionalString(params, "eventType"),
        processed: readOptionalBoolean(params, "processed"),
        limit: readOptionalNumber(params, "limit"),
      });
      const filtered = events.filter((event) => {
        if (source && event.source !== source) return false;
        if (targetAgentId && event.targetAgentId !== targetAgentId) return false;
        const linkValues = eventLinkValues(event);
        if (runId && !linkValues.has(runId)) return false;
        if (taskId && !linkValues.has(taskId)) return false;
        if (assignmentId && !linkValues.has(assignmentId)) return false;
        if (templateId && !linkValues.has(templateId)) return false;
        return true;
      });
      respond(true, { events: filtered }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.runs.trace": async ({ params, respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const runId = readRequiredString(params, "runId");
      const runs = await storage.jobs.listRuns({ limit: 500 });
      const run = runs.find((item) => item.id === runId);
      if (!run) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "run not found"));
        return;
      }
      const [assignment, template, task, events] = await Promise.all([
        storage.jobs.getAssignment(run.assignmentId),
        storage.jobs.getTemplate(run.templateId),
        storage.tasks.get(run.taskId),
        storage.jobs.listEvents({ limit: 300 }),
      ]);
      const assignmentRuns = runs
        .filter((item) => item.assignmentId === run.assignmentId)
        .sort((left, right) => right.startedAt - left.startedAt)
        .slice(0, 15);

      const relatedEvents = events
        .filter((event) => {
          const linkValues = eventLinkValues(event);
          if (linkValues.has(run.id)) return true;
          if (linkValues.has(run.taskId)) return true;
          if (linkValues.has(run.assignmentId)) return true;
          if (linkValues.has(run.templateId)) return true;
          return false;
        })
        .sort((left, right) => right.createdAt - left.createdAt);

      respond(
        true,
        {
          run,
          assignment: assignment ?? null,
          template: template ?? null,
          task: task ?? null,
          assignmentRuns,
          events: relatedEvents,
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.runs.review": async ({ params, respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const runId = readRequiredString(params, "runId");
      const runBefore = (await storage.jobs.listRuns({ limit: 500 })).find(
        (item) => item.id === runId,
      );
      if (!runBefore) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "run not found"));
        return;
      }
      const reviewStatus = readOptionalReviewStatus(params, "reviewStatus");
      if (!reviewStatus) {
        throw new Error("reviewStatus is required");
      }
      const action = readOptionalString(params, "action");
      if (
        action !== undefined &&
        action !== "promote" &&
        action !== "hold" &&
        action !== "rollback"
      ) {
        throw new Error("action must be promote, hold, or rollback");
      }
      const run = await storage.jobs.reviewRun(runId, {
        reviewStatus,
        reviewedBy: readOptionalString(params, "reviewedBy"),
        notes: readOptionalString(params, "notes"),
        action,
        targetStage: readOptionalDeploymentStage(params, "targetStage"),
      });
      if (!run) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "run not found"));
        return;
      }
      const before = {
        id: runBefore.id,
        status: runBefore.status,
        reviewStatus: runBefore.reviewStatus ?? "pending",
        deploymentStage: runBefore.deploymentStage ?? "simulate",
      };
      const after = {
        id: run.id,
        status: run.status,
        reviewStatus: run.reviewStatus ?? "pending",
        deploymentStage: run.deploymentStage ?? "simulate",
      };
      await emitAuditEvent(storage, {
        eventType: "run.reviewed",
        targetAgentId: run.agentId,
        payload: {
          runId: run.id,
          assignmentId: run.assignmentId,
          templateId: run.templateId,
          reviewStatus,
          action: action ?? null,
          actor: readOptionalString(params, "reviewedBy") ?? "operator",
          before,
          after,
          diff: shallowAuditDiff(before, after),
        },
        metadata: {
          runId: run.id,
          assignmentId: run.assignmentId,
          templateId: run.templateId,
          reviewStatus,
          action: action ?? null,
        },
      });
      respond(true, { run }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.runs.retry": async ({ params, respond, context }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const runId = readRequiredString(params, "runId");
      const runs = await storage.jobs.listRuns({ limit: 500 });
      const run = runs.find((item) => item.id === runId);
      if (!run) {
        throw new Error(`run not found: ${runId}`);
      }
      if (run.status === "running") {
        throw new Error("cannot retry a running run");
      }
      const assignment = await storage.jobs.getAssignment(run.assignmentId);
      if (!assignment) {
        throw new Error(`assignment not found for run: ${run.assignmentId}`);
      }
      const now = Date.now();
      await storage.jobs.updateAssignment(assignment.id, {
        nextRunAt: now,
        enabled: true,
      });
      const queuedTasks = await storage.jobs.ensureDueTasks({
        now,
        agentId: assignment.agentId,
      });
      if (queuedTasks > 0) {
        dispatchExecutionWorker(context, {
          agentId: assignment.agentId,
          reason: "run-retry",
        });
      }
      respond(
        true,
        {
          ok: true,
          runId,
          assignmentId: assignment.id,
          queuedTasks,
          dispatched: queuedTasks > 0,
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.runs.advance": async ({ params, respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const runId = readRequiredString(params, "runId");
      const outcomeStatus = readOptionalRunOutcomeStatus(params, "outcomeStatus") ?? "completed";
      const summary = readOptionalString(params, "summary");
      const blockers = readOptionalString(params, "blockers");
      const queueNext = readOptionalBoolean(params, "queueNext") ?? false;

      const runs = await storage.jobs.listRuns({ limit: 500 });
      const run = runs.find((item) => item.id === runId);
      if (!run) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "run not found"));
        return;
      }

      if (run.status !== "running") {
        respond(true, { run, queuedNext: false }, undefined);
        return;
      }

      if (outcomeStatus === "completed") {
        await storage.tasks.complete(run.taskId);
      } else if (outcomeStatus === "blocked") {
        await storage.tasks.block(run.taskId, blockers ?? summary);
      } else {
        await storage.tasks.fail(run.taskId, blockers ?? summary);
      }

      const completedRun = await storage.jobs.completeRunForTask(run.taskId, {
        status: outcomeStatus,
        summary,
        blockers,
        metadata: {
          operatorAdvance: {
            queueNext,
            completedAt: new Date().toISOString(),
          },
        },
      });

      let updatedAssignment = null;
      let queuedNext = false;
      if (queueNext) {
        const assignment = await storage.jobs.getAssignment(run.assignmentId);
        if (assignment?.enabled && assignment.promotionState === "approved-next-stage") {
          updatedAssignment = await storage.jobs.updateAssignment(assignment.id, {
            nextRunAt: Date.now() - 1,
          });
          queuedNext = true;
        } else {
          updatedAssignment = assignment;
        }
      }

      respond(
        true,
        {
          run: completedRun ?? run,
          assignment: updatedAssignment ?? undefined,
          queuedNext,
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "jobs.overview": async ({ respond }) => {
    try {
      const storage = await getWorkforceStorageAdapter();
      const [assignments, templates, runs] = await Promise.all([
        storage.jobs.listAssignments(),
        storage.jobs.listTemplates(),
        storage.jobs.listRuns({ limit: 200 }),
      ]);
      const tasks = await storage.tasks.list({ source: "job", limit: 500 });

      const now = Date.now();
      const byAgent = new Map<
        string,
        {
          total: number;
          enabled: number;
          blockedTasks: number;
          dueNow: number;
          nextDueAt: number | null;
        }
      >();
      for (const assignment of assignments) {
        const entry = byAgent.get(assignment.agentId) ?? {
          total: 0,
          enabled: 0,
          blockedTasks: 0,
          dueNow: 0,
          nextDueAt: null,
        };
        entry.total += 1;
        if (assignment.enabled) entry.enabled += 1;
        if (assignment.nextRunAt && assignment.nextRunAt <= now) entry.dueNow += 1;
        if (assignment.nextRunAt) {
          entry.nextDueAt =
            entry.nextDueAt == null
              ? assignment.nextRunAt
              : Math.min(entry.nextDueAt, assignment.nextRunAt);
        }
        byAgent.set(assignment.agentId, entry);
      }
      for (const task of tasks) {
        if (task.status !== "blocked" || !task.agentId) continue;
        const entry = byAgent.get(task.agentId);
        if (entry) entry.blockedTasks += 1;
      }

      respond(
        true,
        {
          templatesCount: templates.length,
          assignmentsCount: assignments.length,
          enabledAssignmentsCount: assignments.filter((a) => a.enabled).length,
          runningJobsCount: runs.filter((r) => r.status === "running").length,
          blockedRunsCount: runs.filter((r) => r.status === "blocked").length,
          dueNowCount: assignments.filter((a) => a.enabled && (a.nextRunAt ?? 0) <= now).length,
          agents: Array.from(byAgent.entries()).map(([agentId, stats]) => ({ agentId, ...stats })),
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },
};
