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

type ScoutLane = {
  id: string;
  label: string;
  focus: string;
  toolsAllow: string[];
};

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

function wantsVisibleScoutLanes(intent: string): boolean {
  const text = intent.toLowerCase();
  return (
    /\b(scout|scouts|lane|lanes|sub-agent|sub-agents|subagent|subagents|research agent|research agents)\b/.test(
      text,
    ) &&
    /\b(github|open[- ]source|frontier|thought[- ]leader|infrastructure|papers|models|ai)\b/.test(
      text,
    )
  );
}

function defaultScoutLanes(intent: string, toolNames: string[]): ScoutLane[] {
  const text = intent.toLowerCase();
  const webTools = toolNames.filter((tool) => /web|search|fetch|github|hugging|paper/i.test(tool));
  const sharedTools = webTools.length ? webTools : toolNames;
  const lanes: ScoutLane[] = [];

  if (/\b(github|repo|repos|open[- ]source|oss|project|projects)\b/.test(text)) {
    lanes.push({
      id: "scout-github-open-source",
      label: "GitHub / Open Source Scout",
      focus:
        "Find trending GitHub and open-source AI projects. Return source URLs, recent activity, why it matters, and include/skip recommendation.",
      toolsAllow: sharedTools,
    });
  }
  if (
    /\b(frontier|openai|anthropic|deepmind|meta|mistral|xai|model|models|lab|labs)\b/.test(text)
  ) {
    lanes.push({
      id: "scout-frontier-ai",
      label: "Frontier AI Scout",
      focus:
        "Find important frontier AI lab, model, infrastructure, and platform moves. Prefer official sources and clearly label rumors.",
      toolsAllow: sharedTools,
    });
  }
  if (
    /\b(thought[- ]leader|thinker|infrastructure|agent|memory|workflow|eval|benchmark|economics)\b/.test(
      text,
    )
  ) {
    lanes.push({
      id: "scout-thought-leader-infrastructure",
      label: "Thought Leader / Infrastructure Scout",
      focus:
        "Find forward-thinker, agent infrastructure, memory, workflow reliability, eval, and model economics signals relevant to ArgentOS.",
      toolsAllow: sharedTools,
    });
  }

  if (lanes.length >= 2) {
    return lanes;
  }

  return [
    {
      id: "scout-github-open-source",
      label: "GitHub / Open Source Scout",
      focus:
        "Find trending GitHub and open-source AI projects. Return source URLs, recent activity, why it matters, and include/skip recommendation.",
      toolsAllow: sharedTools,
    },
    {
      id: "scout-frontier-ai",
      label: "Frontier AI Scout",
      focus:
        "Find important frontier AI lab, model, infrastructure, and platform moves. Prefer official sources and clearly label rumors.",
      toolsAllow: sharedTools,
    },
    {
      id: "scout-thought-leader-infrastructure",
      label: "Thought Leader / Infrastructure Scout",
      focus:
        "Find forward-thinker, agent infrastructure, memory, workflow reliability, eval, and model economics signals relevant to ArgentOS.",
      toolsAllow: sharedTools,
    },
  ];
}

function draftVisibleScoutWorkflow(input: {
  intent: string;
  name: string;
  description: string;
  workflowId: string;
  ownerAgentId: string;
  ownerAgentName: string;
  triggerType: string;
  scheduleCron?: string;
  timezone?: string;
  tools: WorkflowBuilderCapability[];
  assumptions: string[];
  reviewNotes: string[];
}): WorkflowDraftResult {
  const toolNames = input.tools.map((tool) => tool.name);
  const lanes = defaultScoutLanes(input.intent, toolNames);
  const requestedPodcast = /\b(podcast|audio|elevenlabs|voice)\b/i.test(input.intent);
  const requestedDelivery = /\b(deliver|send|phone|commute|telegram|status)\b/i.test(input.intent);
  const nodes: CanvasWorkflowNode[] = [
    {
      id: "trigger",
      type: "trigger",
      position: { x: 460, y: 80 },
      data: {
        label: "Trigger",
        triggerType: input.triggerType,
        cronExpression:
          input.triggerType === "schedule" ? cronFromIntent(input.intent, input.scheduleCron) : "",
        timezone: input.timezone ?? "America/Chicago",
      },
    },
  ];
  const edges: CanvasWorkflowEdge[] = [];
  const laneStartX = 80;
  const laneGapX = 380;

  lanes.forEach((lane, index) => {
    nodes.push({
      id: lane.id,
      type: "agentStep",
      position: { x: laneStartX + index * laneGapX, y: 260 },
      data: {
        label: lane.label,
        agentId: input.ownerAgentId,
        agentName: lane.label,
        agentColor: "hsl(var(--primary))",
        rolePrompt: [
          `Lane: ${lane.label}`,
          `Focus: ${lane.focus}`,
          "Return 3-5 candidates with clickable URLs, source timestamps, confidence, why Jason should care, and include/skip recommendation.",
          `Overall workflow intent: ${input.intent}`,
        ].join("\n"),
        timeout: 180,
        evidenceRequired: true,
        toolsAllow: lane.toolsAllow,
      },
    });
    edges.push(makeEdge("trigger", lane.id));
    edges.push(makeEdge(lane.id, "research-join"));
  });

  nodes.push(
    {
      id: "research-join",
      type: "gate",
      position: { x: 460, y: 460 },
      data: {
        label: "Research Join",
        gateType: "join",
        conditionField: "",
        conditionOperator: "equals",
        conditionValue: "",
        branchCount: lanes.length,
        maxIterations: 1,
        durationMs: 0,
      },
    },
    {
      id: "synthesis-agent",
      type: "agentStep",
      position: { x: 460, y: 620 },
      data: {
        label: "Synthesis Agent",
        agentId: input.ownerAgentId,
        agentName: `${input.ownerAgentName} Synthesis`,
        agentColor: "hsl(var(--primary))",
        rolePrompt: [
          "Synthesize the scout outputs into a cited AI Morning Brief.",
          "Select 5-7 total stories, one deep dive, one project Jason should inspect, and one ArgentOS implication section.",
          "Keep source links clickable and preserve why-it-matters notes.",
        ].join("\n"),
        timeout: 180,
        evidenceRequired: true,
        toolsAllow: toolNames.filter((tool) => /doc|panel|memory|web|fetch|search/i.test(tool)),
      },
    },
  );
  edges.push(makeEdge("research-join", "synthesis-agent"));

  let previousId = "synthesis-agent";
  nodes.push({
    id: "brief-output",
    type: "output",
    position: { x: 460, y: 800 },
    data: {
      label: "DocPanel Brief",
      target: "docpanel",
      title: input.name,
      format: "markdown",
      sourceMode: "previous",
    },
  });
  edges.push(makeEdge(previousId, "brief-output"));
  previousId = "brief-output";

  if (requestedPodcast) {
    nodes.push(
      {
        id: "podcast-script-agent",
        type: "agentStep",
        position: { x: 460, y: 980 },
        data: {
          label: "Podcast Script Agent",
          agentId: input.ownerAgentId,
          agentName: `${input.ownerAgentName} Podcast Script`,
          agentColor: "hsl(var(--primary))",
          rolePrompt: [
            "Turn the cited AI Morning Brief into a concise podcast script.",
            "Use SPEAKER: text lines so podcast_plan can parse it.",
            "Speaker should be ARGENT unless the operator adds more personas.",
            "Use ElevenLabs v3 performance tags such as [warm], [curious], [beat], [thoughtful], and [dramatic pause].",
            "Preserve links and source titles in the written notes, but keep spoken lines natural.",
          ].join("\n"),
          timeout: 180,
          evidenceRequired: true,
          toolsAllow: [],
        },
      },
      {
        id: "podcast-plan",
        type: "action",
        position: { x: 460, y: 1160 },
        data: {
          label: "Podcast Plan",
          actionType: "podcast_plan",
          timeoutMs: 120000,
          config: {
            title: input.name,
            script: "{{previous.text}}",
            personas: [
              {
                id: "argent",
                aliases: ["ARGENT", "HOST"],
                voice_id: "21m00Tcm4TlvDq8ikWAM",
              },
            ],
            timezone: input.timezone ?? "America/Chicago",
            publish_time_local: "08:00",
            publish: { spotify: false, youtube: false, heygen: false },
          },
        },
      },
      {
        id: "podcast-generate",
        type: "action",
        position: { x: 460, y: 1340 },
        data: {
          label: "Podcast Generate",
          actionType: "podcast_generate",
          timeoutMs: 300000,
          config: {
            title: input.name,
            payloadTemplate: "{{previous.json.podcast_generate}}",
          },
        },
      },
    );
    edges.push(makeEdge(previousId, "podcast-script-agent"));
    edges.push(makeEdge("podcast-script-agent", "podcast-plan"));
    edges.push(makeEdge("podcast-plan", "podcast-generate"));
    previousId = "podcast-generate";
  }

  if (requestedDelivery) {
    nodes.push({
      id: "delivery-status",
      type: "action",
      position: { x: 460, y: requestedPodcast ? 1520 : 980 },
      data: {
        label: "Delivery Status",
        actionType: "send_message",
        timeoutMs: 120000,
        config: {
          channelType: "telegram",
          channelId: "",
          template: requestedPodcast
            ? "AI Morning Brief podcast audio is ready: {{previous.json.path}}"
            : "{{previous.text}}",
          ...(requestedPodcast ? { mediaTemplate: "{{previous.json.path}}" } : {}),
        },
      },
    });
    edges.push(makeEdge(previousId, "delivery-status"));
    previousId = "delivery-status";
  }

  nodes.push({
    id: "run-ledger",
    type: "output",
    position: { x: 460, y: requestedPodcast && requestedDelivery ? 1700 : 1160 },
    data: {
      label: "Run Ledger",
      target: "docpanel",
      title: `${input.name} — Run Ledger`,
      format: "markdown",
      sourceMode: "summary",
    },
  });
  edges.push(makeEdge(previousId, "run-ledger"));

  const normalized = normalizeWorkflow({
    id: input.workflowId,
    name: input.name,
    description: input.description,
    nodes,
    edges,
    canvasLayout: { nodes, edges },
    deploymentStage: "simulate",
  });
  appendValidationNotes(normalized.issues, input.reviewNotes);
  input.assumptions.push(
    "Explicit scout/lane language expanded into visible workflow agent nodes.",
  );
  input.assumptions.push(
    "Scout nodes use the selected owner agent identity with lane-specific role prompts.",
  );

  return {
    ...normalized,
    name: input.name,
    description: input.description,
    nodes,
    edges,
    reviewNotes: input.reviewNotes,
    assumptions: input.assumptions,
  };
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

  if (wantsVisibleScoutLanes(intent)) {
    return draftVisibleScoutWorkflow({
      intent,
      name,
      description,
      workflowId,
      ownerAgentId: input.preferredAgentId ?? input.ownerAgentId ?? "argent",
      ownerAgentName:
        input.preferredAgentName ?? input.preferredAgentId ?? input.ownerAgentId ?? "Argent",
      triggerType,
      scheduleCron: input.scheduleCron,
      timezone: input.timezone,
      tools,
      assumptions,
      reviewNotes,
    });
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
