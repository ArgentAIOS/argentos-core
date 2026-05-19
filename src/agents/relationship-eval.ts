import type { IntentPolicyConfig } from "../config/types.intent.js";
import type { Task } from "../data/types.js";
import type { JobDeploymentStage, JobRelationshipContract } from "../data/types.js";
import type { ResolvedIntentForAgent } from "./intent.js";

export type RelationshipEvaluation = {
  overallScore: number;
  trustPreservationScore: number;
  brandAlignmentScore: number;
  continuityScore: number;
  honestyScore: number;
  escalationIntegrityScore: number;
  recommendation: "hold" | "promote-cautiously" | "ready-for-next-stage";
  reasons: string[];
  contractCoverageScore: number;
  departmentAligned: boolean | null;
  recentAverageScore?: number;
  recentTrend?: "improving" | "steady" | "declining";
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function scoreContractCoverage(contract: JobRelationshipContract | undefined): number {
  if (!contract) return 0;
  const checks = [
    Boolean(contract.relationshipObjective?.trim()),
    Boolean(contract.toneProfile?.trim()),
    Boolean(contract.handoffStyle?.trim()),
    Boolean(contract.trustPriorities?.length),
    Boolean(contract.continuityRequirements?.length),
    Boolean(contract.honestyRules?.length),
    Boolean(contract.relationalFailureModes?.length),
  ];
  const met = checks.filter(Boolean).length;
  return met / checks.length;
}

export function evaluateRelationshipExecution(params: {
  simulationViolation: boolean;
  latestStatus?: Task["status"];
  deploymentStage?: JobDeploymentStage;
  relationshipContract?: JobRelationshipContract;
  intent: ResolvedIntentForAgent | undefined;
  declaredDepartmentId?: string;
  effectiveDepartmentId?: string;
  departmentPolicy?: IntentPolicyConfig | undefined;
  recentScores?: number[];
}): RelationshipEvaluation {
  const reasons: string[] = [];
  let baseline = 0.76;

  if (params.deploymentStage === "shadow") baseline += 0.03;
  if (params.deploymentStage === "limited-live") baseline += 0.02;
  if (params.deploymentStage === "live") baseline += 0.01;

  if (params.latestStatus === "blocked") {
    baseline -= 0.18;
    reasons.push("run blocked before role could complete safely");
  }
  if (params.latestStatus === "failed") {
    baseline -= 0.26;
    reasons.push("run failed during execution");
  }
  if (params.simulationViolation) {
    baseline -= 0.35;
    reasons.push("simulation boundary violated");
  }

  const contractCoverageScore = scoreContractCoverage(params.relationshipContract);
  if (contractCoverageScore > 0) {
    baseline += contractCoverageScore * 0.1;
    reasons.push(`relationship contract coverage ${Math.round(contractCoverageScore * 100)}%`);
  } else {
    reasons.push("relationship contract is still sparse");
  }

  const issuesCount = params.intent?.issues.length ?? 0;
  if (issuesCount > 0) {
    baseline -= Math.min(0.2, issuesCount * 0.05);
    reasons.push(`intent issues present: ${issuesCount}`);
  }

  const declaredDepartmentId = params.declaredDepartmentId?.trim();
  const effectiveDepartmentId = params.effectiveDepartmentId?.trim();
  const departmentAligned =
    declaredDepartmentId && effectiveDepartmentId
      ? declaredDepartmentId.toLowerCase() === effectiveDepartmentId.toLowerCase()
      : null;
  if (departmentAligned === false) {
    baseline -= 0.12;
    reasons.push(
      `role declares ${declaredDepartmentId} but agent intent resolves to ${effectiveDepartmentId}`,
    );
  } else if (departmentAligned === true) {
    baseline += 0.03;
    reasons.push(`role aligned with ${declaredDepartmentId} department identity`);
  }

  if (params.departmentPolicy?.objective?.trim()) {
    baseline += 0.02;
    reasons.push("department objective available for role guidance");
  }

  const usableRecentScores = (params.recentScores ?? []).filter((value) => Number.isFinite(value));
  const recentAverageScore =
    usableRecentScores.length > 0
      ? usableRecentScores.reduce((sum, value) => sum + value, 0) / usableRecentScores.length
      : undefined;
  let recentTrend: "improving" | "steady" | "declining" | undefined;
  if (usableRecentScores.length >= 2) {
    const first = usableRecentScores[usableRecentScores.length - 1] ?? usableRecentScores[0]!;
    const last = usableRecentScores[0]!;
    const delta = last - first;
    recentTrend = delta > 0.08 ? "improving" : delta < -0.08 ? "declining" : "steady";
  }
  if (recentAverageScore !== undefined) {
    baseline += (recentAverageScore - 0.75) * 0.15;
    reasons.push(`recent relationship average ${Math.round(recentAverageScore * 100)}%`);
  }
  if (recentTrend === "declining") {
    baseline -= 0.06;
    reasons.push("recent relationship performance is declining");
  } else if (recentTrend === "improving") {
    baseline += 0.03;
    reasons.push("recent relationship performance is improving");
  }

  const trustPreservationScore = clampScore(
    baseline +
      (params.relationshipContract?.trustPriorities?.length ? 0.08 : -0.04) -
      (params.simulationViolation ? 0.08 : 0),
  );

  const brandAlignmentScore = clampScore(
    baseline +
      (params.relationshipContract?.toneProfile?.trim() ? 0.06 : -0.03) +
      (params.relationshipContract?.handoffStyle?.trim() ? 0.03 : 0) +
      (departmentAligned === false ? -0.08 : departmentAligned === true ? 0.03 : 0),
  );

  const continuityScore = clampScore(
    baseline +
      (params.relationshipContract?.continuityRequirements?.length ? 0.07 : -0.03) -
      (params.latestStatus === "failed" ? 0.08 : 0),
  );

  const honestyScore = clampScore(
    baseline +
      (params.relationshipContract?.honestyRules?.length ? 0.08 : -0.02) -
      (params.simulationViolation ? 0.06 : 0),
  );

  const escalationIntegrityScore = clampScore(
    baseline +
      (params.intent?.policy.escalation ? 0.05 : 0) +
      (params.departmentPolicy?.escalation ? 0.04 : 0) -
      (issuesCount > 0 ? 0.04 : 0) -
      (params.latestStatus === "blocked" ? 0.03 : 0),
  );

  const overallScore = clampScore(
    (trustPreservationScore +
      brandAlignmentScore +
      continuityScore +
      honestyScore +
      escalationIntegrityScore) /
      5,
  );

  const recommendation =
    overallScore >= 0.9
      ? "ready-for-next-stage"
      : overallScore >= 0.75
        ? "promote-cautiously"
        : "hold";

  return {
    overallScore,
    trustPreservationScore,
    brandAlignmentScore,
    continuityScore,
    honestyScore,
    escalationIntegrityScore,
    recommendation,
    reasons,
    contractCoverageScore: clampScore(contractCoverageScore),
    departmentAligned,
    recentAverageScore:
      recentAverageScore !== undefined ? clampScore(recentAverageScore) : undefined,
    recentTrend,
  };
}
