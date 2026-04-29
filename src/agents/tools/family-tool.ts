/**
 * Family Tool — Dynamic agent registration + multi-agent coordination.
 *
 * Actions:
 *   register   — Insert agent into PostgreSQL + set Redis presence + bootstrap identity files
 *   list       — List all family members with alive status
 *   message    — Send a message to another agent via Redis stream (optionally wake them)
 *   publish    — Share knowledge to the family library
 *   search     — Search shared knowledge (full-text)
 *   spawn      — Wake a family agent and assign a task
 *   dispatch   — Route a task to either family specialist or strict sub-agent worker
 *   spawn_team — Wake all agents in a team for a project
 */

import { Type } from "@sinclair/typebox";
import type {
  DispatchContractEvent,
  DispatchContractRecord,
} from "../../infra/dispatch-contracts.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AnyAgentTool } from "./common.js";
import { getAgentFamily } from "../../data/agent-family.js";
import {
  ackFamilyMessages,
  publishDashboardEvent,
  readFamilyMessages,
  refreshPresence,
  sendFamilyMessage,
  setAgentState,
} from "../../data/redis-client.js";
import { encodeForPrompt } from "../../utils/toon-encoding.js";
import { provisionFamilyWorker } from "../family-worker-provisioning.js";
import { jsonResult, readStringParam, readStringArrayParam, readNumberParam } from "./common.js";

const FamilyToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("register"),
    Type.Literal("list"),
    Type.Literal("message"),
    Type.Literal("inbox"),
    Type.Literal("publish"),
    Type.Literal("search"),
    Type.Literal("telemetry"),
    Type.Literal("spawn"),
    Type.Literal("dispatch"),
    Type.Literal("dispatch_contracted"),
    Type.Literal("contract_history"),
    Type.Literal("spawn_team"),
  ]),

  // ── register ──
  id: Type.Optional(Type.String({ description: "Unique agent ID (lowercase, no spaces)" })),
  name: Type.Optional(Type.String({ description: "Human-readable agent name" })),
  role: Type.Optional(
    Type.String({ description: "Agent role (e.g. research_lead, software_engineer, analyst)" }),
  ),
  persona: Type.Optional(Type.String({ description: "System prompt / persona for the agent" })),
  tools: Type.Optional(
    Type.Array(Type.String(), { description: "Tool allowlist (e.g. web_search, memory_recall)" }),
  ),
  skills: Type.Optional(
    Type.Array(Type.String(), {
      description: "Skill allowlist for this family agent (e.g. argentos-code-verification)",
    }),
  ),
  skillsRequired: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Skills this contracted task expects the target worker to apply (e.g. argentos-code-verification)",
    }),
  ),
  model: Type.Optional(Type.String({ description: "Model ID (e.g. claude-sonnet-4-20250514)" })),
  team: Type.Optional(Type.String({ description: "Team name (e.g. dev-team, marketing-team)" })),

  // ── message ──
  recipient: Type.Optional(Type.String({ description: "Target agent ID" })),
  message_type: Type.Optional(
    Type.Union(
      [
        Type.Literal("task_handoff"),
        Type.Literal("observation"),
        Type.Literal("alert"),
        Type.Literal("lesson_shared"),
      ],
      { description: "Message type for the family stream" },
    ),
  ),
  content: Type.Optional(Type.String({ description: "Message body or knowledge content" })),
  wake: Type.Optional(
    Type.Boolean({
      description: "If true, also spawn the recipient agent to process the message immediately",
    }),
  ),

  // ── publish ──
  title: Type.Optional(Type.String({ description: "Knowledge entry title" })),
  category: Type.Optional(
    Type.Union(
      [
        Type.Literal("lesson"),
        Type.Literal("fact"),
        Type.Literal("tool_tip"),
        Type.Literal("pattern"),
      ],
      { description: "Knowledge category" },
    ),
  ),
  confidence: Type.Optional(
    Type.Number({ description: "Confidence score 0-1 (default 0.7)", minimum: 0, maximum: 1 }),
  ),
  source_agent_id: Type.Optional(
    Type.String({ description: "Which agent produced this knowledge (defaults to argent)" }),
  ),

  // ── search ──
  query: Type.Optional(Type.String({ description: "Search query for shared knowledge" })),
  limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
  reset: Type.Optional(Type.Boolean({ description: "Reset telemetry counters before returning" })),

  // ── spawn / dispatch / spawn_team ──
  task: Type.Optional(Type.String({ description: "Task to assign to the spawned agent(s)" })),
  task_id: Type.Optional(Type.String({ description: "Optional parent task ID for audit linkage" })),
  mode: Type.Optional(
    Type.Union([Type.Literal("auto"), Type.Literal("family"), Type.Literal("subagent")]),
  ),
  timeout_ms: Type.Optional(
    Type.Number({ description: "Contract timeout in milliseconds (default 30000)" }),
  ),
  heartbeat_interval_ms: Type.Optional(
    Type.Number({ description: "Contract heartbeat interval in milliseconds (default 5000)" }),
  ),
  toolsAllow: Type.Optional(
    Type.Array(Type.String(), { description: "Per-run tool allowlist for spawned session" }),
  ),
  toolsDeny: Type.Optional(
    Type.Array(Type.String(), { description: "Per-run tool denylist for spawned session" }),
  ),
  contract_id: Type.Optional(
    Type.String({ description: "Dispatch contract ID for history lookup" }),
  ),
  target_agent_id: Type.Optional(
    Type.String({ description: "Filter contract history by target agent ID" }),
  ),
  contract_status: Type.Optional(
    Type.Union([
      Type.Literal("contract_created"),
      Type.Literal("accepted"),
      Type.Literal("started"),
      Type.Literal("heartbeat"),
      Type.Literal("completed"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
    ]),
  ),
  include_events: Type.Optional(
    Type.Boolean({
      description: "Include ordered lifecycle events for each returned contract",
    }),
  ),
  project: Type.Optional(Type.String({ description: "Project description for spawn_team" })),
});

/** Context needed to spawn subagent sessions on behalf of the caller. */
export interface FamilyToolSpawnContext {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  requesterAgentIdOverride?: string;
}

type FamilyTelemetryCounterKey =
  | "dispatchTotal"
  | "dispatchModeAuto"
  | "dispatchModeFamily"
  | "dispatchModeSubagent"
  | "dispatchRouteFamily"
  | "dispatchRouteSubagent"
  | "dispatchSuccess"
  | "dispatchFailure"
  | "spawnDirectBlocked"
  | "spawnExplicitTotal"
  | "spawnExplicitSuccess"
  | "spawnExplicitFailure"
  | "spawnThinkTankExecutionBlocked";

type FamilyTelemetryEvent = {
  at: number;
  event: string;
  details?: Record<string, unknown>;
};

const FAMILY_TELEMETRY_EVENT_LIMIT = 40;
const FAMILY_TELEMETRY_COUNTER_KEYS: FamilyTelemetryCounterKey[] = [
  "dispatchTotal",
  "dispatchModeAuto",
  "dispatchModeFamily",
  "dispatchModeSubagent",
  "dispatchRouteFamily",
  "dispatchRouteSubagent",
  "dispatchSuccess",
  "dispatchFailure",
  "spawnDirectBlocked",
  "spawnExplicitTotal",
  "spawnExplicitSuccess",
  "spawnExplicitFailure",
  "spawnThinkTankExecutionBlocked",
];

function createEmptyFamilyTelemetryCounters(): Record<FamilyTelemetryCounterKey, number> {
  return {
    dispatchTotal: 0,
    dispatchModeAuto: 0,
    dispatchModeFamily: 0,
    dispatchModeSubagent: 0,
    dispatchRouteFamily: 0,
    dispatchRouteSubagent: 0,
    dispatchSuccess: 0,
    dispatchFailure: 0,
    spawnDirectBlocked: 0,
    spawnExplicitTotal: 0,
    spawnExplicitSuccess: 0,
    spawnExplicitFailure: 0,
    spawnThinkTankExecutionBlocked: 0,
  };
}

const familyTelemetryState: {
  startedAt: number;
  updatedAt: number;
  counters: Record<FamilyTelemetryCounterKey, number>;
  recent: FamilyTelemetryEvent[];
} = {
  startedAt: Date.now(),
  updatedAt: Date.now(),
  counters: createEmptyFamilyTelemetryCounters(),
  recent: [],
};

function incFamilyTelemetryCounter(counter: FamilyTelemetryCounterKey) {
  familyTelemetryState.counters[counter] += 1;
  familyTelemetryState.updatedAt = Date.now();
}

function recordFamilyTelemetryEvent(event: string, details?: Record<string, unknown>) {
  familyTelemetryState.updatedAt = Date.now();
  familyTelemetryState.recent.push({
    at: Date.now(),
    event,
    details,
  });
  if (familyTelemetryState.recent.length > FAMILY_TELEMETRY_EVENT_LIMIT) {
    familyTelemetryState.recent.splice(
      0,
      familyTelemetryState.recent.length - FAMILY_TELEMETRY_EVENT_LIMIT,
    );
  }
}

function resetFamilyTelemetry() {
  const now = Date.now();
  familyTelemetryState.startedAt = now;
  familyTelemetryState.updatedAt = now;
  familyTelemetryState.counters = createEmptyFamilyTelemetryCounters();
  familyTelemetryState.recent = [];
}

function snapshotFamilyTelemetry() {
  const counters = Object.fromEntries(
    FAMILY_TELEMETRY_COUNTER_KEYS.map((key) => [key, familyTelemetryState.counters[key]]),
  ) as Record<FamilyTelemetryCounterKey, number>;
  return {
    startedAt: new Date(familyTelemetryState.startedAt).toISOString(),
    updatedAt: new Date(familyTelemetryState.updatedAt).toISOString(),
    counters,
    recent: familyTelemetryState.recent.map((entry) => ({
      at: new Date(entry.at).toISOString(),
      event: entry.event,
      details: entry.details,
    })),
  };
}

export function getFamilyTelemetrySnapshot() {
  return snapshotFamilyTelemetry();
}

export function resetFamilyDelegationTelemetry() {
  resetFamilyTelemetry();
  recordFamilyTelemetryEvent("telemetry.reset");
}

function readToolResultOk(result: unknown): boolean | undefined {
  if (!result || typeof result !== "object") return undefined;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const ok = (details as { ok?: unknown }).ok;
  return typeof ok === "boolean" ? ok : undefined;
}

function readToolResultError(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const error = (details as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

function readToolResultSessionKey(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const value = (details as { sessionKey?: unknown }).sessionKey;
  return typeof value === "string" ? value : undefined;
}

function readToolResultRunId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const value = (details as { runId?: unknown }).runId;
  return typeof value === "string" ? value : undefined;
}

function readToolResultAgent(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const agent = (details as { agent?: unknown }).agent;
  return agent && typeof agent === "object" && !Array.isArray(agent)
    ? (agent as Record<string, unknown>)
    : undefined;
}

export function createFamilyTool(
  opts?: { agentId?: string } & FamilyToolSpawnContext,
): AnyAgentTool {
  return {
    label: "Agent Family",
    name: "family",
    description: `Manage the agent family — register new agents, list members, send messages, share knowledge, spawn agents.

Actions:
  register — Create or update a family agent. Required: id, name, role. Optional: persona, tools, model, team.
  list — List all registered family members with alive/dead status.
  message — Send a message to another agent via the family stream. Required: recipient, content. Optional: message_type, wake.
  inbox — Read pending messages from the family stream addressed to you. Optional: limit (default 10).
  publish — Share knowledge to the family library. Required: title, content, category. Optional: confidence, source_agent_id.
  search — Full-text search the shared knowledge library. Required: query. Optional: limit.
  telemetry — Show/reset family delegation counters (dispatch volume/routes + blocked direct spawn). Optional: reset.
  spawn — Wake a family agent and assign a task. Required: id, task, mode=family. Optional: model, toolsAllow, toolsDeny.
  dispatch — Route task with guardrails: auto -> dev-team for technical work or strict sub-agent fallback; think-tank only via explicit mode=family + id. Required: task. Optional: mode, id, model, toolsAllow, toolsDeny.
  dispatch_contracted — Create an auditable dispatch contract, then execute guarded dispatch. Required: task. Optional: task_id, mode, id, timeout_ms, heartbeat_interval_ms, model, toolsAllow, toolsDeny.
  contract_history — Query dispatch contract history. Optional: contract_id, task_id, target_agent_id, contract_status, limit, include_events.
  spawn_team — Wake all agents in a team for a project. Required: team, project.`,
    parameters: FamilyToolSchema,

    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "register":
          return await handleRegister(params, opts?.agentId);
        case "list":
          return await handleList();
        case "message":
          return await handleMessage(params, opts?.agentId, opts);
        case "inbox":
          return await handleInbox(params, opts?.agentId);
        case "publish":
          return await handlePublish(params, opts?.agentId);
        case "search":
          return await handleSearch(params);
        case "telemetry":
          return handleTelemetry(params);
        case "spawn":
          return await handleSpawn(params, opts);
        case "dispatch":
          return await handleDispatch(params, opts);
        case "dispatch_contracted":
          return await handleDispatchContracted(params, opts);
        case "contract_history":
          return await handleContractHistory(params);
        case "spawn_team":
          return await handleSpawnTeam(params, opts);
        default:
          return jsonResult({ error: `Unknown action: ${action}` });
      }
    },
  };
}

async function handleContractHistory(params: Record<string, unknown>) {
  const contractId = readStringParam(params, "contract_id");
  const taskId = readStringParam(params, "task_id");
  const targetAgentId = readStringParam(params, "target_agent_id");
  const status = readStringParam(params, "contract_status");
  const includeEvents = params.include_events === true;
  const limit = readNumberParam(params, "limit", { integer: true }) ?? 50;

  if (!Number.isFinite(limit) || limit <= 0) {
    return jsonResult({ ok: false, error: "limit must be a positive integer." });
  }

  const { getDispatchContract, listDispatchContracts, listDispatchContractEvents } =
    await import("../../infra/dispatch-contracts.js");

  if (contractId) {
    const contract = await getDispatchContract(contractId);
    if (!contract) {
      return jsonResult({ ok: false, error: `dispatch contract not found: ${contractId}` });
    }
    if (!includeEvents) {
      return jsonResult({
        ok: true,
        contracts: [serializeDispatchContract(contract)],
        count: 1,
      });
    }
    const events = sortDispatchContractEvents(
      await listDispatchContractEvents(contractId, Math.max(1, limit)),
    );
    return jsonResult({
      ok: true,
      contracts: [serializeDispatchContract(contract)],
      events: events.map(serializeDispatchContractEvent),
      count: 1,
    });
  }

  const contracts = await listDispatchContracts({
    status: status as
      | "contract_created"
      | "accepted"
      | "started"
      | "heartbeat"
      | "completed"
      | "failed"
      | "cancelled"
      | undefined,
    targetAgentId: targetAgentId ?? undefined,
    taskId: taskId ?? undefined,
    limit: Math.max(1, limit),
  });

  if (!includeEvents) {
    return jsonResult({
      ok: true,
      contracts: contracts.map(serializeDispatchContract),
      count: contracts.length,
    });
  }

  const eventsByContract = Object.fromEntries(
    await Promise.all(
      contracts.map(async (contract) => {
        const events = sortDispatchContractEvents(
          await listDispatchContractEvents(contract.contractId, Math.max(1, limit)),
        );
        return [contract.contractId, events.map(serializeDispatchContractEvent)] as const;
      }),
    ),
  );

  return jsonResult({
    ok: true,
    contracts: contracts.map(serializeDispatchContract),
    eventsByContract,
    count: contracts.length,
  });
}

function serializeDispatchContract(contract: DispatchContractRecord) {
  return {
    contract_id: contract.contractId,
    task_id: contract.taskId,
    task: contract.task,
    target_agent_id: contract.targetAgentId,
    dispatched_by: contract.dispatchedBy,
    tool_grant_snapshot: [...contract.toolGrantSnapshot],
    timeout_ms: contract.timeoutMs,
    heartbeat_interval_ms: contract.heartbeatIntervalMs,
    status: contract.status,
    created_at: contract.createdAt.toISOString(),
    updated_at: contract.updatedAt.toISOString(),
    expires_at: contract.expiresAt ? contract.expiresAt.toISOString() : null,
    accepted_at: contract.acceptedAt ? contract.acceptedAt.toISOString() : null,
    started_at: contract.startedAt ? contract.startedAt.toISOString() : null,
    last_heartbeat_at: contract.lastHeartbeatAt ? contract.lastHeartbeatAt.toISOString() : null,
    completed_at: contract.completedAt ? contract.completedAt.toISOString() : null,
    failed_at: contract.failedAt ? contract.failedAt.toISOString() : null,
    cancelled_at: contract.cancelledAt ? contract.cancelledAt.toISOString() : null,
    failure_reason: contract.failureReason,
    result_summary: contract.resultSummary,
    metadata: { ...contract.metadata },
  };
}

function serializeDispatchContractEvent(event: DispatchContractEvent) {
  return {
    id: event.id,
    contract_id: event.contractId,
    status: event.status,
    event_at: event.eventAt.toISOString(),
    payload: { ...event.payload },
  };
}

function sortDispatchContractEvents<T extends { id: number; eventAt: Date }>(events: T[]): T[] {
  return events.slice().sort((a, b) => {
    const timeDiff = a.eventAt.getTime() - b.eventAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id - b.id;
  });
}

function handleTelemetry(params: Record<string, unknown>) {
  const reset = params.reset === true;
  if (reset) {
    resetFamilyDelegationTelemetry();
  }
  return jsonResult({
    ok: true,
    telemetry: getFamilyTelemetrySnapshot(),
  });
}

// ── register ──────────────────────────────────────────────────────────────

async function handleRegister(params: Record<string, unknown>, callerAgentId?: string) {
  const id = readStringParam(params, "id", { required: true });
  const name = readStringParam(params, "name", { required: true });
  const role = readStringParam(params, "role", { required: true });
  const persona = readStringParam(params, "persona");
  const tools = readStringArrayParam(params, "tools");
  const skills = readStringArrayParam(params, "skills");
  const model = readStringParam(params, "model");
  const team = readStringParam(params, "team");

  // Validate ID: lowercase, no spaces, alphanumeric + hyphens
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    return jsonResult({
      error:
        "Agent ID must be lowercase, start with a letter, and contain only letters, numbers, and hyphens.",
    });
  }

  const provisioned = await provisionFamilyWorker({
    id,
    name,
    role,
    persona,
    tools,
    skills,
    model,
    team,
    callerAgentId,
  });

  return jsonResult({
    ok: true,
    agent: {
      id: provisioned.id,
      name: provisioned.name,
      role: provisioned.role,
      team: provisioned.team,
      model: provisioned.model,
      provider: provisioned.provider,
      skills: provisioned.skills,
      skillSource: provisioned.skillSource,
      skillDefaultKey: provisioned.skillDefaultKey,
      identityDir: provisioned.identityDir,
    },
    redis: provisioned.redis,
    message: `Agent "${provisioned.name}" (${provisioned.id}) registered. Identity bootstrapped at ${provisioned.identityDir}`,
  });
}

// ── list ──────────────────────────────────────────────────────────────────

async function handleList() {
  const family = await getAgentFamily();
  const members = await family.listMembers();

  // Encode family list as TOON for compact LLM context
  const agents = members.map((m) => ({
    id: m.id,
    name: m.name,
    role: m.role,
    team: m.team ?? "unassigned",
    skills: m.skills ?? [],
    skillSource: m.skillSource ?? "unmapped",
    skillDefaultKey: m.skillDefaultKey,
    status: m.status,
    alive: m.alive,
  }));
  const toon = encodeForPrompt({ count: agents.length, agents });
  return {
    content: [{ type: "text" as const, text: toon }],
    details: { count: agents.length, agents },
  };
}

// ── message ───────────────────────────────────────────────────────────────

async function handleMessage(
  params: Record<string, unknown>,
  callerAgentId?: string,
  spawnCtx?: FamilyToolSpawnContext,
) {
  const recipient = readStringParam(params, "recipient", { required: true });
  const content = readStringParam(params, "content", { required: true });
  const messageType = readStringParam(params, "message_type") ?? "observation";
  const wake = params.wake === true;
  const sender = callerAgentId ?? "argent";

  try {
    const family = await getAgentFamily();
    const redis = family.getRedis();

    if (!redis) {
      return jsonResult({ error: "Redis not available — cannot send family messages." });
    }

    const streamId = await sendFamilyMessage(redis, {
      sender,
      type: messageType as "task_handoff" | "observation" | "alert",
      recipient,
      payload: content,
    });

    // If wake=true, also spawn the recipient agent with the message as task
    let spawnResult: Record<string, unknown> | undefined;
    if (wake) {
      const result = await spawnFamilyAgent(
        recipient,
        `You received a message from ${sender} (type: ${messageType}):\n\n${content}\n\nProcess this message and take appropriate action.`,
        spawnCtx,
      );
      spawnResult = result;
    }

    return jsonResult({
      ok: true,
      streamId,
      from: sender,
      to: recipient,
      type: messageType,
      wake: wake ? spawnResult : undefined,
      message: wake
        ? `Message sent to ${recipient} and agent woken to process it.`
        : `Message sent to ${recipient}.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResult({ error: `Failed to send message: ${msg}` });
  }
}

// ── inbox ────────────────────────────────────────────────────────────────

async function handleInbox(params: Record<string, unknown>, callerAgentId?: string) {
  const agentId = callerAgentId ?? "argent";
  const count = readNumberParam(params, "limit", { integer: true }) ?? 10;

  try {
    const family = await getAgentFamily();
    const redis = family.getRedis();

    if (!redis) {
      return jsonResult({ error: "Redis not available — cannot read family messages." });
    }

    const raw = await readFamilyMessages(redis, agentId, count);

    // Filter: keep messages addressed to this agent or broadcast (*)
    const mine = raw.filter((m) => {
      const r = m.message.recipient;
      return !r || r === agentId;
    });

    // Acknowledge consumed messages
    if (mine.length > 0) {
      await ackFamilyMessages(
        redis,
        agentId,
        mine.map((m) => m.id),
      );
    }

    // Encode inbox messages as TOON for compact LLM context (40-50% token savings)
    const messages = mine.map((m) => ({
      id: m.id,
      from: m.message.sender,
      type: m.message.type,
      content: m.message.payload,
    }));
    const toonEncoded =
      messages.length > 0 ? encodeForPrompt({ agentId, count: messages.length, messages }) : null;
    return toonEncoded
      ? {
          content: [{ type: "text" as const, text: toonEncoded }],
          details: { agentId, count: messages.length, messages },
        }
      : jsonResult({ agentId, count: 0, messages: [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResult({ error: `Failed to read inbox: ${msg}` });
  }
}

// ── spawn ────────────────────────────────────────────────────────────────

const THINK_TANK_AGENT_IDS = new Set(["elon", "sam", "dario", "jensen"]);
const THINK_TANK_SAFE_TOOLS = [
  "read",
  "web_search",
  "web_fetch",
  "memory_recall",
  "memory_store",
  "doc_panel",
  "doc_panel_get",
  "doc_panel_list",
  "doc_panel_search",
  "os_docs",
  "sessions_send",
  "sessions_list",
  "sessions_history",
  "atera_tickets",
];
const THINK_TANK_DENY_TOOLS = [
  "atera_ticket",
  "exec",
  "bash",
  "write",
  "edit",
  "doc_panel_update",
  "doc_panel_delete",
  "tasks",
];
const DEV_TEAM_DEFAULT_TOOLS = [
  "read",
  "write",
  "edit",
  "bash",
  "web_search",
  "web_fetch",
  "memory_recall",
  "memory_store",
  "doc_panel",
  "doc_panel_get",
  "doc_panel_update",
  "doc_panel_list",
  "doc_panel_search",
  "os_docs",
  "sessions_send",
  "sessions_list",
  "sessions_history",
  "tasks",
];
const DEV_TEAM_DEFAULT_DENY_TOOLS = ["atera_ticket"];
const SUBAGENT_STRICT_DEFAULT_TOOLS = [
  "read",
  "web_search",
  "web_fetch",
  "memory_recall",
  "memory_store",
  "doc_panel",
  "doc_panel_get",
  "doc_panel_list",
  "doc_panel_search",
  "os_docs",
];
const SUBAGENT_STRICT_DEFAULT_DENY_TOOLS = ["atera_ticket"];

function normalizeToolGrantList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const deduped = new Set<string>();
  for (const item of value) {
    const normalized = typeof item === "string" ? item.trim().toLowerCase() : "";
    if (!normalized) continue;
    deduped.add(normalized);
  }
  return deduped.size > 0 ? Array.from(deduped) : [];
}

function isThinkTankAgent(agent: {
  id: string;
  role: string;
  config?: Record<string, unknown>;
}): boolean {
  if (THINK_TANK_AGENT_IDS.has(agent.id.toLowerCase())) return true;
  const role = String(agent.role ?? "").toLowerCase();
  const team = String(agent.config?.team ?? "").toLowerCase();
  return role.includes("think_tank") || role.includes("think-tank") || team === "think-tank";
}

function isAdvisoryTask(task: string): boolean {
  const text = task.toLowerCase();
  const advisoryHints = [
    "analy",
    "strategy",
    "summar",
    "brainstorm",
    "evaluate",
    "compare",
    "options",
    "report",
    "recommend",
    "think tank",
    "advice",
  ];
  return advisoryHints.some((hint) => text.includes(hint));
}

function isDevTask(task: string): boolean {
  const text = task.toLowerCase();
  const devHints = [
    "code",
    "build",
    "compile",
    "fix",
    "bug",
    "test",
    "qa",
    "frontend",
    "backend",
    "refactor",
    "typescript",
    "react",
    "dashboard",
    "ui",
    "api",
    "graph api",
    "microsoft graph",
    "sharepoint",
    "scope",
    "least-privilege",
    "least privilege",
    "oauth",
    "tenant id",
    "client id",
  ];
  return devHints.some((hint) => text.includes(hint));
}

function isTechnicalResearchTask(task: string): boolean {
  const text = task.toLowerCase();
  const researchHints = [
    "research",
    "investigate",
    "analy",
    "compare",
    "evaluate",
    "least-privilege",
  ];
  if (!researchHints.some((hint) => text.includes(hint))) return false;
  return isDevTask(task);
}

type DispatchCandidate = { id: string; role: string; team?: string };

function scoreDispatchCandidate(
  candidate: DispatchCandidate,
  task: string,
  preferredTeam: "think-tank" | "dev-team" | null,
): number {
  const text = task.toLowerCase();
  const role = candidate.role.toLowerCase();
  let score = 0;

  if (preferredTeam === "think-tank") {
    if (role.includes("think_tank") || role.includes("think-tank")) score += 40;
    if (text.includes("strategy") || text.includes("recommend") || text.includes("options"))
      score += 20;
    return score;
  }

  const mentionsResearch =
    text.includes("research") || text.includes("investigate") || text.includes("analy");
  const mentionsBuild =
    text.includes("fix") ||
    text.includes("build") ||
    text.includes("code") ||
    text.includes("implement") ||
    text.includes("refactor") ||
    text.includes("typescript");
  const mentionsTest = text.includes("test") || text.includes("qa");

  if (mentionsResearch) {
    if (role.includes("research")) score += 40;
    if (role.includes("analyst")) score += 35;
    if (role.includes("software_engineer")) score += 20;
  }
  if (mentionsBuild) {
    if (role.includes("software_engineer")) score += 40;
    if (role.includes("integration")) score += 30;
    if (role.includes("frontend") || role.includes("backend")) score += 25;
  }
  if (mentionsTest) {
    if (role.includes("qa")) score += 35;
    if (role.includes("software_engineer")) score += 15;
  }

  if (score === 0) {
    if (role.includes("software_engineer")) score += 10;
    if (role.includes("research")) score += 8;
    if (role.includes("analyst")) score += 6;
  }
  return score;
}

function isModelSelectionFailure(errorText: string | undefined): boolean {
  if (!errorText) return false;
  const text = errorText.toLowerCase();
  return text.includes("model not allowed") || text.includes("invalid model");
}

function isExecutionTask(task: string): boolean {
  const text = task.toLowerCase();
  const executionHints = [
    "assign",
    "reassign",
    "comment on",
    "update ticket",
    "close ticket",
    "delete",
    "deploy",
    "run ",
    "execute",
    "patch",
    "edit file",
    "write file",
    "create task",
    "atera_ticket",
    "ticket ",
  ];
  return executionHints.some((hint) => text.includes(hint));
}

function mergeToolLists(primary?: string[], secondary?: string[]): string[] | undefined {
  const merged = new Set<string>();
  for (const list of [primary, secondary]) {
    if (!list) continue;
    for (const item of list) {
      const normalized = item.trim().toLowerCase();
      if (!normalized) continue;
      merged.add(normalized);
    }
  }
  return merged.size > 0 ? Array.from(merged) : undefined;
}

function intersectWithSafeTools(requested: string[] | undefined, safeTools: string[]): string[] {
  if (!requested || requested.length === 0) return safeTools;
  const safeSet = new Set(safeTools.map((tool) => tool.toLowerCase()));
  const filtered = requested.filter((tool) => safeSet.has(tool.toLowerCase()));
  return filtered.length > 0 ? filtered : safeTools;
}

async function handleSpawn(
  params: Record<string, unknown>,
  spawnCtx?: FamilyToolSpawnContext & { agentId?: string },
  source: "direct" | "dispatch-family" = "direct",
) {
  const id = readStringParam(params, "id", { required: true });
  const task = readStringParam(params, "task", { required: true });
  const mode = readStringParam(params, "mode");
  const model = readStringParam(params, "model");
  const toolsAllowParam = normalizeToolGrantList(params.toolsAllow);
  const toolsDenyParam = normalizeToolGrantList(params.toolsDeny);

  if (mode !== "family") {
    if (source === "direct") {
      incFamilyTelemetryCounter("spawnDirectBlocked");
      recordFamilyTelemetryEvent("spawn.blocked.direct", {
        id,
        mode: mode ?? "(unset)",
      });
    }
    return jsonResult({
      ok: false,
      error:
        'Direct family.spawn is locked. Use family.dispatch for delegation routing, or set mode="family" to explicitly target a named family agent.',
    });
  }

  // Verify agent exists
  const family = await getAgentFamily();
  const agent = await family.getAgent(id);
  if (!agent) {
    return jsonResult({ error: `Agent "${id}" is not registered. Use register first.` });
  }
  if (agent.status !== "active") {
    return jsonResult({ error: `Agent "${id}" is inactive.` });
  }

  const thinkTank = isThinkTankAgent(agent);
  if (thinkTank && !isAdvisoryTask(task) && isExecutionTask(task)) {
    incFamilyTelemetryCounter("spawnThinkTankExecutionBlocked");
    recordFamilyTelemetryEvent("spawn.blocked.think-tank-execution", {
      id,
      role: agent.role,
    });
    return jsonResult({
      ok: false,
      error: `Agent "${id}" is think-tank/advisory only. Use sessions_spawn for execution tasks with explicit toolsAllow/toolsDeny grants.`,
    });
  }

  const toolsAllow = thinkTank ? (toolsAllowParam ?? THINK_TANK_SAFE_TOOLS) : toolsAllowParam;
  const toolsDeny = toolsDenyParam;

  const result = await spawnFamilyAgent(id, task, spawnCtx, model, toolsAllow, toolsDeny);
  incFamilyTelemetryCounter("spawnExplicitTotal");
  if (result.ok) {
    incFamilyTelemetryCounter("spawnExplicitSuccess");
    recordFamilyTelemetryEvent("spawn.success", { id, source });
  } else {
    incFamilyTelemetryCounter("spawnExplicitFailure");
    recordFamilyTelemetryEvent("spawn.failure", { id, source, error: result.error });
  }

  // Update Redis presence
  try {
    const redis = family.getRedis();
    if (redis) {
      await refreshPresence(redis, id);
      await setAgentState(redis, id, {
        status: "processing",
        lastActivity: new Date().toISOString(),
      });
    }
  } catch {
    /* Redis optional */
  }

  return jsonResult({
    ok: result.ok,
    agent: {
      id,
      name: agent.name,
      role: agent.role,
      skills: Array.isArray(agent.config.skills) ? agent.config.skills : [],
      skillSource:
        typeof agent.config.skillSource === "string" ? agent.config.skillSource : undefined,
      skillDefaultKey:
        typeof agent.config.skillDefaultKey === "string" ? agent.config.skillDefaultKey : undefined,
    },
    sessionKey: result.childSessionKey,
    runId: result.runId,
    error: result.ok ? undefined : result.error,
    message: result.ok
      ? `Agent "${agent.name}" (${id}) spawned with task.`
      : `Failed to spawn agent "${id}": ${result.error}`,
  });
}

async function handleDispatch(
  params: Record<string, unknown>,
  spawnCtx?: FamilyToolSpawnContext & { agentId?: string },
) {
  const task = readStringParam(params, "task", { required: true });
  const mode = readStringParam(params, "mode") || "auto";
  const model = readStringParam(params, "model");
  const requestedId = readStringParam(params, "id");
  const toolsAllow = normalizeToolGrantList(params.toolsAllow);
  const toolsDeny = normalizeToolGrantList(params.toolsDeny);

  const family = await getAgentFamily();
  const advisoryTask = isAdvisoryTask(task);
  const devTask = isDevTask(task);
  const technicalResearchTask = isTechnicalResearchTask(task);

  let targetMode: "family" | "subagent";
  let preferredTeam: "think-tank" | "dev-team" | null = null;
  if (mode === "family") {
    targetMode = "family";
    preferredTeam =
      technicalResearchTask || devTask ? "dev-team" : advisoryTask ? "think-tank" : null;
  } else if (mode === "subagent") {
    targetMode = "subagent";
  } else if (technicalResearchTask || devTask) {
    targetMode = "family";
    preferredTeam = "dev-team";
  } else {
    // Auto mode never routes to think-tank unless explicitly requested.
    targetMode = "subagent";
  }

  incFamilyTelemetryCounter("dispatchTotal");
  if (mode === "auto") {
    incFamilyTelemetryCounter("dispatchModeAuto");
  } else if (mode === "family") {
    incFamilyTelemetryCounter("dispatchModeFamily");
  } else {
    incFamilyTelemetryCounter("dispatchModeSubagent");
  }

  if (targetMode === "family") {
    const candidates: DispatchCandidate[] = [];
    const seenIds = new Set<string>();
    const pushCandidate = (id: string, role: string, team?: string) => {
      const normalizedId = id.trim().toLowerCase();
      if (!normalizedId || seenIds.has(normalizedId)) return;
      seenIds.add(normalizedId);
      candidates.push({ id, role, team });
    };

    if (requestedId) {
      const agent = await family.getAgent(requestedId);
      if (agent) {
        pushCandidate(agent.id, agent.role, String(agent.config?.team ?? "") || undefined);
      } else {
        pushCandidate(requestedId, "");
      }
    } else if (preferredTeam) {
      if (preferredTeam === "think-tank") {
        incFamilyTelemetryCounter("dispatchFailure");
        recordFamilyTelemetryEvent("dispatch.route.blocked", {
          mode,
          reason: "think-tank-requires-explicit-id",
        });
        return jsonResult({
          ok: false,
          error:
            'Think-tank routing requires explicit target. Use family.dispatch with mode="family" and id="<think-tank-agent>".',
        });
      }
      const members = await family.listTeamMembers(preferredTeam);
      for (const member of members) {
        pushCandidate(member.id, member.role, preferredTeam);
      }
      candidates.sort(
        (a, b) =>
          scoreDispatchCandidate(b, task, preferredTeam) -
          scoreDispatchCandidate(a, task, preferredTeam),
      );
    }

    if (candidates.length === 0 && preferredTeam === "dev-team" && mode === "auto") {
      targetMode = "subagent";
      preferredTeam = null;
      recordFamilyTelemetryEvent("dispatch.route.fallback", {
        mode,
        reason: "dev-team-unavailable",
      });
    }
    if (targetMode === "family") {
      if (candidates.length === 0) {
        if (preferredTeam === "think-tank") {
          const thinkTankMembers = await family.listTeamMembers("think-tank");
          for (const member of thinkTankMembers) {
            pushCandidate(member.id, member.role, "think-tank");
          }
          if (candidates.length === 0) {
            pushCandidate("dario", "think_tank_panelist", "think-tank");
          }
        } else {
          const members = await family.listMembers();
          const nonThinkTankMembers = members.filter(
            (member) =>
              !(
                String(member.team ?? "")
                  .trim()
                  .toLowerCase() === "think-tank"
              ),
          );
          for (const member of nonThinkTankMembers) {
            pushCandidate(member.id, member.role, member.team);
          }
          if (candidates.length === 0) {
            const fallback = members[0];
            if (fallback) {
              pushCandidate(fallback.id, fallback.role, fallback.team);
            } else {
              pushCandidate("forge", "software_engineer", "dev-team");
            }
          }
        }
      }
      incFamilyTelemetryCounter("dispatchRouteFamily");
      recordFamilyTelemetryEvent("dispatch.route", {
        mode,
        targetMode,
        preferredTeam: preferredTeam ?? "(none)",
        chosen: candidates[0]?.id ?? "(none)",
        candidates: candidates.map((c) => c.id),
      });
      if (candidates.length === 0) {
        return jsonResult({ ok: false, error: "No eligible family agent found for dispatch." });
      }
      const routedToolsAllow =
        preferredTeam === "think-tank"
          ? intersectWithSafeTools(toolsAllow, THINK_TANK_SAFE_TOOLS)
          : (toolsAllow ?? DEV_TEAM_DEFAULT_TOOLS);
      const routedToolsDeny =
        preferredTeam === "think-tank"
          ? mergeToolLists(toolsDeny, THINK_TANK_DENY_TOOLS)
          : mergeToolLists(toolsDeny, DEV_TEAM_DEFAULT_DENY_TOOLS);
      for (let index = 0; index < candidates.length; index += 1) {
        const chosen = candidates[index];
        const routed = await handleSpawn(
          {
            id: chosen.id,
            task,
            mode: "family",
            model,
            toolsAllow: routedToolsAllow,
            toolsDeny: routedToolsDeny,
          },
          spawnCtx,
          "dispatch-family",
        );
        const ok = readToolResultOk(routed);
        if (ok === true) {
          incFamilyTelemetryCounter("dispatchSuccess");
          return routed;
        }
        const errorText = readToolResultError(routed);
        recordFamilyTelemetryEvent("dispatch.family.failure", {
          mode,
          preferredTeam: preferredTeam ?? "(none)",
          chosen: chosen.id,
          index,
          error: errorText ?? "failed",
        });
        const canRetryNext =
          mode === "auto" &&
          !requestedId &&
          isModelSelectionFailure(errorText) &&
          index < candidates.length - 1;
        if (canRetryNext) {
          recordFamilyTelemetryEvent("dispatch.route.retry-next", {
            mode,
            preferredTeam: preferredTeam ?? "(none)",
            from: chosen.id,
            to: candidates[index + 1]?.id,
            reason: "model-selection-failure",
          });
          continue;
        }
        if (mode === "auto" && !requestedId && isModelSelectionFailure(errorText)) {
          recordFamilyTelemetryEvent("dispatch.route.fallback", {
            mode,
            preferredTeam: preferredTeam ?? "(none)",
            reason: "family-model-selection-failure",
          });
          targetMode = "subagent";
          preferredTeam = null;
          break;
        }
        incFamilyTelemetryCounter("dispatchFailure");
        return routed;
      }
      if (targetMode === "family") {
        incFamilyTelemetryCounter("dispatchFailure");
        return jsonResult({ ok: false, error: "Failed to dispatch to family candidates." });
      }
    }
  }

  incFamilyTelemetryCounter("dispatchRouteSubagent");
  recordFamilyTelemetryEvent("dispatch.route", {
    mode,
    targetMode: "subagent",
    preferredTeam: preferredTeam ?? "(none)",
  });

  try {
    const { spawnSubagentSession } = await import("./sessions-spawn-helpers.js");
    const { normalizeDeliveryContext } = await import("../../utils/delivery-context.js");
    const { loadConfig } = await import("../../config/config.js");
    const { resolveMainSessionAlias, resolveInternalSessionKey, resolveDisplaySessionKey } =
      await import("./sessions-helpers.js");

    const cfg = loadConfig();
    const { mainKey, alias } = resolveMainSessionAlias(cfg);
    const requesterSessionKey = spawnCtx?.agentSessionKey;
    const requesterInternalKey = requesterSessionKey
      ? resolveInternalSessionKey({ key: requesterSessionKey, alias, mainKey })
      : alias;
    const requesterDisplayKey = resolveDisplaySessionKey({
      key: requesterInternalKey,
      alias,
      mainKey,
    });

    const requesterOrigin = normalizeDeliveryContext({
      channel: spawnCtx?.agentChannel,
      accountId: spawnCtx?.agentAccountId,
      to: spawnCtx?.agentTo,
      threadId: spawnCtx?.agentThreadId,
    });

    const result = await spawnSubagentSession({
      task,
      label: "dispatch:worker",
      modelOverride: model,
      requesterInternalKey,
      requesterDisplayKey,
      requesterOrigin,
      requesterAgentIdOverride: spawnCtx?.requesterAgentIdOverride,
      toolsAllow: intersectWithSafeTools(toolsAllow, SUBAGENT_STRICT_DEFAULT_TOOLS),
      toolsDeny: mergeToolLists(toolsDeny, SUBAGENT_STRICT_DEFAULT_DENY_TOOLS),
      groupId: spawnCtx?.agentGroupId,
      groupChannel: spawnCtx?.agentGroupChannel,
      groupSpace: spawnCtx?.agentGroupSpace,
    });

    if (result.ok) {
      incFamilyTelemetryCounter("dispatchSuccess");
      recordFamilyTelemetryEvent("dispatch.subagent.success", {
        mode,
        sessionKey: result.childSessionKey,
      });
    } else {
      incFamilyTelemetryCounter("dispatchFailure");
      recordFamilyTelemetryEvent("dispatch.subagent.failure", {
        mode,
        error: (result as { error?: string }).error ?? "error",
      });
    }

    return jsonResult({
      ok: result.ok,
      mode: "subagent",
      runId: result.runId,
      sessionKey: result.childSessionKey,
      error: result.ok ? undefined : (result as { error?: string }).error,
      message: result.ok
        ? "Spawned strict sub-agent worker with per-run tool grants."
        : `Failed to spawn strict sub-agent worker: ${(result as { error?: string }).error ?? "error"}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResult({ ok: false, error: msg });
  }
}

async function handleDispatchContracted(
  params: Record<string, unknown>,
  spawnCtx?: FamilyToolSpawnContext & { agentId?: string },
) {
  const task = readStringParam(params, "task", { required: true });
  const taskId = readStringParam(params, "task_id");
  const mode = readStringParam(params, "mode") || "auto";
  const timeoutMs = readNumberParam(params, "timeout_ms", { integer: true }) ?? 30_000;
  const heartbeatIntervalMs =
    readNumberParam(params, "heartbeat_interval_ms", { integer: true }) ?? 5_000;
  const contractToolGrant = normalizeToolGrantList(params.toolsAllow);
  const skillsRequired = readStringArrayParam(params, "skillsRequired") ?? [];

  if (!contractToolGrant || contractToolGrant.length === 0) {
    return jsonResult({
      ok: false,
      error: "dispatch_contracted requires toolsAllow (non-empty) as tool_grant_snapshot.",
    });
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return jsonResult({ ok: false, error: "timeout_ms must be a positive integer." });
  }
  if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
    return jsonResult({ ok: false, error: "heartbeat_interval_ms must be a positive integer." });
  }
  if (heartbeatIntervalMs > timeoutMs) {
    return jsonResult({ ok: false, error: "heartbeat_interval_ms must be <= timeout_ms." });
  }

  const dispatchedBy = spawnCtx?.agentId ?? spawnCtx?.requesterAgentIdOverride ?? "argent";
  const targetAgentId = readStringParam(params, "id") ?? "auto";
  let effectiveContractGrant = [...contractToolGrant];
  let targetForContract: {
    id: string;
    name: string;
    role: string;
    status: string;
    config: Record<string, unknown>;
  } | null = null;

  if (mode === "subagent") {
    const safeSet = new Set(SUBAGENT_STRICT_DEFAULT_TOOLS.map((tool) => tool.toLowerCase()));
    const disallowed = effectiveContractGrant.filter((tool) => !safeSet.has(tool.toLowerCase()));
    if (disallowed.length > 0) {
      return jsonResult({
        ok: false,
        error: `dispatch_contracted tool grant violates strict subagent policy: ${disallowed.join(", ")}`,
      });
    }
  }

  if (mode === "family" && targetAgentId !== "auto") {
    const family = await getAgentFamily();
    targetForContract = await family.getAgent(targetAgentId);
    if (targetForContract && isThinkTankAgent(targetForContract)) {
      const safeSet = new Set(THINK_TANK_SAFE_TOOLS.map((tool) => tool.toLowerCase()));
      const disallowed = effectiveContractGrant.filter((tool) => !safeSet.has(tool.toLowerCase()));
      if (disallowed.length > 0) {
        return jsonResult({
          ok: false,
          error: `dispatch_contracted tool grant violates think-tank policy: ${disallowed.join(", ")}`,
        });
      }
      effectiveContractGrant = intersectWithSafeTools(
        effectiveContractGrant,
        THINK_TANK_SAFE_TOOLS,
      );
    }
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + timeoutMs);

  let contractId: string;
  try {
    const { createDispatchContract } = await import("../../infra/dispatch-contracts.js");
    const created = await createDispatchContract({
      taskId,
      task,
      targetAgentId,
      dispatchedBy,
      toolGrantSnapshot: effectiveContractGrant,
      timeoutMs,
      heartbeatIntervalMs,
      createdAt,
      expiresAt,
      metadata: {
        mode,
        skillsRequired,
        targetSkillsSnapshot: Array.isArray(targetForContract?.config.skills)
          ? targetForContract.config.skills
          : [],
        targetSkillSource:
          typeof targetForContract?.config.skillSource === "string"
            ? targetForContract.config.skillSource
            : undefined,
        targetSkillDefaultKey:
          typeof targetForContract?.config.skillDefaultKey === "string"
            ? targetForContract.config.skillDefaultKey
            : undefined,
      },
    });
    contractId = created.contractId;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResult({
      ok: false,
      error: `Failed to create dispatch contract: ${message}`,
    });
  }

  try {
    const routed = await handleDispatch(
      {
        ...params,
        action: "dispatch",
        task,
        mode,
        toolsAllow: effectiveContractGrant,
      },
      spawnCtx,
    );

    const ok = readToolResultOk(routed) === true;
    const runId = readToolResultRunId(routed);
    const sessionKey = readToolResultSessionKey(routed);
    const targetAgent = readToolResultAgent(routed);
    const dispatchError = readToolResultError(routed) ?? "dispatch failed";
    const { appendDispatchContractEvent } = await import("../../infra/dispatch-contracts.js");

    if (ok) {
      await appendDispatchContractEvent({
        contractId,
        status: "accepted",
        payload: { mode, skillsRequired },
      });
      await appendDispatchContractEvent({
        contractId,
        status: "started",
        payload: {
          mode,
          runId: runId ?? null,
          sessionKey: sessionKey ?? null,
          targetAgent: targetAgent ?? null,
          skillsRequired,
        },
      });
      return jsonResult({
        ok: true,
        contract_id: contractId,
        contract_status: "started",
        expires_at: expiresAt.toISOString(),
        runId,
        sessionKey,
        dispatch: (routed as { details?: unknown }).details,
      });
    }

    await appendDispatchContractEvent({
      contractId,
      status: "failed",
      failureReason: dispatchError,
      payload: { mode },
    });
    return jsonResult({
      ok: false,
      contract_id: contractId,
      contract_status: "failed",
      expires_at: expiresAt.toISOString(),
      error: dispatchError,
      dispatch: (routed as { details?: unknown }).details,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      const { appendDispatchContractEvent } = await import("../../infra/dispatch-contracts.js");
      await appendDispatchContractEvent({
        contractId,
        status: "failed",
        failureReason: message,
        payload: { mode },
      });
    } catch {
      // best effort
    }
    return jsonResult({
      ok: false,
      contract_id: contractId,
      contract_status: "failed",
      expires_at: expiresAt.toISOString(),
      error: message,
    });
  }
}

// ── spawn_team ───────────────────────────────────────────────────────────

async function handleSpawnTeam(
  params: Record<string, unknown>,
  spawnCtx?: FamilyToolSpawnContext & { agentId?: string },
) {
  const team = readStringParam(params, "team", { required: true });
  const project = readStringParam(params, "project", { required: true });

  const family = await getAgentFamily();
  const members = await family.listTeamMembers(team);

  if (members.length === 0) {
    return jsonResult({ error: `No active agents found in team "${team}".` });
  }

  const results: Array<{
    id: string;
    name: string;
    role: string;
    ok: boolean;
    sessionKey?: string;
    runId?: string;
    error?: string;
  }> = [];

  // Spawn all team members concurrently
  const spawnPromises = members.map(async (member) => {
    const agentTask = `Project: ${project}\n\nYour role as ${member.name} (${member.role}): Contribute your expertise to this project.`;
    const result = await spawnFamilyAgent(member.id, agentTask, spawnCtx);
    return {
      id: member.id,
      name: member.name,
      role: member.role,
      ok: result.ok,
      sessionKey: result.childSessionKey,
      runId: result.runId,
      error: result.ok ? undefined : result.error,
    };
  });

  const spawned = await Promise.all(spawnPromises);
  results.push(...spawned);

  const successCount = results.filter((r) => r.ok).length;

  return jsonResult({
    ok: successCount > 0,
    team,
    project,
    spawned: results,
    message: `Spawned ${successCount}/${members.length} agents from team "${team}".`,
  });
}

// ── Shared spawn helper ──────────────────────────────────────────────────

async function spawnFamilyAgent(
  agentId: string,
  task: string,
  spawnCtx?: FamilyToolSpawnContext & { agentId?: string },
  modelOverride?: string,
  toolsAllow?: string[],
  toolsDeny?: string[],
): Promise<{ ok: boolean; childSessionKey?: string; runId?: string; error?: string }> {
  try {
    const { spawnSubagentSession } = await import("./sessions-spawn-helpers.js");
    const { normalizeDeliveryContext } = await import("../../utils/delivery-context.js");
    const { loadConfig } = await import("../../config/config.js");
    const { normalizeAgentId, parseAgentSessionKey } = await import("../../routing/session-key.js");
    const { resolveMainSessionAlias, resolveInternalSessionKey, resolveDisplaySessionKey } =
      await import("./sessions-helpers.js");

    const cfg = loadConfig();
    const { mainKey, alias } = resolveMainSessionAlias(cfg);

    const requesterSessionKey = spawnCtx?.agentSessionKey;
    const requesterInternalKey = requesterSessionKey
      ? resolveInternalSessionKey({ key: requesterSessionKey, alias, mainKey })
      : alias;
    const requesterDisplayKey = resolveDisplaySessionKey({
      key: requesterInternalKey,
      alias,
      mainKey,
    });

    const requesterOrigin = normalizeDeliveryContext({
      channel: spawnCtx?.agentChannel,
      accountId: spawnCtx?.agentAccountId,
      to: spawnCtx?.agentTo,
      threadId: spawnCtx?.agentThreadId,
    });

    const result = await spawnSubagentSession({
      task,
      label: `family:${agentId}`,
      modelOverride,
      toolsAllow,
      toolsDeny,
      requesterInternalKey,
      requesterDisplayKey,
      requesterOrigin,
      requesterAgentIdOverride: spawnCtx?.requesterAgentIdOverride,
      requestedAgentId: agentId,
      groupId: spawnCtx?.agentGroupId,
      groupChannel: spawnCtx?.agentGroupChannel,
      groupSpace: spawnCtx?.agentGroupSpace,
    });

    return {
      ok: result.ok,
      childSessionKey: result.childSessionKey,
      runId: result.runId,
      error: result.ok ? undefined : (result as { error?: string }).error,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ── publish ───────────────────────────────────────────────────────────────

async function handlePublish(params: Record<string, unknown>, callerAgentId?: string) {
  const title = readStringParam(params, "title", { required: true });
  const content = readStringParam(params, "content", { required: true });
  const category = readStringParam(params, "category", { required: true }) as
    | "lesson"
    | "fact"
    | "tool_tip"
    | "pattern";
  const confidence = readNumberParam(params, "confidence") ?? 0.7;
  const sourceAgentId = readStringParam(params, "source_agent_id") ?? callerAgentId ?? "argent";

  const family = await getAgentFamily();
  const entry = await family.publishKnowledge({
    sourceAgentId,
    category,
    title,
    content,
    confidence,
  });

  return jsonResult({
    ok: true,
    knowledge: {
      id: entry.id,
      title: entry.title,
      category: entry.category,
      confidence: entry.confidence,
      sourceAgent: entry.sourceAgentId,
    },
    message: `Knowledge "${title}" published to family library.`,
  });
}

// ── search ────────────────────────────────────────────────────────────────

async function handleSearch(params: Record<string, unknown>) {
  const query = readStringParam(params, "query", { required: true });
  const limit = readNumberParam(params, "limit", { integer: true }) ?? 10;

  const family = await getAgentFamily();
  const results = await family.searchKnowledge(query, limit);

  return jsonResult({
    query,
    count: results.length,
    results: results.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      content: r.content,
      confidence: r.confidence,
      endorsements: r.endorsements,
      sourceAgent: r.sourceAgentId,
      createdAt: r.createdAt,
    })),
  });
}
