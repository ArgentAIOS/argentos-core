import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import type { GatewayRequestHandlers } from "./types.js";
import {
  parseConnectorManifest,
  enrichWithHealthProbe,
  type HealthProbeResult,
  type DoctorProbeResult,
} from "../../connectors/canvas-node-parser.js";
import {
  discoverConnectorCatalog,
  defaultRepoRoots,
  runConnectorCommandJson,
  type ConnectorCatalogEntry,
} from "../../connectors/catalog.js";
import { resolvePostgresUrl, resolveRuntimeStorageConfig } from "../../data/storage-resolver.js";
import {
  pgListServiceKeys,
  pgUpsertServiceKey,
  pgDeleteServiceKey,
  pgGetServiceKeyByVariable,
} from "../../infra/pg-secret-store.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

const log = createSubsystemLogger("gateway/workflows");

// ── Postgres connection (lazy singleton) ────────────────────────────────────

let _sql: ReturnType<typeof postgres> | null = null;
let _initPromise: Promise<ReturnType<typeof postgres> | null> | null = null;

function isPgBacked(): boolean {
  const cfg = resolveRuntimeStorageConfig(process.env);
  return cfg.backend === "postgres" || cfg.backend === "dual";
}

async function getSql(): Promise<ReturnType<typeof postgres>> {
  if (_sql) return _sql;
  if (_initPromise) {
    const result = await _initPromise;
    if (result) return result;
  }

  _initPromise = (async () => {
    if (!isPgBacked()) {
      throw new Error("Workflows require PostgreSQL backend");
    }
    const connectionString = resolvePostgresUrl();
    const sql = postgres(connectionString, {
      max: 3,
      idle_timeout: 10,
      connect_timeout: 5,
      prepare: false,
    });
    try {
      await sql`SELECT 1`;
      _sql = sql;
      log.info("workflows PG connection established");
      return sql;
    } catch (err) {
      log.warn(`workflows PG init failed: ${String(err)}`);
      throw err;
    }
  })();

  const result = await _initPromise;
  if (!result) throw new Error("Workflows PG connection failed");
  return result;
}

// ── Param helpers ───────────────────────────────────────────────────────────

function requireString(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`${key} is required and must be a non-empty string`);
  }
  return v.trim();
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  const trimmed = v.trim();
  return trimmed || undefined;
}

function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${key} must be a number`);
  return v;
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new Error(`${key} must be a boolean`);
  return v;
}

function optionalObject(
  params: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${key} must be an object`);
  return v as Record<string, unknown>;
}

function optionalArray(params: Record<string, unknown>, key: string): unknown[] | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new Error(`${key} must be an array`);
  return v;
}

// ── Handlers ────────────────────────────────────────────────────────────────

export const workflowsHandlers: GatewayRequestHandlers = {
  // ── CRUD ──────────────────────────────────────────────────────────────────

  "workflows.create": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const id = randomUUID();
      const name = requireString(params, "name");
      const description = optionalString(params, "description") ?? null;
      const ownerAgentId = optionalString(params, "ownerAgentId") ?? "argent";
      const nodes = optionalArray(params, "nodes") ?? [];
      const edges = optionalArray(params, "edges") ?? [];
      const canvasLayout = optionalObject(params, "canvasLayout") ?? {};
      const triggerType = optionalString(params, "triggerType") ?? null;
      const triggerConfig = optionalObject(params, "triggerConfig") ?? null;
      const defaultOnError = optionalObject(params, "defaultOnError") ?? {
        strategy: "fail",
        notifyOnError: true,
      };
      const maxRunDurationMs = optionalNumber(params, "maxRunDurationMs") ?? 3600000;
      const maxRunCostUsd = optionalNumber(params, "maxRunCostUsd") ?? null;

      const [row] = await sql`
        INSERT INTO workflows (
          id, name, description, owner_agent_id, version, is_active,
          nodes, edges, canvas_layout,
          default_on_error, max_run_duration_ms, max_run_cost_usd,
          trigger_type, trigger_config, deployment_stage
        ) VALUES (
          ${id}, ${name}, ${description}, ${ownerAgentId}, 1, true,
          ${JSON.stringify(nodes)}::jsonb, ${JSON.stringify(edges)}::jsonb,
          ${JSON.stringify(canvasLayout)}::jsonb,
          ${JSON.stringify(defaultOnError)}::jsonb, ${maxRunDurationMs},
          ${maxRunCostUsd}, ${triggerType}, ${triggerConfig ? JSON.stringify(triggerConfig) : null}::jsonb,
          'live'
        )
        RETURNING *
      `;

      log.info(`workflow created: ${id} "${name}"`);
      respond(true, row);
    } catch (err) {
      log.warn(`workflows.create failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.update": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      // Accept both "id" and "workflowId" (dashboard sends workflowId)
      const id =
        typeof params.id === "string" && params.id.trim()
          ? params.id.trim()
          : requireString(params, "workflowId");

      // Fetch current workflow for versioning
      const [existing] = await sql`SELECT * FROM workflows WHERE id = ${id}`;
      if (!existing) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Workflow not found"));
        return;
      }

      const newVersion = (existing.version as number) + 1;

      // Save current state to version history
      const versionId = randomUUID();
      await sql`
        INSERT INTO workflow_versions (id, workflow_id, version, nodes, edges, canvas_layout, changed_by, change_summary)
        VALUES (
          ${versionId}, ${id}, ${existing.version},
          ${JSON.stringify(existing.nodes)}::jsonb,
          ${JSON.stringify(existing.edges)}::jsonb,
          ${JSON.stringify(existing.canvas_layout)}::jsonb,
          ${optionalString(params, "changedBy") ?? "operator"},
          ${optionalString(params, "changeSummary") ?? null}
        )
      `;

      // Build SET clause dynamically
      // Dashboard may send { canvasData: { nodes, edges } } instead of flat nodes/edges
      const canvasData = optionalObject(params, "canvasData");

      const name = optionalString(params, "name");
      const description = optionalString(params, "description");
      const nodes =
        optionalArray(params, "nodes") ??
        (canvasData && Array.isArray((canvasData as Record<string, unknown>).nodes)
          ? ((canvasData as Record<string, unknown>).nodes as unknown[])
          : undefined);
      const edges =
        optionalArray(params, "edges") ??
        (canvasData && Array.isArray((canvasData as Record<string, unknown>).edges)
          ? ((canvasData as Record<string, unknown>).edges as unknown[])
          : undefined);
      const canvasLayout = optionalObject(params, "canvasLayout");
      const triggerType = optionalString(params, "triggerType");
      const triggerConfig = optionalObject(params, "triggerConfig");
      const defaultOnError = optionalObject(params, "defaultOnError");
      const maxRunDurationMs = optionalNumber(params, "maxRunDurationMs");
      const maxRunCostUsd = optionalNumber(params, "maxRunCostUsd");
      const isActive = optionalBoolean(params, "isActive");
      const nextFireAt = optionalString(params, "nextFireAt");

      const [updated] = await sql`
        UPDATE workflows SET
          version = ${newVersion},
          name = COALESCE(${name ?? null}, name),
          description = COALESCE(${description ?? null}, description),
          nodes = COALESCE(${nodes ? JSON.stringify(nodes) : null}::jsonb, nodes),
          edges = COALESCE(${edges ? JSON.stringify(edges) : null}::jsonb, edges),
          canvas_layout = COALESCE(${canvasLayout ? JSON.stringify(canvasLayout) : null}::jsonb, canvas_layout),
          trigger_type = COALESCE(${triggerType ?? null}, trigger_type),
          trigger_config = COALESCE(${triggerConfig ? JSON.stringify(triggerConfig) : null}::jsonb, trigger_config),
          default_on_error = COALESCE(${defaultOnError ? JSON.stringify(defaultOnError) : null}::jsonb, default_on_error),
          max_run_duration_ms = COALESCE(${maxRunDurationMs ?? null}, max_run_duration_ms),
          max_run_cost_usd = COALESCE(${maxRunCostUsd ?? null}, max_run_cost_usd),
          is_active = COALESCE(${isActive ?? null}, is_active),
          next_fire_at = COALESCE(${nextFireAt ?? null}::timestamptz, next_fire_at),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      log.info(`workflow updated: ${id} → v${newVersion}`);
      respond(true, updated);
    } catch (err) {
      log.warn(`workflows.update failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.get": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const id = requireString(params, "id");

      const [row] = await sql`SELECT * FROM workflows WHERE id = ${id}`;
      if (!row) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Workflow not found"));
        return;
      }

      respond(true, row);
    } catch (err) {
      log.warn(`workflows.get failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.list": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const limit = optionalNumber(params, "limit") ?? 50;
      const offset = optionalNumber(params, "offset") ?? 0;
      const activeOnly = optionalBoolean(params, "activeOnly") ?? false;
      const ownerAgentId = optionalString(params, "ownerAgentId");

      let rows;
      if (activeOnly && ownerAgentId) {
        rows = await sql`
          SELECT * FROM workflows
          WHERE is_active = true AND owner_agent_id = ${ownerAgentId}
          ORDER BY updated_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (activeOnly) {
        rows = await sql`
          SELECT * FROM workflows
          WHERE is_active = true
          ORDER BY updated_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (ownerAgentId) {
        rows = await sql`
          SELECT * FROM workflows
          WHERE owner_agent_id = ${ownerAgentId}
          ORDER BY updated_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        rows = await sql`
          SELECT * FROM workflows
          ORDER BY updated_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      }

      // Get total count for pagination
      const [countRow] = activeOnly
        ? await sql`SELECT COUNT(*)::int AS total FROM workflows WHERE is_active = true`
        : await sql`SELECT COUNT(*)::int AS total FROM workflows`;

      respond(true, { workflows: rows, total: countRow?.total ?? 0, limit, offset });
    } catch (err) {
      log.warn(`workflows.list failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.delete": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const id = requireString(params, "id");

      // Cascading delete — workflow_runs and workflow_step_runs are ON DELETE CASCADE
      const [deleted] = await sql`
        DELETE FROM workflows WHERE id = ${id} RETURNING id, name
      `;

      if (!deleted) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Workflow not found"));
        return;
      }

      log.info(`workflow deleted: ${id} "${deleted.name}"`);
      respond(true, { deleted: true, id });
    } catch (err) {
      log.warn(`workflows.delete failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.duplicate": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const sourceId = requireString(params, "id");
      const newName = optionalString(params, "name");

      const [source] = await sql`SELECT * FROM workflows WHERE id = ${sourceId}`;
      if (!source) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Source workflow not found"),
        );
        return;
      }

      const newId = randomUUID();
      const name = newName ?? `${source.name} (copy)`;

      const [row] = await sql`
        INSERT INTO workflows (
          id, name, description, owner_agent_id, version, is_active,
          nodes, edges, canvas_layout,
          default_on_error, max_run_duration_ms, max_run_cost_usd,
          trigger_type, trigger_config, deployment_stage
        ) VALUES (
          ${newId}, ${name}, ${source.description},
          ${source.owner_agent_id}, 1, true,
          ${JSON.stringify(source.nodes)}::jsonb,
          ${JSON.stringify(source.edges)}::jsonb,
          ${JSON.stringify(source.canvas_layout)}::jsonb,
          ${JSON.stringify(source.default_on_error)}::jsonb,
          ${source.max_run_duration_ms},
          ${source.max_run_cost_usd},
          ${source.trigger_type},
          ${source.trigger_config ? JSON.stringify(source.trigger_config) : null}::jsonb,
          'live'
        )
        RETURNING *
      `;

      log.info(`workflow duplicated: ${sourceId} → ${newId} "${name}"`);
      respond(true, row);
    } catch (err) {
      log.warn(`workflows.duplicate failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Execution ─────────────────────────────────────────────────────────────

  "workflows.run": async ({ params, respond, context }) => {
    try {
      const sql = await getSql();
      const workflowId = requireString(params, "workflowId");
      const triggerPayload = optionalObject(params, "triggerPayload") ?? {};

      const [wf] = await sql`
        SELECT * FROM workflows WHERE id = ${workflowId} AND is_active = true
      `;
      if (!wf) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Workflow not found or inactive"),
        );
        return;
      }

      const runId = randomUUID();
      const [run] = await sql`
        INSERT INTO workflow_runs (
          id, workflow_id, workflow_version, status,
          trigger_type, trigger_payload, variables
        ) VALUES (
          ${runId}, ${workflowId}, ${wf.version},
          'running', 'manual',
          ${JSON.stringify(triggerPayload)}::jsonb,
          '{}'::jsonb
        )
        RETURNING *
      `;

      log.info(`workflow run created: ${runId} for workflow ${workflowId} v${wf.version}`);

      // Broadcast run creation for live subscribers
      if (context?.broadcast) {
        context.broadcast("workflow.run.created", {
          runId,
          workflowId,
          status: "running",
        });
      }

      // Respond immediately with runId — execution happens in background
      respond(true, { ...run, status: "running" });

      // Execute workflow in background
      const { executeWorkflow, CoreAgentDispatcher } =
        await import("../../infra/workflow-runner.js");

      const definition: import("../../infra/workflow-types.js").WorkflowDefinition = {
        id: wf.id as string,
        name: wf.name as string,
        description: wf.description as string | undefined,
        nodes: wf.nodes as import("../../infra/workflow-types.js").WorkflowNode[],
        edges: wf.edges as import("../../infra/workflow-types.js").WorkflowEdge[],
        defaultOnError:
          (wf.default_on_error as import("../../infra/workflow-types.js").ErrorConfig) ?? {
            strategy: "fail" as const,
            notifyOnError: true,
          },
        maxRunDurationMs: wf.max_run_duration_ms as number | undefined,
        maxRunCostUsd: wf.max_run_cost_usd as number | undefined,
      };

      const dispatcher = new CoreAgentDispatcher();

      // Get Redis for agent presence (optional)
      let redis: import("ioredis").default | null = null;
      try {
        const { getAgentFamily } = await import("../../data/agent-family.js");
        const family = await getAgentFamily();
        redis = family.getRedis();
      } catch {
        /* Redis optional */
      }

      executeWorkflow({
        workflow: definition,
        runId,
        dispatcher,
        triggerPayload: triggerPayload as Record<string, unknown>,
        triggerSource: "gateway:manual",
        redis,
        pgSql: sql,
        onApprovalRequested: (_nodeId, request) => {
          if (context?.broadcast) {
            context.broadcast("workflow.approval.requested", {
              runId: request.runId,
              nodeId: request.nodeId,
              message: request.message,
              previousOutput: request.showPreviousOutput ? request.previousOutput : undefined,
              timeoutMs: request.timeoutMs,
              timeoutAction: request.timeoutAction,
              requestedAt: request.requestedAt,
            });
          }
        },
        onStepStart: (nodeId, node) => {
          if (context?.broadcast) {
            context.broadcast("workflow.step.started", {
              runId,
              workflowId,
              nodeId,
              nodeKind: node.kind,
            });
          }
        },
        onStepComplete: (nodeId, record) => {
          // Persist step to PG (fire-and-forget)
          sql`
            INSERT INTO workflow_step_runs (
              id, run_id, node_id, node_kind, node_label,
              agent_id, step_index, status, duration_ms,
              output, tokens_used, cost_usd, started_at, ended_at
            ) VALUES (
              ${randomUUID()}, ${runId}, ${nodeId}, ${record.nodeKind},
              ${record.nodeLabel}, ${record.agentId ?? null},
              ${record.stepIndex}, ${record.status}, ${record.durationMs},
              ${JSON.stringify(record.output)}::jsonb,
              ${record.tokensUsed ?? null}, ${record.costUsd ?? null},
              ${new Date(record.startedAt).toISOString()}::timestamptz,
              ${new Date(record.endedAt).toISOString()}::timestamptz
            )
          `.catch((err: unknown) => {
            log.warn(`failed to persist step run: ${String(err)}`);
          });

          if (context?.broadcast) {
            context.broadcast("workflow.step.completed", {
              runId,
              workflowId,
              nodeId,
              status: record.status,
              durationMs: record.durationMs,
              tokensUsed: record.tokensUsed,
            });
          }
        },
        onRunComplete: (status, steps) => {
          // Update PG run record with final result
          sql`
            UPDATE workflow_runs SET
              status = ${status},
              total_tokens = ${steps.reduce((sum, s) => sum + (s.tokensUsed ?? 0), 0)},
              total_cost_usd = ${steps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0)},
              ended_at = NOW()
            WHERE id = ${runId}
          `.catch((err: unknown) => {
            log.warn(`failed to update workflow run: ${String(err)}`);
          });

          if (context?.broadcast) {
            context.broadcast("workflow.run.completed", {
              runId,
              workflowId,
              status,
              stepCount: steps.length,
            });
          }
        },
      }).catch((err) => {
        log.error(`workflow execution failed: runId=${runId} error=${String(err)}`);
        // Mark run as failed in PG
        sql`
          UPDATE workflow_runs SET status = 'failed', ended_at = NOW()
          WHERE id = ${runId}
        `.catch(() => {});
        if (context?.broadcast) {
          context.broadcast("workflow.run.completed", {
            runId,
            workflowId,
            status: "failed",
            error: String(err),
          });
        }
      });
    } catch (err) {
      log.warn(`workflows.run failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Run History ───────────────────────────────────────────────────────────

  "workflows.runs.list": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const workflowId = optionalString(params, "workflowId");
      const limit = optionalNumber(params, "limit") ?? 25;
      const offset = optionalNumber(params, "offset") ?? 0;
      const status = optionalString(params, "status");

      let rows;
      if (workflowId && status) {
        rows = await sql`
          SELECT r.*, w.name AS workflow_name
          FROM workflow_runs r
          JOIN workflows w ON w.id = r.workflow_id
          WHERE r.workflow_id = ${workflowId} AND r.status = ${status}
          ORDER BY r.started_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (workflowId) {
        rows = await sql`
          SELECT r.*, w.name AS workflow_name
          FROM workflow_runs r
          JOIN workflows w ON w.id = r.workflow_id
          WHERE r.workflow_id = ${workflowId}
          ORDER BY r.started_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (status) {
        rows = await sql`
          SELECT r.*, w.name AS workflow_name
          FROM workflow_runs r
          JOIN workflows w ON w.id = r.workflow_id
          WHERE r.status = ${status}
          ORDER BY r.started_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        rows = await sql`
          SELECT r.*, w.name AS workflow_name
          FROM workflow_runs r
          JOIN workflows w ON w.id = r.workflow_id
          ORDER BY r.started_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      }

      respond(true, { runs: rows, limit, offset });
    } catch (err) {
      log.warn(`workflows.runs.list failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.runs.get": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const runId = requireString(params, "runId");

      const [run] = await sql`
        SELECT r.*, w.name AS workflow_name
        FROM workflow_runs r
        JOIN workflows w ON w.id = r.workflow_id
        WHERE r.id = ${runId}
      `;
      if (!run) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Run not found"));
        return;
      }

      // Fetch step runs for this run
      const steps = await sql`
        SELECT * FROM workflow_step_runs
        WHERE run_id = ${runId}
        ORDER BY started_at ASC NULLS LAST
      `;

      respond(true, { ...run, steps });
    } catch (err) {
      log.warn(`workflows.runs.get failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Live Updates ──────────────────────────────────────────────────────────

  "workflows.connectors": async ({ respond }) => {
    try {
      const catalog = await discoverConnectorCatalog();
      const connectors = catalog.connectors.map((c: ConnectorCatalogEntry) => {
        // Read the manifest to check scaffold_only flag
        let scaffoldOnly = false;
        for (const root of defaultRepoRoots()) {
          const mPath = path.join(root, c.tool, "connector.json");
          if (fs.existsSync(mPath)) {
            try {
              const raw = JSON.parse(fs.readFileSync(mPath, "utf-8")) as Record<string, unknown>;
              const scope =
                raw.scope && typeof raw.scope === "object"
                  ? (raw.scope as Record<string, unknown>)
                  : {};
              scaffoldOnly = scope.scaffold_only === true;
            } catch {
              /* ignore */
            }
            break;
          }
        }

        // Determine readiness state for sidebar badge
        const isBlocked = scaffoldOnly || c.installState === "repo-only";
        const readinessState: string = isBlocked
          ? "blocked"
          : c.installState === "ready"
            ? "write_ready"
            : c.installState === "needs-setup"
              ? "setup_required"
              : "setup_required";

        return {
          id: c.tool,
          name: c.label || c.tool.replace(/^aos-/, "").replace(/-/g, " "),
          category: c.category ?? "general",
          categories: c.categories,
          commands: c.commands.map((cmd) => ({
            id: cmd.id,
            summary: cmd.summary,
            actionClass: cmd.actionClass,
          })),
          installState: c.installState,
          statusOk: c.status.ok,
          scaffoldOnly,
          readinessState,
        };
      });
      respond(true, { connectors });
    } catch (err) {
      log.warn(`workflows.connectors failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.subscribe": async ({ params, respond, client, context }) => {
    try {
      const workflowId = optionalString(params, "workflowId");
      const runId = optionalString(params, "runId");

      if (!workflowId && !runId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "workflowId or runId required"),
        );
        return;
      }

      // Subscription tracking is handled by the WebSocket layer.
      // The client receives workflow.run.* events via broadcast.
      // This handler acknowledges the subscription request.
      log.info(
        `workflow subscribe: connId=${client?.connId ?? "?"} workflow=${workflowId ?? "*"} run=${runId ?? "*"}`,
      );

      respond(true, {
        subscribed: true,
        workflowId: workflowId ?? null,
        runId: runId ?? null,
      });
    } catch (err) {
      log.warn(`workflows.subscribe failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Approval Gate ───────────────────────────────────────────────────────────

  "workflows.approve": async ({ params, respond, context }) => {
    try {
      const runId = requireString(params, "runId");
      const nodeId = requireString(params, "nodeId");

      const { resolveApproval, hasPendingApproval } =
        await import("../../infra/workflow-runner.js");

      if (!hasPendingApproval(runId, nodeId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "No pending approval for this run/node"),
        );
        return;
      }

      const resolved = resolveApproval(runId, nodeId, true);
      if (!resolved) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Failed to resolve approval"),
        );
        return;
      }

      log.info(`workflow approval granted: runId=${runId} nodeId=${nodeId}`);

      if (context?.broadcast) {
        context.broadcast("workflow.approval.resolved", {
          runId,
          nodeId,
          approved: true,
        });
      }

      respond(true, { ok: true, resumed: true });
    } catch (err) {
      log.warn(`workflows.approve failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.deny": async ({ params, respond, context }) => {
    try {
      const runId = requireString(params, "runId");
      const nodeId = requireString(params, "nodeId");
      const reason = optionalString(params, "reason") ?? "Denied by operator";

      const { resolveApproval, hasPendingApproval } =
        await import("../../infra/workflow-runner.js");

      if (!hasPendingApproval(runId, nodeId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "No pending approval for this run/node"),
        );
        return;
      }

      const resolved = resolveApproval(runId, nodeId, false, reason);
      if (!resolved) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Failed to resolve denial"),
        );
        return;
      }

      log.info(`workflow approval denied: runId=${runId} nodeId=${nodeId} reason="${reason}"`);

      if (context?.broadcast) {
        context.broadcast("workflow.approval.resolved", {
          runId,
          nodeId,
          approved: false,
          reason,
        });
      }

      respond(true, { ok: true, denied: true, reason });
    } catch (err) {
      log.warn(`workflows.deny failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.pendingApprovals": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const workflowId = optionalString(params, "workflowId");

      let rows;
      if (workflowId) {
        rows = await sql`
          SELECT r.id AS run_id, r.workflow_id, r.current_node_id,
                 r.status, w.name AS workflow_name,
                 s.approval_status, s.started_at AS approval_requested_at
          FROM workflow_runs r
          JOIN workflows w ON w.id = r.workflow_id
          LEFT JOIN workflow_step_runs s ON s.run_id = r.id AND s.node_id = r.current_node_id
          WHERE r.status = 'waiting_approval' AND r.workflow_id = ${workflowId}
          ORDER BY r.started_at DESC
        `;
      } else {
        rows = await sql`
          SELECT r.id AS run_id, r.workflow_id, r.current_node_id,
                 r.status, w.name AS workflow_name,
                 s.approval_status, s.started_at AS approval_requested_at
          FROM workflow_runs r
          JOIN workflows w ON w.id = r.workflow_id
          LEFT JOIN workflow_step_runs s ON s.run_id = r.id AND s.node_id = r.current_node_id
          WHERE r.status = 'waiting_approval'
          ORDER BY r.started_at DESC
        `;
      }

      respond(true, { approvals: rows });
    } catch (err) {
      log.warn(`workflows.pendingApprovals failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Credential Management ──────────────────────────────────────────────────

  "credentials.list": async ({ respond }) => {
    try {
      const sql = await getSql();
      const allKeys = await pgListServiceKeys(sql);
      // Filter to workflow credentials (category = "workflow-credential") and strip secret values
      const credentials = allKeys
        .filter((k) => k.category === "workflow-credential")
        .map((k) => ({
          id: k.id,
          name: k.name,
          type: k.service ?? "unknown",
          connectorId: k.source ?? undefined,
          createdAt: k.createdAt,
          updatedAt: k.updatedAt,
        }));
      respond(true, { credentials });
    } catch (err) {
      log.warn(`credentials.list failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "credentials.create": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const name = requireString(params, "name");
      const type = requireString(params, "type");
      const connectorId = requireString(params, "connectorId");
      const secrets = params.secrets;
      if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "secrets must be a non-null object"),
        );
        return;
      }

      // Store all secrets as a JSON blob encrypted in a single service key record
      const id = `wfcred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const variable = `WORKFLOW_CRED_${id}`;

      await pgUpsertServiceKey(sql, {
        id,
        variable,
        value: JSON.stringify(secrets),
        name,
        service: type,
        category: "workflow-credential",
        source: connectorId,
      });

      log.info(`credential created: ${id} "${name}" for connector ${connectorId}`);
      respond(true, { id, name, type, connectorId });
    } catch (err) {
      log.warn(`credentials.create failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "credentials.delete": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const credentialId = requireString(params, "credentialId");
      const variable = `WORKFLOW_CRED_${credentialId}`;

      // Check if credential is referenced by any active workflow node configs
      const usedBy = await sql`
        SELECT id, name FROM workflows
        WHERE is_active = true
          AND nodes::text LIKE ${`%${credentialId}%`}
      `;

      if (usedBy.length > 0) {
        const names = usedBy.map((w) => `"${w.name}"`).join(", ");
        log.warn(`credential ${credentialId} is used by active workflows: ${names}`);
        // Warn but still allow deletion — the caller can decide
        const deleted = await pgDeleteServiceKey(sql, variable);
        if (!deleted) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Credential not found"));
          return;
        }
        respond(true, {
          deleted: true,
          id: credentialId,
          warning: `Credential was used by active workflows: ${names}`,
        });
        return;
      }

      const deleted = await pgDeleteServiceKey(sql, variable);
      if (!deleted) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Credential not found"));
        return;
      }

      log.info(`credential deleted: ${credentialId}`);
      respond(true, { deleted: true, id: credentialId });
    } catch (err) {
      log.warn(`credentials.delete failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "credentials.validate": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const credentialId = requireString(params, "credentialId");
      const variable = `WORKFLOW_CRED_${credentialId}`;

      // Load credential
      const key = await pgGetServiceKeyByVariable(sql, variable);
      if (!key) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Credential not found"));
        return;
      }

      const connectorId = key.source;
      if (!connectorId) {
        respond(true, { valid: false, message: "Credential has no associated connector" });
        return;
      }

      // Find the connector binary
      const catalog = await discoverConnectorCatalog();
      const connector = catalog.connectors.find((c) => c.tool === connectorId);
      if (!connector?.discovery.binaryPath) {
        respond(true, {
          valid: false,
          message: `Connector "${connectorId}" not found or has no runnable binary`,
        });
        return;
      }

      // Parse stored secrets and inject into env for the health check
      let secretsEnv: Record<string, string> = {};
      try {
        const parsed = JSON.parse(key.value);
        if (parsed && typeof parsed === "object") {
          secretsEnv = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k, v as string]),
          );
        }
      } catch {
        respond(true, { valid: false, message: "Failed to parse stored credential secrets" });
        return;
      }

      // Run connector's health command with credential secrets in env
      const result = await runConnectorCommandJson({
        binaryPath: connector.discovery.binaryPath,
        args: ["--json", "health"],
        cwd: connector.discovery.harnessDir,
        timeoutMs: 8_000,
        env: secretsEnv,
      });

      if (result.ok) {
        const data =
          result.data && typeof result.data === "object"
            ? (result.data as Record<string, unknown>)
            : {};
        const status = typeof data.status === "string" ? data.status.toLowerCase() : "healthy";
        if (status === "healthy" || status === "ok") {
          respond(true, { valid: true, message: "Credential validated successfully" });
        } else {
          respond(true, { valid: false, message: `Connector health status: ${status}` });
        }
      } else {
        respond(true, { valid: false, message: result.detail || "Health check failed" });
      }
    } catch (err) {
      log.warn(`credentials.validate failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Connector Manifest ─────────────────────────────────────────────────────

  "workflows.manifest": async ({ params, respond }) => {
    try {
      const connectorId = requireString(params, "connectorId");

      // Search repo roots for the connector directory and read its connector.json
      const roots = defaultRepoRoots();
      let manifest: Record<string, unknown> | null = null;

      for (const root of roots) {
        const manifestPath = path.join(root, connectorId, "connector.json");
        if (fs.existsSync(manifestPath)) {
          try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<
              string,
              unknown
            >;
            break;
          } catch {
            // Try next root
          }
        }
      }

      if (!manifest) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `Connector manifest not found for "${connectorId}"`,
          ),
        );
        return;
      }

      // Step 1: Normalize raw manifest into ConnectorNodeDefinition
      const normalized = parseConnectorManifest(connectorId, manifest);

      // Step 2: Runtime readiness enrichment via health/doctor probes
      // Only probe harness-backed connectors (manifest-only stay blocked)
      if (normalized.status === "harness_backed") {
        try {
          const catalog = await discoverConnectorCatalog();
          const entry = catalog.connectors.find((c) => c.tool === connectorId);
          if (entry?.discovery.binaryPath) {
            const binaryPath = entry.discovery.binaryPath;

            // Run health and doctor in parallel (3s timeout each — fast probes)
            const [healthRes, doctorRes] = await Promise.allSettled([
              runConnectorCommandJson({
                binaryPath,
                args: ["health", "--json"],
                timeoutMs: 3000,
              }),
              runConnectorCommandJson({
                binaryPath,
                args: ["doctor", "--json"],
                timeoutMs: 3000,
              }),
            ]);

            const healthData =
              healthRes.status === "fulfilled" && healthRes.value.ok
                ? ((healthRes.value.envelope as HealthProbeResult | null) ??
                  (healthRes.value.data as HealthProbeResult | null))
                : null;

            const doctorData =
              doctorRes.status === "fulfilled" && doctorRes.value.ok
                ? ((doctorRes.value.envelope as DoctorProbeResult | null) ??
                  (doctorRes.value.data as DoctorProbeResult | null))
                : null;

            enrichWithHealthProbe(normalized, healthData, doctorData);
          }
        } catch (probeErr) {
          // Probe failure is non-fatal — manifest readiness stands
          log.debug(`Health probe failed for ${connectorId}: ${String(probeErr)}`);
        }
      }

      respond(true, normalized);
    } catch (err) {
      log.warn(`workflows.manifest failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Connector Command (DynamicPicker) ───────────────────────────────────────

  "workflows.connectorCommand": async ({ params, respond }) => {
    try {
      const connectorId = requireString(params, "connectorId");
      const command = requireString(params, "command");
      const credentialId = optionalString(params, "credentialId");
      const args = optionalArray(params, "args") ?? [];

      // Find the connector binary
      const catalog = await discoverConnectorCatalog();
      const connector = catalog.connectors.find((c) => c.tool === connectorId);
      if (!connector?.discovery.binaryPath) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `Connector "${connectorId}" not found or has no runnable binary`,
          ),
        );
        return;
      }

      // Resolve credential secrets if provided
      let secretsEnv: Record<string, string> = {};
      if (credentialId) {
        const sql = await getSql();
        const variable = `WORKFLOW_CRED_${credentialId}`;
        const key = await pgGetServiceKeyByVariable(sql, variable);
        if (!key) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, `Credential "${credentialId}" not found`),
          );
          return;
        }
        try {
          const parsed = JSON.parse(key.value);
          if (parsed && typeof parsed === "object") {
            secretsEnv = Object.fromEntries(
              Object.entries(parsed as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string")
                .map(([k, v]) => [k, v as string]),
            );
          }
        } catch {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "Failed to parse stored credential secrets"),
          );
          return;
        }
      }

      // Build CLI args: --json <command> [extra args...]
      const cliArgs = ["--json", command];
      for (const arg of args) {
        if (typeof arg === "string") {
          cliArgs.push(arg);
        } else if (arg !== null && arg !== undefined) {
          cliArgs.push(String(arg));
        }
      }

      // Execute connector command
      const result = await runConnectorCommandJson({
        binaryPath: connector.discovery.binaryPath,
        args: cliArgs,
        cwd: connector.discovery.harnessDir,
        timeoutMs: 15_000,
        env: secretsEnv,
      });

      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, result.detail || "Command failed"),
        );
        return;
      }

      // Return parsed data or raw output
      let data: unknown = null;
      if (result.data && typeof result.data === "object") {
        data = result.data;
      } else if (result.envelope && typeof result.envelope === "object") {
        data = result.envelope;
      } else if (typeof result.data === "string") {
        try {
          data = JSON.parse(result.data);
        } catch {
          data = { raw: result.data };
        }
      }

      respond(true, { connectorId, command, data });
    } catch (err) {
      log.warn(`workflows.connectorCommand failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};

/** Expose the lazy PG connection for the workflow webhook HTTP handler. */
export function getWorkflowsSql(): Promise<ReturnType<typeof postgres>> {
  return getSql();
}
