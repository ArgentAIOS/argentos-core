import type { ArgentConfig } from "../config/config.js";
import type { MemoryAdapter } from "../data/adapter.js";
import { runCogneeSearch, type CogneeSearchResult } from "../memory/retrieve/cognee.js";

const DEFAULT_EVERY_EPISODES = 5;
const DEFAULT_MAX_DURATION_MS = 10_000;
const TOPIC_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_TOPICS_PER_CYCLE = 3;
const MAX_HITS_PER_TOPIC = 2;

export type DiscoveryStatus = "skipped" | "completed" | "timeout";

export type DiscoveryOutcome = {
  status: DiscoveryStatus;
  reason?: string;
  topicsConsidered: number;
  hitsExamined: number;
  created: number;
  errors: number;
};

export function shouldRunDiscoveryPhase(params: { config?: ArgentConfig; episodeCount: number }): {
  run: boolean;
  reason?: string;
  maxDurationMs: number;
} {
  const discovery = params.config?.agents?.defaults?.contemplation?.discoveryPhase;
  if (!discovery?.enabled) {
    return { run: false, reason: "disabled", maxDurationMs: DEFAULT_MAX_DURATION_MS };
  }

  const everyEpisodes = Math.max(1, discovery.everyEpisodes ?? DEFAULT_EVERY_EPISODES);
  if (params.episodeCount <= 0) {
    return {
      run: false,
      reason: "no-episodes",
      maxDurationMs: discovery.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
    };
  }
  if (params.episodeCount % everyEpisodes !== 0) {
    return {
      run: false,
      reason: "episode-gate",
      maxDurationMs: discovery.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
    };
  }

  return {
    run: true,
    maxDurationMs: Math.max(100, discovery.maxDurationMs ?? DEFAULT_MAX_DURATION_MS),
  };
}

type DiscoveryTopic = { summary: string; ts: number };

function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickDiscoveryTopics(params: {
  items: Array<{
    summary: string;
    happenedAt?: string | null;
    createdAt?: string | null;
  }>;
  nowMs: number;
}): DiscoveryTopic[] {
  const cutoff = params.nowMs - TOPIC_LOOKBACK_MS;
  const seen = new Set<string>();
  const topics: DiscoveryTopic[] = [];

  for (const item of params.items) {
    const summary = typeof item.summary === "string" ? item.summary.trim() : "";
    if (summary.length < 12) continue;
    const ts = Math.max(toTimestamp(item.happenedAt), toTimestamp(item.createdAt));
    if (ts < cutoff) continue;
    const key = summary.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push({ summary, ts });
  }

  topics.sort((a, b) => b.ts - a.ts);
  return topics.slice(0, MAX_TOPICS_PER_CYCLE);
}

async function hasDiscoveryDuplicate(memory: MemoryAdapter, summary: string): Promise<boolean> {
  try {
    const hits = await memory.searchByKeyword(summary, 1);
    return hits.some(
      (hit) =>
        hit.item.memoryType === "knowledge" &&
        typeof hit.item.extra?.source === "string" &&
        hit.item.extra.source === "contemplation_discovery" &&
        hit.item.summary === summary,
    );
  } catch {
    return false;
  }
}

export async function runDiscoveryPhase(params: {
  config?: ArgentConfig;
  memory: MemoryAdapter;
  nowMs?: number;
  currentMs?: () => number;
  cogneeRunner?: (input: {
    config?: ArgentConfig;
    query: string;
    sufficiencyFailed: boolean;
  }) => Promise<CogneeSearchResult>;
}): Promise<DiscoveryOutcome> {
  const nowMs = params.nowMs ?? Date.now();
  const episodeItems = await params.memory.listItems({ memoryType: "episode", limit: 200 });
  const gate = shouldRunDiscoveryPhase({
    config: params.config,
    episodeCount: episodeItems.length,
  });
  if (!gate.run) {
    return {
      status: "skipped",
      reason: gate.reason,
      topicsConsidered: 0,
      hitsExamined: 0,
      created: 0,
      errors: 0,
    };
  }

  const currentMs = params.currentMs ?? (() => Date.now());
  const deadlineMs = currentMs() + gate.maxDurationMs;
  const allItems = await params.memory.listItems({ limit: 80 });
  const topics = pickDiscoveryTopics({
    items: allItems.map((item) => ({
      summary: item.summary,
      happenedAt: item.happenedAt,
      createdAt: item.createdAt,
    })),
    nowMs,
  });

  if (topics.length === 0) {
    return {
      status: "skipped",
      reason: "no-recent-topics",
      topicsConsidered: 0,
      hitsExamined: 0,
      created: 0,
      errors: 0,
    };
  }

  let hitsExamined = 0;
  let created = 0;
  let errors = 0;

  const runner = params.cogneeRunner ?? ((input) => runCogneeSearch(input));

  for (const topic of topics) {
    if (currentMs() >= deadlineMs) {
      return {
        status: "timeout",
        reason: "budget-exceeded",
        topicsConsidered: topics.length,
        hitsExamined,
        created,
        errors,
      };
    }

    let result: CogneeSearchResult;
    try {
      result = await runner({
        config: params.config,
        query: topic.summary,
        sufficiencyFailed: true,
      });
    } catch {
      errors += 1;
      continue;
    }

    if (result.error) {
      errors += 1;
    }

    const hits = result.results.slice(0, MAX_HITS_PER_TOPIC);
    for (const hit of hits) {
      if (currentMs() >= deadlineMs) {
        return {
          status: "timeout",
          reason: "budget-exceeded",
          topicsConsidered: topics.length,
          hitsExamined,
          created,
          errors,
        };
      }
      hitsExamined += 1;
      const discoverySummary = `Vault discovery: ${topic.summary} -> ${hit.summary}`;
      // Prevent duplicate discovery spam on repeated cycles.
      const duplicate = await hasDiscoveryDuplicate(params.memory, discoverySummary);
      if (duplicate) continue;

      try {
        await params.memory.createItem({
          memoryType: "knowledge",
          summary: discoverySummary,
          significance: "noteworthy",
          extra: {
            source: "contemplation_discovery",
            topic: topic.summary,
            trigger: result.trigger ?? null,
            mode: result.mode ?? null,
            vaultPath: hit.vaultPath ?? null,
            cogneeScore: hit.score,
          },
        });
        created += 1;
      } catch {
        errors += 1;
      }
    }
  }

  return {
    status: "completed",
    topicsConsidered: topics.length,
    hitsExamined,
    created,
    errors,
  };
}
