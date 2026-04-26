import type {
  ActionType,
  ErrorConfig,
  GateConfig,
  OutputConfig,
  OutputSourceMode,
  ConditionExpr,
  TriggerType,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from "./workflow-types.js";

export interface CanvasWorkflowNode {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CanvasWorkflowEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  [key: string]: unknown;
}

export interface CanvasWorkflowLayout {
  nodes: CanvasWorkflowNode[];
  edges: CanvasWorkflowEdge[];
  viewport?: unknown;
  [key: string]: unknown;
}

export type WorkflowValidationMode = "draft" | "live";

export interface WorkflowIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowNormalizationInput {
  id: string;
  name: string;
  description?: string;
  nodes?: unknown[];
  edges?: unknown[];
  canvasLayout?: unknown;
  defaultOnError?: ErrorConfig;
  maxRunDurationMs?: number;
  maxRunCostUsd?: number;
  deploymentStage?: WorkflowDefinition["deploymentStage"];
}

export interface WorkflowNormalizationResult {
  workflow: WorkflowDefinition;
  canvasLayout: CanvasWorkflowLayout;
  issues: WorkflowIssue[];
}

const DEFAULT_ERROR: ErrorConfig = { strategy: "fail", notifyOnError: true };
const READ_ONLY_ACTIONS = new Set<ActionType["type"]>(["store_memory", "store_knowledge"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseJsonObject(
  value: unknown,
  issues: WorkflowIssue[],
  nodeId: string,
  field: string,
): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // handled below
  }
  issues.push({
    severity: "error",
    code: "invalid_json_object",
    nodeId,
    message: `${field} must be a valid JSON object.`,
  });
  return undefined;
}

function parseStringRecord(
  value: unknown,
  issues: WorkflowIssue[],
  nodeId: string,
  field: string,
): Record<string, string> | undefined {
  const object = parseJsonObject(value, issues, nodeId, field);
  if (!object) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(object)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .map(([key, entry]) => [key, String(entry)]),
  );
}

function parseScalar(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) {
    return Number(trimmed);
  }
  return value;
}

function isCanonicalNode(value: unknown): value is WorkflowNode {
  return isRecord(value) && typeof value.kind === "string";
}

function normalizeCanvasLayout(canvasLayout: unknown, nodes: unknown[], edges: unknown[]) {
  const layout = asRecord(canvasLayout);
  const layoutNodes = asArray(layout.nodes);
  const layoutEdges = asArray(layout.edges);
  return {
    ...layout,
    nodes: (layoutNodes.length ? layoutNodes : nodes).filter(isRecord) as CanvasWorkflowNode[],
    edges: (layoutEdges.length ? layoutEdges : edges).filter(isRecord) as CanvasWorkflowEdge[],
  };
}

function normalizeEdges(edges: unknown[]): WorkflowEdge[] {
  return edges.filter(isRecord).map((edge, index) => {
    const source = asString(edge.source);
    const target = asString(edge.target);
    return {
      id: asString(edge.id, source && target ? `${source}->${target}` : `edge-${index}`),
      source,
      target,
      ...(typeof edge.sourceHandle === "string" ? { sourceHandle: edge.sourceHandle } : {}),
      ...(typeof edge.targetHandle === "string" ? { targetHandle: edge.targetHandle } : {}),
    };
  });
}

function outgoing(edges: WorkflowEdge[], nodeId: string): WorkflowEdge[] {
  return edges.filter((edge) => edge.source === nodeId);
}

function expressionFrom(value: unknown): ConditionExpr {
  if (
    isRecord(value) &&
    ("field" in value || "and" in value || "or" in value || "not" in value || "evaluator" in value)
  ) {
    return value as ConditionExpr;
  }
  return { field: "text", operator: "contains" as const, value: "" };
}

function normalizeActionType(
  data: Record<string, unknown>,
  issues: WorkflowIssue[],
  nodeId: string,
): ActionType {
  const config = asRecord(data.config);
  const rawActionType = asString(data.actionType ?? config.actionType, "api_call");

  if (asString(config.connectorId)) {
    const parameters: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (
        ![
          "connectorId",
          "connectorName",
          "connectorCategory",
          "credentialId",
          "resource",
          "operation",
          "outputMapping",
          "sideEffectLevel",
          "dryRunSupported",
        ].includes(key)
      ) {
        parameters[key] = value;
      }
    }
    return {
      type: "connector_action",
      connectorId: asString(config.connectorId),
      credentialId: asString(config.credentialId),
      resource: asString(config.resource),
      operation: asString(config.operation),
      parameters,
      outputMapping: isRecord(config.outputMapping)
        ? (config.outputMapping as Record<string, string>)
        : undefined,
    };
  }

  switch (rawActionType) {
    case "send_message":
      return {
        type: "send_message",
        channelType: asString(config.channelType, "telegram"),
        channelId: asString(config.channelId, asString(config.to)),
        template: asString(config.template ?? config.message, "{{previous.text}}"),
      };
    case "send_email":
      return {
        type: "send_email",
        to: asString(config.to),
        subject: asString(config.subject, "Workflow update"),
        bodyTemplate: asString(config.bodyTemplate ?? config.body, "{{previous.text}}"),
      };
    case "create_task":
      return {
        type: "create_task",
        title: asString(config.title, "Workflow task"),
        assignee: asString(config.assignee) || undefined,
        priority: typeof config.priority === "number" ? config.priority : undefined,
        project: asString(config.project) || undefined,
      };
    case "store_memory":
      return {
        type: "store_memory",
        content: asString(config.content, "{{previous.text}}"),
        memoryType: asString(config.memoryType) || undefined,
        significance: typeof config.significance === "number" ? config.significance : undefined,
      };
    case "store_knowledge":
      return {
        type: "store_knowledge",
        collectionId: asString(config.collectionId),
        content: asString(config.content, "{{previous.text}}"),
        metadata: isRecord(config.metadata) ? config.metadata : undefined,
      };
    case "webhook_call":
      return {
        type: "webhook_call",
        url: asString(config.url),
        method: asString(config.method, "POST").toUpperCase(),
        headers: parseStringRecord(config.headers, issues, nodeId, "Headers"),
        bodyTemplate: asString(config.bodyTemplate ?? config.body, "{{previous.json}}"),
        outputMapping: isRecord(config.outputMapping)
          ? (config.outputMapping as Record<string, string>)
          : undefined,
      };
    case "run_script":
      return {
        type: "run_script",
        command: asString(config.command),
        sandboxed: asBoolean(config.sandboxed, true),
      };
    case "generate_image":
      return {
        type: "generate_image",
        prompt: asString(config.prompt, "{{previous.text}}"),
        model: asString(config.model) || undefined,
        size: asString(config.size) || undefined,
      };
    case "generate_audio":
      return {
        type: "generate_audio",
        text: asString(config.text, "{{previous.text}}"),
        voice: asString(config.voice) || undefined,
        mood: asString(config.mood) || undefined,
      };
    case "save_to_docpanel":
      return {
        type: "save_to_docpanel",
        title: asString(config.title, "Workflow output"),
        content: asString(config.content, "{{previous.text}}"),
        format: asString(config.format) || undefined,
      };
    case "api_call":
    default:
      if (rawActionType !== "api_call") {
        issues.push({
          severity: "warning",
          code: "action_type_mapped_to_api_call",
          nodeId,
          message: `Unsupported action type "${rawActionType}" was mapped to api_call.`,
        });
      }
      return {
        type: "api_call",
        provider: asString(config.provider, "custom"),
        endpoint: asString(config.endpoint ?? config.url),
        method: asString(config.method, "POST").toUpperCase(),
        params:
          parseJsonObject(config.params, issues, nodeId, "Parameters") ??
          parseJsonObject(config.body, issues, nodeId, "Body") ??
          config,
        authType: asString(config.authType, "none"),
      };
  }
}

function normalizeGateConfig(
  node: CanvasWorkflowNode,
  data: Record<string, unknown>,
  edges: WorkflowEdge[],
  issues: WorkflowIssue[],
): GateConfig {
  const config = asRecord(data.config);
  const gateType = asString(data.gateType ?? config.gateType ?? node.type, "condition");
  const out = outgoing(edges, node.id);
  const first = out[0]?.id ?? out[0]?.target ?? "";
  const second = out[1]?.id ?? out[1]?.target ?? "";

  switch (gateType) {
    case "approval":
      return {
        gateType: "approval",
        approvers: asArray(config.approvers).filter((v): v is string => typeof v === "string"),
        channels: asArray(config.channels).filter((v): v is string => typeof v === "string"),
        message: asString(
          config.message ?? config.approvalMessage ?? data.approvalMessage,
          "Approve workflow side effect?",
        ),
        showPreviousOutput: asBoolean(config.showPreviousOutput ?? data.showPreviousOutput, true),
        allowEdit: asBoolean(config.allowEdit, false),
        timeoutMs:
          typeof config.timeoutMs === "number"
            ? config.timeoutMs
            : typeof data.timeoutMs === "number"
              ? data.timeoutMs
              : typeof data.timeoutMinutes === "number" && data.timeoutMinutes > 0
                ? data.timeoutMinutes * 60_000
                : undefined,
        timeoutAction: asString(config.timeoutAction ?? data.timeoutAction, "deny") as
          | "approve"
          | "deny"
          | "escalate",
      };
    case "wait_duration":
      return {
        gateType: "wait_duration",
        durationMs: asNumber(config.durationMs ?? data.durationMs, 60_000),
      };
    case "wait_event":
      return {
        gateType: "wait_event",
        eventType: asString(config.eventType ?? data.eventType, "workflow.event"),
        eventFilter:
          parseJsonObject(config.eventFilter, issues, node.id, "Event filter") ??
          parseJsonObject(data.eventFilter, issues, node.id, "Event filter") ??
          parseJsonObject(data.eventFilterJson, issues, node.id, "Event filter"),
        timeoutMs:
          typeof config.timeoutMs === "number"
            ? config.timeoutMs
            : typeof data.timeoutMs === "number"
              ? data.timeoutMs
              : typeof data.timeoutMinutes === "number" && data.timeoutMinutes > 0
                ? data.timeoutMinutes * 60_000
                : undefined,
        timeoutAction: asString(config.timeoutAction ?? data.timeoutAction, "fail") as
          | "continue"
          | "fail",
      };
    case "parallel":
      return { gateType: "parallel", branchEdges: out.map((edge) => edge.id) };
    case "join":
      return {
        gateType: "join",
        strategy: "all",
        branchFailure: "block",
        mergeStrategy: "concat",
      };
    case "switch":
      return {
        gateType: "switch",
        cases: out.map((edge, index) => ({
          label: `Case ${index + 1}`,
          expression: expressionFrom(config.expression),
          edgeId: edge.id,
        })),
        defaultEdge: out[out.length - 1]?.id,
      };
    case "loop":
      return {
        gateType: "loop",
        maxIterations: asNumber(config.maxIterations ?? data.maxIterations, 3),
        condition: expressionFrom(config.condition ?? data.condition),
        bodyEdge: first,
        exitEdge: second,
      };
    case "error_handler":
      return {
        gateType: "error_handler",
        catchFrom: asArray(config.catchFrom).filter((v): v is string => typeof v === "string"),
        actions: [],
      };
    case "sub_workflow":
      return {
        gateType: "sub_workflow",
        workflowId: asString(config.workflowId),
        inputMapping: isRecord(config.inputMapping)
          ? (config.inputMapping as Record<string, string>)
          : undefined,
        outputMapping: isRecord(config.outputMapping)
          ? (config.outputMapping as Record<string, string>)
          : undefined,
      };
    case "condition":
    default:
      return {
        gateType: "condition",
        expression:
          isRecord(config.expression) || isRecord(data.condition)
            ? expressionFrom(config.expression ?? data.condition)
            : {
                field: asString(data.conditionField, "text"),
                operator: asString(data.conditionOperator, "contains") as
                  | "=="
                  | "!="
                  | ">"
                  | "<"
                  | ">="
                  | "<="
                  | "contains"
                  | "matches",
                value: parseScalar(data.conditionValue ?? ""),
              },
        trueEdge: asString(config.trueEdge, first),
        falseEdge: asString(config.falseEdge, second),
      };
  }
}

function normalizeOutputConfig(
  data: Record<string, unknown>,
  issues: WorkflowIssue[],
  nodeId: string,
): OutputConfig {
  const config = asRecord(data.config);
  const sourceModeRaw = asString(config.sourceMode ?? data.sourceMode, "previous");
  const sourceMode: OutputSourceMode =
    sourceModeRaw === "node" || sourceModeRaw === "summary" || sourceModeRaw === "custom"
      ? sourceModeRaw
      : "previous";
  const source = {
    sourceMode,
    sourceNodeId: asString(config.sourceNodeId ?? data.sourceNodeId) || undefined,
    contentTemplate:
      asString(
        config.contentTemplate ??
          data.contentTemplate ??
          config.payloadTemplate ??
          data.payloadTemplate,
      ) || undefined,
  };
  const outputType = asString(data.outputType ?? config.outputType ?? data.target, "docpanel");
  switch (outputType) {
    case "email":
      return {
        ...source,
        outputType: "email",
        to: asString(config.to ?? data.to ?? data.recipient),
        subject: asString(config.subject ?? data.subject, "Workflow output"),
        bodyTemplate: asString(
          config.bodyTemplate ??
            config.contentTemplate ??
            config.body ??
            data.bodyTemplate ??
            data.contentTemplate ??
            data.body,
          "{{previous.text}}",
        ),
      };
    case "channel":
    case "discord":
    case "telegram":
      return {
        ...source,
        outputType: "channel",
        channelType:
          outputType === "channel"
            ? asString(config.channelType ?? data.channelType, "telegram")
            : outputType,
        channelId: asString(config.channelId ?? config.to ?? data.channelId),
        template: asString(
          config.template ?? config.contentTemplate ?? data.template ?? data.contentTemplate,
          "{{previous.text}}",
        ),
      };
    case "webhook":
      return {
        ...source,
        outputType: "webhook",
        url: asString(config.url ?? data.webhookUrl ?? data.url),
        method: asString(config.method ?? data.method, "POST").toUpperCase(),
        bodyTemplate: asString(
          config.bodyTemplate ??
            config.contentTemplate ??
            config.body ??
            data.bodyTemplate ??
            data.contentTemplate ??
            data.body,
          "{{previous.json}}",
        ),
      };
    case "knowledge":
      return {
        ...source,
        outputType: "knowledge",
        collectionId: asString(config.collectionId ?? data.collectionId),
        metadata: isRecord(config.metadata) ? config.metadata : undefined,
      };
    case "task_update":
      return {
        ...source,
        outputType: "task_update",
        taskId: asString(config.taskId),
        status: asString(config.status, "done"),
        evidence: asString(config.evidence) || undefined,
      };
    case "next_workflow":
      return {
        ...source,
        outputType: "next_workflow",
        workflowId: asString(config.workflowId ?? data.workflowId),
        inputMapping: isRecord(config.inputMapping)
          ? (config.inputMapping as Record<string, string>)
          : undefined,
      };
    case "variable":
      issues.push({
        severity: "warning",
        code: "unsupported_output_target",
        nodeId,
        message: "Variable output is not executable yet and was mapped to DocPanel output.",
      });
      return {
        ...source,
        outputType: "docpanel",
        title: asString(config.title ?? data.title ?? data.label, "Workflow output"),
        format: asString(config.format ?? data.format) || undefined,
      };
    case "doc_panel":
    case "docpanel":
    default:
      return {
        ...source,
        outputType: "docpanel",
        title: asString(config.title ?? data.title ?? data.label, "Workflow output"),
        format: asString(config.format ?? data.format) || undefined,
      };
  }
}

function normalizeSubPortNode(
  node: CanvasWorkflowNode,
  data: Record<string, unknown>,
): WorkflowNode {
  const config = asRecord(data.config);
  const label = asString(data.label ?? data.name ?? data.title, node.id);
  const nodeType =
    node.type === "modelProvider"
      ? "model_provider"
      : node.type === "memorySource"
        ? "memory_source"
        : "tool_grant";
  return {
    kind: "gate",
    id: node.id,
    label,
    config: {
      gateType: "error_handler",
      catchFrom: [],
      actions: [],
      nodeType,
      ...config,
    } as unknown as GateConfig,
  };
}

function normalizeCanvasNode(
  node: CanvasWorkflowNode,
  edges: WorkflowEdge[],
  issues: WorkflowIssue[],
): WorkflowNode | null {
  const data = asRecord(node.data);
  const label = asString(data.label ?? data.name ?? data.title, node.id);
  switch (node.type) {
    case "trigger":
      return {
        kind: "trigger",
        id: node.id,
        triggerType: asString(data.triggerType, "manual") as TriggerType,
        config: {
          cronExpr: asString(data.cronExpression ?? data.cronExpr) || undefined,
          timezone: asString(data.timezone) || undefined,
          webhookPath: asString(data.webhookPath) || undefined,
          webhookSecret: asString(data.webhookSecret) || undefined,
          webhookPayloadFilter: asString(data.webhookPayloadFilter) || undefined,
          channelType: asString(data.channelType) || undefined,
          channelId: asString(data.channelId) || undefined,
          appId: asString(data.appId ?? data.appForgeAppId) || undefined,
          capabilityId: asString(data.capabilityId ?? data.appForgeCapabilityId) || undefined,
          eventType: asString(data.eventType) || undefined,
          eventFilter:
            parseJsonObject(data.eventFilter, issues, node.id, "Event filter") ??
            parseJsonObject(data.eventFilterJson, issues, node.id, "Event filter"),
          senderFilter: asString(data.senderFilter ?? data.emailFilter) || undefined,
          subjectFilter: asString(data.subjectFilter) || undefined,
          sourceWorkflowId: asString(data.sourceWorkflowId ?? data.upstreamWorkflowId) || undefined,
          connectorId: asString(data.connectorId ?? data.dbConnector) || undefined,
          credentialId: asString(data.credentialId) || undefined,
          tableName: asString(data.tableName) || undefined,
          formProvider: asString(data.formProvider) || undefined,
          formId: asString(data.formId) || undefined,
          paymentProvider: asString(data.paymentProvider) || undefined,
          paymentEventType: asString(data.paymentEventType ?? data.paymentEvent) || undefined,
          emailProvider: asString(data.emailProvider) || undefined,
          engagementType: asString(data.engagementType) || undefined,
          calendarProvider: asString(data.calendarProvider) || undefined,
          ticketProvider: asString(data.ticketProvider) || undefined,
          timerDurationMs:
            typeof data.timerDurationMs === "number"
              ? data.timerDurationMs
              : typeof data.timerMinutes === "number"
                ? data.timerMinutes * 60_000
                : undefined,
        },
      };
    case "agentStep":
    case "agent":
      return {
        kind: "agent",
        id: node.id,
        label,
        config: {
          agentId: asString(data.agentId, "argent"),
          rolePrompt: asString(data.rolePrompt ?? data.prompt, "Complete this workflow step."),
          timeoutMs: asNumber(data.timeoutMs, asNumber(data.timeout, 5) * 60_000),
          evidenceRequired: asBoolean(data.evidenceRequired, false),
          toolsAllow: asArray(data.toolsAllow).filter((v): v is string => typeof v === "string"),
          toolsDeny: asArray(data.toolsDeny).filter((v): v is string => typeof v === "string"),
        },
      };
    case "action":
      return {
        kind: "action",
        id: node.id,
        label,
        config: {
          actionType: normalizeActionType(data, issues, node.id),
          timeoutMs: typeof data.timeoutMs === "number" ? data.timeoutMs : undefined,
        },
      };
    case "gate":
    case "condition":
    case "approval":
    case "wait_duration":
      return {
        kind: "gate",
        id: node.id,
        label,
        config: normalizeGateConfig(node, data, edges, issues),
      };
    case "output":
      return {
        kind: "output",
        id: node.id,
        label,
        config: normalizeOutputConfig(data, issues, node.id),
      };
    case "modelProvider":
    case "memorySource":
    case "toolGrant":
      return normalizeSubPortNode(node, data);
    default:
      issues.push({
        severity: "error",
        code: "unsupported_node_type",
        nodeId: node.id,
        message: `Unsupported workflow node type "${node.type ?? "unknown"}".`,
      });
      return null;
  }
}

function isSubPortEngineNode(node: WorkflowNode): boolean {
  const config = node.kind === "gate" ? (node.config as unknown as Record<string, unknown>) : null;
  return (
    node.kind === "gate" &&
    isRecord(config) &&
    ["model_provider", "memory_source", "tool_grant"].includes(asString(config.nodeType))
  );
}

function applyAgentSubPortRefs(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  return nodes.map((node) => {
    if (node.kind !== "agent") {
      return node;
    }
    const incoming = edges.filter((edge) => edge.target === node.id);
    const modelProviderNodeId = incoming.find((edge) => edge.targetHandle === "model")?.source;
    const memorySourceNodeIds = incoming
      .filter((edge) => edge.targetHandle === "memory")
      .map((edge) => edge.source);
    const toolGrantNodeIds = incoming
      .filter((edge) => edge.targetHandle === "tools")
      .map((edge) => edge.source);
    return {
      ...node,
      config: {
        ...node.config,
        ...(modelProviderNodeId ? { modelProviderNodeId } : {}),
        ...(memorySourceNodeIds.length ? { memorySourceNodeIds } : {}),
        ...(toolGrantNodeIds.length ? { toolGrantNodeIds } : {}),
      },
    };
  });
}

export function normalizeWorkflow(input: WorkflowNormalizationInput): WorkflowNormalizationResult {
  const sourceNodes = input.nodes ?? [];
  const sourceEdges = input.edges ?? [];
  const canvasLayout = normalizeCanvasLayout(input.canvasLayout, sourceNodes, sourceEdges);
  const issues: WorkflowIssue[] = [];

  const canonicalNodes = sourceNodes.every(isCanonicalNode)
    ? (sourceNodes as WorkflowNode[])
    : null;
  const engineEdges = normalizeEdges(canonicalNodes ? sourceEdges : canvasLayout.edges);
  const rawEngineNodes =
    canonicalNodes ??
    canvasLayout.nodes
      .map((node) => normalizeCanvasNode(node, engineEdges, issues))
      .filter((node): node is WorkflowNode => Boolean(node));
  const engineNodes = applyAgentSubPortRefs(rawEngineNodes, engineEdges);

  const workflow: WorkflowDefinition = {
    id: input.id,
    name: input.name,
    description: input.description,
    nodes: engineNodes,
    edges: engineEdges.filter((edge) => edge.source && edge.target),
    defaultOnError: input.defaultOnError ?? DEFAULT_ERROR,
    maxRunDurationMs: input.maxRunDurationMs,
    maxRunCostUsd: input.maxRunCostUsd,
    deploymentStage: input.deploymentStage,
  };

  issues.push(...validateWorkflow(workflow, input.deploymentStage === "live" ? "live" : "draft"));
  return { workflow, canvasLayout, issues };
}

function graphFromEdges(edges: WorkflowEdge[]) {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    const next = graph.get(edge.source) ?? [];
    next.push(edge.target);
    graph.set(edge.source, next);
  }
  return graph;
}

function reachableFrom(starts: string[], edges: WorkflowEdge[]) {
  const graph = graphFromEdges(edges);
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    for (const next of graph.get(id) ?? []) {
      stack.push(next);
    }
  }
  return seen;
}

function isUnsafeNode(node: WorkflowNode): boolean {
  if (node.kind === "output") {
    return ["channel", "email", "webhook", "task_update", "next_workflow"].includes(
      node.config.outputType,
    );
  }
  if (node.kind !== "action") {
    return false;
  }
  const type = node.config.actionType.type;
  if (type === "connector_action") {
    return true;
  }
  return !READ_ONLY_ACTIONS.has(type);
}

export function validateWorkflow(
  workflow: WorkflowDefinition,
  mode: WorkflowValidationMode = "live",
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const triggers = workflow.nodes.filter((node) => node.kind === "trigger");

  if (triggers.length !== 1) {
    issues.push({
      severity: "error",
      code: "trigger_count",
      message: `Workflow must have exactly one trigger; found ${triggers.length}.`,
    });
  }

  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        severity: "error",
        code: "invalid_edge",
        edgeId: edge.id,
        message: `Edge ${edge.id} references a missing source or target node.`,
      });
    }
  }

  const reachable = reachableFrom(
    triggers.map((node) => node.id),
    workflow.edges,
  );
  for (const node of workflow.nodes) {
    if (isSubPortEngineNode(node)) {
      continue;
    }
    if (node.kind !== "trigger" && !reachable.has(node.id)) {
      issues.push({
        severity: "warning",
        code: "disconnected_node",
        nodeId: node.id,
        message: `Node "${node.id}" is not reachable from the trigger.`,
      });
    }
  }

  for (const node of workflow.nodes) {
    if (node.kind === "action" && node.config.actionType.type === "connector_action") {
      const action = node.config.actionType;
      if (!action.connectorId || !action.resource || !action.operation) {
        issues.push({
          severity: "error",
          code: "connector_action_incomplete",
          nodeId: node.id,
          message: "Connector action requires connectorId, resource, and operation.",
        });
      }
      if (!action.credentialId) {
        issues.push({
          severity: "error",
          code: "missing_credential",
          nodeId: node.id,
          message: "Connector action requires a credential before it can run live.",
        });
      }
    }

    if (node.kind === "output") {
      const config = node.config;
      if (config.sourceMode === "node") {
        if (!config.sourceNodeId?.trim()) {
          issues.push({
            severity: "error",
            code: "output_source_node_required",
            nodeId: node.id,
            message: "Output source mode is Specific node result, but no source node is selected.",
          });
        } else if (!nodeIds.has(config.sourceNodeId)) {
          issues.push({
            severity: "error",
            code: "output_source_node_missing",
            nodeId: node.id,
            message: `Output source node "${config.sourceNodeId}" does not exist.`,
          });
        }
      }
      if (config.sourceMode === "custom" && !config.contentTemplate?.trim()) {
        issues.push({
          severity: "error",
          code: "output_template_required",
          nodeId: node.id,
          message: "Custom template output requires a payload template.",
        });
      }

      switch (config.outputType) {
        case "email":
          if (!config.to?.trim()) {
            issues.push({
              severity: "error",
              code: "output_email_recipient_required",
              nodeId: node.id,
              message: "Email output requires a recipient.",
            });
          }
          break;
        case "webhook":
          if (!config.url?.trim()) {
            issues.push({
              severity: "error",
              code: "output_webhook_url_required",
              nodeId: node.id,
              message: "Webhook output requires a URL.",
            });
          }
          break;
        case "channel":
          if (!config.channelType?.trim()) {
            issues.push({
              severity: "error",
              code: "output_channel_type_required",
              nodeId: node.id,
              message: "Channel output requires a configured channel type.",
            });
          }
          if (!config.channelId?.trim()) {
            issues.push({
              severity: "error",
              code: "output_channel_target_required",
              nodeId: node.id,
              message: "Channel output requires a target channel, chat, or account.",
            });
          }
          break;
        case "task_update":
          if (!config.taskId?.trim()) {
            issues.push({
              severity: "error",
              code: "output_task_id_required",
              nodeId: node.id,
              message: "Task update output requires a task ID.",
            });
          }
          break;
        case "next_workflow":
          if (!config.workflowId?.trim()) {
            issues.push({
              severity: "error",
              code: "output_next_workflow_required",
              nodeId: node.id,
              message: "Next workflow output requires a workflow ID.",
            });
          }
          break;
        case "docpanel":
        case "knowledge":
          break;
      }
    }
  }

  if (mode === "live") {
    const graph = graphFromEdges(workflow.edges);
    const approvalSafe = new Set<string>();
    const stack = triggers.map((node) => ({ id: node.id, approved: false }));
    const seen = new Set<string>();
    while (stack.length) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      const key = `${current.id}:${current.approved ? "approved" : "raw"}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const node = workflow.nodes.find((candidate) => candidate.id === current.id);
      const approved =
        current.approved || (node?.kind === "gate" && node.config.gateType === "approval");
      if (approved) {
        approvalSafe.add(current.id);
      }
      for (const next of graph.get(current.id) ?? []) {
        stack.push({ id: next, approved });
      }
    }
    for (const node of workflow.nodes.filter(isUnsafeNode)) {
      if (reachable.has(node.id) && !approvalSafe.has(node.id)) {
        issues.push({
          severity: "error",
          code: "unsafe_side_effect_without_approval",
          nodeId: node.id,
          message:
            "External writes, outbound delivery, scripts, and connector actions require an approval gate before live execution.",
        });
      }
    }
  }

  return issues;
}

export function hasBlockingWorkflowIssues(issues: WorkflowIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
