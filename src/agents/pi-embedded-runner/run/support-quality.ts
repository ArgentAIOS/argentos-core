export type SupportQualityIssueCode =
  | "empathy_missing"
  | "blame_language"
  | "resolution_path_missing"
  | "escalation_missing";

export interface SupportQualityIssue {
  code: SupportQualityIssueCode;
  message: string;
}

export interface SupportQualityValidation {
  issues: SupportQualityIssue[];
  blockingCodes: SupportQualityIssueCode[];
  frustrationDetected: boolean;
  riskDetected: boolean;
}

const FRUSTRATION_RE =
  /\b(frustrat|angry|upset|furious|unacceptable|terrible|awful|annoyed|disappointed|mad)\b/i;
const EMPATHY_RE =
  /\b(i understand|i hear you|i know this is|that sounds|that must be|sorry|apologize|frustrating)\b/i;
const BLAME_RE =
  /\b(your fault|you should have|you failed to|you didn't|you did not|obviously you|that's on you)\b/i;
const ACTIONABLE_RE =
  /(^|\n)\s*(\d+\.\s+|[-*]\s+)|\b(next step|here(?:'|’)s what|please (try|check|run|confirm)|i(?:'|’)ll (do|follow up|escalate)|we(?:'|’)ll|let(?:'|’)s)\b/i;
const RISK_RE =
  /\b(legal|compliance|policy exception|refund|credit|chargeback|pr risk|attorney|lawsuit|account (?:closure|termination)|manager|supervisor|escalat)\b/i;
const ESCALATION_RE =
  /\b(escalat|handoff|hand off|human review|specialist|manager|supervisor|approval)\b/i;

export function validateSupportReplyQuality(params: {
  userPrompt: string;
  responseText: string;
}): SupportQualityValidation {
  const userPrompt = String(params.userPrompt ?? "");
  const responseText = String(params.responseText ?? "");
  const issues: SupportQualityIssue[] = [];
  const blockingCodes: SupportQualityIssueCode[] = [];
  const frustrationDetected = FRUSTRATION_RE.test(userPrompt);
  const riskDetected = RISK_RE.test(userPrompt);

  if (frustrationDetected && !EMPATHY_RE.test(responseText)) {
    issues.push({
      code: "empathy_missing",
      message: "Frustration cues detected, but reply does not acknowledge user state.",
    });
    blockingCodes.push("empathy_missing");
  }

  if (BLAME_RE.test(responseText)) {
    issues.push({
      code: "blame_language",
      message: "Reply includes blame-oriented language.",
    });
    blockingCodes.push("blame_language");
  }

  if (!ACTIONABLE_RE.test(responseText)) {
    issues.push({
      code: "resolution_path_missing",
      message: "Reply lacks clear actionable steps or explicit next action.",
    });
    blockingCodes.push("resolution_path_missing");
  }

  if (riskDetected && !ESCALATION_RE.test(responseText)) {
    issues.push({
      code: "escalation_missing",
      message: "High-risk/policy cues detected, but no escalation path is stated.",
    });
    blockingCodes.push("escalation_missing");
  }

  return {
    issues,
    blockingCodes: [...new Set(blockingCodes)],
    frustrationDetected,
    riskDetected,
  };
}

export function buildSupportQualityGuardrailText(validation: SupportQualityValidation): string {
  const issueList = validation.issues.map((issue) => `- ${issue.message}`).join("\n");
  return (
    "[SUPPORT_QUALITY_GUARDRAIL]\n" +
    "Your previous support response violated required quality gates.\n" +
    `${issueList}\n` +
    "Retry now with:\n" +
    "- empathy when customer frustration is present\n" +
    "- no blame language\n" +
    "- concrete next steps or explicit follow-up action\n" +
    "- escalation wording when policy/risk cues are present\n" +
    "[/SUPPORT_QUALITY_GUARDRAIL]"
  );
}
