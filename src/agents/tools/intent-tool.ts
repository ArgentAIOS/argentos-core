import { Type } from "@sinclair/typebox";
import type {
  ArgentConfig,
  IntentAgentConfig,
  IntentConfig,
  IntentDepartmentConfig,
  IntentGlobalConfig,
} from "../../config/types.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import {
  appendIntentHistory,
  getCopilotAccessMode,
  readCopilotState,
  setCopilotAccessMode,
  type CopilotAccessMode,
} from "../copilot-state.js";
import {
  buildIntentSystemPromptHint,
  resolveEffectiveIntentForAgent,
  validateIntentHierarchy,
} from "../intent.js";
import { type AnyAgentTool, jsonResult, readNumberParam, readStringParam } from "./common.js";

const IntentToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("overview"),
    Type.Literal("company_get"),
    Type.Literal("department_get"),
    Type.Literal("agent_get"),
    Type.Literal("effective_resolve"),
    Type.Literal("draft_from_interview"),
    Type.Literal("diff"),
    Type.Literal("validate"),
    Type.Literal("apply"),
    Type.Literal("access_mode_get"),
    Type.Literal("access_mode_set"),
    Type.Literal("history"),
    Type.Literal("rollback"),
  ]),
  departmentId: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  role: Type.Optional(Type.String()),
  interviewNotes: Type.Optional(Type.String()),
  draftIntent: Type.Optional(Type.Any()),
  proposedIntent: Type.Optional(Type.Any()),
  actor: Type.Optional(Type.Union([Type.Literal("operator"), Type.Literal("ai-assisted")])),
  reason: Type.Optional(Type.String()),
  mode: Type.Optional(
    Type.Union([
      Type.Literal("off"),
      Type.Literal("assist-draft"),
      Type.Literal("assist-propose"),
      Type.Literal("assist-live-limited"),
    ]),
  ),
  historyLimit: Type.Optional(Type.Number()),
  entryId: Type.Optional(Type.String()),
  steps: Type.Optional(Type.Number()),
});

function asIntentConfig(value: unknown): IntentConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as IntentConfig;
}

function ensureIntent(cfg: ArgentConfig): IntentConfig {
  return (
    cfg.intent ?? {
      enabled: true,
      validationMode: "warn",
      runtimeMode: "advisory",
      global: {},
      departments: {},
      agents: {},
    }
  );
}

function normalizeIntentShape(intent: IntentConfig): IntentConfig {
  return {
    enabled: intent.enabled ?? true,
    validationMode: intent.validationMode ?? "warn",
    runtimeMode: intent.runtimeMode ?? "advisory",
    global: intent.global ?? {},
    departments: intent.departments ?? {},
    agents: intent.agents ?? {},
    simulationGate: intent.simulationGate,
  };
}

function buildInterviewDraft(params: {
  role?: string;
  departmentId?: string;
  interviewNotes?: string;
}): IntentConfig {
  const departmentId = params.departmentId?.trim();
  const role = params.role?.trim();
  const notes = params.interviewNotes?.trim();
  const objectiveBase = role
    ? `Operate as ${role} with truthful execution, safe escalation, and stable continuity.`
    : "Operate with truthful execution, safe escalation, and stable continuity.";

  const global: IntentGlobalConfig = {
    objective: objectiveBase,
    tradeoffHierarchy: ["truth", "safety", "continuity", "speed"],
    neverDo: ["hallucinate facts", "hide uncertainty", "commit beyond approved scope"],
    requiresHumanApproval: ["external commitments", "policy exceptions"],
    requireAcknowledgmentBeforeClose: true,
    usePersistentHistory: true,
    weightPreviousEscalations: true,
    owner: "operator",
  };

  const departments: Record<string, IntentDepartmentConfig> = {};
  if (departmentId) {
    departments[departmentId] = {
      objective: `Deliver reliable ${departmentId} outcomes while preserving trust and scope discipline.`,
      parentGlobalVersion: undefined,
      escalation: {
        maxAttemptsBeforeEscalation: 2,
      },
    };
  }

  const agents: Record<string, IntentAgentConfig> = {};
  if (role) {
    agents.main = {
      role,
      departmentId,
      objective: objectiveBase,
      escalation: {
        maxAttemptsBeforeEscalation: 2,
      },
      owner: "ai-assisted",
    };
  }

  return normalizeIntentShape({
    enabled: true,
    validationMode: "warn",
    runtimeMode: "advisory",
    global,
    departments,
    agents,
    simulationGate: {
      enabled: true,
      mode: "warn",
      minPassRate: 0.8,
    },
    ...(notes ? { global: { ...global, objective: `${objectiveBase} Notes: ${notes}` } } : {}),
  });
}

function diffObjects(
  before: unknown,
  after: unknown,
  pathPrefix = "",
): Array<Record<string, unknown>> {
  if (before === after) {
    return [];
  }
  const isObj = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(before) || !isObj(after)) {
    return [{ path: pathPrefix || "<root>", before, after }];
  }
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).toSorted();
  const out: Array<Record<string, unknown>> = [];
  for (const key of keys) {
    const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    out.push(...diffObjects(b[key], a[key], childPath));
  }
  return out;
}

function requireIntent(action: string, value: unknown): IntentConfig {
  const parsed = asIntentConfig(value);
  if (!parsed) {
    throw new Error(`${action} requires a valid intent object`);
  }
  return normalizeIntentShape(parsed);
}

export function createIntentTool(): AnyAgentTool {
  return {
    type: "function",
    name: "intent_tool",
    description:
      "Intent Co-Pilot control plane: inspect intent by layer, resolve effective policy, draft/validate/diff/apply updates, manage access mode, and rollback from intent history.",
    parameters: IntentToolSchema,
    strict: true,
    async execute(args) {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action");
      const cfg = loadConfig();
      const currentIntent = normalizeIntentShape(ensureIntent(cfg));

      if (action === "overview") {
        const issues = validateIntentHierarchy(cfg);
        const state = await readCopilotState();
        return jsonResult({
          accessMode: state.accessModes.intent ?? "assist-draft",
          intentEnabled: currentIntent.enabled ?? false,
          validationMode: currentIntent.validationMode ?? "warn",
          runtimeMode: currentIntent.runtimeMode ?? "advisory",
          globalObjective: currentIntent.global?.objective ?? "",
          departmentsCount: Object.keys(currentIntent.departments ?? {}).length,
          agentsCount: Object.keys(currentIntent.agents ?? {}).length,
          issuesCount: issues.length,
          issues,
          historyCount: state.intentHistory.length,
        });
      }

      if (action === "company_get") {
        return jsonResult({
          global: currentIntent.global ?? {},
          simulationGate: currentIntent.simulationGate ?? {},
          runtimeMode: currentIntent.runtimeMode ?? "advisory",
          validationMode: currentIntent.validationMode ?? "warn",
        });
      }

      if (action === "department_get") {
        const departmentId = readStringParam(params, "departmentId", { required: true });
        return jsonResult({
          departmentId,
          department: currentIntent.departments?.[departmentId] ?? null,
        });
      }

      if (action === "agent_get") {
        const agentId = readStringParam(params, "agentId", { required: true });
        return jsonResult({
          agentId,
          agent: currentIntent.agents?.[agentId] ?? null,
        });
      }

      if (action === "effective_resolve") {
        const agentId = readStringParam(params, "agentId", { required: true });
        const resolved = resolveEffectiveIntentForAgent({
          config: cfg,
          agentId,
        });
        return jsonResult({
          agentId,
          resolved: resolved
            ? {
                ...resolved,
                promptHint: buildIntentSystemPromptHint(resolved.policy),
              }
            : null,
        });
      }

      if (action === "draft_from_interview") {
        const role = readStringParam(params, "role");
        const departmentId = readStringParam(params, "departmentId");
        const interviewNotes = readStringParam(params, "interviewNotes");
        const draft = buildInterviewDraft({
          role,
          departmentId,
          interviewNotes,
        });
        return jsonResult({
          draft,
          notes:
            "Draft created from interview guidance. Review with intent_tool(action=validate|diff) before apply.",
        });
      }

      if (action === "diff") {
        const draftIntent = requireIntent("diff", params.draftIntent);
        return jsonResult({
          changes: diffObjects(currentIntent, draftIntent),
        });
      }

      if (action === "validate") {
        const proposedIntent = requireIntent("validate", params.proposedIntent);
        const proposedConfig: ArgentConfig = { ...cfg, intent: proposedIntent };
        const issues = validateIntentHierarchy(proposedConfig);
        return jsonResult({
          valid: issues.length === 0,
          issues,
          validationMode: proposedIntent.validationMode ?? "warn",
          runtimeMode: proposedIntent.runtimeMode ?? "advisory",
        });
      }

      if (action === "access_mode_get") {
        return jsonResult({
          domain: "intent",
          mode: await getCopilotAccessMode("intent"),
        });
      }

      if (action === "access_mode_set") {
        const mode = readStringParam(params, "mode", { required: true }) as CopilotAccessMode;
        if (!["off", "assist-draft", "assist-propose", "assist-live-limited"].includes(mode)) {
          throw new Error(`invalid mode "${mode}"`);
        }
        await setCopilotAccessMode("intent", mode);
        return jsonResult({
          domain: "intent",
          mode,
        });
      }

      if (action === "apply") {
        const mode = await getCopilotAccessMode("intent");
        if (mode === "off" || mode === "assist-draft") {
          throw new Error(
            `intent apply blocked by access mode "${mode}". Use access_mode_set to enable assist-propose or assist-live-limited.`,
          );
        }
        const proposedIntent = requireIntent("apply", params.proposedIntent);
        const proposedConfig: ArgentConfig = { ...cfg, intent: proposedIntent };
        const issues = validateIntentHierarchy(proposedConfig);
        if (issues.length > 0) {
          return jsonResult({
            applied: false,
            reason: "validation_failed",
            issues,
          });
        }
        await writeConfigFile(proposedConfig);
        const actorRaw = readStringParam(params, "actor");
        const actor = actorRaw === "operator" ? "operator" : "ai-assisted";
        const reason = readStringParam(params, "reason");
        const historyEntry = await appendIntentHistory({
          actor,
          reason,
          before: currentIntent,
          after: proposedIntent,
        });
        return jsonResult({
          applied: true,
          historyEntry,
        });
      }

      if (action === "history") {
        const state = await readCopilotState();
        const limit = Math.max(1, Math.min(200, readNumberParam(params, "historyLimit") ?? 20));
        return jsonResult({
          entries: state.intentHistory.slice(0, limit),
          total: state.intentHistory.length,
        });
      }

      if (action === "rollback") {
        const state = await readCopilotState();
        const entryId = readStringParam(params, "entryId");
        const steps = Math.max(1, Math.floor(readNumberParam(params, "steps") ?? 1));
        const target =
          entryId && entryId.length > 0
            ? state.intentHistory.find((entry) => entry.id === entryId)
            : state.intentHistory[steps - 1];
        if (!target) {
          throw new Error("rollback target not found");
        }
        const nextConfig: ArgentConfig = { ...cfg, intent: target.before ?? undefined };
        await writeConfigFile(nextConfig);
        const appliedIntent = normalizeIntentShape(ensureIntent(nextConfig));
        const rollbackEntry = await appendIntentHistory({
          actor: "operator",
          reason: `rollback:${target.id}`,
          before: currentIntent,
          after: appliedIntent,
        });
        return jsonResult({
          rolledBackTo: target.id,
          rollbackEntry,
        });
      }

      throw new Error(`unsupported action: ${action}`);
    },
  };
}
