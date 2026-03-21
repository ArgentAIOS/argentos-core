export interface OperationalEntityStats {
  name: string;
  entityType: string;
  memoryCount: number;
  linkCount: number;
  cronLinks: number;
  sessionLinks: number;
  docpaneLinks: number;
  directLinks: number;
}

const YEAR_ONLY_RE = /^(?:20\d{2})(?:\s+20\d{2})*$/;
const UUID_LIKE_RE = /^(?:[a-f0-9]{8,}|[a-f0-9]{8}-[a-f0-9-]{27,})$/i;
const TECHNICIAN_ID_RE = /^technician id \d+$/i;
const CATEGORY_SPILL_RE = /\bFACT:|\bCATEGORIES:|\|/i;

const OPERATIONAL_ENTITY_EXACT = new Set([
  "active contemplation cycles",
  "comments",
  "cron job",
  "cron jobs",
  "heartbeat cycles",
  "memory_recall",
  "operator",
  "process",
]);

const TIMEZONE_ENTITY_EXACT = new Set([
  "ct",
  "cst",
  "cdt",
  "est",
  "edt",
  "gmt",
  "mst",
  "mdt",
  "mt",
  "pst",
  "pdt",
  "pt",
  "utc",
]);

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isGarbageOperationalCategoryName(name: string): boolean {
  const normalized = String(name || "").trim();
  if (!normalized) {
    return true;
  }
  if (/^[\d\W_]+$/.test(normalized)) {
    return true;
  }
  if (YEAR_ONLY_RE.test(normalized)) {
    return true;
  }
  return CATEGORY_SPILL_RE.test(normalized);
}

export function isPrunableOperationalEntityCandidate(entity: OperationalEntityStats): boolean {
  const normalized = normalize(entity.name);
  if (!normalized) {
    return false;
  }
  if (UUID_LIKE_RE.test(normalized)) {
    return true;
  }
  if (YEAR_ONLY_RE.test(normalized)) {
    return true;
  }
  if (TECHNICIAN_ID_RE.test(normalized)) {
    return true;
  }
  if (OPERATIONAL_ENTITY_EXACT.has(normalized)) {
    return true;
  }
  if (TIMEZONE_ENTITY_EXACT.has(normalized)) {
    return entity.entityType === "place";
  }
  return false;
}
