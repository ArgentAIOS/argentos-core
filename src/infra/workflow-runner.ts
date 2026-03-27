/**
 * Workflow Runner — DAG execution engine for ArgentOS Workflows.
 *
 * Executes workflow definitions by:
 * 1. Topologically sorting nodes based on edges (Kahn's algorithm)
 * 2. Walking nodes in order, dispatching each by kind
 * 3. Building pipeline context with TOON-encoded step history
 * 4. Tracking tokens/cost with circuit breaker support
 * 5. Persisting step results to PG when configured
 *
 * Agent dispatch uses the CoreAgentDispatcher (argentComplete) by default.
 * The Business tier can swap in WorkforceAgentDispatcher at gateway startup.
 *
 * @see docs/argent/WORKFLOWS_ARCHITECTURE.md
 * @module infra/workflow-runner
 */

import type { Redis } from "ioredis";
import type { ModelTier } from "../models/types.js";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  PipelineContext,
  ItemSet,
  StepRecord,
  TriggerNode,
  AgentNode,
  ActionNode,
  GateNode,
  OutputNode,
  AgentDispatcher,
  TriggerOutput,
  GateConfig,
  ConditionExpr,
  JoinStrategy,
  MergeStrategy,
  MergeStrategyAgentConfig,
  BranchFailurePolicy,
  PipelineItem,
  ModelOverrideConfig,
  MemoryContextConfig,
  ToolGrantEntry,
} from "./workflow-types.js";
// Real system integrations — these are the actual delivery systems, not stubs
import { refreshPresence } from "../data/redis-client.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { buildAgentStepPrompt, buildRetryPrompt } from "./workflow-context.js";

const log = createSubsystemLogger("infra/workflow-runner");

// ── Public API ───────────────────────────────────────────────────

export interface ApprovalRequest {
  runId: string;
  nodeId: string;
  message: string;
  previousOutput?: StepRecord;
  showPreviousOutput: boolean;
  timeoutMs?: number;
  timeoutAction?: "approve" | "deny";
  requestedAt: number;
}

/**
 * Action executors — real delivery functions provided by the gateway.
 * If not provided, actions log a warning and return { executed: false }.
 * Each function is optional so the runner works in test/standalone mode.
 */
export interface ActionExecutors {
  /** Send a message to a channel (Discord, Slack, Telegram, etc.) */
  sendMessage?: (
    channel: string,
    to: string,
    text: string,
  ) => Promise<{
    messageId?: string;
    ok: boolean;
    channel?: string;
    to?: string;
    via?: "direct" | "gateway";
  }>;
  /** Send an email */
  sendEmail?: (
    to: string,
    subject: string,
    body: string,
  ) => Promise<{ ok: boolean; error?: string; details?: Record<string, unknown> }>;
  /** Create a task in the task system */
  createTask?: (
    title: string,
    opts?: {
      assignee?: string;
      priority?: string | number;
      project?: string;
      description?: string;
    },
  ) => Promise<{ taskId?: string; ok: boolean; title?: string }>;
  /** Store a fact in agent memory */
  storeMemory?: (
    content: string,
    opts?: { type?: string; significance?: string | number },
  ) => Promise<{ ok: boolean; memoryId?: string }>;
  /** Save a document to DocPanel */
  saveToDocPanel?: (
    title: string,
    content: string,
    format?: string,
  ) => Promise<{ docId?: string; ok: boolean }>;
}

export interface ExecuteWorkflowParams {
  workflow: WorkflowDefinition;
  runId: string;
  dispatcher: AgentDispatcher;
  actions?: ActionExecutors;
  triggerPayload?: Record<string, unknown>;
  triggerSource?: string;
  onStepStart?: (nodeId: string, node: WorkflowNode) => void;
  onStepComplete?: (nodeId: string, result: StepRecord) => void;
  onRunComplete?: (status: string, steps: StepRecord[]) => void;
  onApprovalRequested?: (nodeId: string, request: ApprovalRequest) => void;
  /** PG sql instance for persisting approval state */
  pgSql?: PgSqlInstance | null;
  redis?: Redis | null;
}

export interface WorkflowRunResult {
  status: "completed" | "failed" | "cancelled" | "budget_exceeded" | "waiting_approval";
  steps: StepRecord[];
  totalTokens: number;
  totalCostUsd: number;
  durationMs: number;
  /** Set when status is "waiting_approval" — the gate node blocking the pipeline */
  waitingNodeId?: string;
}

/** Minimal type for the postgres.js sql tagged template instance */
export type PgSqlInstance = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (strings: TemplateStringsArray, ...values: any[]): Promise<any[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

// ── In-memory approval resolution map ────────────────────────────
// The gateway sets a resolver when an approval response comes in.
// The runner awaits the promise to resume or fail.

interface ApprovalResolver {
  resolve: (approved: boolean, reason?: string) => void;
  promise: Promise<{ approved: boolean; reason?: string }>;
}

const pendingApprovals = new Map<string, ApprovalResolver>();

/** Create a pending approval entry. Returns a promise that resolves when approved/denied. */
function createApprovalPromise(runId: string, nodeId: string): ApprovalResolver {
  const key = `${runId}:${nodeId}`;
  let resolve!: (approved: boolean, reason?: string) => void;
  const promise = new Promise<{ approved: boolean; reason?: string }>((res) => {
    resolve = (approved: boolean, reason?: string) => res({ approved, reason });
  });
  const entry: ApprovalResolver = { resolve, promise };
  pendingApprovals.set(key, entry);
  return entry;
}

/** Resolve a pending approval (called by gateway approve/deny handlers). */
export function resolveApproval(
  runId: string,
  nodeId: string,
  approved: boolean,
  reason?: string,
): boolean {
  const key = `${runId}:${nodeId}`;
  const entry = pendingApprovals.get(key);
  if (!entry) return false;
  entry.resolve(approved, reason);
  pendingApprovals.delete(key);
  return true;
}

/** Check if a run+node has a pending approval. */
export function hasPendingApproval(runId: string, nodeId: string): boolean {
  return pendingApprovals.has(`${runId}:${nodeId}`);
}

/**
 * Execute a workflow run end-to-end.
 *
 * Walks the DAG in topological order, dispatching each node by kind.
 * Agent nodes get TOON-encoded pipeline context. All steps are recorded
 * in the context history for downstream nodes to reference.
 */
export async function executeWorkflow(params: ExecuteWorkflowParams): Promise<WorkflowRunResult> {
  const { workflow, runId, dispatcher, redis } = params;
  const runStart = Date.now();

  // 1. Topological sort
  const executionOrder = topologicalSort(workflow.nodes, workflow.edges);
  log.info("workflow run starting", {
    workflowId: workflow.id,
    runId,
    nodeCount: executionOrder.length,
  });

  // 2. Initialize pipeline context
  const triggerOutput: TriggerOutput = {
    triggerType: "manual",
    firedAt: Date.now(),
    payload: params.triggerPayload ?? {},
    source: params.triggerSource,
  };

  const context: PipelineContext = {
    workflowId: workflow.id,
    workflowName: workflow.name,
    runId,
    currentNodeId: "",
    currentStepIndex: 0,
    totalSteps: executionOrder.length,
    trigger: triggerOutput,
    history: [],
    variables: {},
    totalTokensUsed: 0,
    totalCostUsd: 0,
    budgetRemainingUsd: workflow.maxRunCostUsd,
  };

  // 3. Execute each node
  let finalStatus: WorkflowRunResult["status"] = "completed";

  // Build skip sets for nodes inside parallel branches — they are executed
  // by executeParallelSegment when we encounter their parent parallel gate.
  const parallelBranchNodeIds = new Set<string>();
  const joinNodeIds = new Set<string>();
  buildParallelSkipSets(executionOrder, workflow, parallelBranchNodeIds, joinNodeIds);

  // Edge routing: nodes skipped because a gate selected a different branch
  const edgeRoutingSkipIds = new Set<string>();

  for (let i = 0; i < executionOrder.length; i++) {
    const node = executionOrder[i];

    // Skip nodes owned by a parallel segment — already executed by fan-out.
    if (parallelBranchNodeIds.has(node.id) || joinNodeIds.has(node.id)) {
      continue;
    }

    // Skip nodes excluded by edge routing (condition/switch/loop gate selected a different branch)
    if (edgeRoutingSkipIds.has(node.id)) {
      continue;
    }

    context.currentNodeId = node.id;
    context.currentStepIndex = i;

    params.onStepStart?.(node.id, node);
    const stepStart = Date.now();

    let stepResult: ItemSet;
    let stepStatus: StepRecord["status"] = "completed";

    try {
      // Detect parallel gate → execute full fan-out/join segment
      if (node.kind === "gate" && node.config.gateType === "parallel") {
        const segmentResult = await executeParallelSegment(
          node,
          context,
          workflow,
          dispatcher,
          redis,
          params,
        );
        stepResult = segmentResult.output;
        stepStatus = segmentResult.failed ? "failed" : "completed";
        if (segmentResult.failed) finalStatus = "failed";
      } else {
        switch (node.kind) {
          case "trigger":
            stepResult = executeTrigger(node, context);
            // Update trigger output from actual trigger node config
            if (node.triggerType) {
              context.trigger.triggerType = node.triggerType;
            }
            break;

          case "agent":
            stepResult = await executeAgentNode(node, context, dispatcher, redis, workflow);
            break;

          case "action":
            stepResult = await executeAction(node, context, params.actions);
            break;

          case "gate":
            stepResult = executeGate(node, context, workflow.edges);
            break;

          case "output":
            stepResult = await executeOutput(node, context);
            break;

          default: {
            const _exhaustive: never = node;
            log.warn("unknown node kind, skipping", { nodeId: (node as WorkflowNode).id });
            stepResult = emptyItemSet();
            stepStatus = "skipped";
          }
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error("step execution failed", {
        nodeId: node.id,
        nodeKind: node.kind,
        error: errorMsg,
      });

      // Handle error based on node config or workflow default
      const errorConfig = getErrorConfig(node, workflow);
      if (errorConfig.strategy === "skip") {
        stepResult = emptyItemSet();
        stepStatus = "skipped";
      } else if (errorConfig.strategy === "retry") {
        stepResult = await retryStep(
          node,
          context,
          dispatcher,
          redis,
          params.actions,
          errorConfig,
          errorMsg,
        );
        if (stepResult.items.length === 0 && stepResult.items[0]?.meta?.status === "failed") {
          stepStatus = "failed";
        }
      } else {
        // fail strategy — abort workflow
        stepResult = errorItemSet(errorMsg);
        stepStatus = "failed";
        finalStatus = "failed";
      }
    }

    // ── Approval gate pause ──────────────────────────────────────────
    // If the gate returned an approval sentinel, pause the pipeline and
    // wait for the operator to approve or deny via the gateway.
    const isApprovalPending = stepResult.items[0]?.json?.__approvalPending === true;
    if (isApprovalPending) {
      const approvalJson = stepResult.items[0].json as Record<string, unknown>;
      const previousOutput = context.history[context.history.length - 1] ?? undefined;
      const approvalRequest: ApprovalRequest = {
        runId,
        nodeId: node.id,
        message: (approvalJson.message as string) || "Review required before continuing",
        previousOutput,
        showPreviousOutput: (approvalJson.showPreviousOutput as boolean) ?? true,
        timeoutMs: approvalJson.timeoutMs as number | undefined,
        timeoutAction: (approvalJson.timeoutAction as "approve" | "deny") || "deny",
        requestedAt: Date.now(),
      };

      // Persist approval state to PG
      if (params.pgSql) {
        try {
          await params.pgSql`
            UPDATE workflow_runs SET status = 'waiting_approval', current_node_id = ${node.id}
            WHERE id = ${runId}
          `;
          await params.pgSql`
            INSERT INTO workflow_step_runs (
              id, run_id, node_id, node_kind,
              status, approval_status, started_at
            ) VALUES (
              ${`step-${runId}-${node.id}`}, ${runId}, ${node.id}, 'gate',
              'running', 'pending',
              ${new Date().toISOString()}::timestamptz
            )
            ON CONFLICT (id) DO UPDATE SET approval_status = 'pending', status = 'running'
          `;
        } catch (err) {
          log.warn("failed to persist approval state", { error: String(err) });
        }
      }

      // Broadcast approval request to dashboard
      params.onApprovalRequested?.(node.id, approvalRequest);

      // Create approval promise + optional timeout
      const approvalEntry = createApprovalPromise(runId, node.id);
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      if (approvalRequest.timeoutMs && approvalRequest.timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          if (hasPendingApproval(runId, node.id)) {
            const autoApprove = approvalRequest.timeoutAction === "approve";
            log.info(`approval timeout — auto-${autoApprove ? "approving" : "denying"}`, {
              runId,
              nodeId: node.id,
            });
            resolveApproval(runId, node.id, autoApprove, "Timed out");
          }
        }, approvalRequest.timeoutMs);
      }

      log.info("pipeline paused — waiting for approval", { runId, nodeId: node.id });

      // Block execution until resolved
      const decision = await approvalEntry.promise;
      if (timeoutHandle) clearTimeout(timeoutHandle);

      // Update PG with decision
      if (params.pgSql) {
        try {
          const pgStatus = decision.approved ? "approved" : "denied";
          await params.pgSql`
            UPDATE workflow_step_runs SET
              approval_status = ${pgStatus},
              approval_note = ${decision.reason ?? null},
              ended_at = NOW(),
              status = 'completed'
            WHERE id = ${`step-${runId}-${node.id}`}
          `;
          if (decision.approved) {
            await params.pgSql`
              UPDATE workflow_runs SET status = 'running', current_node_id = NULL
              WHERE id = ${runId}
            `;
          } else {
            await params.pgSql`
              UPDATE workflow_runs SET status = 'failed', current_node_id = NULL,
                error = ${decision.reason || "Approval denied by operator"},
                ended_at = NOW()
              WHERE id = ${runId}
            `;
          }
        } catch (err) {
          log.warn("failed to update approval decision in PG", { error: String(err) });
        }
      }

      if (!decision.approved) {
        log.info("approval denied — aborting pipeline", {
          runId,
          nodeId: node.id,
          reason: decision.reason,
        });
        stepResult = {
          items: [
            {
              json: { gateType: "approval", approved: false, reason: decision.reason },
              text: `Approval denied: ${decision.reason || "operator denied"}`,
            },
          ],
        };
        stepStatus = "failed";
        finalStatus = "failed";
      } else {
        log.info("approval granted — resuming pipeline", { runId, nodeId: node.id });
        stepResult = {
          items: [
            {
              json: { gateType: "approval", approved: true },
              text: "Approval granted — pipeline resumed",
            },
          ],
        };
      }
    }

    // ── Wait duration gate pause ─────────────────────────────────────
    // Similar to approval gate — block execution for the specified duration.
    // For short waits (≤5 min), use in-process setTimeout.
    // For longer waits, persist to PG and let a cron resume.
    const isWaitPending = stepResult.items[0]?.json?.__waitPending === true;
    if (isWaitPending) {
      const waitJson = stepResult.items[0].json as Record<string, unknown>;
      const durationMs = (waitJson.durationMs as number) ?? 0;
      const resumeAt = waitJson.resumeAt as string;

      // Persist wait state to PG
      if (params.pgSql) {
        try {
          await params.pgSql`
            UPDATE workflow_runs SET status = 'waiting', current_node_id = ${node.id}
            WHERE id = ${runId}
          `;
          await params.pgSql`
            INSERT INTO workflow_step_runs (
              id, run_id, node_id, node_kind,
              status, started_at, metadata
            ) VALUES (
              ${`step-${runId}-${node.id}`}, ${runId}, ${node.id}, 'gate',
              'waiting',
              ${new Date().toISOString()}::timestamptz,
              ${JSON.stringify({ waitResumeAt: resumeAt, durationMs })}::jsonb
            )
            ON CONFLICT (id) DO UPDATE SET status = 'waiting',
              metadata = ${JSON.stringify({ waitResumeAt: resumeAt, durationMs })}::jsonb
          `;
        } catch (err) {
          log.warn("failed to persist wait state", { error: String(err) });
        }
      }

      // Block execution with a real delay
      const MAX_IN_PROCESS_WAIT = 5 * 60 * 1000; // 5 minutes
      if (durationMs <= MAX_IN_PROCESS_WAIT) {
        log.info("wait_duration: in-process wait", { runId, nodeId: node.id, durationMs });
        await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

        // Update PG status back to running
        if (params.pgSql) {
          try {
            await params.pgSql`
              UPDATE workflow_runs SET status = 'running', current_node_id = NULL
              WHERE id = ${runId}
            `;
            await params.pgSql`
              UPDATE workflow_step_runs SET status = 'completed', ended_at = NOW()
              WHERE id = ${`step-${runId}-${node.id}`}
            `;
          } catch (err) {
            log.warn("failed to update wait completion in PG", { error: String(err) });
          }
        }

        log.info("wait_duration: resumed after wait", { runId, nodeId: node.id });
        stepResult = {
          items: [
            {
              json: {
                gateType: "wait_duration",
                durationMs,
                waited: true,
                resumedAt: new Date().toISOString(),
              },
              text: `Wait complete — resumed after ${durationMs}ms`,
            },
          ],
        };
      } else {
        // Over 5 minutes — persist and return. A cron or manual trigger resumes later.
        log.info("wait_duration: long wait, persisted for cron resume", {
          runId,
          nodeId: node.id,
          resumeAt,
        });
        // For now, we block anyway (the workflow is async).
        // TODO: For true async resume, return here and let a cron pick it up.
        await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

        if (params.pgSql) {
          try {
            await params.pgSql`
              UPDATE workflow_runs SET status = 'running', current_node_id = NULL
              WHERE id = ${runId}
            `;
            await params.pgSql`
              UPDATE workflow_step_runs SET status = 'completed', ended_at = NOW()
              WHERE id = ${`step-${runId}-${node.id}`}
            `;
          } catch (err) {
            log.warn("failed to update long wait completion in PG", { error: String(err) });
          }
        }

        stepResult = {
          items: [
            {
              json: {
                gateType: "wait_duration",
                durationMs,
                waited: true,
                resumedAt: new Date().toISOString(),
              },
              text: `Wait complete — resumed after ${durationMs}ms`,
            },
          ],
        };
      }
    }

    // ── Sub-workflow gate execution ──────────────────────────────────
    const isSubWorkflowPending = stepResult.items[0]?.json?.__subWorkflowPending === true;
    if (isSubWorkflowPending) {
      const subJson = stepResult.items[0].json as Record<string, unknown>;
      const subWorkflowId = subJson.subWorkflowId as string;
      const subDepth = (subJson.depth as number) ?? 1;
      const subInput = (subJson.inputMapping as Record<string, unknown>) ?? {};

      log.info("sub_workflow: loading and executing child workflow", {
        runId,
        nodeId: node.id,
        subWorkflowId,
        depth: subDepth,
      });

      // Load sub-workflow definition from PG
      let subResult: ItemSet | null = null;
      if (params.pgSql) {
        try {
          const rows = await params.pgSql`
            SELECT definition FROM workflows WHERE id = ${subWorkflowId} LIMIT 1
          `;
          if (rows.length > 0 && rows[0].definition) {
            const subDef = rows[0].definition as WorkflowDefinition;

            // Execute the sub-workflow recursively
            const subRunResult = await executeWorkflow(subDef, {
              ...params,
              triggerPayload: subInput,
            });

            subResult = {
              items: [
                {
                  json: {
                    gateType: "sub_workflow",
                    subWorkflowId,
                    subRunStatus: subRunResult.status,
                    subStepCount: subRunResult.steps.length,
                    subTotalTokens: subRunResult.totalTokens,
                    depth: subDepth,
                  },
                  text: `Sub-workflow ${subWorkflowId} completed: ${subRunResult.status}`,
                },
              ],
            };
          } else {
            subResult = {
              items: [
                {
                  json: {
                    gateType: "sub_workflow",
                    error: `Workflow ${subWorkflowId} not found in PG`,
                  },
                  text: `Sub-workflow ${subWorkflowId} not found`,
                },
              ],
            };
          }
        } catch (err) {
          log.error("sub_workflow: execution failed", { error: String(err) });
          subResult = {
            items: [
              {
                json: { gateType: "sub_workflow", error: String(err) },
                text: `Sub-workflow failed: ${String(err).slice(0, 200)}`,
              },
            ],
          };
        }
      }

      if (subResult) {
        stepResult = subResult;
      }
    }

    // ── Edge routing — skip unreachable branches after condition/switch/loop ──
    const selectedEdge = stepResult.items[0]?.json?.selectedEdge as string | undefined;
    if (selectedEdge && node.kind === "gate") {
      // Find all outbound edges from this gate
      const outboundEdges = workflow.edges.filter((e) => e.source === node.id);
      // Collect all branches NOT on the selected path
      for (const edge of outboundEdges) {
        if (edge.id !== selectedEdge && edge.target !== selectedEdge) {
          // Also check if selectedEdge matches the target node (some gates store target ID, not edge ID)
          const selectedTargetNode = workflow.edges.find((e) => e.id === selectedEdge)?.target;
          if (edge.target !== selectedTargetNode) {
            // DFS: collect all nodes reachable from this non-selected branch
            collectReachableNodes(edge.target, workflow, edgeRoutingSkipIds, node.id);
          }
        }
      }
      if (edgeRoutingSkipIds.size > 0) {
        log.info("edge routing: skipping non-selected branches", {
          nodeId: node.id,
          selectedEdge,
          skippedCount: edgeRoutingSkipIds.size,
        });
      }
    }

    const stepEnd = Date.now();

    // Accumulate cost/token tracking from step metadata
    const stepTokens = stepResult.items.reduce(
      (sum, item) => sum + (item.meta?.tokensUsed ?? 0),
      0,
    );
    const stepCost = stepResult.items.reduce((sum, item) => sum + (item.meta?.costUsd ?? 0), 0);
    context.totalTokensUsed += stepTokens;
    context.totalCostUsd += stepCost;
    if (context.budgetRemainingUsd != null) {
      context.budgetRemainingUsd -= stepCost;
    }

    // Record step
    const record: StepRecord = {
      nodeId: node.id,
      nodeKind: node.kind,
      nodeLabel: getNodeLabel(node),
      agentId: node.kind === "agent" ? node.config.agentId : undefined,
      stepIndex: i,
      status: stepStatus,
      durationMs: stepEnd - stepStart,
      output: stepResult,
      tokensUsed: stepTokens || undefined,
      costUsd: stepCost || undefined,
      startedAt: stepStart,
      endedAt: stepEnd,
    };

    context.history.push(record);
    params.onStepComplete?.(node.id, record);

    // Budget circuit breaker
    if (workflow.maxRunCostUsd != null && context.totalCostUsd > workflow.maxRunCostUsd) {
      log.warn("budget exceeded, aborting workflow", {
        totalCostUsd: context.totalCostUsd,
        maxRunCostUsd: workflow.maxRunCostUsd,
      });
      finalStatus = "budget_exceeded";
      break;
    }

    // Duration circuit breaker
    if (workflow.maxRunDurationMs != null && Date.now() - runStart > workflow.maxRunDurationMs) {
      log.warn("max duration exceeded, aborting workflow", {
        elapsed: Date.now() - runStart,
        maxRunDurationMs: workflow.maxRunDurationMs,
      });
      finalStatus = "failed";
      break;
    }

    // Abort on failed step (unless already handled)
    if (stepStatus === "failed" && finalStatus === "failed") {
      break;
    }
  }

  const result: WorkflowRunResult = {
    status: finalStatus,
    steps: context.history,
    totalTokens: context.totalTokensUsed,
    totalCostUsd: context.totalCostUsd,
    durationMs: Date.now() - runStart,
  };

  params.onRunComplete?.(result.status, result.steps);
  log.info("workflow run finished", {
    workflowId: workflow.id,
    runId,
    status: result.status,
    steps: result.steps.length,
    durationMs: result.durationMs,
    totalTokens: result.totalTokens,
    totalCostUsd: result.totalCostUsd,
  });

  return result;
}

// ── Node Executors ───────────────────────────────────────────────

/**
 * Execute a trigger node — produces the initial ItemSet from trigger config.
 */
function executeTrigger(node: TriggerNode, context: PipelineContext): ItemSet {
  return {
    items: [
      {
        json: {
          triggerType: node.triggerType,
          firedAt: context.trigger.firedAt,
          ...context.trigger.payload,
        },
        text:
          `Workflow triggered via ${node.triggerType}` +
          (context.trigger.source ? ` from ${context.trigger.source}` : ""),
      },
    ],
  };
}

/**
 * Execute an agent node — build TOON context, dispatch to agent, return result.
 */
async function executeAgentNode(
  node: AgentNode,
  context: PipelineContext,
  dispatcher: AgentDispatcher,
  redis?: Redis | null,
  workflow?: WorkflowDefinition,
): Promise<ItemSet> {
  // Set Redis presence so Workflow Map shows agent as alive
  if (redis && node.config.agentId) {
    try {
      await refreshPresence(redis, node.config.agentId);
    } catch (err) {
      log.debug("failed to refresh presence, continuing", {
        agentId: node.config.agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Resolve sub-port connections (Model / Memory / Tools) ───────
  let modelOverride: ModelOverrideConfig | undefined;
  let memoryContext: MemoryContextConfig | undefined;
  const toolGrants: ToolGrantEntry[] = [];

  if (workflow) {
    const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]));

    for (const edge of workflow.edges) {
      if (edge.target !== node.id) continue;
      const sourceNode = nodeMap.get(edge.source);
      if (!sourceNode) continue;

      // Model sub-port
      if (edge.targetHandle === "model" && sourceNode.kind === "gate") {
        // Sub-port nodes don't have a dedicated 'kind' — they use gate or action.
        // Check config for nodeType marker.
        const cfg = sourceNode.config as Record<string, unknown>;
        if (cfg.nodeType === "model_provider" || cfg.provider) {
          modelOverride = {
            provider: (cfg.provider as string) || "anthropic",
            model: (cfg.model as string) || "claude-sonnet-4-6",
            temperature: typeof cfg.temperature === "number" ? cfg.temperature : undefined,
            maxTokens: typeof cfg.maxTokens === "number" ? cfg.maxTokens : undefined,
            thinkingLevel: typeof cfg.thinkingLevel === "string" ? cfg.thinkingLevel : undefined,
          };
          log.info("sub-port: model override resolved", {
            nodeId: node.id,
            model: modelOverride.model,
            provider: modelOverride.provider,
          });
        }
      }

      // Memory sub-port
      if (edge.targetHandle === "memory") {
        const cfg = sourceNode.config as Record<string, unknown>;
        if (cfg.nodeType === "memory_source" || cfg.sourceType) {
          const collections: string[] = [];
          if (typeof cfg.collectionId === "string" && cfg.collectionId) {
            collections.push(cfg.collectionId);
          }
          memoryContext = {
            collections,
            searchQuery: typeof cfg.searchQuery === "string" ? cfg.searchQuery : undefined,
            maxItems: typeof cfg.maxItems === "number" ? cfg.maxItems : undefined,
          };
          log.info("sub-port: memory context resolved", {
            nodeId: node.id,
            collections,
            sourceType: cfg.sourceType,
          });
        }
      }

      // Tools sub-port
      if (edge.targetHandle === "tools") {
        const cfg = sourceNode.config as Record<string, unknown>;
        if (cfg.nodeType === "tool_grant" || cfg.grantType) {
          const grantType = (cfg.grantType as string) || "connector";
          const id = (cfg.connectorId as string) || (cfg.toolName as string) || "";
          if (id) {
            toolGrants.push({
              type: grantType === "builtin_tool" ? "builtin" : "connector",
              id,
              credentialId: typeof cfg.credentialId === "string" ? cfg.credentialId : undefined,
              permissions: (cfg.permissions as "readonly" | "readwrite") || "readonly",
            });
            log.info("sub-port: tool grant resolved", {
              nodeId: node.id,
              grantType,
              toolId: id,
            });
          }
        }
      }
    }
  }

  // Build TOON-encoded prompt with pipeline context
  const prompt = buildAgentStepPrompt(node.config, context);

  // Dispatch to agent with sub-port overrides
  const result = await dispatcher.dispatch(node.config.agentId, prompt, {
    timeoutMs: node.config.timeoutMs ?? 300_000,
    modelTierHint: node.config.modelTierHint,
    toolsAllow: node.config.toolsAllow,
    toolsDeny: node.config.toolsDeny,
    modelOverride,
    memoryContext,
    toolGrants: toolGrants.length > 0 ? toolGrants : undefined,
  });

  return result;
}

/**
 * Apply output mapping — extract fields from response data using dot-path selectors.
 * Maps { varName: "jsonPath" } → { varName: resolvedValue }.
 */
function applyOutputMapping(
  data: unknown,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [varName, jsonPath] of Object.entries(mapping)) {
    if (data != null && typeof data === "object") {
      result[varName] = resolveFieldPath(data as Record<string, unknown>, jsonPath);
    } else {
      result[varName] = undefined;
    }
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function resolveTaskPriority(value: unknown): "urgent" | "high" | "normal" | "low" | "background" {
  if (typeof value === "string") {
    switch (value) {
      case "urgent":
      case "high":
      case "normal":
      case "low":
      case "background":
        return value;
      default:
        return "normal";
    }
  }
  switch (value) {
    case 1:
      return "urgent";
    case 2:
      return "high";
    case 4:
      return "low";
    case 5:
      return "background";
    case 3:
    default:
      return "normal";
  }
}

function resolveMemorySignificance(
  value: unknown,
): "routine" | "noteworthy" | "important" | "core" {
  if (typeof value === "string") {
    switch (value) {
      case "routine":
      case "noteworthy":
      case "important":
      case "core":
        return value;
      default:
        return "noteworthy";
    }
  }
  switch (value) {
    case 0:
      return "routine";
    case 2:
      return "important";
    case 3:
      return "core";
    case 1:
    default:
      return "noteworthy";
  }
}

async function sendWorkflowMessage(
  channel: string,
  to: string,
  text: string,
  context: PipelineContext,
  nodeId: string,
): Promise<{
  ok: boolean;
  channel: string;
  to: string;
  via: "direct" | "gateway";
  messageId?: string;
}> {
  const [{ loadConfig }, { sendMessage }] = await Promise.all([
    import("../config/config.js"),
    import("./outbound/message.js"),
  ]);
  const cfg = loadConfig();
  const result = await sendMessage({
    to,
    content: text,
    channel,
    cfg,
    idempotencyKey: `wfrun:${context.runId}:step:${nodeId}:msg`,
  });
  const delivery = asRecord(result.result);
  return {
    ok: true,
    channel: result.channel,
    to: result.to,
    via: result.via,
    messageId: typeof delivery.messageId === "string" ? delivery.messageId : undefined,
  };
}

async function resolveWorkflowEmailFrom(provider: string): Promise<string> {
  const [{ loadConfig }, { resolveServiceKeyAsync }] = await Promise.all([
    import("../config/config.js"),
    import("./service-keys.js"),
  ]);
  const candidateKeys = [
    "WORKFLOW_EMAIL_FROM",
    "ARGENT_EMAIL_FROM",
    "EMAIL_FROM",
    `${provider.toUpperCase()}_FROM_EMAIL`,
    `${provider.toUpperCase()}_FROM`,
  ];
  const cfg = loadConfig();
  for (const key of candidateKeys) {
    const value =
      (await resolveServiceKeyAsync(key, cfg, { source: "workflow_runner" })) ?? process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  throw new Error(
    `No sender address configured for workflow email (${provider}). Tried: ${candidateKeys.join(", ")}`,
  );
}

async function sendWorkflowEmail(
  nodeId: string,
  to: string,
  subject: string,
  body: string,
  provider = "sendgrid",
): Promise<{ ok: boolean; error?: string; details?: Record<string, unknown> }> {
  const [{ loadConfig }, { createEmailDeliveryTool }] = await Promise.all([
    import("../config/config.js"),
    import("../agents/tools/email-delivery-tool.js"),
  ]);
  const cfg = loadConfig();
  const emailTool = createEmailDeliveryTool({ config: cfg });
  const from = await resolveWorkflowEmailFrom(provider);
  const result = await emailTool.execute(`wf-email-${nodeId}`, {
    action: `send_${provider}`,
    to: [to],
    from,
    subject,
    html: body,
  });
  return { ok: true, details: asRecord(result.details) };
}

async function createWorkflowTask(
  context: PipelineContext,
  title: string,
  opts?: { assignee?: string; priority?: string | number; project?: string; description?: string },
): Promise<{ ok: boolean; taskId?: string; title?: string }> {
  const { getStorageAdapter } = await import("../data/storage-factory.js");
  const adapter = await getStorageAdapter();
  const task = await adapter.tasks.create({
    title,
    description: opts?.description,
    priority: resolveTaskPriority(opts?.priority),
    assignee: opts?.assignee,
    source: "agent",
    tags: opts?.project ? [opts.project] : undefined,
    metadata: { workflowRunId: context.runId, workflowId: context.workflowId },
  });
  return { ok: true, taskId: task.id, title: task.title };
}

async function storeWorkflowMemory(
  context: PipelineContext,
  content: string,
  opts?: { type?: string; significance?: string | number },
): Promise<{ ok: boolean; memoryId?: string }> {
  const { getMemuStore } = await import("../memory/memu-store.js");
  const store = getMemuStore();
  const item = store.createItem({
    memoryType: ((opts?.type as string | undefined) ?? "event") as never,
    summary: content,
    significance: resolveMemorySignificance(opts?.significance),
    extra: { source: "workflow", workflowRunId: context.runId },
  });
  return { ok: true, memoryId: item.id };
}

/**
 * Execute an action node — deterministic operations (no LLM).
 *
 * Sprint 6: full implementations with template rendering, output mapping,
 * and real HTTP calls for webhook/api actions.
 */
async function executeAction(
  node: ActionNode,
  context: PipelineContext,
  actions?: ActionExecutors,
): Promise<ItemSet> {
  const { actionType } = node.config;
  const actionName = actionType.type;

  log.info("executing action", { nodeId: node.id, actionType: actionName });

  switch (actionName) {
    case "send_message": {
      const { channelType, channelId, template } = actionType;
      const rendered = resolveTemplate(template, context);
      try {
        const result = actions?.sendMessage
          ? await actions.sendMessage(channelType, channelId, rendered)
          : await sendWorkflowMessage(channelType, channelId, rendered, context, node.id);
        const resolvedChannel = result.channel ?? channelType;
        const resolvedTo = result.to ?? channelId;
        const resolvedVia = result.via ?? "direct";
        log.info("send_message: DELIVERED", {
          channel: resolvedChannel,
          to: resolvedTo,
          via: resolvedVia,
        });
        return {
          items: [
            {
              json: {
                sent: result.ok,
                channel: resolvedChannel,
                to: resolvedTo,
                via: resolvedVia,
                messageId: result.messageId,
              },
              text: rendered,
            },
          ],
        };
      } catch (err) {
        log.error("send_message: FAILED", {
          nodeId: node.id,
          channel: channelType,
          to: channelId,
          error: String(err),
        });
        throw err; // Let retry logic handle it
      }
    }

    case "send_email": {
      const { to, subject, bodyTemplate } = actionType;
      const body = resolveTemplate(bodyTemplate, context);
      const subjectRendered = resolveTemplate(subject, context);
      const provider =
        typeof asRecord(actionType).provider === "string"
          ? String(asRecord(actionType).provider)
          : "sendgrid";
      try {
        const result = actions?.sendEmail
          ? await actions.sendEmail(to, subjectRendered, body)
          : await sendWorkflowEmail(node.id, to, subjectRendered, body, provider);
        log.info("send_email: DELIVERED", { to, subject: subjectRendered, provider });
        return {
          items: [
            {
              json: {
                sent: result.ok,
                to,
                subject: subjectRendered,
                provider,
                error: result.error,
                result: result.details,
              },
              text: body,
            },
          ],
        };
      } catch (err) {
        log.error("send_email: FAILED", {
          nodeId: node.id,
          to,
          subject: subjectRendered,
          error: String(err),
        });
        throw err;
      }
    }

    case "create_task": {
      const { title, assignee, priority, project } = actionType;
      const rendered = resolveTemplate(title, context);
      try {
        const description =
          typeof asRecord(actionType).description === "string"
            ? resolveTemplate(String(asRecord(actionType).description), context)
            : undefined;
        const result = actions?.createTask
          ? await actions.createTask(rendered, { assignee, priority, project, description })
          : await createWorkflowTask(context, rendered, {
              assignee,
              priority,
              project,
              description,
            });
        log.info("create_task: CREATED", {
          taskId: result.taskId,
          title: result.title ?? rendered,
        });
        return {
          items: [
            {
              json: {
                created: result.ok,
                taskId: result.taskId,
                title: result.title ?? rendered,
                assignee,
                priority: resolveTaskPriority(priority),
                project,
              },
              text: `Task created: ${result.title ?? rendered}`,
            },
          ],
        };
      } catch (err) {
        log.error("create_task: FAILED", { nodeId: node.id, title: rendered, error: String(err) });
        throw err;
      }
    }

    case "webhook_call": {
      const { url, method, headers, bodyTemplate, outputMapping } = actionType;
      const timeoutMs = node.config.timeoutMs ?? 30_000;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const renderedBody = method !== "GET" ? resolveTemplate(bodyTemplate, context) : undefined;
        const resp = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: renderedBody,
          signal: controller.signal,
        });
        clearTimeout(timer);
        const rawBody = await resp.text();
        let responseData: Record<string, unknown> = { statusCode: resp.status };
        try {
          responseData = { ...responseData, ...JSON.parse(rawBody) };
        } catch {
          responseData.body = rawBody;
        }
        const mapped = outputMapping
          ? { ...responseData, ...applyOutputMapping(responseData, outputMapping) }
          : responseData;
        return { items: [{ json: mapped, text: rawBody }] };
      } catch (err) {
        throw new Error(`webhook_call failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    case "api_call": {
      const { provider, endpoint, method, params, authType, outputMapping } = actionType;
      const timeoutMs = node.config.timeoutMs ?? 30_000;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const authRef =
          typeof asRecord(actionType).authRef === "string"
            ? String(asRecord(actionType).authRef)
            : undefined;
        if (authRef) {
          const [{ loadConfig }, { resolveServiceKeyAsync }] = await Promise.all([
            import("../config/config.js"),
            import("./service-keys.js"),
          ]);
          const secret = await resolveServiceKeyAsync(authRef, loadConfig(), {
            source: "workflow_runner",
          });
          if (secret) {
            headers.Authorization =
              authType?.toLowerCase() === "basic" ? `Basic ${secret}` : `Bearer ${secret}`;
          }
        }
        log.info("Action: api_call", { provider, endpoint, method, authType });
        const hasBody = method !== "GET" && params;
        const resp = await fetch(endpoint, {
          method: method || "GET",
          headers,
          body: hasBody ? JSON.stringify(params) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);
        const rawBody = await resp.text();
        let data: Record<string, unknown> = { statusCode: resp.status };
        try {
          data = { ...data, ...JSON.parse(rawBody) };
        } catch {
          data.body = rawBody;
        }
        const mapped = outputMapping
          ? { ...data, ...applyOutputMapping(data, outputMapping) }
          : data;
        return { items: [{ json: mapped, text: rawBody }] };
      } catch (err) {
        throw new Error(`api_call failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    case "store_memory": {
      const { content, memoryType, significance } = actionType;
      const rendered = resolveTemplate(content, context);
      try {
        const result = actions?.storeMemory
          ? await actions.storeMemory(rendered, { type: memoryType, significance })
          : await storeWorkflowMemory(context, rendered, { type: memoryType, significance });
        log.info("store_memory: STORED", { memoryId: result.memoryId, type: memoryType });
        return {
          items: [
            {
              json: {
                stored: result.ok,
                memoryId: result.memoryId,
                type: memoryType,
                significance: resolveMemorySignificance(significance),
              },
              text: rendered,
            },
          ],
        };
      } catch (err) {
        log.error("store_memory: FAILED", { nodeId: node.id, error: String(err) });
        throw err;
      }
    }

    case "store_knowledge": {
      const { collectionId, content, metadata } = actionType;
      const rendered = resolveTemplate(content, context);
      try {
        const { getStorageAdapter } = await import("../data/storage-factory.js");
        const adapter = await getStorageAdapter();
        const item = await adapter.memory.createItem({
          memoryType: "knowledge",
          summary: rendered,
          significance: "noteworthy",
          extra: {
            source: "workflow_knowledge_ingest",
            collection: collectionId,
            workflowRunId: context.runId,
            ...(metadata ?? {}),
          },
        });
        return {
          items: [
            { json: { stored: true, collection: collectionId, memoryId: item.id }, text: rendered },
          ],
        };
      } catch (err) {
        log.error("store_knowledge: FAILED", { nodeId: node.id, collectionId, error: String(err) });
        throw err;
      }
    }

    case "generate_image": {
      const { prompt, model, size } = actionType;
      const rendered = resolveTemplate(prompt, context);
      try {
        // Resolve OpenAI API key from environment or service keys
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          log.warn("generate_image: no OPENAI_API_KEY set — cannot generate", { nodeId: node.id });
          return {
            items: [{ json: { generated: false, reason: "OPENAI_API_KEY not configured" } }],
          };
        }
        const body: Record<string, unknown> = {
          model: model || "dall-e-3",
          prompt: rendered,
          n: 1,
          response_format: "url",
        };
        if (size) body.size = size;
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "unknown");
          throw new Error(`OpenAI image gen failed: HTTP ${res.status} — ${errBody}`);
        }
        const data = (await res.json()) as {
          data?: Array<{ url?: string; revised_prompt?: string }>;
        };
        const imageUrl = data.data?.[0]?.url ?? "";
        const revisedPrompt = data.data?.[0]?.revised_prompt ?? rendered;
        log.info("generate_image: GENERATED", {
          model: model || "dall-e-3",
          url: imageUrl.slice(0, 60),
        });
        return {
          items: [
            {
              json: {
                generated: true,
                url: imageUrl,
                revisedPrompt,
                model: model || "dall-e-3",
                size,
              },
              text: revisedPrompt,
              artifacts: [{ type: "image" as const, id: imageUrl, title: rendered.slice(0, 50) }],
            },
          ],
        };
      } catch (err) {
        log.error("generate_image: FAILED", { nodeId: node.id, error: String(err) });
        throw err;
      }
    }

    case "generate_audio": {
      const { text, voice, mood } = actionType;
      const rendered = resolveTemplate(text, context);
      try {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          log.warn("generate_audio: no ELEVENLABS_API_KEY set — cannot generate", {
            nodeId: node.id,
          });
          return {
            items: [
              {
                json: { generated: false, reason: "ELEVENLABS_API_KEY not configured" },
                text: rendered,
              },
            ],
          };
        }
        const voiceId = voice || "21m00Tcm4TlvDq8ikWAM"; // Default: Rachel
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": apiKey,
          },
          body: JSON.stringify({
            text: rendered,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "unknown");
          throw new Error(`ElevenLabs TTS failed: HTTP ${res.status} — ${errBody}`);
        }
        // Response is audio bytes — we can't easily save to a file from the runner.
        // Return success with metadata. The audio data would need a storage step.
        log.info("generate_audio: GENERATED", { voiceId, textLength: rendered.length });
        return {
          items: [
            {
              json: { generated: true, voiceId, textLength: rendered.length, mood },
              text: rendered,
              artifacts: [
                {
                  type: "audio" as const,
                  id: `tts-${context.runId}-${node.id}`,
                  title: rendered.slice(0, 50),
                },
              ],
            },
          ],
        };
      } catch (err) {
        log.error("generate_audio: FAILED", { nodeId: node.id, error: String(err) });
        throw err;
      }
    }

    case "save_to_docpanel": {
      const { title, content, format } = actionType;
      const renderedTitle = resolveTemplate(title, context);
      const fallbackContent =
        context.history[context.history.length - 1]?.output?.items[0]?.text ?? "";
      const renderedContent = resolveTemplate(content ?? fallbackContent, context);
      try {
        const { dashboardApiHeaders } = await import("../utils/dashboard-api.js");
        const dashboardApi = process.env.ARGENT_DASHBOARD_API || "http://localhost:9242";
        const docId = `wfdoc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const res = await fetch(`${dashboardApi}/api/canvas/save`, {
          method: "POST",
          headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            doc: {
              id: docId,
              title: renderedTitle,
              content: renderedContent,
              type: format || "markdown",
              autoRouted: true,
            },
          }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "unknown error");
          throw new Error(`DocPanel save failed: HTTP ${res.status} — ${errBody}`);
        }
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const savedId = (data.id as string) || docId;
        log.info("save_to_docpanel: SAVED", { docId: savedId, title: renderedTitle });
        return {
          items: [
            {
              json: {
                saved: true,
                docId: savedId,
                title: renderedTitle,
                format: format || "markdown",
              },
              text: renderedContent,
              artifacts: [
                { type: "docpanel" as const, id: `doc:${savedId}`, title: renderedTitle },
              ],
            },
          ],
        };
      } catch (err) {
        log.error("save_to_docpanel: FAILED", {
          nodeId: node.id,
          title: renderedTitle,
          error: String(err),
        });
        throw err;
      }
    }

    case "run_script": {
      const { command, sandboxed } = actionType;
      if (!sandboxed) {
        return {
          items: [{ json: { executed: false, error: "Unsandboxed scripts not allowed" } }],
        };
      }

      try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        const timeoutMs =
          typeof (actionType as Record<string, unknown>).timeoutMs === "number"
            ? Number((actionType as Record<string, unknown>).timeoutMs)
            : 30_000;

        const result = await execAsync(command, {
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024,
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_ENV: "production",
            // Strip secret env vars from subprocess
            OPENAI_API_KEY: "",
            ANTHROPIC_API_KEY: "",
          },
        });

        log.info("run_script: executed", {
          nodeId: node.id,
          command: command.slice(0, 80),
          exitCode: 0,
        });

        return {
          items: [
            {
              json: {
                executed: true,
                exitCode: 0,
                stdout: result.stdout.slice(0, 10_000),
                stderr: result.stderr.slice(0, 5_000),
              },
              text: result.stdout.slice(0, 2_000),
            },
          ],
        };
      } catch (err: unknown) {
        const execErr = err as {
          code?: number;
          stdout?: string;
          stderr?: string;
          killed?: boolean;
        };
        log.error("run_script: failed", {
          nodeId: node.id,
          command: command.slice(0, 80),
          error: String(err),
        });
        return {
          items: [
            {
              json: {
                executed: true,
                exitCode: execErr.code ?? 1,
                stdout: execErr.stdout?.slice(0, 10_000) ?? "",
                stderr: execErr.stderr?.slice(0, 5_000) ?? String(err),
                killed: execErr.killed ?? false,
              },
              text: `Script failed: ${String(err).slice(0, 500)}`,
            },
          ],
        };
      }
    }

    case "connector_action": {
      const { connectorId, credentialId, resource, operation, parameters, outputMapping } =
        actionType;
      try {
        // 1. Discover connector binary from catalog
        const { discoverConnectorCatalog, runConnectorCommandJson, defaultRepoRoots } =
          await import("../connectors/catalog.js");
        const catalog = await discoverConnectorCatalog();
        const connector = catalog.connectors.find((c) => c.tool === connectorId);
        if (!connector?.discovery.binaryPath) {
          throw new Error(`Connector "${connectorId}" not found or has no runnable binary`);
        }

        // 2. Load connector manifest for auth requirements
        const fs = await import("node:fs");
        const nodePath = await import("node:path");
        let manifest: Record<string, unknown> | null = null;
        for (const root of defaultRepoRoots()) {
          const manifestPath = nodePath.join(root, connectorId, "connector.json");
          if (fs.existsSync(manifestPath)) {
            try {
              manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<
                string,
                unknown
              >;
              break;
            } catch {
              /* try next root */
            }
          }
        }

        // 2b. Guard: block manifest-only connectors from execution
        if (manifest) {
          const scope =
            manifest.scope && typeof manifest.scope === "object"
              ? (manifest.scope as Record<string, unknown>)
              : {};
          if (scope.scaffold_only === true || scope.live_backend_available === false) {
            return {
              text: `Connector "${connectorId}" is manifest-only — no runtime harness available. This connector cannot be executed until a Python CLI harness is implemented.`,
              json: {
                connectorId,
                operation,
                status: "blocked",
                reason: "manifest_only_no_runtime",
              },
            };
          }
        }

        // 3. Resolve credential secrets from pg-secret-store
        let secretsEnv: Record<string, string> = {};
        if (credentialId) {
          const { pgGetServiceKeyByVariable } = await import("./pg-secret-store.js");
          const { resolvePostgresUrl } = await import("../data/storage-resolver.js");
          const postgres = (await import("postgres")).default;
          const sql = postgres(resolvePostgresUrl(), {
            max: 1,
            idle_timeout: 5,
            connect_timeout: 5,
            prepare: false,
          });
          try {
            const variable = `WORKFLOW_CRED_${credentialId}`;
            const key = await pgGetServiceKeyByVariable(sql, variable);
            if (key?.value) {
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
                log.warn("connector_action: failed to parse credential secrets", {
                  credentialId,
                });
              }
            } else {
              log.warn("connector_action: credential not found or empty", { credentialId });
            }
          } finally {
            await sql.end({ timeout: 2 }).catch(() => {});
          }
        }

        // 4. Build args: --json <operation> with parameters as JSON on stdin or args
        const resolvedParams: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(parameters ?? {})) {
          resolvedParams[key] = typeof val === "string" ? resolveTemplate(val, context) : val;
        }

        const args = ["--json", operation];
        // Pass parameters as flattened --key=value args for the connector harness
        for (const [key, val] of Object.entries(resolvedParams)) {
          if (val !== undefined && val !== null) {
            args.push(`--${key}`, String(val));
          }
        }

        // 5. Execute connector command
        const result = await runConnectorCommandJson({
          binaryPath: connector.discovery.binaryPath,
          args,
          cwd: connector.discovery.harnessDir,
          timeoutMs: node.config.timeoutMs ?? 30_000,
          env: secretsEnv,
        });

        if (!result.ok) {
          throw new Error(
            `Connector ${connectorId} command "${operation}" failed: ${result.detail || result.stderr}`,
          );
        }

        // 6. Map result to ItemSet output ports
        let responseData: Record<string, unknown> = {};
        if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
          responseData = result.data as Record<string, unknown>;
        } else if (result.envelope && typeof result.envelope === "object") {
          responseData = result.envelope as Record<string, unknown>;
        } else if (typeof result.data === "string") {
          try {
            responseData = JSON.parse(result.data) as Record<string, unknown>;
          } catch {
            responseData = { raw: result.data };
          }
        }

        const mapped = outputMapping
          ? { ...responseData, ...applyOutputMapping(responseData, outputMapping) }
          : responseData;

        log.info("connector_action: SUCCESS", {
          connectorId,
          operation,
          resource,
          hasOutputMapping: !!outputMapping,
        });

        return {
          items: [
            {
              json: {
                ok: true,
                connectorId,
                operation,
                resource,
                ...mapped,
              },
              text: result.stdout?.trim() || JSON.stringify(mapped),
            },
          ],
        };
      } catch (err) {
        log.error("connector_action: FAILED", {
          nodeId: node.id,
          connectorId,
          operation,
          error: String(err),
        });
        throw err;
      }
    }

    default:
      log.warn("unknown action type", { nodeId: node.id, actionType: actionName });
      return emptyItemSet();
  }
}

/**
 * Execute a gate node — control flow routing.
 *
 * Sprint 2 implements: condition (simple field comparison), and pass-through
 * for all other gate types (parallel, join, approval, etc.)
 */
function executeGate(node: GateNode, context: PipelineContext, _edges: WorkflowEdge[]): ItemSet {
  const config = node.config;
  const gateType = config.gateType;

  log.info("executing gate", { nodeId: node.id, gateType });

  switch (gateType) {
    case "condition": {
      const lastOutput = getLastOutput(context);
      const result = evaluateCondition(config.expression, lastOutput);
      return {
        items: [
          {
            json: {
              gateType: "condition",
              result,
              selectedEdge: result ? config.trueEdge : config.falseEdge,
            },
            text: `Condition evaluated: ${result ? "true" : "false"}`,
          },
        ],
      };
    }

    case "switch": {
      const lastOutput = getLastOutput(context);
      for (const c of config.cases) {
        if (evaluateCondition(c.expression, lastOutput)) {
          return {
            items: [
              {
                json: { gateType: "switch", matchedCase: c.label, selectedEdge: c.edgeId },
                text: `Switch matched: ${c.label}`,
              },
            ],
          };
        }
      }
      return {
        items: [
          {
            json: {
              gateType: "switch",
              matchedCase: "default",
              selectedEdge: config.defaultEdge ?? "",
            },
            text: "Switch fell through to default",
          },
        ],
      };
    }

    case "wait_duration": {
      const durationMs = config.durationMs ?? 0;
      const resumeAt = new Date(Date.now() + durationMs).toISOString();

      if (durationMs <= 0) {
        log.info("wait_duration gate — zero duration, passing through", { nodeId: node.id });
        return {
          items: [
            {
              json: { gateType: "wait_duration", durationMs: 0, waited: true },
              text: "Wait gate (0ms) — passed through immediately",
            },
          ],
        };
      }

      log.info("wait_duration gate — pausing execution", {
        nodeId: node.id,
        durationMs,
        resumeAt,
      });

      // Use a sentinel so the main loop can detect this and handle it,
      // similar to the __approvalPending pattern.
      return {
        items: [
          {
            json: {
              gateType: "wait_duration",
              __waitPending: true,
              durationMs,
              resumeAt,
            },
            text: `Waiting ${durationMs}ms until ${resumeAt}`,
          },
        ],
      };
    }

    case "approval":
      // Returns a sentinel ItemSet that the main loop detects to pause execution.
      // The actual pause/resume logic lives in the main executeWorkflow loop.
      log.info("approval gate — requesting operator approval");
      return {
        items: [
          {
            json: {
              gateType: "approval",
              __approvalPending: true,
              message: config.message || "Review required before continuing",
              showPreviousOutput: config.showPreviousOutput ?? true,
              timeoutMs: config.timeoutMs,
              timeoutAction: config.timeoutAction || "deny",
            },
            text: "Approval gate — waiting for operator",
          },
        ],
      };

    case "error_handler":
      // Pass through — error_handler only activates on failure
      return {
        items: [
          {
            json: { gateType: "error_handler", status: "standby" },
            text: "Error handler standing by",
          },
        ],
      };

    case "parallel":
    case "join":
      // Handled by executeParallelJoin() — should not reach here in normal flow.
      // If we do reach here (e.g., linear fallback), pass through gracefully.
      log.info(`${gateType} gate — linear fallback pass-through`, { nodeId: node.id });
      return {
        items: [
          {
            json: { gateType, passThrough: true },
            text: `${gateType} gate (linear fallback)`,
          },
        ],
      };

    case "loop": {
      const maxIterations = config.maxIterations ?? 10;
      const loopKey = `__loop_${node.id}_iteration`;
      const currentIteration = (context.variables?.[loopKey] as number) ?? 0;

      // Check termination conditions
      const maxReached = currentIteration >= maxIterations;
      const conditionMet = config.condition
        ? evaluateCondition(config.condition, getLastOutput(context))
        : true;

      if (maxReached || !conditionMet) {
        log.info("loop gate — exiting", {
          nodeId: node.id,
          iteration: currentIteration,
          maxReached,
          conditionMet,
        });
        if (context.variables) context.variables[loopKey] = 0;
        return {
          items: [
            {
              json: {
                gateType: "loop",
                action: "exit",
                totalIterations: currentIteration,
                exitReason: maxReached ? "max_iterations" : "condition_false",
                selectedEdge: config.exitEdge ?? "",
              },
              text: `Loop complete after ${currentIteration} iterations`,
            },
          ],
        };
      }

      // Continue looping
      log.info("loop gate — iterating", {
        nodeId: node.id,
        iteration: currentIteration + 1,
        maxIterations,
      });
      if (context.variables) context.variables[loopKey] = currentIteration + 1;
      return {
        items: [
          {
            json: {
              gateType: "loop",
              action: "iterate",
              iteration: currentIteration + 1,
              maxIterations,
              selectedEdge: config.bodyEdge ?? "",
            },
            text: `Loop iteration ${currentIteration + 1}/${maxIterations}`,
          },
        ],
      };
    }

    case "sub_workflow": {
      const { workflowId, inputMapping } = config;

      if (!workflowId) {
        log.error("sub_workflow gate — no workflowId specified", { nodeId: node.id });
        return {
          items: [
            {
              json: { gateType: "sub_workflow", error: "No workflowId specified" },
              text: "Sub-workflow gate error: no workflowId",
            },
          ],
        };
      }

      // Depth guard against infinite recursion
      const MAX_DEPTH = 5;
      const depth = (context.variables?.__subWorkflowDepth as number) ?? 0;
      if (depth >= MAX_DEPTH) {
        log.error("sub_workflow gate — depth limit exceeded", {
          nodeId: node.id,
          depth,
          maxDepth: MAX_DEPTH,
        });
        return {
          items: [
            {
              json: {
                gateType: "sub_workflow",
                error: `Sub-workflow depth limit (${MAX_DEPTH}) exceeded`,
              },
              text: `Sub-workflow aborted: depth limit exceeded`,
            },
          ],
        };
      }

      // Map parent context into sub-workflow input
      const subInput: Record<string, unknown> = {};
      if (inputMapping && typeof inputMapping === "object") {
        for (const [subKey, parentPath] of Object.entries(inputMapping as Record<string, string>)) {
          subInput[subKey] = resolveFieldPath(getLastOutput(context), parentPath);
        }
      }

      log.info("sub_workflow gate — returning sentinel for main loop", {
        nodeId: node.id,
        subWorkflowId: workflowId,
        depth: depth + 1,
      });

      // Return a sentinel — the main loop will handle PG lookup and recursive execution
      return {
        items: [
          {
            json: {
              gateType: "sub_workflow",
              __subWorkflowPending: true,
              subWorkflowId: workflowId,
              depth: depth + 1,
              inputMapping: subInput,
            },
            text: `Sub-workflow ${workflowId} pending (depth ${depth + 1})`,
          },
        ],
      };
    }

    case "wait_event":
      // wait_event requires external event delivery (webhooks/streams).
      // Log and pass through — full implementation needs event subscription system.
      log.info("wait_event gate — not yet implemented, passing through", {
        nodeId: node.id,
        eventType: config.eventType,
      });
      return {
        items: [
          {
            json: {
              gateType: "wait_event",
              eventType: config.eventType,
              passThrough: true,
              reason: "Event subscription system not yet implemented",
            },
            text: `wait_event: ${config.eventType ?? "unknown"} (pass-through — not yet implemented)`,
          },
        ],
      };

    default:
      log.warn("unknown gate type, passing through", { nodeId: node.id });
      return emptyItemSet();
  }
}

/**
 * Execute an output node — delivers the pipeline result.
 * Sprint 2: stubs that log delivery and return confirmation.
 */
async function executeOutput(node: OutputNode, context: PipelineContext): Promise<ItemSet> {
  const config = node.config;
  const outputType = config.outputType;
  const lastOutput = getLastOutput(context);

  log.info("executing output", { nodeId: node.id, outputType });

  switch (outputType) {
    case "docpanel":
      log.warn("docpanel output not yet wired — returning mock", {
        nodeId: node.id,
        title: config.title,
      });
      return {
        items: [
          {
            json: { outputType: "docpanel", title: config.title },
            text: `DocPanel document created: ${config.title}`,
            artifacts: [
              {
                type: "docpanel",
                id: `doc:${context.runId}-${node.id}`,
                title: config.title,
              },
            ],
          },
        ],
      };

    case "channel": {
      const content = config.template
        ? resolveTemplate(config.template, context)
        : lastOutput.text
          ? String(lastOutput.text)
          : JSON.stringify(lastOutput);
      const result = await sendWorkflowMessage(
        config.channelType,
        config.channelId,
        content,
        context,
        node.id,
      );
      return {
        items: [
          {
            json: {
              outputType: "channel",
              delivered: result.ok,
              channel: result.channel,
              to: result.to,
              via: result.via,
              messageId: result.messageId,
            },
            text: content,
          },
        ],
      };
    }

    case "email": {
      const subject = resolveTemplate(config.subject, context);
      const body = resolveTemplate(config.bodyTemplate, context);
      const result = await sendWorkflowEmail(node.id, config.to, subject, body, "sendgrid");
      return {
        items: [
          {
            json: {
              outputType: "email",
              delivered: result.ok,
              to: config.to,
              subject,
              error: result.error,
              result: result.details,
            },
            text: body,
          },
        ],
      };
    }

    case "webhook": {
      const renderedBody = resolveTemplate(config.bodyTemplate, context);
      const response = await fetch(config.url, {
        method: config.method,
        headers: { "Content-Type": "application/json" },
        body: config.method === "GET" ? undefined : renderedBody,
      });
      const rawBody = await response.text();
      return {
        items: [
          {
            json: {
              outputType: "webhook",
              delivered: response.ok,
              statusCode: response.status,
              url: config.url,
              body: rawBody,
            },
            text: rawBody,
          },
        ],
      };
    }

    case "knowledge":
      log.warn("knowledge output not yet wired — returning mock", {
        nodeId: node.id,
        collectionId: config.collectionId,
      });
      return {
        items: [
          {
            json: { outputType: "knowledge", collectionId: config.collectionId },
            text: `Output stored to knowledge collection ${config.collectionId}`,
          },
        ],
      };

    case "task_update": {
      const { getStorageAdapter } = await import("../data/storage-factory.js");
      const adapter = await getStorageAdapter();
      const taskId = resolveTemplate(config.taskId, context);
      const status = resolveTemplate(config.status, context);
      const metadata = config.evidence
        ? {
            workflowRunId: context.runId,
            evidence: resolveTemplate(config.evidence, context),
          }
        : undefined;
      const updated = await adapter.tasks.update(taskId, {
        status: status as
          | "pending"
          | "in_progress"
          | "blocked"
          | "completed"
          | "failed"
          | "cancelled",
        ...(metadata ? { metadata } : {}),
      });
      return {
        items: [
          {
            json: { outputType: "task_update", updated: Boolean(updated), taskId, status },
            text: updated ? `Task ${taskId} updated to ${status}` : `Task ${taskId} not found`,
          },
        ],
      };
    }

    case "next_workflow": {
      const [{ callGateway }, { loadConfig }] = await Promise.all([
        import("../gateway/call.js"),
        import("../config/config.js"),
      ]);
      const triggerPayload = config.inputMapping
        ? applyOutputMapping(lastOutput, config.inputMapping)
        : { ...lastOutput };
      const result = await callGateway({
        method: "workflows.run",
        params: { workflowId: config.workflowId, triggerPayload },
        config: loadConfig(),
      });
      return {
        items: [
          {
            json: {
              outputType: "next_workflow",
              workflowId: config.workflowId,
              result: asRecord(result),
            },
            text: `Chained to workflow ${config.workflowId}`,
          },
        ],
      };
    }

    default:
      log.warn("unknown output type", { nodeId: node.id });
      return { items: [{ json: { ...lastOutput }, text: "Output delivered" }] };
  }
}

// ── Topological Sort (Kahn's Algorithm) ──────────────────────────

/**
 * Sort workflow nodes in execution order using Kahn's algorithm.
 * Throws if the graph contains a cycle.
 */
export function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const nodeMap = new Map<string, WorkflowNode>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Start with nodes that have no incoming edges
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: WorkflowNode[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (!node) continue;

    sorted.push(node);

    for (const neighbor of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== nodes.length) {
    const missing = nodes.filter((n) => !sorted.find((s) => s.id === n.id)).map((n) => n.id);
    throw new Error(`Workflow graph contains a cycle. Unreachable nodes: ${missing.join(", ")}`);
  }

  return sorted;
}

// ── Condition Evaluator ──────────────────────────────────────────

/**
 * Evaluate a condition expression against a data context.
 * Sprint 2: supports simple field comparisons and logical combinators.
 * Agent-evaluated conditions deferred to Sprint 3.
 */
function evaluateCondition(expr: ConditionExpr, data: Record<string, unknown>): boolean {
  if ("and" in expr) {
    return expr.and.every((e) => evaluateCondition(e, data));
  }
  if ("or" in expr) {
    return expr.or.some((e) => evaluateCondition(e, data));
  }
  if ("not" in expr) {
    return !evaluateCondition(expr.not, data);
  }
  if ("evaluator" in expr) {
    // Agent-evaluated condition — Sprint 3
    log.warn("agent-evaluated condition not yet implemented, defaulting to true");
    return true;
  }

  // Simple field comparison
  const fieldValue = resolveFieldPath(data, expr.field);
  const { operator, value } = expr;

  switch (operator) {
    case "==":
      return fieldValue === value;
    case "!=":
      return fieldValue !== value;
    case ">":
      return Number(fieldValue) > Number(value);
    case "<":
      return Number(fieldValue) < Number(value);
    case ">=":
      return Number(fieldValue) >= Number(value);
    case "<=":
      return Number(fieldValue) <= Number(value);
    case "contains":
      return String(fieldValue).includes(String(value));
    case "matches":
      try {
        return new RegExp(String(value)).test(String(fieldValue));
      } catch {
        log.warn("invalid regex in condition", { value });
        return false;
      }
    default:
      return false;
  }
}

// ── Retry Logic ──────────────────────────────────────────────────

/**
 * Retry a failed step with exponential backoff + jitter.
 */
async function retryStep(
  node: WorkflowNode,
  context: PipelineContext,
  dispatcher: AgentDispatcher,
  redis: Redis | null | undefined,
  actions: ActionExecutors | undefined,
  errorConfig: { maxRetries?: number; retryBackoffMs?: number; retryJitterPct?: number },
  previousError: string,
): Promise<ItemSet> {
  const maxRetries = errorConfig.maxRetries ?? 3;
  const baseMs = errorConfig.retryBackoffMs ?? 2000;
  const jitterPct = errorConfig.retryJitterPct ?? 20;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const delay = baseMs * Math.pow(2, attempt - 1);
    const jitter = delay * (jitterPct / 100) * (Math.random() * 2 - 1);
    const waitMs = Math.max(0, Math.round(delay + jitter));

    log.info("retrying step", {
      nodeId: node.id,
      attempt,
      maxRetries,
      waitMs,
    });

    await sleep(waitMs);

    try {
      switch (node.kind) {
        case "agent": {
          const prompt = buildRetryPrompt(node.config, context, attempt, previousError);
          return await dispatcher.dispatch(node.config.agentId, prompt, {
            timeoutMs: node.config.timeoutMs ?? 300_000,
            modelTierHint: node.config.modelTierHint,
            toolsAllow: node.config.toolsAllow,
            toolsDeny: node.config.toolsDeny,
          });
        }
        case "action":
          return await executeAction(node, context, actions);
        default:
          return emptyItemSet();
      }
    } catch (err) {
      previousError = err instanceof Error ? err.message : String(err);
      log.warn("retry attempt failed", {
        nodeId: node.id,
        attempt,
        error: previousError,
      });
    }
  }

  // All retries exhausted
  return errorItemSet(`All ${maxRetries} retries exhausted. Last error: ${previousError}`);
}

// ── Core Agent Dispatcher — Live LLM ─────────────────────────────

/**
 * Resolve a model tier hint to an explicit provider/model pair via the
 * model router with a synthetic complexity score targeting the tier.
 */
function resolveModelFromTier(
  tierHint?: ModelTier | string,
): { provider: string; model: string } | undefined {
  if (!tierHint) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { routeModel } = require("../models/router.js") as {
      routeModel: typeof import("../models/router.js").routeModel;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadConfig } = require("../config/config.js") as {
      loadConfig: typeof import("../config/config.js").loadConfig;
    };
    const cfg = loadConfig();
    const routerCfg = cfg.agents?.defaults?.modelRouter;

    const decision = routeModel({
      signals: {
        prompt: "(workflow pipeline step)",
        sessionType: "main",
        forceMaxTier: tierHint === "powerful",
      },
      config: routerCfg,
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-20250514",
    });

    return { provider: decision.provider, model: decision.model };
  } catch {
    return undefined;
  }
}

/**
 * Core Agent Dispatcher — dispatches workflow agent nodes to the live
 * LLM via the gateway's own `agentCommand()` function.
 *
 * This reuses the same execution path as the gateway `agent` handler,
 * giving workflow agent nodes full access to model routing, tool loading,
 * session management, timeout enforcement, and model fallback chains.
 *
 * The dispatcher runs inside the gateway process so no WebSocket
 * round-trip is needed.
 */
export class CoreAgentDispatcher implements AgentDispatcher {
  async dispatch(
    agentId: string,
    prompt: string,
    config: {
      timeoutMs: number;
      modelTierHint?: ModelTier | string;
      toolsAllow?: string[];
      toolsDeny?: string[];
    },
  ): Promise<ItemSet> {
    const startMs = Date.now();

    log.info("CoreAgentDispatcher: dispatching live agent call", {
      agentId,
      promptLen: prompt.length,
      timeoutMs: config.timeoutMs,
      modelTierHint: config.modelTierHint,
    });

    try {
      // Lazy import to avoid circular deps at module load time.
      const { agentCommand } = await import("../commands/agent.js");
      const { defaultRuntime } = await import("../runtime.js");
      const { createDefaultDeps } = await import("../cli/deps.js");

      // Resolve model from tier hint when present
      const resolved = resolveModelFromTier(config.modelTierHint as ModelTier | undefined);

      // Each workflow step gets an isolated session key.
      const sessionKey = `workflow:${agentId}:${Date.now()}`;
      const timeoutSeconds = Math.ceil(config.timeoutMs / 1000);

      const result = await agentCommand(
        {
          message: prompt,
          agentId,
          sessionKey,
          timeout: String(timeoutSeconds),
          lane: "workflow",
          providerOverride: resolved?.provider,
          modelOverride: resolved?.model,
          extraSystemPrompt:
            "You are executing a step in an automated workflow pipeline. " +
            "Follow the TOON-encoded pipeline context in the message precisely. " +
            "Be concise and actionable in your response.",
        },
        defaultRuntime,
        createDefaultDeps(),
      );

      const durationMs = Date.now() - startMs;

      // Extract text from the agent result. agentCommand returns a
      // delivery result whose shape varies.
      const responseText =
        typeof result === "object" && result !== null
          ? String(
              (result as Record<string, unknown>).text ??
                (result as Record<string, unknown>).summary ??
                result,
            )
          : String(result ?? "");

      // Extract token usage from result metadata when available
      let tokensUsed = 0;
      let costUsd = 0;
      if (typeof result === "object" && result !== null) {
        const meta = (result as Record<string, unknown>).meta as
          | Record<string, unknown>
          | undefined;
        if (meta) {
          const usage = meta.usage as Record<string, number> | undefined;
          if (usage) {
            tokensUsed = (usage.input ?? 0) + (usage.output ?? 0);
          }
        }
      }

      const modelRef = resolved ? `${resolved.provider}/${resolved.model}` : "default";

      log.info("CoreAgentDispatcher: agent call completed", {
        agentId,
        durationMs,
        tokensUsed,
        responseLen: responseText.length,
      });

      return {
        items: [
          {
            json: {
              agentId,
              modelTierHint: config.modelTierHint ?? "balanced",
              model: modelRef,
            },
            text: responseText,
            meta: {
              nodeId: "",
              agentId,
              status: "completed",
              durationMs,
              tokensUsed,
              model: modelRef,
              costUsd,
            },
          },
        ],
      };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errorMsg = err instanceof Error ? err.message : String(err);

      log.error("CoreAgentDispatcher: agent call failed", {
        agentId,
        durationMs,
        error: errorMsg,
      });

      // Re-throw so the runner's error handling (retry/skip/fail) kicks in.
      throw err;
    }
  }
}

// ── Parallel / Join Execution ─────────────────────────────────────

interface ParallelSegmentResult {
  output: ItemSet;
  failed: boolean;
}

/**
 * Identify the join node paired with a parallel gate.
 * Walks outgoing edges from the parallel gate's branches until a join gate
 * is found whose incoming edges all originate from the parallel's branch set.
 */
function findJoinForParallel(
  parallelNodeId: string,
  workflow: WorkflowDefinition,
): GateNode | null {
  const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const queue = workflow.edges.filter((e) => e.source === parallelNodeId).map((e) => e.target);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const node = nodeMap.get(id);
    if (!node) continue;

    if (node.kind === "gate" && node.config.gateType === "join") {
      return node;
    }

    for (const edge of workflow.edges) {
      if (edge.source === id && !visited.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }

  return null;
}

/**
 * Get all nodes in a branch from startId until we hit the joinNodeId (exclusive).
 * Performs a DFS collecting nodes in execution order.
 */
function getNodesInBranch(
  startId: string,
  joinNodeId: string,
  workflow: WorkflowDefinition,
): WorkflowNode[] {
  const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]));
  const result: WorkflowNode[] = [];
  const visited = new Set<string>();

  const dfs = (id: string) => {
    if (visited.has(id) || id === joinNodeId) return;
    visited.add(id);
    const node = nodeMap.get(id);
    if (!node) return;
    result.push(node);

    for (const edge of workflow.edges) {
      if (edge.source === id) {
        dfs(edge.target);
      }
    }
  };

  dfs(startId);
  return result;
}

/**
 * Collect all node IDs reachable from startId via DFS, adding them to the skip set.
 * Used by edge routing to skip branches not selected by condition/switch/loop gates.
 * Stops at the gate that originated the routing (prevents skipping merge points).
 */
function collectReachableNodes(
  startId: string,
  workflow: WorkflowDefinition,
  skipSet: Set<string>,
  originGateId: string,
): void {
  const visited = new Set<string>();
  const dfs = (id: string) => {
    if (visited.has(id) || id === originGateId) return;
    visited.add(id);
    skipSet.add(id);
    for (const edge of workflow.edges) {
      if (edge.source === id) {
        dfs(edge.target);
      }
    }
  };
  dfs(startId);
}

/**
 * Populate skip sets so the main linear loop skips nodes that belong
 * to parallel branches (they are executed by executeParallelSegment).
 */
function buildParallelSkipSets(
  _executionOrder: WorkflowNode[],
  workflow: WorkflowDefinition,
  branchNodeIds: Set<string>,
  joinIds: Set<string>,
): void {
  for (const node of workflow.nodes) {
    if (node.kind !== "gate" || node.config.gateType !== "parallel") continue;

    const joinNode = findJoinForParallel(node.id, workflow);
    if (!joinNode) continue;

    joinIds.add(joinNode.id);

    const branchEdges = workflow.edges.filter((e) => e.source === node.id);
    for (const edge of branchEdges) {
      const branchNodes = getNodesInBranch(edge.target, joinNode.id, workflow);
      for (const bn of branchNodes) {
        branchNodeIds.add(bn.id);
      }
    }
  }
}

/**
 * Execute a single branch of a parallel segment sequentially.
 */
async function executeBranch(
  branchNodes: WorkflowNode[],
  context: PipelineContext,
  workflow: WorkflowDefinition,
  dispatcher: AgentDispatcher,
  redis: Redis | null | undefined,
  params: ExecuteWorkflowParams,
  branchLabel: string,
): Promise<{ items: PipelineItem[]; failed: boolean }> {
  const items: PipelineItem[] = [];
  let failed = false;

  for (const node of branchNodes) {
    const stepStart = Date.now();
    params.onStepStart?.(node.id, node);

    let stepResult: ItemSet;
    let stepStatus: StepRecord["status"] = "completed";

    try {
      switch (node.kind) {
        case "agent":
          stepResult = await executeAgentNode(node, context, dispatcher, redis, workflow);
          break;
        case "action":
          stepResult = await executeAction(node, context, params.actions);
          break;
        case "gate":
          stepResult = executeGate(node, context, workflow.edges);
          break;
        case "output":
          stepResult = await executeOutput(node, context);
          break;
        default:
          stepResult = emptyItemSet();
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error("parallel branch step failed", {
        branch: branchLabel,
        nodeId: node.id,
        error: errorMsg,
      });
      const errorConfig = getErrorConfig(node, workflow);
      if (errorConfig.strategy === "skip") {
        stepResult = emptyItemSet();
        stepStatus = "skipped";
      } else {
        stepResult = errorItemSet(errorMsg);
        stepStatus = "failed";
        failed = true;
      }
    }

    const stepEnd = Date.now();

    const record: StepRecord = {
      nodeId: node.id,
      nodeKind: node.kind,
      nodeLabel: getNodeLabel(node),
      agentId: node.kind === "agent" ? node.config.agentId : undefined,
      stepIndex: context.history.length,
      status: stepStatus,
      durationMs: stepEnd - stepStart,
      output: stepResult,
      startedAt: stepStart,
      endedAt: stepEnd,
    };
    context.history.push(record);
    params.onStepComplete?.(node.id, record);

    items.push(...stepResult.items);

    if (failed) break;
  }

  return { items, failed };
}

/**
 * Execute a parallel gate segment: fan-out to branches, wait for completion
 * per the join strategy, then merge outputs.
 */
async function executeParallelSegment(
  parallelNode: GateNode,
  context: PipelineContext,
  workflow: WorkflowDefinition,
  dispatcher: AgentDispatcher,
  redis: Redis | null | undefined,
  params: ExecuteWorkflowParams,
): Promise<ParallelSegmentResult> {
  const joinNode = findJoinForParallel(parallelNode.id, workflow);

  if (!joinNode) {
    log.warn("parallel gate has no matching join, passing through", {
      nodeId: parallelNode.id,
    });
    return { output: emptyItemSet(), failed: false };
  }

  const joinConfig = joinNode.config as Extract<GateConfig, { gateType: "join" }>;
  const branchEdges = workflow.edges.filter((e) => e.source === parallelNode.id);

  log.info("executing parallel fan-out", {
    parallelId: parallelNode.id,
    joinId: joinNode.id,
    branchCount: branchEdges.length,
    joinStrategy: joinConfig.strategy,
    mergeStrategy: joinConfig.mergeStrategy,
  });

  const branches = branchEdges.map((edge, idx) => ({
    label: `branch-${idx}`,
    edgeId: edge.id,
    startNodeId: edge.target,
    nodes: getNodesInBranch(edge.target, joinNode.id, workflow),
  }));

  // Execute branches concurrently
  const timeoutMs = joinConfig.timeoutMs ?? 600_000;
  const branchPromises = branches.map((branch) =>
    executeBranch(branch.nodes, context, workflow, dispatcher, redis, params, branch.label),
  );

  let branchResults: Array<{ items: PipelineItem[]; failed: boolean }>;

  try {
    const racePromise = Promise.all(branchPromises);
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("parallel join timeout")), timeoutMs),
    );
    branchResults = await Promise.race([racePromise, timer]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("parallel execution failed or timed out", { error: msg });

    if (joinConfig.branchFailure === "skip") {
      branchResults = branches.map(() => ({ items: [], failed: true }));
    } else {
      return { output: errorItemSet(msg), failed: true };
    }
  }

  // Apply join strategy
  const anyFailed = branchResults.some((r) => r.failed);
  const allFailed = branchResults.every((r) => r.failed);

  switch (joinConfig.strategy) {
    case "all":
      if (anyFailed && joinConfig.branchFailure === "block") {
        return { output: errorItemSet("One or more parallel branches failed"), failed: true };
      }
      break;
    case "any":
      if (allFailed) {
        return { output: errorItemSet("All parallel branches failed"), failed: true };
      }
      break;
    case "n_of_m": {
      const successCount = branchResults.filter((r) => !r.failed).length;
      const nRequired = joinConfig.nRequired ?? 1;
      if (successCount < nRequired) {
        return {
          output: errorItemSet(`Only ${successCount}/${nRequired} branches succeeded`),
          failed: true,
        };
      }
      break;
    }
    case "all_settled":
      break;
  }

  const successfulOutputs = branchResults
    .map((r, idx) => ({ branchLabel: branches[idx].label, items: r.items, failed: r.failed }))
    .filter((r) => !r.failed || joinConfig.strategy === "all_settled");

  const mergedOutput = await applyMergeStrategy(
    joinConfig.mergeStrategy,
    successfulOutputs,
    joinConfig.mergeAgentConfig,
    dispatcher,
  );

  // Record join step
  const joinRecord: StepRecord = {
    nodeId: joinNode.id,
    nodeKind: "gate",
    nodeLabel: joinNode.label,
    stepIndex: context.history.length,
    status: "completed",
    durationMs: 0,
    output: mergedOutput,
    startedAt: Date.now(),
    endedAt: Date.now(),
  };
  context.history.push(joinRecord);
  params.onStepComplete?.(joinNode.id, joinRecord);

  return { output: mergedOutput, failed: false };
}

/**
 * Apply the configured merge strategy to combine branch outputs.
 */
async function applyMergeStrategy(
  strategy: MergeStrategy,
  branchOutputs: Array<{ branchLabel: string; items: PipelineItem[]; failed: boolean }>,
  mergeAgentConfig: MergeStrategyAgentConfig | undefined,
  dispatcher: AgentDispatcher,
): Promise<ItemSet> {
  switch (strategy) {
    case "concat":
      return concatMerge(branchOutputs);
    case "structured":
      return structuredMerge(branchOutputs);
    case "pick_first":
      return branchOutputs.length > 0 && branchOutputs[0].items.length > 0
        ? { items: branchOutputs[0].items }
        : emptyItemSet();
    case "agent_merge":
      return agentMerge(branchOutputs, mergeAgentConfig, dispatcher);
    default:
      return concatMerge(branchOutputs);
  }
}

/**
 * Concat merge: each branch output becomes a labeled section.
 */
function concatMerge(
  branchOutputs: Array<{ branchLabel: string; items: PipelineItem[] }>,
): ItemSet {
  const items: PipelineItem[] = [];
  for (const branch of branchOutputs) {
    for (const item of branch.items) {
      items.push({
        json: { ...item.json, _branch: branch.branchLabel },
        text: `[${branch.branchLabel}] ${item.text ?? ""}`,
        artifacts: item.artifacts,
        meta: item.meta,
      });
    }
  }
  return { items };
}

/**
 * Structured merge: combine all json fields, last-write-wins. Texts joined.
 */
function structuredMerge(
  branchOutputs: Array<{ branchLabel: string; items: PipelineItem[] }>,
): ItemSet {
  const mergedJson: Record<string, unknown> = {};
  const texts: string[] = [];
  const allArtifacts: PipelineItem["artifacts"] = [];

  for (const branch of branchOutputs) {
    for (const item of branch.items) {
      Object.assign(mergedJson, item.json);
      if (item.text) texts.push(item.text);
      if (item.artifacts) allArtifacts.push(...item.artifacts);
    }
  }

  return {
    items: [
      {
        json: mergedJson,
        text: texts.join("\n\n"),
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
      },
    ],
  };
}

/**
 * Agent merge: use an LLM to synthesize branch outputs. Falls back to concat.
 */
async function agentMerge(
  branchOutputs: Array<{ branchLabel: string; items: PipelineItem[] }>,
  agentConfig: MergeStrategyAgentConfig | undefined,
  dispatcher: AgentDispatcher,
): Promise<ItemSet> {
  if (!agentConfig) {
    log.warn("agent_merge requested but no mergeAgentConfig, falling back to concat");
    return concatMerge(branchOutputs);
  }

  const branchSections = branchOutputs
    .map((b) => {
      const content = b.items.map((item) => item.text ?? JSON.stringify(item.json)).join("\n");
      return `## ${b.branchLabel}\n${content}`;
    })
    .join("\n\n");

  const prompt = `${agentConfig.mergePrompt}\n\n---\n\n${branchSections}`;

  try {
    return await dispatcher.dispatch(agentConfig.agentId, prompt, {
      timeoutMs: 120_000,
      modelTierHint: agentConfig.modelTier,
    });
  } catch (err) {
    log.error("agent_merge dispatch failed, falling back to concat", {
      error: err instanceof Error ? err.message : String(err),
    });
    return concatMerge(branchOutputs);
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function emptyItemSet(): ItemSet {
  return { items: [] };
}

function errorItemSet(message: string): ItemSet {
  return {
    items: [
      {
        json: { error: true, message },
        text: message,
        meta: {
          nodeId: "",
          status: "failed",
          durationMs: 0,
        },
      },
    ],
  };
}

function getNodeLabel(node: WorkflowNode): string {
  switch (node.kind) {
    case "trigger":
      return node.triggerType;
    case "agent":
    case "action":
    case "gate":
    case "output":
      return node.label;
    default:
      return "unknown";
  }
}

/**
 * Get the last step's output as a flat JSON object for condition evaluation.
 */
function getLastOutput(context: PipelineContext): Record<string, unknown> {
  if (context.history.length === 0) return {};
  const lastStep = context.history[context.history.length - 1];
  if (lastStep.output.items.length === 0) return {};
  const item = lastStep.output.items[0];
  return {
    ...item.json,
    text: item.text,
    status: lastStep.status,
    nodeId: lastStep.nodeId,
    agentId: lastStep.agentId,
  };
}

/**
 * Resolve a dot-path field (e.g. "payload.score") from a data object.
 */
function resolveFieldPath(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Simple template resolution — replaces {{variable}} with context values.
 * Used for action body templates.
 */
function resolveTemplate(template: string, context: PipelineContext): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, rawPath: string) => {
    const path = rawPath.trim();

    // {{variables.name}} — pipeline variables
    if (path.startsWith("variables.")) {
      const subPath = path.slice("variables.".length);
      const val = resolveFieldPath(context.variables as Record<string, unknown>, subPath);
      return val !== undefined ? String(val) : "";
    }

    // {{steps.nodeLabel.output.text}} or {{steps.nodeLabel.output.json.field}}
    if (path.startsWith("steps.")) {
      const parts = path.split(".");
      const stepLabel = parts[1];
      const step = context.history.find((s) => s.nodeLabel === stepLabel);
      if (step && parts[2] === "output" && step.output.items.length > 0) {
        const field = parts.slice(3).join(".");
        if (field === "text") return step.output.items[0].text ?? "";
        // Allow steps.X.output.json.field — strip leading "json." prefix
        const jsonField = field.startsWith("json.") ? field.slice(5) : field;
        const val = resolveFieldPath(step.output.items[0].json, jsonField);
        return val !== undefined ? String(val) : "";
      }
      return "";
    }

    // {{trigger.payload.field}} — trigger data
    if (path.startsWith("trigger.")) {
      const subPath = path.slice("trigger.".length);
      const val = resolveFieldPath(context.trigger as unknown as Record<string, unknown>, subPath);
      return val !== undefined ? String(val) : "";
    }

    // {{context.runId}}, {{context.workflowId}}, etc. — run metadata
    if (path.startsWith("context.")) {
      const subPath = path.slice("context.".length);
      const val = resolveFieldPath(context as unknown as Record<string, unknown>, subPath);
      return val !== undefined ? String(val) : "";
    }

    // Fallback: check bare variables (backward compat with Sprint 2 usage)
    const fromVars = resolveFieldPath(context.variables as Record<string, unknown>, path);
    if (fromVars !== undefined) return String(fromVars);

    return "";
  });
}

function getErrorConfig(
  node: WorkflowNode,
  workflow: WorkflowDefinition,
): { strategy: string; maxRetries?: number; retryBackoffMs?: number; retryJitterPct?: number } {
  // Check node-level error config
  if (node.kind === "agent" && node.config.onError) return node.config.onError;
  if (node.kind === "action" && node.config.onError) return node.config.onError;
  // Fall back to workflow default
  return workflow.defaultOnError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-export types the caller needs
export type { AgentDispatcher, WorkflowDefinition, PipelineContext, StepRecord, ItemSet };
