/**
 * Workflow Webhook HTTP Handler — Sprint 6
 *
 * Handles incoming POST requests to /hooks/wf-{workflowId}.
 * Validates the workflow exists and is active, optionally verifies
 * HMAC signature, then creates and executes a workflow run.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/workflow-webhook");

const WF_HOOK_PREFIX = "/hooks/wf-";
const MAX_BODY_BYTES = 512_000; // 512 KB

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error("payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function verifyHmacSignature(
  body: Buffer,
  secret: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;
  // Support both "sha256=<hex>" and raw hex formats
  const raw = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  if (raw.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(raw, "hex"), Buffer.from(expected, "hex"));
}

function extractPayloadFilter(
  payload: Record<string, unknown>,
  jsonPath: string | undefined,
): Record<string, unknown> {
  if (!jsonPath) return payload;
  // Simple dot-path extraction (e.g. "data.attributes")
  const parts = jsonPath.replace(/^\$\.?/, "").split(".");
  let current: unknown = payload;
  for (const part of parts) {
    if (!part) continue;
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return payload; // path doesn't resolve, return full payload
    }
  }
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  return payload;
}

export type WorkflowWebhookDeps = {
  getSql: () => Promise<import("postgres").Sql>;
  broadcast?: (event: string, payload: unknown) => void;
};

/**
 * Creates an HTTP request handler for workflow webhooks.
 * Returns true if the request was handled, false to pass through.
 */
export function createWorkflowWebhookHandler(
  deps: WorkflowWebhookDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    const url = req.url ?? "";
    if (!url.startsWith(WF_HOOK_PREFIX)) return false;

    // Extract workflow ID from path
    const afterPrefix = url.slice(WF_HOOK_PREFIX.length).split("?")[0];
    const workflowId = afterPrefix?.replace(/\/+$/, "");
    if (!workflowId) {
      sendJson(res, 400, { ok: false, error: "missing workflow ID in path" });
      return true;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }

    let sql: import("postgres").Sql;
    try {
      sql = await deps.getSql();
    } catch {
      sendJson(res, 503, { ok: false, error: "workflow backend unavailable" });
      return true;
    }

    // Load workflow
    const [wf] = await sql`
      SELECT * FROM workflows WHERE id = ${workflowId}
    `;
    if (!wf) {
      sendJson(res, 404, { ok: false, error: "workflow not found" });
      return true;
    }

    if (!wf.is_active) {
      sendJson(res, 409, { ok: false, error: "workflow is disabled" });
      return true;
    }

    // Verify trigger type is webhook
    if (wf.trigger_type !== "webhook") {
      sendJson(res, 400, { ok: false, error: "workflow does not have a webhook trigger" });
      return true;
    }

    // Read body
    let bodyBuf: Buffer;
    try {
      bodyBuf = await readBody(req, MAX_BODY_BYTES);
    } catch (err) {
      const msg =
        err instanceof Error && err.message === "payload too large"
          ? "payload too large"
          : "failed to read request body";
      sendJson(res, msg === "payload too large" ? 413 : 400, { ok: false, error: msg });
      return true;
    }

    // Parse trigger config for webhook settings
    const triggerConfig = (wf.trigger_config ?? {}) as Record<string, unknown>;
    const webhookSecret =
      typeof triggerConfig.webhookSecret === "string" ? triggerConfig.webhookSecret : undefined;
    const webhookPayloadFilter =
      typeof triggerConfig.webhookPayloadFilter === "string"
        ? triggerConfig.webhookPayloadFilter
        : undefined;

    // Verify HMAC if secret is configured
    if (webhookSecret) {
      const sig =
        (req.headers["x-webhook-signature"] as string | undefined) ??
        (req.headers["x-hub-signature-256"] as string | undefined);
      if (!verifyHmacSignature(bodyBuf, webhookSecret, sig)) {
        sendJson(res, 401, { ok: false, error: "invalid webhook signature" });
        return true;
      }
    }

    // Parse JSON body
    let payload: Record<string, unknown> = {};
    if (bodyBuf.length > 0) {
      try {
        const parsed = JSON.parse(bodyBuf.toString("utf-8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        }
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        return true;
      }
    }

    // Apply payload filter if configured
    const filteredPayload = extractPayloadFilter(payload, webhookPayloadFilter);

    // Create workflow run
    const runId = randomUUID();
    try {
      await sql`
        INSERT INTO workflow_runs (
          id, workflow_id, workflow_version, status,
          trigger_type, trigger_payload, variables
        ) VALUES (
          ${runId}, ${workflowId}, ${wf.version},
          'running', 'webhook',
          ${JSON.stringify(filteredPayload)}::jsonb,
          '{}'::jsonb
        )
      `;
    } catch (err) {
      log.warn(`failed to create webhook run: ${String(err)}`);
      sendJson(res, 500, { ok: false, error: "failed to create workflow run" });
      return true;
    }

    log.info(`webhook triggered: workflow=${workflowId} run=${runId}`);

    // Broadcast run creation
    if (deps.broadcast) {
      deps.broadcast("workflow.run.created", {
        runId,
        workflowId,
        status: "running",
        trigger: "webhook",
      });
    }

    // Respond immediately
    sendJson(res, 200, { ok: true, runId });

    // Execute workflow in background
    (async () => {
      try {
        const { executeWorkflow, CoreAgentDispatcher } =
          await import("../infra/workflow-runner.js");

        const definition: import("../infra/workflow-types.js").WorkflowDefinition = {
          id: wf.id as string,
          name: wf.name as string,
          description: wf.description as string | undefined,
          nodes: wf.nodes as import("../infra/workflow-types.js").WorkflowNode[],
          edges: wf.edges as import("../infra/workflow-types.js").WorkflowEdge[],
          defaultOnError:
            (wf.default_on_error as import("../infra/workflow-types.js").ErrorConfig) ?? {
              strategy: "fail" as const,
              notifyOnError: true,
            },
          maxRunDurationMs: wf.max_run_duration_ms as number | undefined,
          maxRunCostUsd: wf.max_run_cost_usd as number | undefined,
        };

        const dispatcher = new CoreAgentDispatcher();

        let redis: import("ioredis").default | null = null;
        try {
          const { getAgentFamily } = await import("../data/agent-family.js");
          const family = await getAgentFamily();
          redis = family.getRedis();
        } catch {
          /* Redis optional */
        }

        await executeWorkflow({
          workflow: definition,
          runId,
          dispatcher,
          triggerPayload: filteredPayload,
          triggerSource: "webhook",
          redis,
          onStepStart: (nodeId, node) => {
            if (deps.broadcast) {
              deps.broadcast("workflow.step.started", {
                runId,
                workflowId,
                nodeId,
                nodeKind: node.kind,
              });
            }
          },
          onStepComplete: (nodeId, record) => {
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
              log.warn(`failed to persist webhook step run: ${String(err)}`);
            });

            if (deps.broadcast) {
              deps.broadcast("workflow.step.completed", {
                runId,
                workflowId,
                nodeId,
                status: record.status,
                durationMs: record.durationMs,
              });
            }
          },
          onRunComplete: (status, steps) => {
            sql`
              UPDATE workflow_runs SET
                status = ${status},
                total_tokens = ${steps.reduce((sum, s) => sum + (s.tokensUsed ?? 0), 0)},
                total_cost_usd = ${steps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0)},
                ended_at = NOW()
              WHERE id = ${runId}
            `.catch((err: unknown) => {
              log.warn(`failed to update webhook workflow run: ${String(err)}`);
            });

            if (deps.broadcast) {
              deps.broadcast("workflow.run.completed", {
                runId,
                workflowId,
                status,
                stepCount: steps.length,
              });
            }
          },
        });
      } catch (err) {
        log.error(`webhook workflow execution failed: runId=${runId} error=${String(err)}`);
        sql`
          UPDATE workflow_runs SET status = 'failed', ended_at = NOW()
          WHERE id = ${runId}
        `.catch(() => {});
        if (deps.broadcast) {
          deps.broadcast("workflow.run.completed", {
            runId,
            workflowId,
            status: "failed",
            error: String(err),
          });
        }
      }
    })();

    return true;
  };
}
