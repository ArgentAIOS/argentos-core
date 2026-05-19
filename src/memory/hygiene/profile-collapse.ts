import type { MemuStore } from "../memu-store.js";
import type { MemoryItem, Significance } from "../memu-types.js";

const OPERATIONAL_PROFILE_HINT_RE =
  /\b(?:status(?:es)?|snapshot(?:s)?|health|metric(?:s)?|count(?:s)?|queue(?:s)?|uptime|latenc(?:y|ies)|ticket(?:s)?|alert(?:s)?|cron(?:s)?|heartbeat(?:s)?|service(?:s)?|gateway(?:s)?|dashboard(?:s)?|api(?:s)?|provider(?:s)?|model(?:s)?)\b/i;
const NUMERIC_TOKEN_RE = /\b\d+(?:[.,]\d+)?%?\b/g;
const DATETIME_TOKEN_RE =
  /\b\d{4}-\d{2}-\d{2}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?:z)?\b/gi;
const HEX_OR_UUID_RE = /\b(?:[a-f0-9]{8,}|[a-f0-9]{8}-[a-f0-9-]{27,})\b/gi;
const REQUEST_TOKEN_RE = /\b(?:run|req|msg)-[a-z0-9-]+\b/gi;
const NUMERIC_TOKEN_TEST_RE = /\b\d+(?:[.,]\d+)?%?\b/;
const DATETIME_TOKEN_TEST_RE =
  /\b\d{4}-\d{2}-\d{2}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?:z)?\b/i;
const META_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "connected",
  "context",
  "conversation",
  "current",
  "currently",
  "environment",
  "for",
  "from",
  "had",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "participant",
  "participants",
  "reported",
  "report",
  "reports",
  "says",
  "state",
  "stated",
  "states",
  "summary",
  "that",
  "the",
  "there",
  "these",
  "this",
  "those",
  "to",
  "was",
  "were",
  "with",
  "you",
  "your",
]);
const PLACEHOLDER_TOKEN_SET = new Set(["<id>", "<num>", "<datetime>"]);
const FUZZY_SIMILARITY_THRESHOLD = 0.78;
const FUZZY_MIN_INTERSECTION = 4;
const TOKEN_KEY_MIN_TOKENS = 3;

const SIGNIFICANCE_RANK: Record<Significance, number> = {
  routine: 0,
  noteworthy: 1,
  important: 2,
  core: 3,
};

export interface ProfileCollapseOptions {
  dryRun?: boolean;
  maxSampleGroups?: number;
  batchSize?: number;
  enableFuzzy?: boolean;
}

export interface ProfileCollapseGroupSample {
  signature: string;
  groupSize: number;
  canonicalId: string;
  canonicalSummary: string;
  duplicateIds: string[];
  duplicateSummaries: string[];
  reinforcementTransfer: number;
}

export interface ProfileCollapseReport {
  dryRun: boolean;
  scannedProfiles: number;
  operationalProfiles: number;
  uniqueSignatures: number;
  duplicateGroups: number;
  duplicatesFound: number;
  groupsCollapsed: number;
  duplicatesRemoved: number;
  reinforcementsApplied: number;
  exactDuplicateGroups: number;
  tokenDuplicateGroups: number;
  fuzzyDuplicateGroups: number;
  samples: ProfileCollapseGroupSample[];
}

export function isOperationalProfileSnapshotSummary(summary: string): boolean {
  if (!OPERATIONAL_PROFILE_HINT_RE.test(summary)) {
    return false;
  }
  return NUMERIC_TOKEN_TEST_RE.test(summary) || DATETIME_TOKEN_TEST_RE.test(summary);
}

export function operationalProfileSignature(summary: string): string {
  return summary
    .toLowerCase()
    .replace(DATETIME_TOKEN_RE, " <datetime> ")
    .replace(REQUEST_TOKEN_RE, " <id> ")
    .replace(HEX_OR_UUID_RE, " <id> ")
    .replace(NUMERIC_TOKEN_RE, " <num> ")
    .replace(/[^\p{L}\p{N}<>\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToken(token: string): string | null {
  if (!token) return null;
  if (PLACEHOLDER_TOKEN_SET.has(token)) return null;
  if (META_STOPWORDS.has(token)) return null;
  let normalized = token;
  if (normalized.length > 5 && normalized.endsWith("ies")) {
    normalized = `${normalized.slice(0, -3)}y`;
  } else if (
    normalized.length > 4 &&
    normalized.endsWith("s") &&
    !normalized.endsWith("ss") &&
    !normalized.endsWith("us")
  ) {
    normalized = normalized.slice(0, -1);
  }
  if (!normalized) return null;
  if (META_STOPWORDS.has(normalized)) return null;
  return normalized;
}

function semanticTokenSet(summary: string): string[] {
  const normalized = operationalProfileSignature(summary);
  if (!normalized) return [];
  const tokens = normalized
    .split(" ")
    .map((token) => normalizeToken(token.trim()))
    .filter((token): token is string => Boolean(token));
  return [...new Set(tokens)].sort();
}

function semanticTokenKey(summary: string): string | null {
  const tokens = semanticTokenSet(summary);
  if (tokens.length < TOKEN_KEY_MIN_TOKENS) {
    return null;
  }
  return tokens.join(" ");
}

function tokenOverlap(a: string[], b: string[]): { score: number; intersection: number } {
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) {
      intersection += 1;
    }
  }
  const union = aSet.size + bSet.size - intersection;
  return {
    score: union > 0 ? intersection / union : 0,
    intersection,
  };
}

function pickCanonical(items: MemoryItem[]): MemoryItem {
  const sorted = [...items].sort((a, b) => {
    const sigA = SIGNIFICANCE_RANK[a.significance] ?? 0;
    const sigB = SIGNIFICANCE_RANK[b.significance] ?? 0;
    if (sigB !== sigA) return sigB - sigA;
    if (b.reinforcementCount !== a.reinforcementCount) {
      return b.reinforcementCount - a.reinforcementCount;
    }
    const createdA = Date.parse(a.createdAt) || 0;
    const createdB = Date.parse(b.createdAt) || 0;
    if (createdA !== createdB) return createdA - createdB;
    return a.id.localeCompare(b.id);
  });
  return sorted[0];
}

function listAllProfiles(store: MemuStore, batchSize: number): MemoryItem[] {
  const total = store.countItems("profile");
  if (total <= 0) return [];
  const items: MemoryItem[] = [];
  for (let offset = 0; offset < total; offset += batchSize) {
    const page = store.listItems({
      memoryType: "profile",
      limit: batchSize,
      offset,
    });
    if (page.length === 0) break;
    items.push(...page);
  }
  return items;
}

function safeDeleteMemoryItem(store: MemuStore, id: string): boolean {
  try {
    return store.deleteItem(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/FOREIGN KEY/i.test(message)) {
      throw err;
    }
    // Some local schemas may have missing ON DELETE CASCADE constraints or older table names.
    // Manually clean junction rows, then retry deletion.
    const cleanupTables = ["item_categories", "category_items", "item_entities"] as const;
    for (const table of cleanupTables) {
      try {
        store.db.prepare(`DELETE FROM ${table} WHERE item_id = ?`).run(id);
      } catch {
        // Table may not exist in this schema variant.
      }
    }
    return store.deleteItem(id);
  }
}

type GroupingCandidate = {
  item: MemoryItem;
  signature: string;
  tokenSet: string[];
  tokenKey: string | null;
};

type CollapseGroup = {
  phase: "exact" | "token" | "fuzzy";
  signature: string;
  items: MemoryItem[];
};

function buildFuzzyGroups(candidates: GroupingCandidate[]): GroupingCandidate[][] {
  type Cluster = {
    representative: string[];
    items: GroupingCandidate[];
  };
  const clusters: Cluster[] = [];
  const sorted = [...candidates].sort((a, b) => {
    const tsA = Date.parse(a.item.createdAt) || 0;
    const tsB = Date.parse(b.item.createdAt) || 0;
    if (tsA !== tsB) return tsA - tsB;
    return a.item.id.localeCompare(b.item.id);
  });

  for (const candidate of sorted) {
    if (candidate.tokenSet.length < FUZZY_MIN_INTERSECTION) {
      continue;
    }

    let bestClusterIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < clusters.length; i += 1) {
      const overlap = tokenOverlap(candidate.tokenSet, clusters[i].representative);
      if (
        overlap.intersection >= FUZZY_MIN_INTERSECTION &&
        overlap.score >= FUZZY_SIMILARITY_THRESHOLD &&
        overlap.score > bestScore
      ) {
        bestScore = overlap.score;
        bestClusterIndex = i;
      }
    }

    if (bestClusterIndex >= 0) {
      clusters[bestClusterIndex].items.push(candidate);
    } else {
      clusters.push({
        representative: candidate.tokenSet,
        items: [candidate],
      });
    }
  }

  return clusters.filter((cluster) => cluster.items.length > 1).map((cluster) => cluster.items);
}

export function collapseOperationalProfileSnapshots(
  store: MemuStore,
  options: ProfileCollapseOptions = {},
): ProfileCollapseReport {
  const dryRun = options.dryRun ?? true;
  const enableFuzzy = options.enableFuzzy ?? false;
  const maxSampleGroups = Math.max(0, options.maxSampleGroups ?? 20);
  const batchSize = Math.max(50, options.batchSize ?? 500);

  const profiles = listAllProfiles(store, batchSize);
  const exactGroups = new Map<string, GroupingCandidate[]>();
  const candidates: GroupingCandidate[] = [];
  let operationalProfiles = 0;

  for (const item of profiles) {
    if (!isOperationalProfileSnapshotSummary(item.summary)) {
      continue;
    }
    const signature = operationalProfileSignature(item.summary);
    if (!signature) {
      continue;
    }
    const tokenSet = semanticTokenSet(item.summary);
    const tokenKey = tokenSet.length >= TOKEN_KEY_MIN_TOKENS ? tokenSet.join(" ") : null;
    const candidate: GroupingCandidate = {
      item,
      signature,
      tokenSet,
      tokenKey,
    };
    candidates.push(candidate);
    operationalProfiles += 1;
    const group = exactGroups.get(signature);
    if (group) {
      group.push(candidate);
    } else {
      exactGroups.set(signature, [candidate]);
    }
  }

  const collapseGroups: CollapseGroup[] = [];
  const consumed = new Set<string>();
  for (const [signature, group] of exactGroups.entries()) {
    if (group.length < 2) continue;
    for (const candidate of group) {
      consumed.add(candidate.item.id);
    }
    collapseGroups.push({
      phase: "exact",
      signature,
      items: group.map((candidate) => candidate.item),
    });
  }

  const tokenGroups = new Map<string, GroupingCandidate[]>();
  for (const candidate of candidates) {
    if (consumed.has(candidate.item.id)) continue;
    if (!candidate.tokenKey) continue;
    const group = tokenGroups.get(candidate.tokenKey);
    if (group) {
      group.push(candidate);
    } else {
      tokenGroups.set(candidate.tokenKey, [candidate]);
    }
  }
  for (const [tokenKey, group] of tokenGroups.entries()) {
    if (group.length < 2) continue;
    for (const candidate of group) {
      consumed.add(candidate.item.id);
    }
    collapseGroups.push({
      phase: "token",
      signature: `tokens:${tokenKey}`,
      items: group.map((candidate) => candidate.item),
    });
  }

  if (enableFuzzy) {
    const fuzzyCandidates = candidates.filter((candidate) => !consumed.has(candidate.item.id));
    const fuzzyGroups = buildFuzzyGroups(fuzzyCandidates);
    for (const group of fuzzyGroups) {
      for (const candidate of group) {
        consumed.add(candidate.item.id);
      }
      const signature = group[0]?.tokenSet.join(" ") ?? "fuzzy";
      collapseGroups.push({
        phase: "fuzzy",
        signature: `fuzzy:${signature}`,
        items: group.map((candidate) => candidate.item),
      });
    }
  }

  const samples: ProfileCollapseGroupSample[] = [];
  let duplicateGroups = 0;
  let duplicatesFound = 0;
  let groupsCollapsed = 0;
  let duplicatesRemoved = 0;
  let reinforcementsApplied = 0;
  let exactDuplicateGroups = 0;
  let tokenDuplicateGroups = 0;
  let fuzzyDuplicateGroups = 0;

  for (const grouped of collapseGroups) {
    const group = grouped.items;
    duplicateGroups += 1;
    if (grouped.phase === "exact") exactDuplicateGroups += 1;
    if (grouped.phase === "token") tokenDuplicateGroups += 1;
    if (grouped.phase === "fuzzy") fuzzyDuplicateGroups += 1;
    duplicatesFound += group.length - 1;

    const canonical = pickCanonical(group);
    const duplicates = group.filter((item) => item.id !== canonical.id);
    const reinforcementTransfer = duplicates.reduce(
      (sum, item) => sum + Math.max(1, Math.round(item.reinforcementCount || 1)),
      0,
    );

    if (samples.length < maxSampleGroups) {
      samples.push({
        signature: grouped.signature,
        groupSize: group.length,
        canonicalId: canonical.id,
        canonicalSummary: canonical.summary,
        duplicateIds: duplicates.map((item) => item.id),
        duplicateSummaries: duplicates.map((item) => item.summary),
        reinforcementTransfer,
      });
    }

    if (dryRun) {
      continue;
    }

    let removedInGroup = 0;
    let reinforcementAppliedInGroup = 0;
    for (const duplicate of duplicates) {
      const removed = safeDeleteMemoryItem(store, duplicate.id);
      if (!removed) {
        continue;
      }
      removedInGroup += 1;
      duplicatesRemoved += 1;
      const transfer = Math.max(1, Math.round(duplicate.reinforcementCount || 1));
      for (let i = 0; i < transfer; i += 1) {
        store.reinforceItem(canonical.id);
      }
      reinforcementAppliedInGroup += transfer;
      reinforcementsApplied += transfer;
    }
    if (removedInGroup > 0) {
      groupsCollapsed += 1;
    }
    if (reinforcementAppliedInGroup === 0) {
      continue;
    }
  }

  return {
    dryRun,
    scannedProfiles: profiles.length,
    operationalProfiles,
    uniqueSignatures: exactGroups.size,
    duplicateGroups,
    duplicatesFound,
    groupsCollapsed,
    duplicatesRemoved,
    reinforcementsApplied,
    exactDuplicateGroups,
    tokenDuplicateGroups,
    fuzzyDuplicateGroups,
    samples,
  };
}
