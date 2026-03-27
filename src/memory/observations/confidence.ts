import type { KnowledgeObservationConfidenceComponents } from "../memu-types.js";

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function computeRecencyWeight(lastSupportedAt: string | null | undefined, now: Date): number {
  if (!lastSupportedAt) {
    return 0.35;
  }
  const ageMs = Math.max(0, now.getTime() - Date.parse(lastSupportedAt));
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return clamp(1 - ageDays / 60, 0.1, 1);
}

export function computeKnowledgeObservationConfidence(params: {
  sourceCount: number;
  sourceDiversity: number;
  supportWeight: number;
  contradictionWeight: number;
  lastSupportedAt?: string | null;
  operatorConfirmed?: boolean;
  now?: Date;
}): {
  confidence: number;
  components: KnowledgeObservationConfidenceComponents;
} {
  const now = params.now ?? new Date();
  const sourceCount = Math.max(0, params.sourceCount);
  const sourceDiversity = Math.max(0, params.sourceDiversity);
  const supportWeight = Math.max(0, params.supportWeight);
  const contradictionWeight = Math.max(0, params.contradictionWeight);
  const recencyWeight = computeRecencyWeight(params.lastSupportedAt, now);
  const operatorConfirmedBoost = params.operatorConfirmed ? 0.12 : 0;

  const countFactor = Math.min(Math.log1p(sourceCount) / Math.log1p(6), 1) * 0.22;
  const diversityFactor = Math.min(sourceDiversity / 4, 1) * 0.18;
  const supportFactor = Math.min(supportWeight / 4, 1) * 0.2;
  const contradictionPenalty = Math.min(contradictionWeight / 3, 1) * 0.35;
  const recencyFactor = recencyWeight * 0.12;

  const confidence = clamp(
    0.28 +
      countFactor +
      diversityFactor +
      supportFactor +
      recencyFactor +
      operatorConfirmedBoost -
      contradictionPenalty,
  );

  return {
    confidence,
    components: {
      sourceCount,
      sourceDiversity,
      supportWeight,
      contradictionWeight,
      recencyWeight,
      operatorConfirmedBoost,
    },
  };
}
