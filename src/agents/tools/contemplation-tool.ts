/**
 * Contemplation History Tool — Review the agent's contemplation journal
 *
 * Lets the agent introspect on its own contemplation episodes, moods,
 * lessons, and patterns over time. Reads JSONL files from the workspace
 * contemplation directory.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import type { Episode, EpisodeType } from "../../infra/episode-types.js";
import type { AnyAgentTool } from "./common.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agent-scope.js";
import { resolveUserTimezone } from "../date-time.js";
import { jsonResult, readStringParam, readNumberParam } from "./common.js";

// ── Schema ──────────────────────────────────────────────────────────────────

const ContemplationSchema = Type.Object({
  action: Type.Optional(
    Type.Union(
      [
        Type.Literal("recent"),
        Type.Literal("episodes"),
        Type.Literal("moods"),
        Type.Literal("lessons"),
      ],
      {
        description:
          'Action: "recent" (default) = last N entries, "episodes" = structured episode data, ' +
          '"moods" = mood/valence/arousal timeline, "lessons" = extracted lessons and patterns',
      },
    ),
  ),
  days: Type.Optional(
    Type.Number({ description: "How many days back to look (default: 3)", default: 3 }),
  ),
  type: Type.Optional(
    Type.Union(
      [
        Type.Literal("contemplation"),
        Type.Literal("task_execution"),
        Type.Literal("conversation"),
        Type.Literal("research"),
        Type.Literal("reflection"),
        Type.Literal("creation"),
        Type.Literal("rest"),
      ],
      { description: "Filter by episode type" },
    ),
  ),
  limit: Type.Optional(Type.Number({ description: "Max results (default: 20)", default: 20 })),
});

// ── Types ───────────────────────────────────────────────────────────────────

interface ContemplationJournalEntry {
  timestamp: string;
  type: "rest" | "action" | "wakeup" | "reflection";
  content?: string;
  durationMs: number;
  episode?: Episode;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the list of date strings (YYYY-MM-DD) for the lookback window.
 */
function buildDateRange(days: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Load contemplation entries from JSONL files for the given date range.
 */
async function loadEntries(
  contemplationDir: string,
  dates: string[],
): Promise<ContemplationJournalEntry[]> {
  const entries: ContemplationJournalEntry[] = [];
  for (const date of dates) {
    const filePath = path.join(contemplationDir, `${date}.jsonl`);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.trim().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as ContemplationJournalEntry);
        } catch {
          /* skip invalid lines */
        }
      }
    } catch {
      /* file doesn't exist for this date — skip */
    }
  }
  // Sort chronologically (newest last)
  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return entries;
}

function formatTime(isoDate: string, tz: string): string {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return "??:??";
    return d.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "??:??";
  }
}

function formatDateKey(isoDate: string, tz: string): string {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate.slice(0, 10);
    return d.toLocaleDateString("en-US", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return isoDate.slice(0, 10);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return remainSec > 0 ? `${minutes}m ${remainSec}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
}

// ── Mood emoji helpers ──────────────────────────────────────────────────────

function valenceEmoji(v: number): string {
  if (v >= 1.0) return "\u{1F929}"; // star-struck
  if (v >= 0.5) return "\u{1F60A}"; // smiling
  if (v >= 0.0) return "\u{1F610}"; // neutral
  if (v >= -0.5) return "\u{1F615}"; // confused
  if (v >= -1.0) return "\u{1F61E}"; // disappointed
  return "\u{1F622}"; // crying
}

// ── Actions ─────────────────────────────────────────────────────────────────

function actionRecent(
  entries: ContemplationJournalEntry[],
  limit: number,
  tz: string,
): { text: string; count: number } {
  const sliced = entries.slice(-limit);
  if (sliced.length === 0) {
    return { text: "No contemplation entries found for this period.", count: 0 };
  }

  // Group by date
  const grouped = new Map<string, ContemplationJournalEntry[]>();
  for (const entry of sliced) {
    const dateKey = formatDateKey(entry.timestamp, tz);
    if (!grouped.has(dateKey)) grouped.set(dateKey, []);
    grouped.get(dateKey)!.push(entry);
  }

  let text = "";
  for (const [dateKey, dateEntries] of grouped) {
    text += `## ${dateKey}\n\n`;
    for (const entry of dateEntries) {
      const time = formatTime(entry.timestamp, tz);
      const duration = formatDuration(entry.durationMs);
      const epType = entry.episode?.type ?? entry.type;
      const mood = entry.episode?.mood?.state ?? "";
      const moodStr = mood ? ` (${mood})` : "";

      // Summary from episode outcome or truncated content
      let summary: string;
      if (entry.episode?.outcome?.summary) {
        summary = entry.episode.outcome.summary;
      } else if (entry.content) {
        // Strip [EPISODE_JSON] blocks for display
        const clean = entry.content
          .replace(/\[EPISODE_JSON\][\s\S]*?\[\/EPISODE_JSON\]/gi, "")
          .trim();
        summary = clean.length > 150 ? clean.slice(0, 150) + "..." : clean;
      } else {
        summary = "(no content)";
      }

      text += `[${time}] **${epType}**${moodStr} (${duration})\n`;
      text += `  ${summary}\n\n`;
    }
  }

  return { text: text.trim(), count: sliced.length };
}

function actionEpisodes(
  entries: ContemplationJournalEntry[],
  episodeTypeFilter: EpisodeType | undefined,
  limit: number,
  tz: string,
): { text: string; count: number } {
  // Filter to entries with episodes
  let withEpisodes = entries.filter((e) => e.episode != null);

  // Apply type filter
  if (episodeTypeFilter) {
    withEpisodes = withEpisodes.filter((e) => e.episode!.type === episodeTypeFilter);
  }

  const sliced = withEpisodes.slice(-limit);
  if (sliced.length === 0) {
    return { text: "No episodes found matching criteria.", count: 0 };
  }

  let text = "";
  for (const entry of sliced) {
    const ep = entry.episode!;
    const time = formatTime(entry.timestamp, tz);
    const date = formatDateKey(entry.timestamp, tz);
    const duration = formatDuration(entry.durationMs);

    text += `### ${date} ${time} — ${ep.type} (${duration})\n`;
    if (ep.trigger?.detail) text += `Trigger: ${ep.trigger.source} — ${ep.trigger.detail}\n`;
    if (ep.intent) text += `Intent: ${ep.intent}\n`;
    text += `Outcome: ${ep.outcome.result} — ${ep.outcome.summary}\n`;
    if (ep.outcome.impact) text += `Impact: ${ep.outcome.impact}\n`;
    text += `Mood: ${ep.mood.state} (energy: ${ep.mood.energy}) | Valence: ${ep.valence} | Arousal: ${ep.arousal}\n`;

    if (ep.observations.length > 0) {
      text += "Observations:\n";
      for (const obs of ep.observations) {
        text += `  - [${obs.significance}] ${obs.what}\n`;
      }
    }

    if (ep.tools_used.length > 0) {
      const toolNames = ep.tools_used.map((t) => t.tool + (t.action ? `:${t.action}` : ""));
      text += `Tools: ${toolNames.join(", ")}\n`;
    }

    if (ep.reflection) text += `Reflection: ${ep.reflection}\n`;
    if (ep.lesson) text += `Lesson: ${ep.lesson}\n`;
    if (ep.pattern_hint) text += `Pattern: ${ep.pattern_hint}\n`;

    if (ep.identity_links.length > 0) {
      const links = ep.identity_links.map((l) => `${l.entity} (${l.role})`);
      text += `Entities: ${links.join(", ")}\n`;
    }

    text += "\n";
  }

  return { text: text.trim(), count: sliced.length };
}

function actionMoods(
  entries: ContemplationJournalEntry[],
  limit: number,
  tz: string,
): { text: string; count: number } {
  const withMoods = entries.filter((e) => e.episode?.mood != null);
  const sliced = withMoods.slice(-limit);
  if (sliced.length === 0) {
    return { text: "No mood data found for this period.", count: 0 };
  }

  // Group by date
  const grouped = new Map<string, ContemplationJournalEntry[]>();
  for (const entry of sliced) {
    const dateKey = formatDateKey(entry.timestamp, tz);
    if (!grouped.has(dateKey)) grouped.set(dateKey, []);
    grouped.get(dateKey)!.push(entry);
  }

  let text = "";
  for (const [dateKey, dateEntries] of grouped) {
    text += `## ${dateKey}\n\n`;

    // Compute daily averages
    let totalValence = 0;
    let totalArousal = 0;
    for (const entry of dateEntries) {
      const ep = entry.episode!;
      totalValence += ep.valence;
      totalArousal += ep.arousal;
    }
    const avgValence = totalValence / dateEntries.length;
    const avgArousal = totalArousal / dateEntries.length;
    text += `Day avg: valence ${avgValence.toFixed(2)} | arousal ${avgArousal.toFixed(2)}\n\n`;

    for (const entry of dateEntries) {
      const ep = entry.episode!;
      const time = formatTime(entry.timestamp, tz);
      const emoji = valenceEmoji(ep.valence);
      text += `[${time}] ${emoji} ${ep.mood.state} (${ep.mood.energy}) | v:${ep.valence.toFixed(1)} a:${ep.arousal.toFixed(1)} | ${ep.type}\n`;
    }
    text += "\n";
  }

  return { text: text.trim(), count: sliced.length };
}

function actionLessons(
  entries: ContemplationJournalEntry[],
  limit: number,
  tz: string,
): { text: string; count: number } {
  // Filter to entries with lessons or pattern hints
  const withLessons = entries.filter(
    (e) => e.episode != null && (e.episode.lesson || e.episode.pattern_hint),
  );

  const sliced = withLessons.slice(-limit);
  if (sliced.length === 0) {
    return { text: "No lessons or patterns found for this period.", count: 0 };
  }

  let text = "";
  let lessonCount = 0;
  let patternCount = 0;

  // Collect unique patterns
  const patterns = new Map<string, number>();

  for (const entry of sliced) {
    const ep = entry.episode!;
    const time = formatTime(entry.timestamp, tz);
    const date = formatDateKey(entry.timestamp, tz);

    if (ep.lesson) {
      lessonCount++;
      text += `### ${date} ${time} (${ep.type})\n`;
      text += `**Lesson:** ${ep.lesson}\n`;
      if (ep.reflection) text += `Reflection: ${ep.reflection}\n`;
      if (ep.pattern_hint) {
        text += `Pattern: ${ep.pattern_hint}\n`;
        patterns.set(ep.pattern_hint, (patterns.get(ep.pattern_hint) ?? 0) + 1);
      }
      text += "\n";
    } else if (ep.pattern_hint) {
      patternCount++;
      patterns.set(ep.pattern_hint, (patterns.get(ep.pattern_hint) ?? 0) + 1);
    }
  }

  // Summarize recurring patterns
  if (patterns.size > 0) {
    text += "---\n\n## Recurring Patterns\n\n";
    const sorted = [...patterns.entries()].sort((a, b) => b[1] - a[1]);
    for (const [pattern, count] of sorted) {
      text += `- **${pattern}** (seen ${count}x)\n`;
    }
  }

  text += `\n---\nTotal: ${lessonCount} lessons, ${patternCount} pattern-only entries, ${patterns.size} unique patterns`;

  return { text: text.trim(), count: sliced.length };
}

// ── Tool Export ──────────────────────────────────────────────────────────────

export function createContemplationTool(options: { config?: ArgentConfig }): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;

  return {
    label: "Contemplation History",
    name: "contemplation_history",
    description:
      "Review your own contemplation journal — recent entries, structured episodes, mood timeline, " +
      "and extracted lessons/patterns. Use this to reflect on what you've been thinking, feeling, " +
      "and learning over time. Supports filtering by episode type and lookback window.",
    parameters: ContemplationSchema,
    execute: async (_toolCallId, params) => {
      const action = readStringParam(params, "action") ?? "recent";
      const days = readNumberParam(params, "days", { integer: true }) ?? 3;
      const episodeTypeFilter = readStringParam(params, "type") as EpisodeType | undefined;
      const limit = readNumberParam(params, "limit", { integer: true }) ?? 20;

      try {
        const tz = resolveUserTimezone(cfg.agents?.defaults?.userTimezone);
        const agentId = resolveDefaultAgentId(cfg);
        const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
        const contemplationDir = path.join(workspaceDir, "memory", "contemplation");

        const dates = buildDateRange(days);
        const entries = await loadEntries(contemplationDir, dates);

        let result: { text: string; count: number };

        switch (action) {
          case "episodes":
            result = actionEpisodes(entries, episodeTypeFilter, limit, tz);
            break;
          case "moods":
            result = actionMoods(entries, limit, tz);
            break;
          case "lessons":
            result = actionLessons(entries, limit, tz);
            break;
          case "recent":
          default:
            result = actionRecent(entries, limit, tz);
            break;
        }

        return jsonResult({
          contemplation: result.text,
          count: result.count,
          action,
          days,
          filters: {
            ...(episodeTypeFilter ? { type: episodeTypeFilter } : {}),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ contemplation: "", count: 0, error: message });
      }
    },
  };
}
