export type MemoryRecallReadinessStatus = "green" | "yellow" | "red";

export type MemoryRecallReadiness = {
  status: MemoryRecallReadinessStatus;
  reasons: string[];
  resultCount: number;
  coverageScore?: number;
  answerConfidence?: number;
  notice?: string;
};

export function classifyMemoryRecallReadiness(params: {
  resultCount: number;
  coverageScore?: number;
  answerConfidence?: number;
  fallbackUsed?: boolean;
  error?: string;
}): MemoryRecallReadiness {
  const resultCount = Number.isFinite(params.resultCount) ? Math.max(0, params.resultCount) : 0;
  const reasons: string[] = [];
  let status: MemoryRecallReadinessStatus = "green";

  if (params.error && params.error.trim()) {
    return {
      status: "red",
      reasons: ["recall_error"],
      resultCount,
      notice: "Memory recall failed; do not rely on memory continuity for this answer.",
    };
  }

  if (resultCount === 0) {
    status = "red";
    reasons.push("no_results");
  } else if (resultCount < 2) {
    status = "yellow";
    reasons.push("sparse_results");
  }

  const coverageScore =
    typeof params.coverageScore === "number" && Number.isFinite(params.coverageScore)
      ? Math.max(0, Math.min(1, params.coverageScore))
      : undefined;
  if (coverageScore !== undefined) {
    if (coverageScore < 0.25) {
      status = "red";
      reasons.push("very_low_type_coverage");
    } else if (coverageScore < 0.5 && status !== "red") {
      status = "yellow";
      reasons.push("low_type_coverage");
    }
  }

  const answerConfidence =
    typeof params.answerConfidence === "number" && Number.isFinite(params.answerConfidence)
      ? Math.max(0, Math.min(1, params.answerConfidence))
      : undefined;
  if (answerConfidence !== undefined && answerConfidence < 0.55 && status !== "red") {
    status = "yellow";
    reasons.push("low_answer_confidence");
  }

  if (params.fallbackUsed && status !== "red") {
    status = "yellow";
    reasons.push("fallback_used");
  }

  const dedupedReasons = [...new Set(reasons)];
  return {
    status,
    reasons: dedupedReasons,
    resultCount,
    coverageScore,
    answerConfidence,
    notice:
      status === "green"
        ? undefined
        : status === "red"
          ? "Memory recall is not ready enough for a confident answer; say that memory continuity is weak and verify elsewhere before making claims."
          : "Memory recall succeeded but coverage is thin; mention uncertainty and avoid overclaiming.",
  };
}
