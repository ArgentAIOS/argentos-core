import type {
  CanvasWorkflowEdge,
  CanvasWorkflowNode,
  WorkflowIssue,
} from "./workflow-normalize.js";
import { normalizeWorkflow, type WorkflowNormalizationResult } from "./workflow-normalize.js";

export type WorkflowBuilderCapability = {
  name: string;
  label?: string;
  description?: string;
  source?: "core" | "plugin" | "connector" | "skill" | "promoted-cli" | "appforge";
  appId?: string;
  appName?: string;
  capabilityId?: string;
  capabilityType?: string;
  sideEffect?: string;
  eventTypes?: string[];
};

export interface WorkflowDraftRequest {
  id?: string;
  name?: string;
  description?: string;
  intent: string;
  ownerAgentId?: string;
  preferredAgentId?: string;
  preferredAgentName?: string;
  triggerType?: string;
  scheduleCron?: string;
  timezone?: string;
  preferredTools?: string[];
  capabilities?: WorkflowBuilderCapability[];
}

export interface WorkflowDraftResult extends WorkflowNormalizationResult {
  name: string;
  description: string;
  nodes: CanvasWorkflowNode[];
  edges: CanvasWorkflowEdge[];
  reviewNotes: string[];
  assumptions: string[];
}

function cleanId(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || "workflow";
}

function titleFromIntent(intent: string): string {
  const first = intent
    .split(/[.!?\n]/)[0]
    .replace(/\b(workflow|automation|please|build|create|make|set up)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!first) {
    return "New Workflow";
  }
  return first
    .split(" ")
    .slice(0, 8)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function inferTriggerType(intent: string, explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  const text = intent.toLowerCase();
  if (/\b(every|daily|weekly|monthly|morning|afternoon|evening|schedule|cron)\b/.test(text)) {
    return "schedule";
  }
  if (/\b(webhook|form submitted|new signup|lead form|typeform|tally)\b/.test(text)) {
    return "webhook";
  }
  if (
    /\b(appforge|app forge|review app|art table)\b/.test(text) &&
    /\b(event|record|review|updated|completed|approved|submitted|when)\b/.test(text)
  ) {
    return "appforge_event";
  }
  if (/\b(email received|incoming email|vip email|inbox)\b/.test(text)) {
    return "email_received";
  }
  if (/\b(slack|telegram|discord|message received|channel)\b/.test(text)) {
    return "channel_message";
  }
  return "manual";
}

function inferAction(intent: string): {
  actionType?: "send_email" | "send_message" | "create_task";
  outputTarget: "doc_panel" | "email" | "discord" | "webhook" | "variable";
  requiresApproval: boolean;
  label: string;
} {
  const text = intent.toLowerCase();
  if (/\b(email|newsletter|sendgrid|mailchimp)\b/.test(text)) {
    return {
      actionType: "send_email",
      outputTarget: "email",
      requiresApproval: true,
      label: "Send Email",
    };
  }
  if (/\b(post|publish|social|telegram|slack|discord|sms|message)\b/.test(text)) {
    return {
      actionType: "send_message",
      outputTarget: "discord",
      requiresApproval: true,
      label: "Send Message",
    };
  }
  if (/\b(task|ticket|linear|todo|follow up)\b/.test(text)) {
    return {
      actionType: "create_task",
      outputTarget: "doc_panel",
      requiresApproval: true,
      label: "Create Task",
    };
  }
  return {
    outputTarget: "doc_panel",
    requiresApproval: false,
    label: "Save Result",
  };
}

function cronFromIntent(intent: string, explicit?: string): string {
  if (explicit?.trim()) {
    return explicit.trim();
  }
  const text = intent.toLowerCase();
  if (/\bweekly\b/.test(text)) {
    return "0 9 * * MON";
  }
  if (/\bmonthly\b/.test(text)) {
    return "0 9 1 * *";
  }
  if (/\b(evening|night)\b/.test(text)) {
    return "0 17 * * *";
  }
  return "0 9 * * *";
}

function findCapability(
  capabilities: WorkflowBuilderCapability[] | undefined,
  toolName: string,
): WorkflowBuilderCapability | undefined {
  return capabilities?.find((capability) => capability.name === toolName);
}

function selectedTools(input: WorkflowDraftRequest): WorkflowBuilderCapability[] {
  const requested = (input.preferredTools ?? []).map((tool) => tool.trim()).filter(Boolean);
  return requested.map((tool) => findCapability(input.capabilities, tool) ?? { name: tool });
}

function hasAppForgeReview(intent: string, tools: WorkflowBuilderCapability[]): boolean {
  const text = intent.toLowerCase();
  return (
    tools.some(
      (tool) =>
        tool.source === "appforge" &&
        (tool.capabilityType === "human_review" || tool.sideEffect === "operator_interaction"),
    ) || /\b(appforge|app forge|review table|art table|review app|approval app)\b/.test(text)
  );
}

function makeEdge(source: string, target: string, sourceHandle?: string, targetHandle?: string) {
  return {
    id: `${source}-${target}${sourceHandle ? `-${sourceHandle}` : ""}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
    ...(targetHandle ? { targetHandle } : {}),
  };
}

function appendValidationNotes(issues: WorkflowIssue[], notes: string[]) {
  for (const issue of issues) {
    if (issue.severity === "error") {
      notes.push(`Fix before running: ${issue.message}`);
    }
  }
}

export function draftWorkflowFromIntent(input: WorkflowDraftRequest): WorkflowDraftResult {
  const intent = input.intent.trim();
  if (!intent) {
    throw new Error("intent is required");
  }
  const name = input.name?.trim() || titleFromIntent(intent);
  const description = input.description?.trim() || intent;
  const workflowId = input.id?.trim() || `wf-draft-${cleanId(name)}`;
  const triggerType = inferTriggerType(intent, input.triggerType);
  const action = inferAction(intent);
  const tools = selectedTools(input);
  const appForgeReview = hasAppForgeReview(intent, tools);
  const appForgeEventCapability = tools.find(
    (tool) => tool.source === "appforge" && (tool.eventTypes?.length ?? 0) > 0,
  );
  const reviewNotes: string[] = [];
  const assumptions: string[] = [];

  assumptions.push(`Trigger inferred as ${triggerType}.`);
  assumptions.push(
    action.requiresApproval
      ? "Outbound or mutating work is gated by operator approval."
      : "Draft keeps the first output read-only in DocPanel.",
  );
  if (appForgeReview) {
    assumptions.push("AppForge is used as an operator review surface before delivery.");
  }
  if (triggerType === "appforge_event") {
    assumptions.push(
      "AppForge events start this workflow through the local workflow event bridge.",
    );
  }

  const triggerId = "trigger";
  const agentId = "agent-draft";
  const approvalId = "approval";
  const actionId = "action-deliver";
  const outputId = "output";

  const nodes: CanvasWorkflowNode[] = [
    {
      id: triggerId,
      type: "trigger",
      position: { x: 120, y: 120 },
      data: {
        label: "Trigger",
        triggerType,
        cronExpression:
          triggerType === "schedule" ? cronFromIntent(intent, input.scheduleCron) : "",
        timezone: input.timezone ?? "America/Chicago",
        appId: triggerType === "appforge_event" ? appForgeEventCapability?.appId : undefined,
        capabilityId:
          triggerType === "appforge_event" ? appForgeEventCapability?.capabilityId : undefined,
        eventType:
          triggerType === "appforge_event" ? appForgeEventCapability?.eventTypes?.[0] : undefined,
      },
    },
    {
      id: agentId,
      type: "agentStep",
      position: { x: 120, y: 300 },
      data: {
        label: "Agent Step",
        agentId: input.preferredAgentId ?? input.ownerAgentId ?? "argent",
        agentName:
          input.preferredAgentName ?? input.preferredAgentId ?? input.ownerAgentId ?? "Argent",
        agentColor: "hsl(var(--primary))",
        rolePrompt: [
          `Intent: ${intent}`,
          "Use the trigger payload and available workflow bindings to produce the next artifact.",
          "Keep evidence and operator-review notes in the output.",
        ].join("\n"),
        timeout: 120,
        evidenceRequired: true,
        toolsAllow: tools.map((tool) => tool.name),
      },
    },
  ];

  const edges: CanvasWorkflowEdge[] = [makeEdge(triggerId, agentId)];

  tools.forEach((tool, index) => {
    const toolNodeId = `tool-${cleanId(tool.name || `tool-${index}`)}`;
    nodes.push({
      id: toolNodeId,
      type: "toolGrant",
      position: { x: 470, y: 250 + index * 90 },
      data: {
        subPortType: "tool_grant",
        label: tool.label ?? tool.name,
        config: {
          grantType:
            tool.source === "connector"
              ? "connector"
              : tool.source === "appforge"
                ? "appforge_app"
                : "builtin_tool",
          toolName: tool.source === "connector" ? undefined : tool.name,
          connectorId: tool.source === "connector" ? tool.name : undefined,
          appId: tool.source === "appforge" ? tool.appId : undefined,
          appName: tool.source === "appforge" ? tool.appName : undefined,
          appCapabilityId: tool.source === "appforge" ? tool.capabilityId : undefined,
          appCapabilityType: tool.source === "appforge" ? tool.capabilityType : undefined,
          capabilityId: tool.name,
          name: tool.label ?? tool.name,
          source: tool.source,
          permissions: action.requiresApproval ? "readwrite" : "readonly",
        },
      },
    });
    edges.push(makeEdge(toolNodeId, agentId, undefined, "tools"));
  });

  let previousId = agentId;
  if (appForgeReview) {
    const appForgeTool =
      tools.find((tool) => tool.source === "appforge") ??
      ({
        name: "appforge:review",
        label: "AppForge Review",
        source: "appforge" as const,
      } satisfies WorkflowBuilderCapability);
    const appReviewId = "appforge-review";
    nodes.push({
      id: appReviewId,
      type: "gate",
      position: { x: 120, y: 500 },
      data: {
        label: appForgeTool.label ?? "AppForge Review",
        gateType: "approval",
        conditionField: "decision",
        conditionOperator: "equals",
        conditionValue: "approved",
        branchCount: 1,
        maxIterations: 1,
        durationMs: 0,
        approvalMessage: `Review ${name} in ${appForgeTool.appName ?? "AppForge"} before delivery.`,
        showPreviousOutput: true,
        timeoutMinutes: 240,
        timeoutAction: "deny",
        reviewSurface: "appforge",
        appCapabilityId: appForgeTool.capabilityId,
        appCapabilityName: appForgeTool.name,
        appId: appForgeTool.appId,
      },
    });
    edges.push(makeEdge(previousId, appReviewId, "output"));
    previousId = appReviewId;
  }

  if (action.requiresApproval) {
    nodes.push({
      id: approvalId,
      type: "gate",
      position: { x: 120, y: appForgeReview ? 680 : 500 },
      data: {
        label: "Approval",
        gateType: "approval",
        conditionField: "text",
        conditionOperator: "contains",
        conditionValue: "",
        branchCount: 1,
        maxIterations: 3,
        durationMs: 0,
        approvalMessage: `Approve ${action.label.toLowerCase()} for ${name}?`,
        showPreviousOutput: true,
        timeoutMinutes: 60,
        timeoutAction: "deny",
      },
    });
    edges.push(makeEdge(previousId, approvalId, "output"));
    previousId = approvalId;
  }

  if (action.actionType) {
    nodes.push({
      id: actionId,
      type: "action",
      position: {
        x: 120,
        y: appForgeReview
          ? action.requiresApproval
            ? 860
            : 680
          : action.requiresApproval
            ? 680
            : 500,
      },
      data: {
        label: action.label,
        actionType: action.actionType,
        timeoutMs: 120000,
        config:
          action.actionType === "send_email"
            ? {
                to: "",
                subject: `${name} - approval required`,
                bodyTemplate: "{{previous.text}}",
              }
            : action.actionType === "create_task"
              ? { title: name, priority: 2 }
              : {
                  channelType: "telegram",
                  channelId: "",
                  template: "{{previous.text}}",
                },
      },
    });
    edges.push(makeEdge(previousId, actionId));
    previousId = actionId;
  }

  nodes.push({
    id: outputId,
    type: "output",
    position: {
      x: 120,
      y: appForgeReview
        ? action.actionType
          ? action.requiresApproval
            ? 1040
            : 860
          : 680
        : action.actionType
          ? action.requiresApproval
            ? 860
            : 680
          : 500,
    },
    data: {
      label: "Output",
      target: action.actionType ? "doc_panel" : action.outputTarget,
      format: "markdown",
    },
  });
  edges.push(makeEdge(previousId, outputId));

  const normalized = normalizeWorkflow({
    id: workflowId,
    name,
    description,
    nodes,
    edges,
    canvasLayout: { nodes, edges },
    deploymentStage: "simulate",
  });
  appendValidationNotes(normalized.issues, reviewNotes);
  if (tools.length === 0) {
    reviewNotes.push("No explicit tools were selected; the agent step will use its default tools.");
  }

  return {
    ...normalized,
    name,
    description,
    nodes,
    edges,
    reviewNotes,
    assumptions,
  };
}
