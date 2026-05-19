/**
 * Accountability History Tool — Review your own accountability score
 *
 * Lets the agent inspect its heartbeat accountability score, daily breakdown,
 * multi-day history, and journal entries. Read-only introspection into the
 * score state persisted by the heartbeat system.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import type { JournalEntry } from "../../infra/heartbeat-journal.js";
import type { AnyAgentTool } from "./common.js";
import { loadConfig } from "../../config/config.js";
import {
  loadScoreState,
  loadLastFeedback,
  computeDailyTarget,
  type ScoreState,
  type CycleFeedback,
} from "../../infra/heartbeat-score.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agent-scope.js";
import { jsonResult, readStringParam, readNumberParam } from "./common.js";

// ── Schema ──────────────────────────────────────────────────────────────────

const AccountabilityToolSchema = Type.Object({
  action: Type.Optional(
    Type.Union(
      [
        Type.Literal("summary"),
        Type.Literal("today"),
        Type.Literal("history"),
        Type.Literal("journal"),
      ],
      {
        description:
          'What to show. "summary" = current score + streak + trend (default). ' +
          '"today" = detailed event breakdown for today. ' +
          '"history" = last 7 days of daily scores. ' +
          '"journal" = recent heartbeat journal entries.',
      },
    ),
  ),
  days: Type.Optional(
    Type.Number({
      description:
        "Number of days of journal entries to return (default: 3, max: 14). Only used with action=journal.",
    }),
  ),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

function scoreTrend(state: ScoreState): "up" | "down" | "flat" {
  const history = state.history;
  if (history.length < 2) return "flat";
  const recent = history[0]!.score;
  const prior = history[1]!.score;
  if (recent > prior) return "up";
  if (recent < prior) return "down";
  return "flat";
}

function trendArrow(trend: "up" | "down" | "flat"): string {
  if (trend === "up") return "^";
  if (trend === "down") return "v";
  return "-";
}

function buildSummary(state: ScoreState, feedback: CycleFeedback | null): string {
  const target = computeDailyTarget(state);
  const score = state.today.score;
  const pct = target > 0 ? Math.round((score / target) * 100) : 0;
  const trend = scoreTrend(state);
  const streak = state.lifetime.currentStreak;
  const lines: string[] = [];

  // Score bar
  const barLen = 20;
  const filled = Math.max(0, Math.min(barLen, Math.round((Math.max(0, score) / target) * barLen)));
  const bar = "#".repeat(filled) + ".".repeat(barLen - filled);
  lines.push(`Score: ${score} / ${target}  [${bar}]  ${pct}%`);

  if (score < 0) {
    lines.push(`NEGATIVE SCORE -- ${Math.abs(score)} points below zero`);
  } else if (state.today.targetReached) {
    lines.push("Daily target reached.");
  } else {
    lines.push(`${target - score} points to daily target`);
  }

  lines.push(`Today: ${state.today.verifiedCount} verified, ${state.today.failedCount} failed`);
  lines.push(`Trend: ${trendArrow(trend)} (${trend})`);

  if (streak > 0) {
    lines.push(`Streak: ${streak} day${streak > 1 ? "s" : ""} hitting target`);
  }

  // Lifetime
  lines.push("");
  lines.push("Lifetime:");
  lines.push(`  Days tracked: ${state.lifetime.daysTracked}`);
  lines.push(`  Total verified: ${state.lifetime.totalVerified}`);
  lines.push(`  Total failed: ${state.lifetime.totalFailed}`);
  lines.push(`  Best day: ${state.lifetime.bestDay}`);
  lines.push(`  Worst day: ${state.lifetime.worstDay}`);
  lines.push(`  Longest streak: ${state.lifetime.longestStreak}`);
  lines.push(`  Target floor (ratchet): ${state.lifetime.targetFloor}`);

  // Last cycle feedback snippet
  if (feedback) {
    lines.push("");
    lines.push(`Last cycle (${feedback.timestamp}):`);
    lines.push(`  Points delta: ${feedback.pointsDelta >= 0 ? "+" : ""}${feedback.pointsDelta}`);
    lines.push(`  Verdicts: ${feedback.verdicts.length}`);
    const failed = feedback.verdicts.filter((v) => v.status === "not_verified");
    if (failed.length > 0) {
      lines.push(`  Failures: ${failed.map((f) => f.action).join(", ")}`);
    }
  }

  return lines.join("\n");
}

function buildTodayDetail(state: ScoreState): string {
  const target = computeDailyTarget(state);
  const today = state.today;
  const lines: string[] = [];

  lines.push(`Date: ${today.date}`);
  lines.push(`Score: ${today.score} / ${target}`);
  lines.push(`Peak: ${today.peakScore}  |  Lowest: ${today.lowestScore}`);
  lines.push(`Verified: ${today.verifiedCount}  |  Failed: ${today.failedCount}`);
  lines.push(`Target reached: ${today.targetReached ? "yes" : "no"}`);
  lines.push("");

  if (today.events.length === 0) {
    lines.push("No events recorded today.");
  } else {
    lines.push(`Events (${today.events.length}):`);
    for (const ev of today.events) {
      const sign = ev.points >= 0 ? "+" : "";
      const gt = ev.groundTruthContradiction ? " [GROUND TRUTH CONTRADICTION]" : "";
      const req = ev.required ? "required" : "optional";
      lines.push(
        `  [${formatTimestamp(ev.timestamp)}] ${ev.verdict} (${req}) ${sign}${ev.points}pts -- ${ev.taskId}${gt}`,
      );
    }
  }

  return lines.join("\n");
}

function buildHistoryView(state: ScoreState): string {
  const lines: string[] = [];
  const target = computeDailyTarget(state);

  // Current day first
  lines.push(
    `${state.today.date} (today): score=${state.today.score} target=${target} verified=${state.today.verifiedCount} failed=${state.today.failedCount} targetReached=${state.today.targetReached}`,
  );

  // History (most recent first)
  if (state.history.length === 0) {
    lines.push("");
    lines.push("No prior daily history recorded.");
  } else {
    for (const day of state.history) {
      lines.push(
        `${day.date}: score=${day.score} peak=${day.peakScore} low=${day.lowestScore} verified=${day.verifiedCount} failed=${day.failedCount} targetReached=${day.targetReached}`,
      );
    }
  }

  return lines.join("\n");
}

async function buildJournalView(workspaceDir: string, days: number): Promise<string> {
  const journalDir = path.join(workspaceDir, "memory", "journal");
  const lines: string[] = [];
  let totalEntries = 0;

  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    const filePath = path.join(journalDir, `${dateStr}.jsonl`);

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const entryLines = raw.trim().split("\n").filter(Boolean);
      if (entryLines.length === 0) continue;

      lines.push(`## ${dateStr} (${entryLines.length} cycles)`);
      lines.push("");

      for (const line of entryLines) {
        try {
          const entry = JSON.parse(line) as JournalEntry;
          totalEntries++;

          const time = entry.occurredAt
            ? new Date(entry.occurredAt).toLocaleTimeString("en-US", {
                timeZone: "America/Chicago",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })
            : "??:??";

          lines.push(
            `[${time}] cycle #${entry.cycleNumber} | score ${entry.score.before}->${entry.score.after} (${entry.score.delta >= 0 ? "+" : ""}${entry.score.delta}) | target=${entry.score.target} | verified=${entry.verification.verified} failed=${entry.verification.failed} unclear=${entry.verification.unclear} | model=${entry.verification.model}`,
          );

          if (entry.failures && entry.failures.length > 0) {
            for (const f of entry.failures) {
              lines.push(`  FAIL: ${f.taskId} -- ${f.reason}`);
            }
          }
          if (entry.reflection) {
            lines.push(`  Reflection: ${entry.reflection}`);
          }
          if (entry.lesson) {
            lines.push(`  Lesson: ${entry.lesson}`);
          }
        } catch {
          // Skip malformed journal lines
        }
      }

      lines.push("");
    } catch {
      // File doesn't exist for this day — skip
    }
  }

  if (totalEntries === 0) {
    return `No journal entries found in the last ${days} day${days > 1 ? "s" : ""}.`;
  }

  return lines.join("\n").trim();
}

// ── Tool Factory ────────────────────────────────────────────────────────────

export function createAccountabilityTool(opts?: {
  config?: ArgentConfig;
  agentId?: string;
}): AnyAgentTool {
  return {
    label: "Accountability History",
    name: "accountability_history",
    description:
      "Review your own accountability score history. Actions: " +
      '"summary" (default) = current score, target, streak, trend, today stats, lifetime stats. ' +
      '"today" = detailed today breakdown with all score events. ' +
      '"history" = last 7 days of daily scores. ' +
      '"journal" = recent heartbeat journal entries (use days param to control lookback, default 3).',
    parameters: AccountabilityToolSchema,
    execute: async (_toolCallId, params) => {
      const args = params as Record<string, unknown>;
      const action = readStringParam(args, "action") ?? "summary";
      const daysRaw = readNumberParam(args, "days", { integer: true });
      const days = Math.max(1, Math.min(14, daysRaw ?? 3));

      const cfg = opts?.config ?? loadConfig();
      const agentId = opts?.agentId ?? resolveDefaultAgentId(cfg);
      const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

      try {
        const state = await loadScoreState(workspaceDir);

        switch (action) {
          case "summary": {
            const feedback = await loadLastFeedback(workspaceDir);
            const text = buildSummary(state, feedback);
            return jsonResult({ action: "summary", text });
          }

          case "today": {
            const text = buildTodayDetail(state);
            return jsonResult({ action: "today", text });
          }

          case "history": {
            const text = buildHistoryView(state);
            return jsonResult({ action: "history", text });
          }

          case "journal": {
            const text = await buildJournalView(workspaceDir, days);
            return jsonResult({ action: "journal", days, text });
          }

          default: {
            throw new Error(
              `Unknown action "${action}". Use "summary", "today", "history", or "journal".`,
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ action, error: message });
      }
    },
  };
}
