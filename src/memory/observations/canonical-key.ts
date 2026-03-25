import type { KnowledgeObservationKind, KnowledgeObservationSubjectType } from "../memu-types.js";

export type KnowledgeObservationSlot =
  | "response_style"
  | "decision_preference"
  | "delivery_preference"
  | "relationship"
  | "status"
  | "risk"
  | "failure_mode"
  | "best_path"
  | "verification_pattern";

export const KNOWLEDGE_OBSERVATION_SLOTS: readonly KnowledgeObservationSlot[] = [
  "response_style",
  "decision_preference",
  "delivery_preference",
  "relationship",
  "status",
  "risk",
  "failure_mode",
  "best_path",
  "verification_pattern",
] as const;

export function normalizeObservationKeySegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function buildKnowledgeObservationCanonicalKey(params: {
  kind: KnowledgeObservationKind;
  subjectType: KnowledgeObservationSubjectType;
  subjectId?: string | null;
  slot: KnowledgeObservationSlot;
}): string {
  const slot = normalizeObservationKeySegment(params.slot);
  const subjectId = normalizeObservationKeySegment(params.subjectId ?? "");

  switch (params.kind) {
    case "operator_preference":
    case "relationship_fact": {
      if (params.subjectType !== "entity" || !subjectId) {
        throw new Error(`${params.kind} observations require an entity subject id`);
      }
      return `entity:${subjectId}:${params.kind}:${slot}`;
    }
    case "project_state": {
      const scopedId =
        params.subjectType === "project" && subjectId
          ? subjectId
          : normalizeObservationKeySegment(params.subjectId ?? "");
      if (!scopedId) {
        throw new Error("project_state observations require a project subject id");
      }
      return `project:${scopedId}:project_state:${slot}`;
    }
    case "tooling_state": {
      const scopedId =
        params.subjectType === "tool" && subjectId
          ? subjectId
          : normalizeObservationKeySegment(params.subjectId ?? "");
      if (!scopedId) {
        throw new Error("tooling_state observations require a tool subject id");
      }
      return `tool:${scopedId}:tooling_state:${slot}`;
    }
    case "self_model": {
      const scopedId = params.subjectType === "agent" && subjectId ? subjectId : "self";
      return `agent:${scopedId}:self_model:${slot}`;
    }
    case "world_fact":
      return `global:world_fact:${slot}`;
    default: {
      const exhaustive: never = params.kind;
      throw new Error(`Unhandled observation kind: ${String(exhaustive)}`);
    }
  }
}
