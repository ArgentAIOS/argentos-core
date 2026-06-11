import { Type } from "@sinclair/typebox";
import type {
  JobDeploymentStage,
  JobExecutionMode,
  JobRelationshipContract,
} from "../../data/types.js";
import { loadConfig } from "../../config/config.js";
import { getAgentFamily } from "../../data/agent-family.js";
import { isStrictPostgresOnly } from "../../data/storage-config.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import { resolveRuntimeStorageConfig } from "../../data/storage-resolver.js";
import { provisionFamilyWorker } from "../family-worker-provisioning.js";
import {
  type AnyAgentTool,
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
} from "./common.js";

const WorkforceSetupToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("agent_options"),
    Type.Literal("draft"),
    Type.Literal("worker_create"),
    Type.Literal("template_create"),
    Type.Literal("assignment_create"),
    Type.Literal("project_start"),
  ]),
  targetMode: Type.Optional(
    Type.Union([Type.Literal("primary"), Type.Literal("existing"), Type.Literal("create")]),
  ),
  roleName: Type.Optional(Type.String()),
  brief: Type.Optional(Type.String()),
  departmentId: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  rolePrompt: Type.Optional(Type.String()),
  sop: Type.Optional(Type.String()),
  successDefinition: Type.Optional(Type.String()),
  defaultStage: Type.Optional(
    Type.Union([
      Type.Literal("simulate"),
      Type.Literal("shadow"),
      Type.Literal("limited-live"),
      Type.Literal("live"),
    ]),
  ),
  targetAgentId: Type.Optional(Type.String()),
  assignmentTitle: Type.Optional(Type.String()),
  cadenceMinutes: Type.Optional(Type.Number()),
  reviewRequired: Type.Optional(Type.Boolean()),
  scopeLimit: Type.Optional(Type.String()),
  toolsAllow: Type.Optional(Type.Array(Type.String())),
  toolsDeny: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
  scenarios: Type.Optional(Type.Array(Type.String())),
  relationshipObjective: Type.Optional(Type.String()),
  toneProfile: Type.Optional(Type.String()),
  trustPriorities: Type.Optional(Type.Array(Type.String())),
  continuityRequirements: Type.Optional(Type.Array(Type.String())),
  honestyRules: Type.Optional(Type.Array(Type.String())),
  handoffStyle: Type.Optional(Type.String()),
  relationalFailureModes: Type.Optional(Type.Array(Type.String())),
  templateId: Type.Optional(Type.String()),
  newAgentId: Type.Optional(Type.String()),
  newAgentName: Type.Optional(Type.String()),
  newAgentRole: Type.Optional(Type.String()),
  newAgentPersona: Type.Optional(Type.String()),
  newAgentTeam: Type.Optional(Type.String()),
  newAgentModel: Type.Optional(Type.String()),
  newAgentTools: Type.Optional(Type.Array(Type.String())),
});

type WorkerTargetMode = "primary" | "existing" | "create";

type WorkerDraft = {
  id?: string;
  name?: string;
  role?: string;
  persona?: string;
  team?: string;
  model?: string;
  tools?: string[];
};

type DraftContext = {
  targetMode?: WorkerTargetMode;
  roleName?: string;
  brief?: string;
  departmentId?: string;
  description?: string;
  rolePrompt?: string;
  sop?: string;
  successDefinition?: string;
  defaultStage?: JobDeploymentStage;
  targetAgentId?: string;
  assignmentTitle?: string;
  cadenceMinutes?: number;
  reviewRequired?: boolean;
  scopeLimit?: string;
  toolsAllow?: string[];
  toolsDeny?: string[];
  tags?: string[];
  scenarios?: string[];
  relationshipContract?: JobRelationshipContract;
  workerDraft?: WorkerDraft;
};

function isDevLikeRuntime(env: NodeJS.ProcessEnv): boolean {
  const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();
  return nodeEnv === "development" || nodeEnv === "test" || Boolean(env.VITEST);
}

function enforceWorkforceStoragePolicy(env: NodeJS.ProcessEnv = process.env): void {
  const cfg = resolveRuntimeStorageConfig(env);
  if (isStrictPostgresOnly(cfg)) {
    return;
  }
  if (isDevLikeRuntime(env) || env.ARGENT_ALLOW_NON_PG_WORKFORCE === "1") {
    return;
  }

  const writeTo = cfg.writeTo.join(",");
  throw new Error(
    `workforce requires PostgreSQL-canonical storage in production (backend=${cfg.backend}, readFrom=${cfg.readFrom}, writeTo=${writeTo}). Set storage.backend=postgres with read/write on postgres only.`,
  );
}

async function getWorkforceStorageAdapter() {
  enforceWorkforceStoragePolicy(process.env);
  return getStorageAdapter();
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStage(raw: string | undefined): JobDeploymentStage | undefined {
  switch ((raw ?? "").trim()) {
    case "shadow":
    case "limited-live":
    case "live":
    case "simulate":
      return raw as JobDeploymentStage;
    default:
      return undefined;
  }
}

function normalizeTargetMode(raw: string | undefined): WorkerTargetMode | undefined {
  switch ((raw ?? "").trim()) {
    case "primary":
    case "existing":
    case "create":
      return raw as WorkerTargetMode;
    default:
      return undefined;
  }
}

function modeFromStage(stage: JobDeploymentStage | undefined): JobExecutionMode {
  return stage === "live" ? "live" : "simulate";
}

function slugifyAgentId(raw: string | undefined): string | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) {
    return undefined;
  }
  const slug = value
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || undefined;
}

function normalizeRelationshipContract(
  params: Record<string, unknown>,
): JobRelationshipContract | undefined {
  const contract: JobRelationshipContract = {
    relationshipObjective: trimOrUndefined(readStringParam(params, "relationshipObjective")),
    toneProfile: trimOrUndefined(readStringParam(params, "toneProfile")),
    trustPriorities: readStringArrayParam(params, "trustPriorities"),
    continuityRequirements: readStringArrayParam(params, "continuityRequirements"),
    honestyRules: readStringArrayParam(params, "honestyRules"),
    handoffStyle: trimOrUndefined(readStringParam(params, "handoffStyle")),
    relationalFailureModes: readStringArrayParam(params, "relationalFailureModes"),
  };
  return Object.values(contract).some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return Boolean(value);
  })
    ? contract
    : undefined;
}

async function listWorkerAgents(): Promise<
  Array<{ id: string; label: string; role: "primary" | "family" }>
> {
  const cfg = loadConfig();
  const configuredAgents = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const primary = { id: "main", label: "Argent (Primary)", role: "primary" as const };
  const byId = new Map<string, { id: string; label: string; role: "family" }>();

  for (const entry of configuredAgents) {
    const id = entry?.id?.trim();
    if (!id || id === "main" || id === "argent") {
      continue;
    }
    const name = entry?.name?.trim();
    byId.set(id, {
      id,
      label: name ? `${name} (${id})` : `Family Agent (${id})`,
      role: "family",
    });
  }

  try {
    const family = await getAgentFamily();
    const members = await family.listMembers();
    for (const member of members) {
      const id = member.id?.trim();
      if (!id || id === "main" || id === "argent") {
        continue;
      }
      const name = member.name?.trim();
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          label: name ? `${name} (${id})` : `Family Agent (${id})`,
          role: "family",
        });
      }
    }
  } catch {
    // Best effort only: fallback to configured agents list.
  }

  const family = Array.from(byId.values()).toSorted((a, b) => a.label.localeCompare(b.label));
  return [primary, ...family];
}

function buildWorkerDraft(
  params: Record<string, unknown>,
  context: DraftContext,
): WorkerDraft | undefined {
  const draft: WorkerDraft = {
    id: slugifyAgentId(readStringParam(params, "newAgentId")) ?? slugifyAgentId(context.roleName),
    name: trimOrUndefined(readStringParam(params, "newAgentName")) ?? context.roleName,
    role: trimOrUndefined(readStringParam(params, "newAgentRole")) ?? context.roleName,
    persona: trimOrUndefined(readStringParam(params, "newAgentPersona")),
    team: trimOrUndefined(readStringParam(params, "newAgentTeam")) ?? context.departmentId,
    model: trimOrUndefined(readStringParam(params, "newAgentModel")),
    tools: readStringArrayParam(params, "newAgentTools"),
  };
  return Object.values(draft).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  )
    ? draft
    : undefined;
}

function buildDraftContext(params: Record<string, unknown>): DraftContext {
  const context: DraftContext = {
    targetMode: normalizeTargetMode(readStringParam(params, "targetMode")),
    roleName: trimOrUndefined(readStringParam(params, "roleName")),
    brief: trimOrUndefined(readStringParam(params, "brief")),
    departmentId: trimOrUndefined(readStringParam(params, "departmentId")),
    description: trimOrUndefined(readStringParam(params, "description")),
    rolePrompt: trimOrUndefined(readStringParam(params, "rolePrompt")),
    sop: trimOrUndefined(readStringParam(params, "sop")),
    successDefinition: trimOrUndefined(readStringParam(params, "successDefinition")),
    defaultStage: normalizeStage(readStringParam(params, "defaultStage")),
    targetAgentId: trimOrUndefined(readStringParam(params, "targetAgentId")),
    assignmentTitle: trimOrUndefined(readStringParam(params, "assignmentTitle")),
    cadenceMinutes: readNumberParam(params, "cadenceMinutes", { integer: true }),
    reviewRequired: typeof params.reviewRequired === "boolean" ? params.reviewRequired : undefined,
    scopeLimit: trimOrUndefined(readStringParam(params, "scopeLimit")),
    toolsAllow: readStringArrayParam(params, "toolsAllow"),
    toolsDeny: readStringArrayParam(params, "toolsDeny"),
    tags: readStringArrayParam(params, "tags"),
    scenarios: readStringArrayParam(params, "scenarios"),
    relationshipContract: normalizeRelationshipContract(params),
  };
  context.workerDraft = buildWorkerDraft(params, context);
  return context;
}

function buildMissingItems(context: DraftContext, requireAssignment: boolean): string[] {
  const missing: string[] = [];
  if (!context.roleName) {
    missing.push("roleName");
  }
  if (!context.rolePrompt && !context.brief) {
    missing.push("rolePrompt_or_brief");
  }
  if (!context.successDefinition) {
    missing.push("successDefinition");
  }
  if (!context.relationshipContract?.relationshipObjective) {
    missing.push("relationshipObjective");
  }
  if (!context.scenarios || context.scenarios.length === 0) {
    missing.push("simulationScenarios");
  }
  if (requireAssignment && !context.targetMode) {
    missing.push("targetMode");
  }
  if (requireAssignment && context.targetMode === "existing" && !context.targetAgentId) {
    missing.push("targetAgentId");
  }
  if (requireAssignment && context.targetMode === "create") {
    if (!context.workerDraft?.name) {
      missing.push("newAgentName");
    }
    if (!context.workerDraft?.role) {
      missing.push("newAgentRole");
    }
  }
  if (requireAssignment && !context.cadenceMinutes) {
    missing.push("cadenceMinutes");
  }
  return missing;
}

function buildFollowUpQuestions(missing: string[]): string[] {
  const questions: string[] = [];
  for (const key of missing) {
    switch (key) {
      case "roleName":
        questions.push("What is the worker role called from the operator’s point of view?");
        break;
      case "rolePrompt_or_brief":
        questions.push(
          "What should this worker actually do day to day, and what are its explicit boundaries?",
        );
        break;
      case "successDefinition":
        questions.push(
          "How will you know this role is succeeding beyond raw throughput or closure speed?",
        );
        break;
      case "relationshipObjective":
        questions.push(
          "What relationship should this role preserve or create for the customer or internal stakeholder?",
        );
        break;
      case "simulationScenarios":
        questions.push(
          "Which realistic test scenarios should this role survive before promotion? Add at least 2-3.",
        );
        break;
      case "targetMode":
        questions.push(
          "Should this role run on Argent (Primary), an existing family worker, or should I create a new family worker for it?",
        );
        break;
      case "targetAgentId":
        questions.push("Which existing family worker should own this role?");
        break;
      case "newAgentName":
        questions.push("What should the new family worker be called?");
        break;
      case "newAgentRole":
        questions.push("What is the persistent role/title of the new family worker?");
        break;
      case "cadenceMinutes":
        questions.push("How often should this worker run when active?");
        break;
      default:
        questions.push(`What should be set for ${key}?`);
    }
  }
  return questions;
}

function buildTemplateDraft(context: DraftContext) {
  const name = context.roleName ?? "New Worker Role";
  const stage = context.defaultStage ?? "simulate";
  return {
    name,
    departmentId: context.departmentId,
    description: context.description,
    rolePrompt: context.rolePrompt ?? context.brief ?? "",
    sop: context.sop,
    successDefinition: context.successDefinition,
    defaultMode: modeFromStage(stage),
    defaultStage: stage,
    toolsAllow: context.toolsAllow,
    toolsDeny: context.toolsDeny,
    relationshipContract: context.relationshipContract,
    tags: context.tags,
    metadata:
      context.scenarios && context.scenarios.length > 0
        ? { simulationScenarios: context.scenarios }
        : undefined,
  };
}

function resolveAssignmentAgentId(context: DraftContext): string {
  if (context.targetMode === "primary") {
    return "main";
  }
  if (context.targetMode === "create") {
    return context.workerDraft?.id ?? "main";
  }
  return context.targetAgentId ?? "main";
}

function buildAssignmentDraft(context: DraftContext, templateId?: string) {
  const stage = context.defaultStage ?? "simulate";
  return {
    templateId,
    agentId: resolveAssignmentAgentId(context),
    title: context.assignmentTitle ?? context.roleName ?? "New Worker Assignment",
    cadenceMinutes: context.cadenceMinutes ?? 1440,
    executionMode: modeFromStage(stage),
    deploymentStage: stage,
    promotionState: "draft" as const,
    scopeLimit: context.scopeLimit,
    reviewRequired: context.reviewRequired ?? true,
  };
}

async function createWorkerFromDraft(context: DraftContext) {
  const draft = context.workerDraft;
  if (!draft?.name || !draft.role) {
    throw new Error("new family worker requires name and role");
  }
  return provisionFamilyWorker({
    id: draft.id ?? slugifyAgentId(draft.name) ?? "family-worker",
    name: draft.name,
    role: draft.role,
    persona: draft.persona,
    tools: draft.tools,
    model: draft.model,
    team: draft.team,
    callerAgentId: "argent",
  });
}

export function createWorkforceSetupTool(): AnyAgentTool {
  return {
    label: "Workforce Setup",
    name: "workforce_setup_tool",
    description:
      "Guide the operator through setting up a worker role. Use this to draft missing fields, suggest the next questions, list assignable agents, and create workforce templates/assignments once the role contract is clear.",
    parameters: WorkforceSetupToolSchema,
    async execute(_toolCallId, args) {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const context = buildDraftContext(params);
      const workerAgents = await listWorkerAgents();

      if (action === "agent_options") {
        return jsonResult({
          agents: workerAgents,
          targetModes: [
            { id: "primary", label: "Argent (Primary)" },
            { id: "existing", label: "Existing Family Worker" },
            { id: "create", label: "Create New Family Worker" },
          ],
          guidance:
            "Assign roles to Argent (Primary), pick an existing family worker, or create a new family worker when the role needs a persistent specialist.",
        });
      }

      if (action === "draft") {
        const missing = buildMissingItems(context, false);
        return jsonResult({
          summary:
            "Draft the worker role conversationally, then use project_start once the operator has confirmed the role contract and target agent.",
          agentOptions: workerAgents,
          targetModes: [
            { id: "primary", label: "Argent (Primary)" },
            { id: "existing", label: "Existing Family Worker" },
            { id: "create", label: "Create New Family Worker" },
          ],
          missing,
          followUpQuestions: buildFollowUpQuestions(missing),
          templateDraft: buildTemplateDraft(context),
          assignmentDraft: buildAssignmentDraft(context),
          workerDraft: context.workerDraft,
        });
      }

      if (action === "worker_create") {
        const required = buildMissingItems({ ...context, cadenceMinutes: 1 }, true).filter(
          (item) =>
            ![
              "cadenceMinutes",
              "simulationScenarios",
              "relationshipObjective",
              "successDefinition",
              "rolePrompt_or_brief",
            ].includes(item),
        );
        if (!context.targetMode) {
          required.unshift("targetMode");
        }
        if (context.targetMode !== "create") {
          return jsonResult({
            ok: false,
            error: "worker_create requires targetMode=create.",
            targetMode: context.targetMode ?? null,
          });
        }
        if (required.length > 0) {
          return jsonResult({
            ok: false,
            error: "Missing information for family worker creation.",
            missing: required,
            followUpQuestions: buildFollowUpQuestions(required),
            workerDraft: context.workerDraft,
          });
        }
        const worker = await createWorkerFromDraft(context);
        return jsonResult({
          ok: true,
          worker,
          nextStep:
            "Use workforce_setup_tool with action=project_start to create the template and assignment for this new worker.",
        });
      }

      if (action === "template_create") {
        const missing = buildMissingItems(context, false);
        if (missing.length > 0) {
          return jsonResult({
            ok: false,
            error: "Missing information for template creation.",
            missing,
            followUpQuestions: buildFollowUpQuestions(missing),
            templateDraft: buildTemplateDraft(context),
          });
        }
        const storage = await getWorkforceStorageAdapter();
        const template = await storage.jobs.createTemplate(buildTemplateDraft(context));
        return jsonResult({
          ok: true,
          template,
          nextStep:
            "Use workforce_setup_tool with action=assignment_create or project_start to bind this role to Argent or a family agent.",
        });
      }

      if (action === "assignment_create") {
        const templateId = trimOrUndefined(readStringParam(params, "templateId"));
        if (!templateId) {
          return jsonResult({
            ok: false,
            error: "templateId is required for assignment_create.",
          });
        }
        const missing = buildMissingItems(context, true).filter((item) => item !== "roleName");
        if (missing.length > 0) {
          return jsonResult({
            ok: false,
            error: "Missing information for assignment creation.",
            missing,
            followUpQuestions: buildFollowUpQuestions(missing),
            assignmentDraft: buildAssignmentDraft(context, templateId),
          });
        }
        const storage = await getWorkforceStorageAdapter();
        const assignment = await storage.jobs.createAssignment({
          ...buildAssignmentDraft(context, templateId),
          templateId,
        });
        return jsonResult({ ok: true, assignment });
      }

      if (action === "project_start") {
        const missing = buildMissingItems(context, true);
        if (missing.length > 0) {
          return jsonResult({
            ok: false,
            error: "Missing information for workforce project start.",
            missing,
            followUpQuestions: buildFollowUpQuestions(missing),
            templateDraft: buildTemplateDraft(context),
            assignmentDraft: buildAssignmentDraft(context),
            agentOptions: workerAgents,
            workerDraft: context.workerDraft,
          });
        }
        const worker =
          context.targetMode === "create" ? await createWorkerFromDraft(context) : undefined;
        const storage = await getWorkforceStorageAdapter();
        const template = await storage.jobs.createTemplate(buildTemplateDraft(context));
        const assignment = await storage.jobs.createAssignment({
          ...buildAssignmentDraft(context, template.id),
          templateId: template.id,
        });
        return jsonResult({
          ok: true,
          worker,
          template,
          assignment,
          guidance:
            "Start the assignment in simulate, review at least one run, then promote deliberately through shadow and limited-live.",
        });
      }

      return jsonResult({ ok: false, error: `Unsupported action: ${action}` });
    },
  };
}
