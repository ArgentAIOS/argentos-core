import type { MemoryAdapter } from "../../data/adapter.js";
import type { KnowledgeObservation, KnowledgeObservationKind } from "../memu-types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_KNOWLEDGE_OBSERVATION_REVALIDATION_DAYS: Record<
  KnowledgeObservationKind,
  number
> = {
  operator_preference: 45,
  project_state: 3,
  world_fact: 14,
  self_model: 21,
  relationship_fact: 30,
  tooling_state: 7,
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveKnowledgeObservationRevalidationDays(params: {
  kind: KnowledgeObservationKind;
  overrides?: Partial<Record<KnowledgeObservationKind, number>>;
}): number {
  const override = params.overrides?.[params.kind];
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return override;
  }
  return DEFAULT_KNOWLEDGE_OBSERVATION_REVALIDATION_DAYS[params.kind];
}

export function computeKnowledgeObservationFreshness(params: {
  kind: KnowledgeObservationKind;
  lastSupportedAt?: string | null;
  lastContradictedAt?: string | null;
  now?: Date;
  kindDays?: Partial<Record<KnowledgeObservationKind, number>>;
}): {
  freshness: number;
  revalidationDueAt: string;
} {
  const now = params.now ?? new Date();
  const windowDays = resolveKnowledgeObservationRevalidationDays({
    kind: params.kind,
    overrides: params.kindDays,
  });
  const lastSupportedAt = params.lastSupportedAt ? new Date(params.lastSupportedAt) : now;
  const ageDays = Math.max(0, now.getTime() - lastSupportedAt.getTime()) / DAY_MS;
  const contradictionPenalty =
    params.lastContradictedAt && Date.parse(params.lastContradictedAt) >= lastSupportedAt.getTime()
      ? 0.2
      : 0;
  const freshness = clamp(1 - ageDays / (windowDays * 2) - contradictionPenalty);
  const revalidationDueAt = new Date(lastSupportedAt.getTime() + windowDays * DAY_MS).toISOString();
  return { freshness, revalidationDueAt };
}

export function isKnowledgeObservationRevalidationDue(params: {
  observation: Pick<
    KnowledgeObservation,
    "kind" | "status" | "revalidationDueAt" | "lastSupportedAt" | "lastContradictedAt"
  >;
  now?: Date;
  kindDays?: Partial<Record<KnowledgeObservationKind, number>>;
}): boolean {
  if (params.observation.status !== "active") {
    return false;
  }
  const now = params.now ?? new Date();
  if (params.observation.revalidationDueAt) {
    return Date.parse(params.observation.revalidationDueAt) <= now.getTime();
  }
  const freshness = computeKnowledgeObservationFreshness({
    kind: params.observation.kind,
    lastSupportedAt: params.observation.lastSupportedAt,
    lastContradictedAt: params.observation.lastContradictedAt,
    now,
    kindDays: params.kindDays,
  });
  return Date.parse(freshness.revalidationDueAt) <= now.getTime();
}

export async function sweepKnowledgeObservationRevalidation(params: {
  memory: MemoryAdapter;
  now?: Date;
  kinds?: KnowledgeObservationKind[];
  limit?: number;
  kindDays?: Partial<Record<KnowledgeObservationKind, number>>;
}): Promise<{
  scanned: number;
  markedStale: number;
  staleIds: string[];
}> {
  const now = params.now ?? new Date();
  const activeObservations = await params.memory.listKnowledgeObservations({
    kinds: params.kinds,
    status: "active",
    limit: params.limit ?? 250,
  });

  const dueObservations = activeObservations.filter((observation) =>
    isKnowledgeObservationRevalidationDue({
      observation,
      now,
      kindDays: params.kindDays,
    }),
  );

  const staleIds: string[] = [];
  for (const observation of dueObservations) {
    await params.memory.markKnowledgeObservationStale(observation.id);
    staleIds.push(observation.id);
  }

  return {
    scanned: activeObservations.length,
    markedStale: staleIds.length,
    staleIds,
  };
}
