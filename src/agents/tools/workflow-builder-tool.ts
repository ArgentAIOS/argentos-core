import { Type } from "@sinclair/typebox";
import { type AnyAgentTool, jsonResult, readStringArrayParam, readStringParam } from "./common.js";
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
      "Draft ArgentOS workflows from operator intent using the same canonical graph and canvas contract as the Operations workflow board. Use this before manually instructing the operator to drag nodes.",
    parameters: WorkflowBuilderToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true }) as WorkflowBuilderAction;
      const gatewayOpts: GatewayCallOptions = {
        gatewayUrl: readStringParam(params, "gatewayUrl"),
        gatewayToken: readStringParam(params, "gatewayToken"),
        timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      };
      const draftParams = {
        intent: readStringParam(params, "intent", { required: true }),
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
      };
      const draft = await callGatewayTool("workflows.draft", gatewayOpts, draftParams);

      if (action === "draft") {
        return jsonResult({
          ok: true,
          action,
          draft,
          nextStep:
            "Review the generated graph with the operator, then call workflow_builder.save_draft or workflows.create when they want it added to the board.",
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
