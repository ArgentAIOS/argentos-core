/**
 * Workflow Types — Type foundation for the ArgentOS Workflows engine.
 *
 * Defines the five node primitives (Trigger, Agent, Action, Gate, Output),
 * the ItemSet data contract, PipelineContext, and WorkflowDefinition.
 *
 * @see docs/argent/WORKFLOWS_ARCHITECTURE.md
 * @module infra/workflow-types
 */

import type { ModelTier } from "../models/types.js";

// ── Trigger ──────────────────────────────────────────────────────

export type TriggerType =
  | "manual"
  | "schedule"
  | "webhook"
  | "channel_message"
  | "email_received"
  | "task_completed"
  | "agent_event"
  | "workflow_done"
  | "file_changed"
  // Event-based triggers
  | "record_created"
  | "record_updated"
  | "form_submitted"
  | "payment_received"
  | "email_engaged"
  | "appointment_booked"
  | "ticket_created"
  | "timer_elapsed"
  // Connector-driven triggers (AOS Canvas Node)
  | "connector_event";

export interface TriggerConfig {
  // Schedule (cron expression)
  cronExpr?: string;
  timezone?: string;

  // Webhook
  webhookPath?: string;
  webhookSecret?: string;
  webhookPayloadFilter?: string;

  // Channel message
  channelType?: string;
  channelId?: string;
  messageFilter?: string;

  // Email
  senderFilter?: string;
  subjectFilter?: string;

  // Task completed
  taskPattern?: string;

  // Agent event
  agentId?: string;
  eventType?: string;

  // Workflow done
  sourceWorkflowId?: string;

  // Record events (database)
  connectorId?: string;
  tableName?: string;
  recordFilter?: string;

  // Connector event (AOS Canvas Node)
  credentialId?: string;
  eventId?: string; // "contact.creation"
  eventResource?: string; // "contact"
  eventConfig?: Record<string, unknown>; // Dynamic config from event.configFields

  // Form submitted
  formProvider?: string; // "wordpress" | "typeform" | "tally"
  formId?: string;

  // Payment received
  paymentProvider?: string; // "stripe" | "square"
  paymentEventType?: string; // "payment_intent.succeeded" | "invoice.paid"

  // Email engagement
  emailProvider?: string; // "sendgrid" | "mailchimp"
  engagementType?: string; // "opened" | "clicked" | "bounced"

  // Appointment booked
  calendarProvider?: string; // "calendly" | "cal.com"

  // Ticket created
  ticketProvider?: string; // "clientsync" | "connectwise"

  // Timer elapsed
  timerDurationMs?: number;
  timerAnchorEvent?: string; // "contact_created" | "last_email_sent" etc.

  // Shared
  deduplicationWindowMs?: number;
}

export interface TriggerOutput {
  triggerType: TriggerType;
  firedAt: number;
  payload: Record<string, unknown>;
  source?: string;
}

export interface TriggerNode {
  kind: "trigger";
  id: string;
  triggerType: TriggerType;
  config: TriggerConfig;
}

// ── Agent ────────────────────────────────────────────────────────

export type AgentPreset =
  | "research"
  | "write"
  | "analyze"
  | "review"
  | "code"
  | "summarize"
  | "custom";

export interface AgentOutputSchema {
  expectsText: boolean;
  expectsArtifact: boolean;
  expectsStructuredData: boolean;
  structuredDataShape?: Record<string, string>;
}

export interface AgentConfig {
  agentId: string;
  rolePrompt: string;
  preset?: AgentPreset;
  timeoutMs: number;
  evidenceRequired: boolean;
  modelTierHint?: ModelTier;
  toolsAllow?: string[];
  toolsDeny?: string[];
  maxTokenBudget?: number;
  outputSchema?: AgentOutputSchema;
  onError?: ErrorConfig;
  /** Business-tier: link to job template for SOP/tools */
  jobTemplateId?: string;
  /** Sub-port: model provider node ID (resolved at execution) */
  modelProviderNodeId?: string;
  /** Sub-port: memory source node IDs (resolved at execution) */
  memorySourceNodeIds?: string[];
  /** Sub-port: tool grant node IDs (resolved at execution) */
  toolGrantNodeIds?: string[];
}

export interface AgentNode {
  kind: "agent";
  id: string;
  label: string;
  config: AgentConfig;
}

// ── Action ───────────────────────────────────────────────────────

export type ActionType =
  // Messaging
  | { type: "send_message"; channelType: string; channelId: string; template: string }
  | { type: "send_email"; to: string; subject: string; bodyTemplate: string }
  // Data persistence
  | { type: "create_task"; title: string; assignee?: string; priority?: number; project?: string }
  | { type: "store_memory"; content: string; memoryType?: string; significance?: number }
  | {
      type: "store_knowledge";
      collectionId: string;
      content: string;
      metadata?: Record<string, unknown>;
    }
  // External
  | {
      type: "webhook_call";
      url: string;
      method: string;
      headers?: Record<string, string>;
      bodyTemplate: string;
      outputMapping?: Record<string, string>;
    }
  | {
      type: "api_call";
      provider: string;
      endpoint: string;
      method: string;
      params?: Record<string, unknown>;
      authType: string;
      retryOnStatus?: number[];
      outputMapping?: Record<string, string>;
    }
  | { type: "run_script"; command: string; sandboxed: boolean }
  // Media generation
  | { type: "generate_image"; prompt: string; model?: string; size?: string }
  | { type: "generate_audio"; text: string; voice?: string; mood?: string }
  // Document panel
  | { type: "save_to_docpanel"; title: string; content?: string; format?: string }
  // Connector-driven action (AOS Canvas Node)
  | {
      type: "connector_action";
      connectorId: string; // "aos-slack-workflow"
      credentialId: string; // pg-secret-store credential ID
      resource: string; // "message"
      operation: string; // "message.post"
      parameters: Record<string, unknown>; // { channel_id: "#sales-leads", text: "..." }
      outputMapping?: Record<string, string>;
    };

export interface ActionConfig {
  actionType: ActionType;
  onError?: ErrorConfig;
  timeoutMs?: number;
}

export interface ActionNode {
  kind: "action";
  id: string;
  label: string;
  config: ActionConfig;
}

// ── Gate ─────────────────────────────────────────────────────────

export type ConditionExpr =
  | {
      field: string;
      operator: "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "matches";
      value: unknown;
    }
  | { and: ConditionExpr[] }
  | { or: ConditionExpr[] }
  | { not: ConditionExpr }
  | { evaluator: "agent"; agentId: string; question: string; modelTier?: ModelTier };

export type JoinStrategy = "all" | "any" | "n_of_m" | "all_settled";
export type BranchFailurePolicy = "block" | "skip" | "retry" | "fallback";
export type MergeStrategy = "concat" | "structured" | "agent_merge" | "pick_first";

export interface MergeStrategyAgentConfig {
  agentId: string;
  mergePrompt: string;
  modelTier?: ModelTier;
}

export type GateConfig =
  // Conditional branching
  | { gateType: "condition"; expression: ConditionExpr; trueEdge: string; falseEdge: string }
  | {
      gateType: "switch";
      cases: Array<{ label: string; expression: ConditionExpr; edgeId: string }>;
      defaultEdge?: string;
    }
  // Parallel execution
  | { gateType: "parallel"; branchEdges: string[] }
  | {
      gateType: "join";
      strategy: JoinStrategy;
      branchFailure: BranchFailurePolicy;
      mergeStrategy: MergeStrategy;
      timeoutMs?: number;
      nRequired?: number;
      mergeAgentConfig?: MergeStrategyAgentConfig;
    }
  // Timing
  | { gateType: "wait_duration"; durationMs: number }
  | {
      gateType: "wait_event";
      eventType: string;
      eventFilter?: Record<string, unknown>;
      timeoutMs?: number;
      timeoutAction: "continue" | "fail";
    }
  // Approval (Business-tier — Core treats as pass-through)
  | {
      gateType: "approval";
      approvers: string[];
      channels: string[];
      message: string;
      showPreviousOutput: boolean;
      allowEdit: boolean;
      timeoutMs?: number;
      timeoutAction: "approve" | "deny" | "escalate";
    }
  // Iteration
  | {
      gateType: "loop";
      maxIterations: number;
      condition?: ConditionExpr;
      bodyEdge: string;
      exitEdge: string;
    }
  // Error handling
  | {
      gateType: "error_handler";
      catchFrom: string[];
      actions: Array<{
        type: "log" | "notify" | "create_task" | "retry" | "skip" | "abort";
        config?: Record<string, unknown>;
      }>;
    }
  // Composition
  | {
      gateType: "sub_workflow";
      workflowId: string;
      inputMapping?: Record<string, string>;
      outputMapping?: Record<string, string>;
    };

export interface GateNode {
  kind: "gate";
  id: string;
  label: string;
  config: GateConfig;
}

// ── Output ───────────────────────────────────────────────────────

export type OutputConfig =
  | { outputType: "docpanel"; title: string; format?: string }
  | { outputType: "channel"; channelType: string; channelId: string; template: string }
  | { outputType: "email"; to: string; subject: string; bodyTemplate: string }
  | { outputType: "webhook"; url: string; method: string; bodyTemplate: string }
  | { outputType: "knowledge"; collectionId: string; metadata?: Record<string, unknown> }
  | { outputType: "task_update"; taskId: string; status: string; evidence?: string }
  | { outputType: "next_workflow"; workflowId: string; inputMapping?: Record<string, string> };

export interface OutputNode {
  kind: "output";
  id: string;
  label: string;
  config: OutputConfig;
}

// ── Unified Node Type ────────────────────────────────────────────

export type WorkflowNode = TriggerNode | AgentNode | ActionNode | GateNode | OutputNode;

// ── Data Contract ────────────────────────────────────────────────

export interface Artifact {
  type: "docpanel" | "image" | "audio" | "file" | "url";
  id: string;
  title?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface ItemMeta {
  nodeId: string;
  agentId?: string;
  status: "completed" | "failed" | "skipped";
  durationMs: number;
  tokensUsed?: number;
  model?: string;
  toolsCalled?: string[];
  costUsd?: number;
}

export interface PipelineItem {
  json: Record<string, unknown>;
  text?: string;
  artifacts?: Artifact[];
  meta?: ItemMeta;
}

export interface ItemSet {
  items: PipelineItem[];
}

// ── Pipeline Context ─────────────────────────────────────────────

export interface StepRecord {
  nodeId: string;
  nodeKind: "trigger" | "agent" | "action" | "gate" | "output";
  nodeLabel: string;
  agentId?: string;
  stepIndex: number;
  status: "completed" | "failed" | "skipped";
  durationMs: number;
  output: ItemSet;
  tokensUsed?: number;
  costUsd?: number;
  startedAt: number;
  endedAt: number;
}

export interface PipelineContext {
  workflowId: string;
  workflowName: string;
  runId: string;
  currentNodeId: string;
  currentStepIndex: number;
  totalSteps: number;
  trigger: TriggerOutput;
  history: StepRecord[];
  variables: Record<string, unknown>;
  totalTokensUsed: number;
  totalCostUsd: number;
  budgetRemainingUsd?: number;
}

// ── Error Handling ───────────────────────────────────────────────

export interface ErrorConfig {
  strategy: "fail" | "retry" | "skip" | "fallback" | "handler";
  maxRetries?: number;
  retryBackoffMs?: number;
  retryJitterPct?: number;
  retryOnlyOn?: string[];
  fallbackNodeId?: string;
  handlerNodeId?: string;
  notifyOnError?: boolean;
  notifyChannels?: string[];
}

// ── Node Schema (Design-Time Validation) ─────────────────────────

export interface NodeSchema {
  input?: {
    requiresText?: boolean;
    requiresArtifact?: boolean;
    requiresFields?: string[];
  };
  output?: {
    producesText?: boolean;
    producesArtifact?: boolean;
    producesFields?: string[];
  };
}

// ── Workflow Definition ──────────────────────────────────────────

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export type WorkflowRunStatus =
  | "created"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_approval"
  | "waiting_event"
  | "waiting_duration";

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  defaultOnError: ErrorConfig;
  errorWorkflowId?: string;
  maxRunDurationMs?: number;
  maxRunCostUsd?: number;
  /** Business-tier: ignored in Core */
  deploymentStage?: "simulate" | "shadow" | "limited_live" | "live";
  /** Business-tier: ignored in Core */
  monthlyBudgetUsd?: number;
}

// ── Node Credential Reference ────────────────────────────────

/** Credential binding on a workflow connector node. */
export interface NodeCredentialRef {
  credentialType: string; // "slack" | "hubspot" | "sendgrid"
  credentialId: string; // pg-secret-store record ID
  credentialName: string; // Display name: "Acme Corp Slack"
}

// ── Dispatcher Interface ─────────────────────────────────────────

/**
 * Agent dispatch strategy — Core calls argentStream directly,
 * Business routes through execution worker + job template resolution.
 */
export interface AgentDispatcher {
  dispatch(
    agentId: string,
    prompt: string,
    config: {
      timeoutMs: number;
      modelTierHint?: ModelTier;
      toolsAllow?: string[];
      toolsDeny?: string[];
      /** Sub-port: model override for this specific step */
      modelOverride?: ModelOverrideConfig;
      /** Sub-port: memory/knowledge context to inject */
      memoryContext?: MemoryContextConfig;
      /** Sub-port: tools granted for this step */
      toolGrants?: ToolGrantEntry[];
    },
  ): Promise<ItemSet>;
}

// ── Sub-Port Node Types (n8n-style Model/Memory/Tool connections) ─────

/** Model Provider — overrides the model for an agent step */
export interface ModelProviderNodeConfig {
  nodeType: "model_provider";
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  thinkingLevel?: "none" | "low" | "medium" | "high";
}

/** Memory Source — attaches knowledge/memory context to an agent step */
export interface MemorySourceNodeConfig {
  nodeType: "memory_source";
  sourceType: "knowledge_collection" | "conversation_history" | "agent_memory" | "custom_context";
  collectionId?: string;
  agentId?: string;
  maxItems?: number;
  searchQuery?: string;
  timeRange?: "last_24h" | "last_7d" | "last_30d" | "all";
}

/** Tool Grant — grants a connector or builtin tool to an agent step */
export interface ToolGrantNodeConfig {
  nodeType: "tool_grant";
  grantType: "connector" | "builtin_tool" | "tool_set";
  connectorId?: string;
  toolName?: string;
  toolSetPreset?: "web_search" | "code_execution" | "file_management";
  credentialId?: string;
  permissions?: "readonly" | "readwrite";
}

/** Union of all sub-port node configs */
export type SubPortNodeConfig =
  | ModelProviderNodeConfig
  | MemorySourceNodeConfig
  | ToolGrantNodeConfig;

/** Sub-port handle IDs on the Agent node */
export type SubPortType = "model" | "memory" | "tools";

/** Model override passed through AgentDispatcher */
export interface ModelOverrideConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  thinkingLevel?: string;
}

/** Memory context passed through AgentDispatcher */
export interface MemoryContextConfig {
  collections: string[];
  searchQuery?: string;
  maxItems?: number;
  conversationHistory?: Array<{ role: string; content: string }>;
}

/** Individual tool grant entry */
export interface ToolGrantEntry {
  type: "connector" | "builtin";
  id: string;
  credentialId?: string;
  permissions: "readonly" | "readwrite";
}
