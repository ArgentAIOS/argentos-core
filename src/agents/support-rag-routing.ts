export function isSupportDepartment(departmentId: string | undefined | null): boolean {
  const normalized = String(departmentId ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return normalized === "support" || normalized.startsWith("support-");
}

function normalizeCollection(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const TECHNICAL_QUERY_RE =
  /\b(error|failed|failure|broken|bug|issue|not\s+working|timeout|latency|disconnect|cannot\s+connect|can'?t\s+connect|install|setup|configure|api|gateway|dashboard|login|auth|permission)\b/i;
const SENTIMENT_QUERY_RE =
  /\b(frustrated|angry|upset|furious|annoyed|disappointed|unhappy|mad|escalate|manager|supervisor|complaint)\b/i;
const GOODWILL_QUERY_RE =
  /\b(refund|credit|waive|waiver|discount|goodwill|compensat|courtesy|billing\s+adjustment)\b/i;
const EXCEPTION_QUERY_RE =
  /\b(exception|override|policy\s+exception|outside\s+policy|special\s+case|one[-\s]?time)\b/i;

export function inferSupportKnowledgeCollections(query: string): string[] {
  const text = String(query || "").trim();
  if (!text) return [];
  const collections = new Set<string>();
  if (TECHNICAL_QUERY_RE.test(text)) {
    collections.add("support-runbooks");
  }
  if (SENTIMENT_QUERY_RE.test(text)) {
    collections.add("support-tone");
  }
  if (GOODWILL_QUERY_RE.test(text)) {
    collections.add("support-policy");
    collections.add("support-goodwill");
  }
  if (EXCEPTION_QUERY_RE.test(text)) {
    collections.add("support-policy");
    collections.add("support-exceptions");
  }
  return [...collections];
}

export function inferDepartmentKnowledgeCollections(params: {
  departmentId?: string | null;
  query: string;
  explicitCollections?: string[];
}): string[] {
  if (Array.isArray(params.explicitCollections) && params.explicitCollections.length > 0) {
    return params.explicitCollections.map((entry) => normalizeCollection(entry)).filter(Boolean);
  }
  if (!isSupportDepartment(params.departmentId)) {
    return [];
  }
  return inferSupportKnowledgeCollections(params.query);
}

export function collectionMatchesAny(collection: string | undefined, wanted: Set<string>): boolean {
  if (!wanted.size) return true;
  const normalized = normalizeCollection(collection ?? "");
  if (!normalized) return false;
  return wanted.has(normalized);
}
