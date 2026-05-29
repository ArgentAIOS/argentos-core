import { Type } from "@sinclair/typebox";
import { type AnyAgentTool, jsonResult, readStringArrayParam, readStringParam } from "./common.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";
import {
  buildWorkflowAuthoringDelegationTask,
  CAPABILITY_DELEGATION_TOOL_ALLOWLIST,
  CAPABILITY_DELEGATION_TOOL_DENY,
} from "./capability-delegation.js";
import { recordOperatorSelfExtensionAction } from "../../infra/agent-events.js";

const BASE_WORKFLOW_BUILDER_ACTIONS = ["draft", "save_draft"] as const;

/**
 * Expanded actions available exclusively when the tool is instantiated for the primary
 * operator (via createLightOperatorTools + forPrimaryOperator flag).
 * These turn "workflow_builder" into a first-class operator-owned authoring + versioning
 * + self-extension surface for durable workflows as continuous self-improvement artifacts.
 *
 * All new actions are behind the light operator tool surface only. Full surface agents
 * (non-primary) continue to see only the original minimal draft/save_draft surface.
 * No production call sites were modified; only the light surface creation site passes the flag.
 */
const OPERATOR_WORKFLOW_BUILDER_ACTIONS = [
  ...BASE_WORKFLOW_BUILDER_ACTIONS,
  "list",            // List operator-owned workflows (leverages workflows.list + ownerAgentId filter)
  "update",          // Edit / version bump an existing owned workflow (maps to workflows.update)
  "promote_pattern", // Treat a workflow as a reusable self-extension artifact: returns publish-ready payload + records operator provenance
  "delegate_build",  // Returns a ready-to-dispatch capability delegation packet (framedTask + tuned allow/deny) for parallel family authoring of self-improvement workflows. Uses DispatchContract + family publish/message return machinery.
  "help",            // Operator-facing usage for the full authoring + delegation surface
] as const;

const WorkflowBuilderToolSchema = Type.Object({
  action: Type.Union(
    [...BASE_WORKFLOW_BUILDER_ACTIONS, ...OPERATOR_WORKFLOW_BUILDER_ACTIONS].map((action) => Type.Literal(action)),
    {
      description:
        'Action to perform. Base: "draft" (produce reviewable graph), "save_draft". ' +
        'Operator-only (light surface): "list", "update" (edit/version), "promote_pattern" (self-extension artifact), "delegate_build" (parallel goal-driven delegation packet), "help".',
    },
  ),
  intent: Type.Optional(Type.String({
    description:
      "Operator intent for the workflow (required for draft/save_draft). Include trigger, agent work, tools/connectors, approval needs, and delivery target when known.",
  })),
  name: Type.Optional(Type.String({ description: "Optional workflow name." })),
  description: Type.Optional(Type.String({ description: "Optional workflow description." })),
  ownerAgentId: Type.Optional(Type.String({ description: "Agent that owns the workflow (strongly recommended for operator self-extension ownership)." })),
  preferredAgentId: Type.Optional(
    Type.String({ description: "Agent to place in the agent step." }),
  ),
  preferredAgentName: Type.Optional(
    Type.String({ description: "Display name for the agent step." }),
  ),
  triggerType: Type.Optional(
    Type.String({
      description:
        'Optional trigger override, e.g. "manual", "schedule", "webhook", "email_received", "appforge_event".',
    }),
  ),
  scheduleCron: Type.Optional(Type.String({ description: "Optional cron expression when triggerType is schedule." })),
  timezone: Type.Optional(Type.String({ description: "Optional schedule timezone." })),
  preferredTools: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Optional tool/capability names to bind to the agent step, such as connector tool IDs or promoted custom tools.",
    }),
  ),
  // For list / get / update / promote / delegate
  workflowId: Type.Optional(Type.String({ description: "Target workflow id for update, promote_pattern, or list scoping." })),
  limit: Type.Optional(Type.Number({ description: "Limit for list (default 20)." })),
  activeOnly: Type.Optional(Type.Boolean({ description: "Filter list to active workflows only." })),
  note: Type.Optional(Type.String({ description: "Operator note / goal context for promote_pattern or delegate_build." })),
  domainHints: Type.Optional(Type.Array(Type.String(), { description: "Hints for delegate_build (e.g. ['self-improvement', 'recurring', 'curator'])." })),

  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
});

type WorkflowBuilderAction = (typeof BASE_WORKFLOW_BUILDER_ACTIONS)[number] | (typeof OPERATOR_WORKFLOW_BUILDER_ACTIONS)[number];

export function createWorkflowBuilderTool(options?: {
  agentSessionKey?: string;
  /** When true (passed ONLY from operator-light-tools.ts for isPrimaryOperator path), exposes the full operator authoring + versioning + self-extension + delegation surface. Default false preserves exact original behavior for all other agents. */
  forPrimaryOperator?: boolean;
  /** Threading for operator self-extension audit events on promote_pattern etc. */
  runId?: string;
  /** The primary operator's agent id (for ownerAgentId defaults + provenance). */
  operatorAgentId?: string;
}): AnyAgentTool {
  const isPrimary = !!options?.forPrimaryOperator;
  const effectiveActions = isPrimary ? OPERATOR_WORKFLOW_BUILDER_ACTIONS : BASE_WORKFLOW_BUILDER_ACTIONS;

  return {
    label: "Workflow Builder",
    name: "workflow_builder",
    description: isPrimary
      ? "Primary operator surface for authoring, editing, versioning, and promoting durable workflows as self-extension artifacts. Supports goal-driven continuous self-improvement (recurring curator loops, lesson synthesis, parallel delegation orchestration). Use delegate_build to hand parallel authoring work to family via rich DispatchContract + publish return packets. All actions respect ownerAgentId for true operator ownership."
      : "Draft ArgentOS workflows from operator intent using the same canonical graph and canvas contract as the Operations workflow board. Use this before manually instructing the operator to drag nodes.",
    parameters: {
      ...WorkflowBuilderToolSchema,
      // The union above already includes the expanded literals when isPrimary (schema is permissive; runtime enforces via effectiveActions).
    } as any,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true }) as WorkflowBuilderAction;
      const gatewayOpts: GatewayCallOptions = {
        gatewayUrl: readStringParam(params, "gatewayUrl"),
        gatewayToken: readStringParam(params, "gatewayToken"),
        timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      };

      const effectiveOwner = readStringParam(params, "ownerAgentId") || options?.operatorAgentId || "argent";
      const runId = options?.runId;

      // Base actions (always available, unchanged behavior)
      if (action === "draft" || action === "save_draft") {
        const draftParams = {
          intent: readStringParam(params, "intent", { required: true }),
          name: readStringParam(params, "name"),
          description: readStringParam(params, "description"),
          ownerAgentId: effectiveOwner,
          preferredAgentId: readStringParam(params, "preferredAgentId"),
          preferredAgentName: readStringParam(params, "preferredAgentName"),
          triggerType: readStringParam(params, "triggerType"),
          scheduleCron: readStringParam(params, "scheduleCron"),
          timezone: readStringParam(params, "timezone"),
          preferredTools: readStringArrayParam(params, "preferredTools"),
          sessionKey: options?.agentSessionKey,
        };
        const draft = await callGatewayTool("workflows.draft", gatewayOpts, draftParams);

        if (action === "draft") {
          return jsonResult({
            ok: true,
            action,
            draft,
            nextStep:
              "Review the generated graph with the operator, then call workflow_builder with action=save_draft or use workflows.create directly when ready to add to the board. For operator self-extension ownership, pass explicit ownerAgentId.",
            ownerAgentId: effectiveOwner,
          });
        }

        const saved = await callGatewayTool("workflows.create", gatewayOpts, {
          name: draft.name,
          description: draft.description,
          ownerAgentId: effectiveOwner,
          nodes: draft.nodes,
          edges: draft.edges,
          canvasLayout: draft.canvasLayout,
          definition: draft.workflow,
          deploymentStage:
            typeof (draft.workflow as { deploymentStage?: unknown } | undefined)?.deploymentStage ===
            "string"
              ? (draft.workflow as { deploymentStage: string }).deploymentStage
              : undefined,
        });
        return jsonResult({
          ok: true,
          action,
          draft,
          saved,
          ownerAgentId: effectiveOwner,
        });
      }

      // === Operator-only expanded surface (strictly behind forPrimaryOperator in light tools) ===
      if (!isPrimary) {
        return jsonResult({ error: `Unknown action for this tool instance: ${action}. Operator-only actions require the primary operator light surface.` });
      }

      switch (action) {
        case "list": {
          const listParams = {
            ownerAgentId: effectiveOwner,
            limit: typeof params.limit === "number" ? params.limit : 20,
            activeOnly: typeof params.activeOnly === "boolean" ? params.activeOnly : true,
            snapshot: undefined, // prefer live PG-backed list when available
          };
          const listed = await callGatewayTool("workflows.list", gatewayOpts, listParams);
          return jsonResult({
            ok: true,
            action,
            ownerAgentId: effectiveOwner,
            workflows: listed,
            guidance: "These are your owned workflows (self-extension artifacts). Use update to edit/version, promote_pattern to publish as reusable pattern, or delegate_build for parallel family work.",
          });
        }

        case "update": {
          const workflowId = readStringParam(params, "workflowId") || readStringParam(params, "id");
          if (!workflowId) {
            return jsonResult({ error: "workflowId (or id) required for update (edit/version) action." });
          }
          const updatePayload: Record<string, unknown> = {
            workflowId,
            ownerAgentId: effectiveOwner,
            name: readStringParam(params, "name"),
            description: readStringParam(params, "description"),
            triggerType: readStringParam(params, "triggerType"),
            scheduleCron: readStringParam(params, "scheduleCron"),
            timezone: readStringParam(params, "timezone"),
            // Pass through graph if caller supplies nodes/edges/definition for true edit/version bump
            ...(params.nodes ? { nodes: params.nodes } : {}),
            ...(params.edges ? { edges: params.edges } : {}),
            ...(params.definition ? { definition: params.definition } : {}),
            ...(params.canvasLayout ? { canvasLayout: params.canvasLayout } : {}),
          };
          const updated = await callGatewayTool("workflows.update", gatewayOpts, updatePayload);
          return jsonResult({
            ok: true,
            action,
            workflowId,
            ownerAgentId: effectiveOwner,
            updated,
            note: "Update creates a new versioned revision in the durable store. This is the primary mechanism for operator-owned workflow evolution as self-extension artifacts.",
          });
        }

        case "promote_pattern": {
          const workflowId = readStringParam(params, "workflowId") || readStringParam(params, "id");
          const note = readStringParam(params, "note") || "Operator-promoted as reusable self-improvement pattern.";
          // Return a ready-to-publish payload the operator can feed to family.publish (or curator can consume).
          // This treats the workflow as a first-class self-extension artifact alongside Personal Skills.
          const publishPayload = {
            title: `Workflow self-extension artifact: ${workflowId || "draft"}`,
            content: JSON.stringify({
              workflowId,
              ownerAgentId: effectiveOwner,
              promotedAt: new Date().toISOString(),
              note,
              source: "operator.workflow_builder.promote_pattern",
              usage: "Durable recurring self-improvement automation owned by primary operator. Can be referenced from curator loops, goal-runners, or family delegations.",
            }, null, 2),
            category: "pattern",
            confidence: 0.85,
            source_agent_id: effectiveOwner,
          };

          if (runId) {
            try {
              recordOperatorSelfExtensionAction(runId, "workflow", "promote_pattern", { workflowId, note });
            } catch {
              // best-effort only
            }
          }

          return jsonResult({
            ok: true,
            action,
            workflowId,
            ownerAgentId: effectiveOwner,
            publishReady: publishPayload,
            nextStep: "Feed the publishReady object to family.publish (action=publish) for durable family/MemU visibility as a reusable self-extension pattern. This completes the operator-owned workflow-as-artifact loop.",
            guidance: "Workflows promoted this way become first-class continuous self-improvement assets (recurring goal judges, curator delegation targets, parallel orchestration).",
          });
        }

        case "delegate_build": {
          const goal = readStringParam(params, "intent") || readStringParam(params, "note") || "Author a durable self-improvement workflow owned by the primary operator for continuous capability growth (e.g. recurring curator review + lesson synthesis + workflow versioning).";
          const domainHints = readStringArrayParam(params, "domainHints") || ["workflow", "self-improvement", "recurring", "goal-driven"];
          const packet = buildWorkflowAuthoringDelegationTask({
            goal,
            context: readStringParam(params, "note"),
            targetOwnerAgentId: effectiveOwner,
            expectedDeliverables: "Complete workflow draft or saved workflow (with ownerAgentId), published family knowledge entry (category pattern/workflow), family message handoff, and CAPABILITY_DELEGATION_RESULT block. Use DispatchContract via dispatch_contracted for full audit trail.",
            requesterAgentId: effectiveOwner,
          });

          return jsonResult({
            ok: true,
            action,
            ownerAgentId: effectiveOwner,
            delegationPacket: {
              framedTask: packet.framedTask,
              recommendedToolsAllow: [...CAPABILITY_DELEGATION_TOOL_ALLOWLIST, "workflow_builder"],
              recommendedToolsDeny: CAPABILITY_DELEGATION_TOOL_DENY,
              suggestedPurpose: "workflow_authoring",
              handoffExpectations: packet.handoffExpectations,
              metadata: {
                ...packet.metadata,
                domainHints,
                targetOwnerAgentId: effectiveOwner,
              },
            },
            usage: "Pass delegationPacket.framedTask + .recommendedToolsAllow / .recommendedToolsDeny directly to family action=dispatch_contracted (or dispatch). The delegated family member will use its (restricted) workflow_builder + family publish/message to return the authored workflow artifact. Full provenance via DispatchContract + operator publish return.",
            guidance: "This is the key primitive for goal-driven *parallel* delegation of workflow authoring as part of operator-owned continuous self-improvement.",
          });
        }

        case "help":
        default: {
          return jsonResult({
            ok: true,
            action,
            operatorSurface: true,
            usage: {
              overview: "workflow_builder on the primary operator light surface is your direct ownership layer for creating, versioning, and promoting workflows as durable self-extension artifacts (continuous self-improvement engine).",
              base: ["draft", "save_draft — identical to full surface; always pass ownerAgentId for true ownership."],
              extended: [
                "list — your owned workflows (activeOnly + owner filter). Foundation for review/versioning.",
                "update — edit an existing owned workflow (triggers version bump in store). Primary evolution mechanism.",
                "promote_pattern — package a workflow as reusable 'pattern' knowledge. Records operator self-extension event. Returns ready-to-publish payload for family.publish.",
                "delegate_build — produces rich packet (framedTask + safe allow/deny including workflow_builder) for family.dispatch_contracted. Enables parallel goal-driven workflow authoring by family while you retain ownership + audit via contracts + publish return.",
              ],
              selfExtensionLoop: "goal (standing) → workflow_builder.list/update or delegate_build (parallel family) → curator review of resulting artifacts → promote_pattern (or personal_skill linkage) → measurable operator provenance.",
              delegation: "Always combine with family tool (publish + message + dispatch_contracted) and the packets from capability-delegation.ts for safe, auditable, returning handoffs.",
            },
            constraints: "Expanded surface only visible to primary operator (isPrimaryOperator + operator_fast profile + createLightOperatorTools).",
          });
        }
      }
    },
  };
}
