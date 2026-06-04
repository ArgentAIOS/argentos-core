import { Type } from "@sinclair/typebox";
import {
  type AnyAgentTool,
  isPrimaryOperator,
  jsonResult,
  readStringArrayParam,
  readStringParam,
} from "./common.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";

const WORKFLOW_BUILDER_ACTIONS = ["draft", "save_draft"] as const;

const WorkflowBuilderToolSchema = Type.Object({
  action: Type.Union(
    WORKFLOW_BUILDER_ACTIONS.map((action) => Type.Literal(action)),
    {
      description:
        'Action to perform. Use "draft" to produce a reviewable workflow graph, "save_draft" only when the operator asked you to create it in the workflow board.',
    },
  ),
  intent: Type.String({
    description:
      "Operator intent for the workflow. Include trigger, agent work, tools/connectors, approval needs, and delivery target when known.",
  }),
  name: Type.Optional(Type.String({ description: "Optional workflow name." })),
  description: Type.Optional(Type.String({ description: "Optional workflow description." })),
  ownerAgentId: Type.Optional(Type.String({ description: "Agent that owns the workflow." })),
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
  scheduleCron: Type.Optional(
    Type.String({ description: "Optional cron expression when triggerType is schedule." }),
  ),
  timezone: Type.Optional(Type.String({ description: "Optional schedule timezone." })),
  preferredTools: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Optional tool/capability names to bind to the agent step, such as connector tool IDs or promoted custom tools.",
    }),
  ),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
});

type WorkflowBuilderAction = (typeof WORKFLOW_BUILDER_ACTIONS)[number];

export function createWorkflowBuilderTool(options?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Workflow Builder",
    name: "workflow_builder",
    description:
      "Draft ArgentOS workflows from operator intent using the same canonical graph and canvas contract as the Operations workflow board. Use this before manually instructing the operator to drag nodes. Recognizes 'build for me', delegation, handoff, supervisor contract, and parallel goals; emits family.dispatch_contracted steps (gated to primary operator via isPrimaryOperator for self-extension power).",
    parameters: WorkflowBuilderToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true }) as WorkflowBuilderAction;
      const gatewayOpts: GatewayCallOptions = {
        gatewayUrl: readStringParam(params, "gatewayUrl"),
        gatewayToken: readStringParam(params, "gatewayToken"),
        timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      };
      const rawIntent = readStringParam(params, "intent", { required: true });
      const lowerIntent = rawIntent.toLowerCase();

      // Light operator tooling polish (Phases 4+5): detect delegation / "build for me" / handoff / parallel goals
      // and inject orchestration hints so the goal engine can emit dispatch_contracted supervisor steps.
      const delegationHints = {
        wantsBuildForMe: /\b(build for me|build-for-me|delegate.*me|supervisor handoff)\b/.test(lowerIntent),
        wantsHandoffContract: /\b(handoff|dispatch.contracted|contracted dispatch|supervisor contract)\b/.test(lowerIntent),
        wantsParallel: /\b(parallel|concurrent|multiple.*agent|split.*task|3 sub|five sub|wf-5)\b/.test(lowerIntent),
        isPrimaryContext: isPrimaryOperator(),
      };

      const augmentedIntent = delegationHints.wantsBuildForMe || delegationHints.wantsHandoffContract || delegationHints.wantsParallel
        ? `${rawIntent}\n\n[Delegation Orchestration Hint - primary=${delegationHints.isPrimaryContext}]: Prefer family.dispatch_contracted for 'build for me' growth work (with skillsRequired + promotePattern when appropriate). Support parallel sub-goal splits via multiple contracted dispatches. Gate advanced self-extension to primary operator.`
        : rawIntent;

      const draftParams = {
        intent: augmentedIntent,
        name: readStringParam(params, "name"),
        description: readStringParam(params, "description"),
        ownerAgentId: readStringParam(params, "ownerAgentId"),
        preferredAgentId: readStringParam(params, "preferredAgentId"),
        preferredAgentName: readStringParam(params, "preferredAgentName"),
        triggerType: readStringParam(params, "triggerType"),
        scheduleCron: readStringParam(params, "scheduleCron"),
        timezone: readStringParam(params, "timezone"),
        preferredTools: readStringArrayParam(params, "preferredTools"),
        sessionKey: options?.agentSessionKey,
        // Pass hints downstream for goal-orchestration engine (wf authoring surface)
        _delegationHints: delegationHints,
      };
      const draft = await callGatewayTool("workflows.draft", gatewayOpts, draftParams);

      if (action === "draft") {
        return jsonResult({
          ok: true,
          action,
          draft,
          delegationHints: delegationHints,
          nextStep:
            "Review the generated graph with the operator (note delegation hints for dispatch_contracted 'build for me' steps if present). Then call workflow_builder.save_draft or workflows.create when they want it added to the board. Primary operator can use promotePattern on resulting contracts for growth pattern capture.",
        });
      }

      const saved = await callGatewayTool("workflows.create", gatewayOpts, {
        name: draft.name,
        description: draft.description,
        ownerAgentId: draftParams.ownerAgentId,
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
      });
    },
  };
}
