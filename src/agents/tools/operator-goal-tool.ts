/**
 * Operator Goal Tool — Thin, high-leverage tool surface for wf-2 (goal definition + orchestration)
 * and wf-3 (parallel delegation engine) on the primary operator fast path.
 *
 * Exposes actions the primary operator (only when isPrimaryOperator / light tool surface)
 * can use to declare high-level continuous self-improvement goals, receive ready-to-fire
 * parallel delegation packets (extending capability-delegation patterns + DispatchContract),
 * trigger orchestration (plan + optional auto-spawn hooks), and aggregate results that flow
 * back via family shared knowledge and contracts.
 *
 * Everything is strictly additive and flag-gated in intent. This file is **not** imported
 * by any full-surface tool factory on this branch. It is designed to be pulled into
 * createLightOperatorTools (see operator-light-tools.ts foundation in the evolution plan).
 *
 * Leverages:
 * - operator-goal-primitives.ts (the real wf-2/wf-3 logic)
 * - capability-delegation.ts (framing, allowlists, outcome helpers)
 * - DispatchContract (via family dispatch_contracted packets the operator can issue)
 * - workflow_builder (for durable parallel goal workflows)
 * - family (for return path + knowledge aggregation)
 *
 * See the parent initiative docs and Daily Update for E2E usage examples.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, readStringArrayParam, readNumberParam } from "./common.js";
import {
  generateOperatorGoalId,
  decomposeOperatorSelfImprovementGoal,
  buildParallelDelegationPlanForGoal,
  aggregateGoalResultsFromArtifacts,
  GOAL_ORCHESTRATION_TOOL_ALLOWLIST,
  GOAL_ORCHESTRATION_TOOL_DENY,
  OPERATOR_GOAL_PRIMITIVES_VERSION,
  type OperatorSelfImprovementGoal,
  type GoalDecomposition,
  type ParallelDelegationPlan,
  type GoalResultAggregation,
} from "./operator-goal-primitives.js";

const OperatorGoalToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("declare"),
    Type.Literal("decompose"),
    Type.Literal("build_parallel_plan"),
    Type.Literal("get_delegation_packets"),
    Type.Literal("aggregate_results"),
    Type.Literal("help"),
    Type.Literal("list_active_goals"),
  ]),
  goal_description: Type.Optional(Type.String({ description: "High-level self-improvement goal text (required for declare/decompose)" })),
  goal_id: Type.Optional(Type.String({ description: "Existing goal id for follow-up actions" })),
  strategy: Type.Optional(Type.Union([Type.Literal("parallel_family"), Type.Literal("parallel_workflow_gates"), Type.Literal("hybrid")])),
  max_parallelism: Type.Optional(Type.Number({ description: "Cap on concurrent sub-tasks (default 5)" })),
  include_workflow_draft: Type.Optional(Type.Boolean({ description: "When building plan, also emit ready-to-use workflow_builder intent for durable parallel execution" })),
  contract_summaries: Type.Optional(Type.Array(Type.Object({ contractId: Type.String(), status: Type.String(), resultSummary: Type.Optional(Type.String()) }))),
  published_knowledge: Type.Optional(Type.Array(Type.Object({
    title: Type.String(),
    category: Type.String(),
    content: Type.String(),
    confidence: Type.Optional(Type.Number()),
    sourceAgentId: Type.Optional(Type.String()),
  }))),
  runId: Type.Optional(Type.String()),
});

export interface OperatorGoalToolContext {
  operatorAgentId?: string;
  spawnContext?: Record<string, unknown>;
}

export function createOperatorGoalTool(context: OperatorGoalToolContext = {}): AnyAgentTool {
  const operatorId = context.operatorAgentId ?? "argent";

  return {
    label: "Operator Goals (Self-Improvement Orchestration)",
    name: "operator_goal",
    description: `Primary-operator-only surface for declaring high-level continuous self-improvement goals and driving goal-driven parallel delegation to family agents (wf-2 + wf-3).

Core power:
- declare a long-horizon goal
- Receive an immediate, high-quality decomposition + ParallelDelegationPlan containing N ready-to-dispatch packets
- Optionally emit a workflow_builder intent that creates a durable PG-backed workflow using parallel gates
- Aggregation helper

All work produces DispatchContract provenance and automatic return via family publish/message. Results become first-class operator memory.

Everything 100% behind isPrimaryOperator / light tool surface. No effect on any other agent.`,

    parameters: OperatorGoalToolSchema,

    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const runId = readStringParam(params, "runId");

      try {
        switch (action) {
          case "help":
            return jsonResult({
              ok: true,
              action,
              version: OPERATOR_GOAL_PRIMITIVES_VERSION,
              guidance: "Use declare with a rich goal_description. Then build_parallel_plan (or get_delegation_packets). Fire the returned packets via your family tool using action=dispatch_contracted. Later call aggregate_results with summaries from contracts + family knowledge you searched. The plan also gives you a workflow_builder intent for durable variants.",
              allowlistExample: GOAL_ORCHESTRATION_TOOL_ALLOWLIST.slice(0, 8),
              denyExample: GOAL_ORCHESTRATION_TOOL_DENY,
            });

          case "declare": {
            const desc = readStringParam(params, "goal_description", { required: true });
            const goalId = generateOperatorGoalId(desc);
            const goal: OperatorSelfImprovementGoal = {
              goalId,
              description: desc,
              ownerAgentId: operatorId,
              createdAt: new Date().toISOString(),
              status: "declared",
              metadata: { source: "operator_goal_tool", version: OPERATOR_GOAL_PRIMITIVES_VERSION },
            };
            return jsonResult({
              ok: true,
              action,
              goal,
              next: "Call decompose or build_parallel_plan with this goal_id (or pass the description again).",
            });
          }

          case "decompose": {
            const desc = readStringParam(params, "goal_description") || readStringParam(params, "goal_id");
            if (!desc) throw new Error("goal_description or goal_id required");
            const strategy = (readStringParam(params, "strategy") as any) || "hybrid";
            const maxP = readNumberParam(params, "max_parallelism") ?? 5;
            const decomp = decomposeOperatorSelfImprovementGoal({ goalDescription: desc, preferredStrategy: strategy, maxParallelism: maxP });
            return jsonResult({ ok: true, action, decomposition: decomp });
          }

          case "build_parallel_plan": {
            const desc = readStringParam(params, "goal_description");
            const gid = readStringParam(params, "goal_id");
            if (!desc && !gid) throw new Error("goal_description or goal_id required for plan");

            const goal: OperatorSelfImprovementGoal = {
              goalId: gid || generateOperatorGoalId(desc!),
              description: desc || `Goal ${gid}`,
              ownerAgentId: operatorId,
              createdAt: new Date().toISOString(),
              status: "decomposed",
              metadata: {},
            };

            const includeWf = readStringParam(params, "include_workflow_draft") === "true" || params.include_workflow_draft === true;
            const decomp = decomposeOperatorSelfImprovementGoal({ goalDescription: goal.description });

            const plan: ParallelDelegationPlan = buildParallelDelegationPlanForGoal({
              goal,
              decomposition: decomp,
              includeWorkflowDraftIntent: includeWf,
            });

            return jsonResult({
              ok: true,
              action,
              goalId: goal.goalId,
              plan,
              usage: "Take plan.packets and for each call family with action=dispatch_contracted, task=packet.framedTask (or the dispatchContractParams), toolsAllow=..., toolsDeny=.... The workflow_builder intent (if present) can be fed directly to workflow_builder tool.",
              aggregationHint: plan.aggregationQueryHints,
            });
          }

          case "get_delegation_packets": {
            const desc = readStringParam(params, "goal_description") || readStringParam(params, "goal_id");
            if (!desc) throw new Error("goal_description or goal_id required");
            const goal: OperatorSelfImprovementGoal = {
              goalId: generateOperatorGoalId(desc),
              description: desc,
              ownerAgentId: operatorId,
              createdAt: new Date().toISOString(),
              status: "decomposed",
              metadata: {},
            };
            const decomp = decomposeOperatorSelfImprovementGoal({ goalDescription: desc });
            const plan = buildParallelDelegationPlanForGoal({ goal, decomposition: decomp });
            return jsonResult({
              ok: true,
              action,
              goalId: goal.goalId,
              packets: plan.packets,
              overallContract: plan.overallHandoffContract,
              recommendedWorkflowIntent: plan.recommendedWorkflowDraftIntent,
            });
          }

          case "aggregate_results": {
            const gid = readStringParam(params, "goal_id");
            if (!gid) throw new Error("goal_id required for aggregation");

            const contracts = params.contract_summaries as any[] || [];
            const knowledge = params.published_knowledge as any[] || [];

            const agg = aggregateGoalResultsFromArtifacts({ goalId: gid, contracts, publishedKnowledge: knowledge });
            return jsonResult({ ok: true, action, goalId: gid, aggregation: agg });
          }

          case "help":
            return jsonResult({
              ok: true,
              action,
              version: OPERATOR_GOAL_PRIMITIVES_VERSION,
              guidance: "Use declare with a rich goal_description. Then build_parallel_plan (or get_delegation_packets). Fire the returned packets via your family tool using action=dispatch_contracted. Later call aggregate_results with summaries from contracts + family knowledge you searched.",
            });

          case "list_active_goals":
            return jsonResult({
              ok: true,
              action,
              note: "Real implementation would query persisted GoalState or family knowledge tagged with goalId. For now use family.search or memory_recall with goal-related terms.",
            });

          default:
            throw new Error(`Unknown operator_goal action: ${action}`);
        }
      } catch (err: any) {
        return jsonResult({ ok: false, action, error: err?.message || String(err) });
      }
    },
  };
}
