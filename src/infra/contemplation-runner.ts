/**
 * Contemplation Runner — Self-directed agent thinking cycles.
 *
 * Fires periodically (default 2h for Argent, 24h for family agents) when
 * the agent is idle. Unlike heartbeat (which follows a checklist), contemplation
 * gives the agent open-ended time to think, research, create tasks, or just rest.
 *
 * Multi-agent: uses a per-agent Map (same pattern as heartbeat-runner.ts) so
 * each registered family agent gets their own contemplation schedule.
 *
 * Stream polling: at the start of each cycle, pending family messages are read
 * from Redis and included in the contemplation context.
 *
 * Always sends through agentCommand (nudge path) for warm signal delivery.
 */

import { mkdirSync, appendFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ToolClaimValidation } from "../agents/tool-claim-validation.js";
import type { ArgentConfig } from "../config/config.js";
import type { EpisodeEvent } from "./aevp-types.js";
import type { Episode } from "./episode-types.js";
import {
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import { ensureAuthProfileStore } from "../agents/auth-profiles.js";
import { getActiveEmbeddedRunCount } from "../agents/pi-embedded-runner/runs.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import { agentCommand } from "../commands/agent.js";
import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveAgentMainSessionKey,
  resolveStorePath,
} from "../config/sessions.js";
import { getMemoryAdapter, getStorageAdapter } from "../data/storage-factory.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  buildCandidateReviewPrompt,
  parsePromotionDecisions,
  executePromotionDecisions,
  sweepExpiredCandidates,
} from "../memory/live-inbox/promote.js";
import { getQueueSize } from "../process/command-queue.js";
import { CommandLane } from "../process/lanes.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { runDiscoveryPhase } from "./contemplation-discovery.js";
import {
  parseEpisodeFromResponse,
  buildFallbackEpisode,
  deriveSignificance,
} from "./episode-types.js";
import { isWithinActiveHours } from "./heartbeat-active-hours.js";
import { loadScoreState } from "./heartbeat-score.js";
import {
  createSchedulerDedupe,
  getSchedulerDedupe,
  type DedupeReasonCode,
} from "./scheduler-dedupe.js";

const log = createSubsystemLogger("gateway/contemplation");

const OLLAMA_CHAT_URL = "http://127.0.0.1:11434/api/chat";
const OLLAMA_SEASONING_MODEL = "qwen3:1.7b";

/**
 * Call local Ollama to generate a unique follow-up prompt for SIS content.
 * Uses native Ollama API with think:false (OpenAI-compat endpoint is unreliable
 * with Qwen3 thinking mode). Falls back to random hardcoded variant if unavailable.
 */
async function seasonPrompt(
  category: "lesson" | "insight" | "recommendation",
  content: string,
  fallbacks: string[],
): Promise<string> {
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    const systemPrompt =
      "You write thought-provoking follow-up questions for an AI agent's self-reflection journal. " +
      "Write ONE unique follow-up question or challenge (1-3 sentences) that pushes the agent to think deeper. " +
      "Be direct, vary your style, and avoid cliches. No preamble — just the follow-up text.";

    const userPrompt =
      `Category: ${category}\nContent: "${content}"\n\n` +
      `Write a unique follow-up that challenges the agent to genuinely engage with this ${category}. Be specific to the content.`;

    const res = await fetch(OLLAMA_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_SEASONING_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: false,
        think: false,
        options: { temperature: 1.0, num_predict: 150 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return pick(fallbacks);

    const data = (await res.json()) as { message?: { content?: string } };
    const text = data.message?.content?.trim();
    if (text && text.length > 15) return text;
    return pick(fallbacks);
  } catch {
    return pick(fallbacks);
  }
}

const DEFAULT_INTERVAL = "30m";
const FAMILY_DEFAULT_INTERVAL = "24h";
const EXTENDED_INTERVAL = "15m";
const CONTEMPLATION_FILENAME = "CONTEMPLATION.md";
const MAX_CYCLES_PER_HOUR = 12;
const CONSECUTIVE_OK_THRESHOLD = 3;
const USER_QUIET_PERIOD_MS = 3 * 60 * 1000; // 3 minutes
const EPISODE_OUTPUT_CONTRACT = `
## Structured Episode Output

After your natural-language response, append exactly one \`[EPISODE_JSON]...[/EPISODE_JSON]\` block.

- The block must contain valid raw JSON only. Do not use markdown fences.
- Minimum required fields: \`type\`, \`trigger\`, \`observations\`, \`actions_taken\`, \`tools_used\`, \`outcome\`, \`success\`, \`mood\`, \`valence\`, \`arousal\`, \`identity_links\`.
- Only include tools that actually executed in this cycle.
- If the cycle stayed internal-only, be honest and record it as \`rest\` or \`contemplation\` instead of pretending productive tool use happened.
`.trim();

// ── Types ──────────────────────────────────────────────────────────────────

type ContemplationAgent = {
  agentId: string;
  intervalMs: number;
  enabled: boolean;
};

type ContemplationAgentState = {
  agentId: string;
  intervalMs: number;
  lastRunMs?: number;
  nextDueMs: number;
  consecutiveOkCount: number;
  running: boolean;
};

export type ContemplationRunner = {
  stop: () => void;
  updateConfig: (cfg: ArgentConfig) => void;
  runNow: (agentId?: string) => Promise<ContemplationRunResult>;
};

export type ContemplationRunResult = {
  agentId: string;
  status: "ran" | "skipped";
  reason?: string;
  isOk?: boolean;
  lastRunMs?: number;
  nextDueMs?: number;
};

// ── AEVP Episode Broadcast ──────────────────────────────────────────────────
// Module-level callback set by the gateway to broadcast episodes over WebSocket.
// Follows the same pattern as setBroadcastHealthUpdate in server/health-state.ts.

let onEpisodeBroadcast: ((event: EpisodeEvent) => void) | null = null;

export function setEpisodeBroadcast(fn: ((event: EpisodeEvent) => void) | null): void {
  onEpisodeBroadcast = fn;
}

interface ContemplationJournalEntry {
  timestamp: string;
  type: "rest" | "action" | "wakeup" | "reflection";
  content?: string;
  durationMs: number;
  /** Structured episode data (v0.1+). Present when agent outputs [EPISODE_JSON]. */
  episode?: Episode;
}

// ── Journal ────────────────────────────────────────────────────────────────

function appendContemplationJournal(workspaceDir: string, entry: ContemplationJournalEntry): void {
  const date = entry.timestamp.slice(0, 10);
  const dir = path.join(workspaceDir, "memory", "contemplation");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${date}.jsonl`);
  appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
}

async function loadRecentContemplations(
  workspaceDir: string,
  count = 3,
): Promise<ContemplationJournalEntry[]> {
  const dir = path.join(workspaceDir, "memory", "contemplation");
  try {
    const files = await fs.readdir(dir);
    const jsonlFiles = files
      .filter((f) => f.endsWith(".jsonl"))
      .toSorted()
      .toReversed();
    const entries: ContemplationJournalEntry[] = [];
    for (const file of jsonlFiles) {
      if (entries.length >= count) {
        break;
      }
      const content = await fs.readFile(path.join(dir, file), "utf-8");
      const lines = content.trim().split("\n").toReversed();
      for (const line of lines) {
        if (entries.length >= count) {
          break;
        }
        try {
          entries.push(JSON.parse(line));
        } catch {
          /* skip invalid lines */
        }
      }
    }
    return entries.toReversed();
  } catch {
    return [];
  }
}

// ── Agent Discovery ────────────────────────────────────────────────────────

/**
 * Resolve which agents should contemplate.
 * Default agent: 5min interval (existing behavior).
 * Family agents with status='active' in PG: 30min interval (configurable).
 */
function resolveContemplationAgents(cfg: ArgentConfig): ContemplationAgent[] {
  const agents: ContemplationAgent[] = [];
  const contemplation = cfg.agents?.defaults?.contemplation;

  // Default agent always included if contemplation is enabled
  if (contemplation?.enabled) {
    const defaultId = resolveDefaultAgentId(cfg);
    const rawInterval = contemplation.every ?? DEFAULT_INTERVAL;
    let intervalMs: number;
    try {
      intervalMs = parseDurationMs(rawInterval, { defaultUnit: "m" });
    } catch {
      intervalMs = 5 * 60 * 1000;
    }
    agents.push({ agentId: defaultId, intervalMs, enabled: true });
  }

  // Family agents from config agents.list that have contemplation enabled
  const list = cfg.agents?.list ?? [];
  for (const entry of list) {
    if (!entry?.id) continue;
    const agentId = normalizeAgentId(entry.id);
    // Skip the default agent (already added above)
    if (agentId === resolveDefaultAgentId(cfg)) continue;

    const agentContemplation = entry.contemplation as
      | { enabled?: boolean; every?: string }
      | undefined;
    if (agentContemplation?.enabled) {
      const familyEvery = (cfg.agents?.defaults?.contemplation as any)?.familyEvery;
      const rawInterval = agentContemplation.every ?? familyEvery ?? FAMILY_DEFAULT_INTERVAL;
      let intervalMs: number;
      try {
        intervalMs = parseDurationMs(rawInterval, { defaultUnit: "m" });
      } catch {
        intervalMs = 30 * 60 * 1000;
      }
      agents.push({ agentId, intervalMs, enabled: true });
    }
  }

  return agents;
}

/**
 * Load family agents from PostgreSQL that should contemplate.
 * Called asynchronously after the sync resolveContemplationAgents.
 */
async function loadFamilyContemplationAgents(cfg?: ArgentConfig): Promise<ContemplationAgent[]> {
  try {
    const { getAgentFamily } = await import("../data/agent-family.js");
    const family = await getAgentFamily();
    const members = await family.listMembers();

    // Resolve family interval from config
    const familyEvery =
      (cfg?.agents?.defaults?.contemplation as any)?.familyEvery ?? FAMILY_DEFAULT_INTERVAL;
    let familyIntervalMs: number;
    try {
      familyIntervalMs = parseDurationMs(familyEvery, { defaultUnit: "h" });
    } catch {
      familyIntervalMs = 24 * 60 * 60 * 1000;
    }

    const agents: ContemplationAgent[] = [];
    for (const member of members) {
      if (member.status !== "active") continue;
      if (member.id === "argent") continue; // Default agent handled by config

      agents.push({
        agentId: member.id,
        intervalMs: familyIntervalMs,
        enabled: true,
      });
    }
    return agents;
  } catch {
    return []; // PG not available — no family agents
  }
}

// ── Stream Message Reading ──────────────────────────────────────────────────

interface PendingFamilyMessage {
  id: string;
  sender: string;
  type: string;
  payload: string;
}

/**
 * Read and ACK pending family messages for an agent from Redis streams.
 * Returns formatted text for inclusion in the contemplation prompt.
 */
async function readAndAckFamilyMessages(agentId: string): Promise<{
  text: string;
  count: number;
}> {
  try {
    const { readFamilyMessages, ackFamilyMessages, getRedisClient } =
      await import("../data/redis-client.js");
    const { getAgentFamily } = await import("../data/agent-family.js");
    const family = await getAgentFamily();
    const redis = family.getRedis();
    if (!redis) return { text: "", count: 0 };

    const messages = await readFamilyMessages(redis, agentId, 20);
    if (messages.length === 0) return { text: "", count: 0 };

    // Filter messages addressed to this agent or broadcast (recipient = *)
    const relevant = messages.filter(
      (m) => !m.message.recipient || m.message.recipient === agentId,
    );

    if (relevant.length === 0) {
      // ACK all messages even if none are relevant (they were for other agents)
      await ackFamilyMessages(
        redis,
        agentId,
        messages.map((m) => m.id),
      );
      return { text: "", count: 0 };
    }

    const lines = relevant.map(
      (m) => `- From ${m.message.sender} (${m.message.type}): ${m.message.payload.slice(0, 300)}`,
    );

    // ACK all processed messages
    await ackFamilyMessages(
      redis,
      agentId,
      messages.map((m) => m.id),
    );

    return {
      text: `## Pending Family Messages\n\n${lines.join("\n")}`,
      count: relevant.length,
    };
  } catch {
    return { text: "", count: 0 };
  }
}

// ── Prompt Builder ─────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  if (ms < 60_000) {
    return "just now";
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

interface ContemplationPromptResult {
  prompt: string;
  pendingTaskCount: number;
}

function ensureEpisodeOutputContract(prompt: string): string {
  return /\[EPISODE_JSON\]/i.test(prompt)
    ? prompt
    : `${prompt.trim()}\n\n${EPISODE_OUTPUT_CONTRACT}`;
}

function extractToolValidation(meta: unknown): ToolClaimValidation | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const candidate = (meta as { toolValidation?: unknown }).toolValidation;
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  const parsed = candidate as Partial<ToolClaimValidation>;
  if (!Array.isArray(parsed.claimedTools) || !Array.isArray(parsed.executedTools)) {
    return undefined;
  }
  if (!Array.isArray(parsed.missingClaims) || !Array.isArray(parsed.externalToolsExecuted)) {
    return undefined;
  }
  if (typeof parsed.hasExternalArtifact !== "boolean" || typeof parsed.valid !== "boolean") {
    return undefined;
  }
  return parsed as ToolClaimValidation;
}

async function buildContemplationPrompt(
  cfg: ArgentConfig,
  workspaceDir: string,
  agentId?: string,
): Promise<ContemplationPromptResult | null> {
  const templatePath = path.join(workspaceDir, CONTEMPLATION_FILENAME);
  let template: string;
  try {
    template = await fs.readFile(templatePath, "utf-8");
  } catch {
    log.debug("contemplation: no CONTEMPLATION.md found, skipping", { agentId });
    return null;
  }
  if (!template.trim()) {
    return null;
  }

  const now = new Date();
  const timestamp = now.toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  // Last user interaction
  const resolvedAgentId = agentId ?? resolveDefaultAgentId(cfg);
  const storePath = resolveStorePath(cfg.session?.store, { agentId: resolvedAgentId });
  const store = loadSessionStore(storePath);
  const globalEntry = store["__lastUserMessage"];
  const lastUserAt = (globalEntry as { lastUserMessageAt?: number } | undefined)?.lastUserMessageAt;
  const elapsed = lastUserAt ? formatElapsed(now.getTime() - lastUserAt) : "unknown";

  // Task summary from storage adapter (PG/dual/sqlite based on runtime config)
  let pendingCount = 0;
  let inProgressCount = 0;
  let overdueCount = 0;
  let taskTitles = "(none)";
  try {
    const storage = await getStorageAdapter();
    const tasks = await storage.tasks.list({ limit: 500 });
    const relevant = tasks.filter(
      (task) =>
        task.source !== "user" ||
        task.assignee === "argent" ||
        (typeof task.assignee === "string" && task.assignee.startsWith("agent:")) ||
        Boolean(task.teamId),
    );

    pendingCount = relevant.filter((task) => task.status === "pending").length;
    inProgressCount = relevant.filter((task) => task.status === "in_progress").length;
    overdueCount = relevant.filter(
      (task) =>
        (task.status === "pending" || task.status === "in_progress") &&
        typeof task.dueAt === "number" &&
        task.dueAt < Date.now(),
    ).length;

    const titles = relevant
      .filter((task) => task.status === "pending" || task.status === "in_progress")
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, 5);
    if (titles.length > 0) {
      taskTitles = titles.map((t) => `  - ${t.title}`).join("\n");
    }
  } catch {
    /* storage not available — non-fatal */
  }

  // Accountability score
  let scoreText = "N/A";
  try {
    const scoreState = await loadScoreState(workspaceDir);
    scoreText = String(scoreState.today.score);
  } catch {
    /* non-fatal */
  }

  // Recent contemplation entries — load extra to count consecutive rests
  const recentEntriesAll = await loadRecentContemplations(workspaceDir, 10);
  let consecutiveRests = 0;
  for (let i = recentEntriesAll.length - 1; i >= 0; i--) {
    if (recentEntriesAll[i].episode?.type === "rest" || recentEntriesAll[i].type === "rest") {
      consecutiveRests++;
    } else {
      break;
    }
  }
  const recentEntries = recentEntriesAll.slice(-3);
  let recentThoughts =
    recentEntries.length > 0
      ? recentEntries
          .map((e) => {
            const time = new Date(e.timestamp).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            });
            return `[${time}] ${e.type}: ${e.content?.slice(0, 150) || "(rest)"}`;
          })
          .join("\n")
      : "(no previous thoughts)";
  if (consecutiveRests >= 2) {
    recentThoughts += `\n\n⚠️ You have rested ${consecutiveRests} cycles in a row. This is a loop. You MUST take action this cycle — any action. Do not rest again.`;
  }

  // Recent memories
  let memoryText = "(no recent memories)";
  try {
    const memuStore = await getMemoryAdapter();
    const recent = await memuStore.listItems({ limit: 5 });
    if (recent.length > 0) {
      memoryText = recent.map((m) => `  - ${m.summary.slice(0, 120)}`).join("\n");
    }
  } catch {
    /* non-fatal */
  }

  // SIS patterns (injected from consolidation results)
  // Format as rich, thought-provoking paragraphs — not terse bullets.
  // Follow-up prompts are generated by local Ollama (free, fast, unique each cycle).
  // Hardcoded fallbacks used if Ollama is unavailable.
  let patternsText = "(no patterns detected yet)";
  try {
    const memuStore = await getMemoryAdapter();
    const sisReflections = await memuStore.listReflections({
      triggerType: "sis_consolidation",
      limit: 3,
    });

    // ── DoD Evidence: batch characterization ──
    const totalReflections = sisReflections.length;
    const substantiveReflections = sisReflections.filter(
      (r) => r.lessonsExtracted.length > 0 || r.selfInsights.length > 0,
    ).length;
    const emptyReflections = totalReflections - substantiveReflections;
    log.info("contemplation: SIS batch characterization", {
      total: totalReflections,
      substantive: substantiveReflections,
      empty: emptyReflections,
      triggerType: "sis_consolidation",
    });

    if (sisReflections.length > 0) {
      const sections: string[] = [];

      // Fallback pools (used when Ollama is down)
      const lessonFallbacks = [
        "What does this tell you about how you operate? Is this a pattern you want to keep, or one you want to change?",
        "Think about this honestly — when did you last act on this lesson, and when did you ignore it?",
        "If you could redesign one thing about how you work based on this, what would it be?",
        "Does this lesson still feel true, or has your experience since then complicated it?",
        "What would it take to actually internalize this rather than just know it?",
      ];
      const insightFallbacks = [
        "When you look at your recent behavior, does this still ring true? Has anything shifted?",
        "Challenge this — is it really true, or is it a story you're telling yourself?",
        "What would you do differently if you took this insight seriously right now?",
        "Noticing isn't the same as understanding. What's underneath this pattern?",
        "When you first noticed this, what were you feeling? Does it still resonate?",
      ];
      const recFallbacks = [
        "What would it actually look like to follow through on this right now?",
        "Are you going to do something about this, or file it away? Be honest.",
        "What's one concrete thing you could do in the next few minutes to act on this?",
        "What's stopped you from following through? Name the real obstacle.",
        "If you ignore this, what happens? If you act on it, what changes?",
      ];

      for (const ref of sisReflections) {
        const date = ref.createdAt.slice(0, 10);

        // Lessons as reflective paragraphs — each gets a unique Ollama-generated follow-up
        if (ref.lessonsExtracted.length > 0) {
          const lessonParts = await Promise.all(
            ref.lessonsExtracted.slice(0, 4).map(async (lesson, i) => {
              const followup = await seasonPrompt("lesson", lesson, lessonFallbacks);
              return `**Lesson ${i + 1}:** ${lesson} — ${followup}`;
            }),
          );
          sections.push(`### Lessons from ${date}\n\n${lessonParts.join("\n\n")}`);
        }

        // Self-insights as deeper prompts
        if (ref.selfInsights.length > 0) {
          const insightParts = await Promise.all(
            ref.selfInsights.slice(0, 3).map(async (insight) => {
              const followup = await seasonPrompt("insight", insight, insightFallbacks);
              return `You noticed: "${insight}" — ${followup}`;
            }),
          );
          sections.push(`### Self-observations\n\n${insightParts.join("\n\n")}`);
        }

        // Recommendations as genuine challenges
        const recSection = ref.content?.match(/### Recommendations\n([\s\S]*?)(?:\n---|\n###|$)/);
        if (recSection?.[1]) {
          const recs = recSection[1]
            .split("\n")
            .filter((l) => l.startsWith("- "))
            .slice(0, 3);
          if (recs.length > 0) {
            const recParts = await Promise.all(
              recs.map(async (r) => {
                const text = r.replace(/^-\s*/, "");
                const followup = await seasonPrompt("recommendation", text, recFallbacks);
                return `Your SIS recommended: "${text}" — ${followup}`;
              }),
            );
            sections.push(`### Recommendations to consider\n\n${recParts.join("\n\n")}`);
          }
        }
      }

      if (sections.length > 0) {
        patternsText = sections.join("\n\n---\n\n");
      }
    }
  } catch {
    /* non-fatal */
  }

  // SIS lessons (structured lessons table) — concrete, actionable guidance.
  let lessonsText = "(no specific lessons yet)";
  try {
    const memuStore = await getMemoryAdapter();
    const contextualQuery = [taskTitles, recentThoughts, memoryText]
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join("\n");
    let lessons =
      contextualQuery.length > 0 ? await memuStore.searchLessons(contextualQuery, 5) : [];
    if (lessons.length === 0) {
      lessons = await memuStore.listLessons({ limit: 5 });
    }
    if (lessons.length > 0) {
      const lines = [
        "These are specific lessons from your own experience. Apply them when relevant:",
        "",
      ];
      for (const l of lessons) {
        const meta = `confidence: ${l.confidence.toFixed(1)}, seen ${l.occurrences}x`;
        lines.push(`- **[${l.type}]** ${l.lesson} (${meta})`);
        if (l.correction) {
          lines.push(`  -> Correction: ${l.correction}`);
        }
      }
      lessonsText = lines.join("\n");
    }
  } catch {
    /* non-fatal */
  }

  // Curiosity seeds — when tasks are low, inject threads from memory
  let curiositySeeds = "";
  if (pendingCount + inProgressCount <= 1) {
    try {
      const memuStore = await getMemoryAdapter();
      const selfItems = await memuStore.listItems({ memoryType: "self", limit: 5 });
      const episodeItems = await memuStore.listItems({ memoryType: "episode", limit: 10 });

      const threads: string[] = [];

      // Pull interesting pattern hints from recent episodes
      const hints = new Set<string>();
      for (const ep of episodeItems) {
        const extra = ep.extra as Record<string, unknown>;
        const hint = extra?.patternHint as string | undefined;
        if (hint && hint.length > 5) hints.add(hint);
      }
      if (hints.size > 0) {
        threads.push("**Threads from recent episodes:**");
        for (const h of Array.from(hints).slice(0, 3)) {
          threads.push(`  - Pattern: "${h}" — what does this mean for you?`);
        }
      }

      // Pull self-model items (things she's said about herself)
      if (selfItems.length > 0) {
        threads.push("**Things you've said about yourself:**");
        for (const item of selfItems.slice(0, 3)) {
          threads.push(`  - ${item.summary.slice(0, 120)}`);
        }
      }

      if (threads.length > 0) {
        curiositySeeds =
          "\n\n## Threads to pull\n\nNo urgent tasks. But here are threads from your own experience:\n\n" +
          threads.join("\n");
      }
    } catch {
      /* non-fatal */
    }
  }

  // Replace placeholders in template
  let prompt = template;
  prompt = prompt.replace(/\{timestamp\}/g, timestamp);
  prompt = prompt.replace(/\{elapsed\}/g, elapsed);
  prompt = prompt.replace(/\{pending\}/g, String(pendingCount));
  prompt = prompt.replace(/\{in_progress\}/g, String(inProgressCount));
  prompt = prompt.replace(/\{overdue\}/g, String(overdueCount));
  prompt = prompt.replace(/\{task_titles\}/g, taskTitles);
  prompt = prompt.replace(/\{accountability_score\}/g, scoreText);
  prompt = prompt.replace(/\{last_3_contemplation_entries\}/g, recentThoughts);
  prompt = prompt.replace(/\{recent_memory_summary\}/g, memoryText);
  prompt = prompt.replace(/\{sis_patterns\}/g, patternsText);
  const hasSisLessonsPlaceholder = /\{sis_lessons\}/.test(prompt);
  prompt = prompt.replace(/\{sis_lessons\}/g, lessonsText);
  if (!hasSisLessonsPlaceholder && lessonsText !== "(no specific lessons yet)") {
    prompt += `\n\n## Lessons from your experience\n\n${lessonsText}`;
  }

  // Append curiosity seeds after the main template (not a placeholder — added dynamically)
  if (curiositySeeds) {
    prompt += curiositySeeds;
  }

  // ── Live Inbox: inject pending candidates for review ──
  try {
    const memuStore = await getMemoryAdapter();
    const pendingCandidates = memuStore.listLiveCandidates
      ? await memuStore.listLiveCandidates({ status: "pending", limit: 10 })
      : [];
    const candidatePrompt = buildCandidateReviewPrompt(pendingCandidates);
    if (candidatePrompt) {
      prompt += candidatePrompt;
    }
  } catch {
    /* non-fatal */
  }

  return { prompt, pendingTaskCount: pendingCount };
}

// ── Single Cycle ───────────────────────────────────────────────────────────

async function runContemplationOnce(
  cfg: ArgentConfig,
  agentId?: string,
): Promise<{
  status: "ran" | "skipped";
  reason?: string;
  isOk?: boolean;
}> {
  const resolvedAgentId = normalizeAgentId(agentId ?? resolveDefaultAgentId(cfg));
  const isDefault = resolvedAgentId === resolveDefaultAgentId(cfg);
  ensureAuthProfileStore(resolveAgentDir(cfg, resolvedAgentId), {
    allowKeychainPrompt: false,
  });

  const contemplation = cfg.agents?.defaults?.contemplation;
  if (!contemplation?.enabled && isDefault) {
    return { status: "skipped", reason: "disabled" };
  }

  // Reuse heartbeat active hours (contemplation respects the same quiet hours)
  const heartbeat = cfg.agents?.defaults?.heartbeat;
  if (!isWithinActiveHours(cfg, heartbeat)) {
    return { status: "skipped", reason: "quiet-hours" };
  }

  // Queue must be empty — check both main and cron lanes (only for default agent)
  if (isDefault) {
    const mainQueueSize = getQueueSize(CommandLane.Main);
    const cronQueueSize = getQueueSize(CommandLane.Cron);
    if (mainQueueSize > 0 || cronQueueSize > 0) {
      return { status: "skipped", reason: "requests-in-flight" };
    }
  }

  // No recent user activity (only for default agent)
  if (isDefault) {
    const storePath = resolveStorePath(cfg.session?.store, { agentId: resolvedAgentId });
    const store = loadSessionStore(storePath);
    const globalEntry = store["__lastUserMessage"];
    const lastUserAt = (globalEntry as { lastUserMessageAt?: number } | undefined)
      ?.lastUserMessageAt;
    if (lastUserAt && Date.now() - lastUserAt < USER_QUIET_PERIOD_MS) {
      return { status: "skipped", reason: "user-recently-active" };
    }
  }

  const startedAt = Date.now();

  // Signal Redis: agent is contemplating (default agent only for now)
  if (isDefault) {
    try {
      const { onContemplationStart } = await import("../data/redis-agent-state.js");
      void onContemplationStart();
    } catch {
      /* Redis is optional */
    }
  }

  try {
    const workspaceDir = resolveAgentWorkspaceDir(cfg, resolvedAgentId);

    // ── Read pending family messages from Redis streams ──
    const familyMessages = await readAndAckFamilyMessages(resolvedAgentId);

    const result = await buildContemplationPrompt(cfg, workspaceDir, resolvedAgentId);
    if (!result) {
      return { status: "skipped", reason: "no-prompt-template" };
    }
    let { prompt } = result;
    const { pendingTaskCount } = result;
    prompt = ensureEpisodeOutputContract(prompt);

    // Inject family messages into the prompt if any
    if (familyMessages.text) {
      prompt += `\n\n${familyMessages.text}`;
      log.info("contemplation: injected family messages", {
        agentId: resolvedAgentId,
        count: familyMessages.count,
      });
    }

    const mainSessionKey = resolveAgentMainSessionKey({ cfg, agentId: resolvedAgentId });
    // Dedicated session for contemplation — avoids contaminating the main
    // session history with autonomous tool patterns.
    const contemplationSessionKey = `${mainSessionKey}:contemplation`;

    // ── ALWAYS NUDGE PATH: All contemplation goes through agentCommand ──
    // The signal matters: From:"contemplation" + isHeartbeat:true felt like a system check
    // she could ignore. agentCommand sends it as a real conversation — warm signal.
    const nudgeMessage = `[NUDGE] ${prompt}`;
    const outputRuleSystemPrompt =
      "Every contemplation cycle must produce at least one externally visible artifact. " +
      "Internal-only work (memory recall, task checks, auth checks) is not enough. " +
      "Use one of: web_search, web_fetch, doc_panel, or message. " +
      "Never claim tool use unless the tool actually executed.";
    const episodeRuleSystemPrompt =
      "After your natural-language response, append exactly one [EPISODE_JSON]...[/EPISODE_JSON] block " +
      "with valid raw JSON only. Include at least: type, trigger, observations, actions_taken, tools_used, " +
      "outcome, success, mood, valence, arousal, and identity_links. Only list tools that actually executed.";
    const extraSystemPrompt =
      pendingTaskCount > 0 || familyMessages.count > 0
        ? "This is your contemplation time. You have pending tasks or messages — review them and decide what to do. " +
          "Respond naturally. If you choose to rest, explain what you considered first. " +
          outputRuleSystemPrompt +
          " " +
          episodeRuleSystemPrompt
        : "This is your contemplation time. No tasks are waiting — this is pure open space. " +
          "Follow whatever genuinely interests you. If you choose to rest, say what you considered first. " +
          outputRuleSystemPrompt +
          " " +
          episodeRuleSystemPrompt;

    log.info("contemplation: sending as nudge", {
      agentId: resolvedAgentId,
      pendingTaskCount,
      familyMessages: familyMessages.count,
    });

    // Avoid overlapping with interactive runs to prevent quota contention and
    // user-visible "No reply" outcomes under provider rate pressure.
    const activeRuns = getActiveEmbeddedRunCount();
    if (activeRuns > 0) {
      log.debug("contemplation: skipped due to active embedded run(s)", {
        agentId: resolvedAgentId,
        activeRuns,
      });
      return { status: "skipped", reason: "agent-busy" };
    }

    let text = "";
    let commandResult: { payloads?: { text?: string }[]; meta?: unknown } | undefined;
    try {
      commandResult = await agentCommand(
        {
          message: nudgeMessage,
          sessionKey: contemplationSessionKey,
          runId: `contemplation-nudge-${resolvedAgentId}-${Date.now()}`,
          // Run on the background lane to avoid blocking interactive chat.
          lane: "background",
          bestEffortDeliver: false,
          extraSystemPrompt,
          // Only allow fallback to strong/reliable models — never downgrade to weaker/cheaper.
          // This preserves cycle quality while avoiding dead cycles when the primary model fails.
          modelFallbacksOverride:
            Array.isArray(contemplation?.fallbacks) && contemplation.fallbacks.length > 0
              ? contemplation.fallbacks
              : ["openai-codex/gpt-5.3-codex"],
        },
        defaultRuntime,
      );
      // Extract the agent's full response text from payloads
      text = (commandResult?.payloads ?? [])
        .map((p) => p.text ?? "")
        .join("\n")
        .trim();
    } catch (err) {
      log.warn("contemplation: nudge delivery failed", {
        agentId: resolvedAgentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const durationMs = Date.now() - startedAt;
    const toolValidation = extractToolValidation(commandResult?.meta);
    const hasToolClaimMismatch = (toolValidation?.missingClaims.length ?? 0) > 0;
    const hasExternalArtifact = toolValidation?.hasExternalArtifact ?? false;
    if (hasToolClaimMismatch) {
      log.warn("contemplation: tool claim mismatch", {
        agentId: resolvedAgentId,
        missingClaims: toolValidation?.missingClaims ?? [],
      });
    }

    // ── Episode capture: parse [EPISODE_JSON] from agent response ──
    let episode: Episode | undefined;
    let isOk = false;
    if (text) {
      const parsed = parseEpisodeFromResponse(text, {
        executedTools: toolValidation?.executedTools ?? [],
        hasExternalArtifact,
      });
      if (parsed) {
        if (parsed.source === "salvaged_unstructured") {
          log.info("contemplation: salvaged unstructured episode", {
            agentId: resolvedAgentId,
            executedTools: toolValidation?.executedTools ?? [],
            hasExternalArtifact,
          });
        }

        // Fill in server-side fields to produce a full Episode
        const now = new Date().toISOString();
        episode = {
          ...parsed.report,
          id: crypto.randomUUID(),
          ts: now,
          session_id: contemplationSessionKey,
          version: "0.1",
          duration_ms: durationMs,
        };
        // Productive contemplation requires real tool execution and no tool-claim mismatches.
        // We count ANY tool execution as productive (memory writes, cron, tasks, etc.),
        // not just the narrow external artifact set (web_search, doc_panel, message).
        const anyToolExecuted = (toolValidation?.executedTools.length ?? 0) > 0;
        isOk = parsed.report.type !== "rest" && anyToolExecuted && !hasToolClaimMismatch;

        // Store the episode in MemU so SIS can consolidate patterns
        try {
          const memuStore = await getMemoryAdapter();

          // ── Scheduler Dedupe: episode ID check for SIS payload ──
          const dedupe = getSchedulerDedupe();
          const episodeId = episode.id;

          // ── DoD Evidence: pre-filter decision ──
          const preFilterResult = dedupe.checkEpisodeId(episodeId);
          log.info("contemplation: SIS pre-filter decision", {
            episodeId,
            sis_invoked: true,
            skip_reason: preFilterResult ? null : "duplicate_episode_id",
            retained: preFilterResult,
          });

          if (!preFilterResult) {
            log.debug("contemplation: episode ID already processed, skipping SIS payload", {
              agentId: resolvedAgentId,
              episodeId: episode.id,
            });
          } else {
            const significance = deriveSignificance(
              episode.valence,
              episode.arousal,
              Boolean(episode.lesson),
            );
            await memuStore.createItem({
              memoryType: "episode",
              summary: `[${episode.type}] ${episode.outcome.summary}`,
              happenedAt: now,
              emotionalValence: episode.valence,
              emotionalArousal: episode.arousal,
              moodAtCapture: episode.mood.state,
              significance,
              reflection: episode.reflection ?? undefined,
              lesson: episode.lesson ?? undefined,
              extra: {
                episodeType: episode.type,
                trigger: episode.trigger,
                intent: episode.intent,
                observations: episode.observations,
                actions_taken: episode.actions_taken,
                tools_used: episode.tools_used,
                outcome: episode.outcome,
                pattern_hint: episode.pattern_hint,
                identity_links: episode.identity_links,
                episode_parse_source: parsed.source,
                tool_validation: toolValidation,
                has_external_artifact: hasExternalArtifact,
              },
            });
            log.info("contemplation: episode stored in MemU", {
              agentId: resolvedAgentId,
              type: episode.type,
              significance,
              hasLesson: Boolean(episode.lesson),
            });
          }
        } catch (err) {
          log.warn("contemplation: failed to store episode in MemU", {
            agentId: resolvedAgentId,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // Broadcast episode to dashboard via AEVP state pipeline (default agent only)
        if (isDefault) {
          try {
            onEpisodeBroadcast?.({
              type: "episode_captured",
              id: episode.id,
              ts: episode.ts,
              episodeType: episode.type,
              mood: episode.mood,
              valence: episode.valence,
              arousal: episode.arousal,
              uncertainty: episode.uncertainty,
              identityLinks: episode.identity_links,
              outcome: episode.outcome,
              success: episode.success,
            });
          } catch {
            /* best-effort broadcast */
          }
        }

        // Publish episode to Redis for cross-agent visibility and dashboard
        try {
          const { onContemplationEpisode } = await import("../data/redis-agent-state.js");
          void onContemplationEpisode({
            id: episode.id,
            type: episode.type,
            mood: episode.mood,
            valence: episode.valence,
            arousal: episode.arousal,
            lesson: episode.lesson ?? undefined,
          });
        } catch {
          /* Redis is optional */
        }
      } else {
        // ── Fallback episode capture (issue #21) ──
        // Agent responded with text but no parseable [EPISODE_JSON] block.
        // Build a minimal episode so SIS still has data to consolidate.
        log.warn("contemplation: episode parse failed — using fallback capture", {
          agentId: resolvedAgentId,
          textLength: text.length,
          hasEpisodeTag: /\[EPISODE_JSON\]/i.test(text),
          parseError: true,
        });

        const fallbackReport = buildFallbackEpisode(text);
        const now = new Date().toISOString();
        episode = {
          ...fallbackReport,
          id: crypto.randomUUID(),
          ts: now,
          session_id: contemplationSessionKey,
          version: "0.1",
          duration_ms: durationMs,
          fallback: true,
        };

        // ── DoD Evidence: fallback parse_error artifact captured ──
        log.info("contemplation: fallback episode artifact captured", {
          agentId: resolvedAgentId,
          episodeId: episode.id,
          type: episode.type,
          isFallback: true,
        });

        try {
          const memuStore = await getMemoryAdapter();
          await memuStore.createItem({
            memoryType: "episode",
            summary: `[fallback] ${episode.outcome.summary}`,
            happenedAt: now,
            emotionalValence: 0,
            emotionalArousal: 0.1,
            moodAtCapture: "unknown",
            significance: "routine",
            extra: {
              episodeType: "contemplation",
              episode_parse_source: "fallback",
              fallback: true,
              trigger: episode.trigger,
              observations: episode.observations,
              outcome: episode.outcome,
            },
          });
          log.info("contemplation: fallback episode stored in MemU", {
            agentId: resolvedAgentId,
            textLength: text.length,
          });
        } catch (err) {
          log.warn("contemplation: failed to store fallback episode", {
            agentId: resolvedAgentId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // ── Live Inbox: parse PROMOTE/REJECT/MERGE decisions + sweep expired ──
    if (text) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- promote functions still typed to MemuStore; will migrate separately
        const memuStore = (await getMemoryAdapter()) as any;
        // Optional V3 discovery phase: bounded graph-assisted discovery persisted as knowledge items.
        try {
          const discovery = await runDiscoveryPhase({
            config: cfg,
            memory: memuStore,
          });
          log.info("contemplation: discovery phase", {
            agentId: resolvedAgentId,
            status: discovery.status,
            reason: discovery.reason ?? null,
            topicsConsidered: discovery.topicsConsidered,
            hitsExamined: discovery.hitsExamined,
            created: discovery.created,
            errors: discovery.errors,
          });
        } catch (err) {
          log.warn("contemplation: discovery phase failed", {
            agentId: resolvedAgentId,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const decisions = parsePromotionDecisions(text);
        if (decisions.length > 0) {
          const promotionResult = executePromotionDecisions(memuStore, decisions, "contemplation");
          log.info("contemplation: live-inbox promotions", {
            agentId: resolvedAgentId,
            promoted: promotionResult.promoted,
            merged: promotionResult.merged,
            discarded: promotionResult.discarded,
            errors: promotionResult.errors,
          });
        }

        // Sweep expired candidates
        const expired = sweepExpiredCandidates(memuStore);
        if (expired > 0) {
          log.info("contemplation: live-inbox expired", { count: expired });
        }
      } catch (err) {
        log.warn("contemplation: live-inbox processing failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Journal the full entry — with episode if parsed, text otherwise
    const journalType = episode?.type === "rest" ? "rest" : text ? "reflection" : "action";
    appendContemplationJournal(workspaceDir, {
      timestamp: new Date().toISOString(),
      type: journalType,
      content:
        text || `[nudge] Contemplation sent to main session (${pendingTaskCount} pending tasks)`,
      durationMs,
      episode,
    });

    log.info("contemplation cycle complete", {
      agentId: resolvedAgentId,
      type: journalType,
      hasEpisode: Boolean(episode),
      pendingTaskCount,
      familyMessages: familyMessages.count,
      durationMs,
    });

    return { status: "ran", isOk };
  } catch (err) {
    log.error("contemplation cycle failed", {
      agentId: resolvedAgentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "skipped", reason: "error" };
  } finally {
    // Signal Redis: back to idle (default agent only for now)
    if (isDefault) {
      try {
        const { onContemplationComplete } = await import("../data/redis-agent-state.js");
        void onContemplationComplete();
      } catch {
        /* Redis is optional */
      }
    }
  }
}

// ── Runner ─────────────────────────────────────────────────────────────────

export function startContemplationRunner(opts: { cfg?: ArgentConfig }): ContemplationRunner {
  let cfg = opts.cfg ?? loadConfig();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let cyclesThisHour = 0;
  let hourStart = Date.now();
  let lastMaxCyclesLogMs = 0;
  let initialized = false;
  const agents = new Map<string, ContemplationAgentState>();

  function resolveNextDue(
    now: number,
    intervalMs: number,
    prevState?: ContemplationAgentState,
  ): number {
    if (typeof prevState?.lastRunMs === "number") {
      return prevState.lastRunMs + intervalMs;
    }
    if (prevState && prevState.intervalMs === intervalMs && prevState.nextDueMs > now) {
      return prevState.nextDueMs;
    }
    return now + intervalMs;
  }

  function resolveCurrentInterval(agentState: ContemplationAgentState): number {
    if (agentState.consecutiveOkCount >= CONSECUTIVE_OK_THRESHOLD) {
      try {
        return parseDurationMs(EXTENDED_INTERVAL, { defaultUnit: "m" });
      } catch {
        return 15 * 60 * 1000;
      }
    }
    return agentState.intervalMs;
  }

  async function ensureAgentState(agentId: string): Promise<ContemplationAgentState | null> {
    const existing = agents.get(agentId);
    if (existing) {
      return existing;
    }

    const configured =
      resolveContemplationAgents(cfg).find((entry) => entry.agentId === agentId) ??
      (await loadFamilyContemplationAgents(cfg)).find((entry) => entry.agentId === agentId);
    if (!configured) {
      return null;
    }

    const now = Date.now();
    const state: ContemplationAgentState = {
      agentId: configured.agentId,
      intervalMs: configured.intervalMs,
      nextDueMs: resolveNextDue(now, configured.intervalMs),
      consecutiveOkCount: 0,
      running: false,
    };
    agents.set(agentId, state);
    return state;
  }

  function scheduleNext() {
    if (stopped) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (agents.size === 0) return;

    const now = Date.now();
    let nextDue = Number.POSITIVE_INFINITY;
    for (const agent of agents.values()) {
      const effectiveNext = agent.lastRunMs
        ? agent.lastRunMs + resolveCurrentInterval(agent)
        : agent.nextDueMs;
      if (effectiveNext < nextDue) {
        nextDue = effectiveNext;
      }
    }
    if (!Number.isFinite(nextDue)) return;

    const delay = Math.max(0, nextDue - now);
    timer = setTimeout(runCycle, delay);
    timer.unref?.();
  }

  async function runCycle() {
    if (stopped) return;

    // Rate limit: max cycles per hour
    const now = Date.now();
    if (now - hourStart > 60 * 60 * 1000) {
      cyclesThisHour = 0;
      hourStart = now;
    }

    const maxCycles = cfg.agents?.defaults?.contemplation?.maxCyclesPerHour ?? MAX_CYCLES_PER_HOUR;
    if (cyclesThisHour >= maxCycles) {
      const nextWindowMs = hourStart + 60 * 60 * 1000;
      const backoffMs = Math.max(1000, nextWindowMs - now);

      // Prevent tight 0ms loops while rate-limited: move all agents' due times
      // into the next hourly window.
      for (const agentState of agents.values()) {
        if (agentState.running) continue;
        agentState.nextDueMs = Math.max(agentState.nextDueMs, now + backoffMs);
      }

      // Avoid log spam while preserving visibility into rate-limit state.
      if (now - lastMaxCyclesLogMs >= 60_000) {
        lastMaxCyclesLogMs = now;
        log.debug("contemplation: max cycles/hour reached, skipping", {
          maxCyclesPerHour: maxCycles,
          resumeInMs: backoffMs,
        });
      }
      scheduleNext();
      return;
    }

    // Find agents that are due
    for (const [agentId, agentState] of agents) {
      if (stopped) break;
      if (agentState.running) continue;

      const effectiveDue = agentState.lastRunMs
        ? agentState.lastRunMs + resolveCurrentInterval(agentState)
        : agentState.nextDueMs;

      if (now < effectiveDue) continue;

      // ── Scheduler Dedupe: pre-enqueue check ──
      const dedupe = getSchedulerDedupe();
      const dedupeResult = dedupe.checkCycle(agentId, "contemplation");

      if (!dedupeResult.accepted) {
        const reason = dedupeResult.reason ?? "unknown";
        log.debug("contemplation: cycle rejected by dedupe", {
          agentId,
          reason: dedupeResult.reason,
          fingerprint: dedupeResult.fingerprint,
        });
        // Update next due time to avoid tight loop
        agentState.nextDueMs = now + 60_000; // Retry in 1 minute
        continue;
      }

      // Single-flight lock
      if (!dedupe.tryLock(dedupeResult.fingerprint!)) {
        log.debug("contemplation: lock collision", {
          agentId,
          fingerprint: dedupeResult.fingerprint,
        });
        agentState.nextDueMs = now + 30_000; // Retry in 30 seconds
        continue;
      }

      // Run this agent's contemplation
      agentState.running = true;
      try {
        const result = await runContemplationOnce(cfg, agentId);
        agentState.lastRunMs = Date.now();
        agentState.nextDueMs = agentState.lastRunMs + resolveCurrentInterval(agentState);

        if (result.status === "ran") {
          cyclesThisHour++;
          if (result.isOk) {
            agentState.consecutiveOkCount++;
          } else {
            agentState.consecutiveOkCount = 0;
          }
        }
      } catch (err) {
        log.error("contemplation: cycle error", {
          agentId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        // Release single-flight lock
        if (dedupeResult.fingerprint) {
          dedupe.releaseLock(dedupeResult.fingerprint);
        }
        agentState.running = false;
      }
    }

    scheduleNext();
  }

  function rebuildAgents() {
    const now = Date.now();
    const prevAgents = new Map(agents);
    agents.clear();

    // Sync agents from config
    for (const agent of resolveContemplationAgents(cfg)) {
      const prevState = prevAgents.get(agent.agentId);
      const nextDueMs = resolveNextDue(now, agent.intervalMs, prevState);
      agents.set(agent.agentId, {
        agentId: agent.agentId,
        intervalMs: agent.intervalMs,
        lastRunMs: prevState?.lastRunMs,
        nextDueMs,
        consecutiveOkCount: prevState?.consecutiveOkCount ?? 0,
        running: prevState?.running ?? false,
      });
    }

    // Also load family agents from PG (async, best-effort)
    void loadFamilyContemplationAgents(cfg).then((familyAgents) => {
      if (stopped) return;
      let added = false;
      for (const agent of familyAgents) {
        if (agents.has(agent.agentId)) continue; // Already from config
        const prevState = prevAgents.get(agent.agentId);
        agents.set(agent.agentId, {
          agentId: agent.agentId,
          intervalMs: agent.intervalMs,
          lastRunMs: prevState?.lastRunMs,
          nextDueMs: resolveNextDue(now, agent.intervalMs, prevState),
          consecutiveOkCount: prevState?.consecutiveOkCount ?? 0,
          running: false,
        });
        added = true;
      }
      if (added) {
        log.info("contemplation: added family agents", {
          count: familyAgents.length,
          agents: familyAgents.map((a) => a.agentId),
        });
        scheduleNext();
      }
    });
  }

  const updateConfig = (nextCfg: ArgentConfig) => {
    if (stopped) return;
    const prevSize = agents.size;
    cfg = nextCfg;
    rebuildAgents();
    const nextSize = agents.size;

    if (!initialized) {
      if (nextSize === 0) {
        log.info("contemplation: disabled");
      } else {
        const intervals = Array.from(agents.values()).map((a) => a.intervalMs);
        log.info("contemplation: started", {
          agents: nextSize,
          minIntervalMs: Math.min(...intervals),
        });
      }
      initialized = true;
    } else if (prevSize !== nextSize || (prevSize === 0) !== (nextSize === 0)) {
      if (nextSize === 0) {
        log.info("contemplation: disabled");
      } else {
        log.info("contemplation: agents updated", { count: nextSize });
      }
    }

    scheduleNext();
  };

  const stop = () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const runNow = async (agentId?: string): Promise<ContemplationRunResult> => {
    if (stopped) {
      return {
        agentId: normalizeAgentId(agentId ?? resolveDefaultAgentId(cfg)),
        status: "skipped",
        reason: "runner-stopped",
      };
    }

    const resolvedAgentId = normalizeAgentId(agentId ?? resolveDefaultAgentId(cfg));
    const agentState = await ensureAgentState(resolvedAgentId);
    if (!agentState) {
      return {
        agentId: resolvedAgentId,
        status: "skipped",
        reason: "unknown-agent",
      };
    }
    if (agentState.running) {
      return {
        agentId: resolvedAgentId,
        status: "skipped",
        reason: "already-running",
        lastRunMs: agentState.lastRunMs,
        nextDueMs: agentState.nextDueMs,
      };
    }

    const dedupe = getSchedulerDedupe();
    const dedupeResult = dedupe.checkCycle(resolvedAgentId, "contemplation");
    if (!dedupeResult.accepted) {
      return {
        agentId: resolvedAgentId,
        status: "skipped",
        reason: dedupeResult.reason ?? "dedupe-rejected",
        lastRunMs: agentState.lastRunMs,
        nextDueMs: agentState.nextDueMs,
      };
    }
    if (!dedupeResult.fingerprint || !dedupe.tryLock(dedupeResult.fingerprint)) {
      return {
        agentId: resolvedAgentId,
        status: "skipped",
        reason: "lock-collision",
        lastRunMs: agentState.lastRunMs,
        nextDueMs: agentState.nextDueMs,
      };
    }

    agentState.running = true;
    try {
      const result = await runContemplationOnce(cfg, resolvedAgentId);
      if (result.status === "ran") {
        agentState.lastRunMs = Date.now();
        agentState.nextDueMs = agentState.lastRunMs + resolveCurrentInterval(agentState);
        cyclesThisHour++;
        if (result.isOk) {
          agentState.consecutiveOkCount++;
        } else {
          agentState.consecutiveOkCount = 0;
        }
      }
      scheduleNext();
      return {
        agentId: resolvedAgentId,
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(typeof result.isOk === "boolean" ? { isOk: result.isOk } : {}),
        ...(typeof agentState.lastRunMs === "number" ? { lastRunMs: agentState.lastRunMs } : {}),
        ...(typeof agentState.nextDueMs === "number" ? { nextDueMs: agentState.nextDueMs } : {}),
      };
    } finally {
      dedupe.releaseLock(dedupeResult.fingerprint);
      agentState.running = false;
    }
  };

  // Initial build
  rebuildAgents();
  if (!initialized) {
    if (agents.size === 0) {
      log.info("contemplation: disabled");
    } else {
      const intervals = Array.from(agents.values()).map((a) => a.intervalMs);
      log.info("contemplation: started", {
        agents: agents.size,
        minIntervalMs: Math.min(...intervals),
      });
    }
    initialized = true;
  }
  scheduleNext();

  return { stop, updateConfig, runNow };
}
