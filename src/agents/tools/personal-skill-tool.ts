import { Type } from "@sinclair/typebox";
import type {
  CreatePersonalSkillCandidateInput,
  PersonalSkillCandidate,
  PersonalSkillCandidateState,
} from "../../memory/memu-types.js";
import type { AnyAgentTool } from "./common.js";
import { getMemoryAdapter } from "../../data/storage-factory.js";
import { jsonResult, readNumberParam, readStringArrayParam, readStringParam } from "./common.js";

const PERSONAL_SKILL_ACTIONS = ["list", "create", "patch"] as const;

const PersonalSkillToolSchema = Type.Object({
  action: Type.Union(
    PERSONAL_SKILL_ACTIONS.map((action) => Type.Literal(action)),
    {
      description: 'Action to perform: "list", "create", or "patch".',
    },
  ),
  id: Type.Optional(Type.String({ description: "Personal Skill id for patch." })),
  state: Type.Optional(
    Type.String({
      description:
        'Optional state filter for list. Example: "promoted", "incubating", "candidate".',
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Max rows to return for list (default 10, max 50).",
    }),
  ),
  title: Type.Optional(Type.String({ description: "Personal Skill title." })),
  summary: Type.Optional(Type.String({ description: "Short summary of the procedure." })),
  triggerPatterns: Type.Optional(
    Type.Array(Type.String(), {
      description: "Prompt or situation patterns that should trigger the procedure.",
    }),
  ),
  procedureOutline: Type.Optional(
    Type.String({
      description: "Optional markdown outline of the full procedure.",
    }),
  ),
  preconditions: Type.Optional(
    Type.Array(Type.String(), {
      description: "Preconditions or 'use when' constraints.",
    }),
  ),
  executionSteps: Type.Optional(
    Type.Array(Type.String(), {
      description: "Ordered execution steps for the procedure.",
    }),
  ),
  expectedOutcomes: Type.Optional(
    Type.Array(Type.String(), {
      description: "Expected outcomes when the procedure succeeds.",
    }),
  ),
  relatedTools: Type.Optional(
    Type.Array(Type.String(), {
      description: "Preferred related tools for this procedure.",
    }),
  ),
  operatorNotes: Type.Optional(
    Type.String({
      description: "Optional notes about why this skill matters or how it should be used.",
    }),
  ),
  reason: Type.Optional(
    Type.String({
      description: "Why the skill is being created or patched.",
    }),
  ),
});

type PersonalSkillToolAction = (typeof PERSONAL_SKILL_ACTIONS)[number];

function normalizeStateFilter(value: string | undefined): PersonalSkillCandidateState | undefined {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "candidate" ||
    normalized === "incubating" ||
    normalized === "promoted" ||
    normalized === "rejected" ||
    normalized === "deprecated"
  ) {
    return normalized;
  }
  return undefined;
}

function cleanStringArray(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

function buildProcedureOutline(input: {
  procedureOutline?: string;
  executionSteps?: string[];
  expectedOutcomes?: string[];
}): string | undefined {
  const explicit = input.procedureOutline?.trim();
  if (explicit) {
    return explicit;
  }
  const lines: string[] = [];
  for (const [index, step] of (input.executionSteps ?? []).entries()) {
    lines.push(`${index + 1}. ${step}`);
  }
  if ((input.expectedOutcomes ?? []).length > 0) {
    lines.push(`Expected outcomes: ${input.expectedOutcomes!.join("; ")}`);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function formatPersonalSkillRow(row: PersonalSkillCandidate): string {
  return [
    `${row.title}`,
    `  id: ${row.id}`,
    `  state: ${row.state}`,
    `  confidence: ${row.confidence.toFixed(2)} | strength: ${row.strength.toFixed(2)}`,
    `  usage: ${row.usageCount} | success: ${row.successCount} | failure: ${row.failureCount}`,
    `  summary: ${row.summary}`,
  ].join("\n");
}

async function resolveScopedMemory(agentId: string) {
  const memory = await getMemoryAdapter();
  return memory.withAgentId ? memory.withAgentId(agentId) : memory;
}

export function createPersonalSkillTool(options: { agentId: string }): AnyAgentTool {
  return {
    label: "Personal Skill",
    name: "personal_skill",
    description:
      "Manage DB-backed Personal Skills as operator procedures. Use this to list, intentionally create, or patch Personal Skills instead of relying only on passive promotion.",
    parameters: PersonalSkillToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", {
        required: true,
      }) as PersonalSkillToolAction;
      const memory = await resolveScopedMemory(options.agentId);

      if (action === "list") {
        const state = normalizeStateFilter(readStringParam(params, "state"));
        const limit = Math.min(50, Math.max(1, readNumberParam(params, "limit") ?? 10));
        const rows = await memory.listPersonalSkillCandidates({ state, limit });
        const text =
          rows.length === 0
            ? "No Personal Skills found."
            : rows.map((row) => formatPersonalSkillRow(row)).join("\n\n");
        return {
          content: [{ type: "text", text }],
          details: {
            ok: true,
            action,
            count: rows.length,
            rows,
          },
        };
      }

      if (action === "create") {
        const title = readStringParam(params, "title", { required: true });
        const summary = readStringParam(params, "summary", { required: true });
        const triggerPatterns = cleanStringArray(readStringArrayParam(params, "triggerPatterns"));
        const preconditions = cleanStringArray(readStringArrayParam(params, "preconditions"));
        const executionSteps = cleanStringArray(readStringArrayParam(params, "executionSteps"));
        const expectedOutcomes = cleanStringArray(readStringArrayParam(params, "expectedOutcomes"));
        const relatedTools = cleanStringArray(readStringArrayParam(params, "relatedTools"));
        const operatorNotes = readStringParam(params, "operatorNotes");
        const reason =
          readStringParam(params, "reason") ?? "Agent intentionally authored a Personal Skill";
        const procedureOutline = buildProcedureOutline({
          procedureOutline: readStringParam(params, "procedureOutline"),
          executionSteps,
          expectedOutcomes,
        });

        const input: CreatePersonalSkillCandidateInput = {
          title,
          summary,
          triggerPatterns,
          procedureOutline,
          preconditions,
          executionSteps,
          expectedOutcomes,
          relatedTools,
          operatorNotes: operatorNotes ?? null,
          confidence: 0.75,
          strength: 0.55,
          evidenceCount: 1,
          recurrenceCount: 1,
          state: "incubating",
        };
        const created = await memory.createPersonalSkillCandidate(input);
        await memory.createPersonalSkillReviewEvent({
          candidateId: created.id,
          actorType: "system",
          action: "authored",
          reason,
          details: {
            source: "personal_skill_tool",
            action,
          },
        });
        return jsonResult({
          ok: true,
          action,
          row: created,
        });
      }

      if (action === "patch") {
        const id = readStringParam(params, "id", { required: true });
        const fields: Parameters<typeof memory.updatePersonalSkillCandidate>[1] = {};
        const title = readStringParam(params, "title");
        const summary = readStringParam(params, "summary");
        const triggerPatterns = cleanStringArray(readStringArrayParam(params, "triggerPatterns"));
        const preconditions = cleanStringArray(readStringArrayParam(params, "preconditions"));
        const executionSteps = cleanStringArray(readStringArrayParam(params, "executionSteps"));
        const expectedOutcomes = cleanStringArray(readStringArrayParam(params, "expectedOutcomes"));
        const relatedTools = cleanStringArray(readStringArrayParam(params, "relatedTools"));
        const operatorNotes = readStringParam(params, "operatorNotes");
        const procedureOutline = buildProcedureOutline({
          procedureOutline: readStringParam(params, "procedureOutline"),
          executionSteps,
          expectedOutcomes,
        });
        if (title !== undefined) fields.title = title;
        if (summary !== undefined) fields.summary = summary;
        if (triggerPatterns !== undefined) fields.triggerPatterns = triggerPatterns;
        if (preconditions !== undefined) fields.preconditions = preconditions;
        if (executionSteps !== undefined) fields.executionSteps = executionSteps;
        if (expectedOutcomes !== undefined) fields.expectedOutcomes = expectedOutcomes;
        if (relatedTools !== undefined) fields.relatedTools = relatedTools;
        if (procedureOutline !== undefined) fields.procedureOutline = procedureOutline;
        if (operatorNotes !== undefined) fields.operatorNotes = operatorNotes;
        if (Object.keys(fields).length === 0) {
          throw new Error("patch requires at least one field to update");
        }
        fields.lastReviewedAt = new Date().toISOString();
        const updated = await memory.updatePersonalSkillCandidate(id, fields);
        if (!updated) {
          throw new Error(`personal skill "${id}" not found`);
        }
        await memory.createPersonalSkillReviewEvent({
          candidateId: updated.id,
          actorType: "system",
          action: "patched",
          reason:
            readStringParam(params, "reason") ??
            "Agent intentionally patched a Personal Skill after runtime use or correction",
          details: {
            source: "personal_skill_tool",
            action,
            patchedFields: Object.keys(fields),
          },
        });
        return jsonResult({
          ok: true,
          action,
          row: updated,
        });
      }

      throw new Error(`unsupported action "${String(action)}"`);
    },
  };
}
