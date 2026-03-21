/**
 * Identity System — Self-Model & Dynamic Identity
 *
 * Builds a dynamic identity summary from self-memories, entities, and lessons.
 * Generates IDENTITY_CONTEXT.md for bootstrap injection at session start.
 */

import type { WorkspaceBootstrapFile } from "../../agents/workspace.js";
import type { ArgentConfig } from "../../config/config.js";
import type { MemuStore } from "../memu-store.js";
import type { MemoryItem, Significance } from "../memu-types.js";
import { callIdentityLlm } from "./llm.js";

// ── Self-Insight Extraction ──

const SELF_INSIGHT_PROMPT = `Extract self-observations and meta-insights from the following memories.

Look for:
- Observations the AI makes about its own behavior or patterns
- Lessons learned from mistakes or successes
- Insights about how to interact better with specific people
- Changes in approach or strategy
- Growth moments and realizations

Rules:
- Format as first-person observations: "I noticed..." or "I learned..."
- One insight per line, prefixed with "INSIGHT:"
- Only extract genuine insights, not trivial self-references
- If no self-observations are found, output NONE.

Memories:
`;

/**
 * Extract self-insights from a batch of memories using LLM.
 * Returns an array of first-person insight strings.
 */
export async function extractSelfInsights(
  memories: MemoryItem[],
  config: ArgentConfig,
): Promise<string[]> {
  if (memories.length === 0) return [];

  const summaries = memories.map((m, i) => `${i + 1}. [${m.memoryType}] ${m.summary}`).join("\n");
  const prompt = SELF_INSIGHT_PROMPT + summaries;

  const response = await callIdentityLlm(prompt, "self-insights", config);

  if (!response || response.trim().toUpperCase() === "NONE") {
    return [];
  }

  const insights: string[] = [];
  for (const line of response.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("INSIGHT:")) {
      insights.push(trimmed.slice("INSIGHT:".length).trim());
    }
  }

  return insights;
}

// ── Dynamic Identity ──

/**
 * Significance levels in priority order for filtering.
 */
const SIGNIFICANCE_PRIORITY: Record<Significance, number> = {
  core: 4,
  important: 3,
  noteworthy: 2,
  routine: 1,
};

/**
 * Build a dynamic identity summary from the store's current state.
 *
 * Aggregates:
 * - Core/important self-memories (who I am, what I've learned)
 * - Top entities by bond strength (key relationships)
 * - Recent lessons learned
 * - Growth trajectory
 *
 * Returns a markdown string suitable for injection into agent context.
 */
export function buildDynamicIdentity(store: MemuStore): string {
  const lines: string[] = [];

  // 1. Self-memories (type='self', ordered by significance then recency)
  const selfMemories = store
    .listItems({ memoryType: "self", limit: 50 })
    .sort((a, b) => {
      const sigDiff =
        (SIGNIFICANCE_PRIORITY[b.significance] ?? 1) - (SIGNIFICANCE_PRIORITY[a.significance] ?? 1);
      if (sigDiff !== 0) return sigDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, 10);

  if (selfMemories.length > 0) {
    lines.push("## Self-Knowledge");
    lines.push("");
    for (const m of selfMemories) {
      const sig = m.significance !== "routine" ? ` [${m.significance}]` : "";
      lines.push(`- ${m.summary}${sig}`);
    }
    lines.push("");
  }

  // 2. Key entities (top 5 by bond strength)
  const topEntities = store.listEntities({ limit: 5 });
  if (topEntities.length > 0) {
    lines.push("## Key People & Entities");
    lines.push("");
    for (const e of topEntities) {
      const rel = e.relationship ? ` — ${e.relationship}` : "";
      const bond = e.bondStrength >= 0.7 ? " (strong bond)" : "";
      const profile = e.profileSummary ? ` ${e.profileSummary}` : "";
      lines.push(`- **${e.name}**${rel}${bond}${profile ? ":" + profile : ""}`);
    }
    lines.push("");
  }

  // 3. Recent lessons (from self-memories and reflections)
  const lessons: string[] = [];

  // From self-memories with lessons
  const itemsWithLessons = store
    .listItems({ memoryType: "self", limit: 100 })
    .filter((m) => m.lesson)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  for (const m of itemsWithLessons) {
    if (m.lesson) lessons.push(m.lesson);
  }

  // From reflections
  const recentReflections = store.getRecentReflections(5);
  for (const r of recentReflections) {
    for (const l of r.lessonsExtracted) {
      if (!lessons.includes(l)) lessons.push(l);
    }
  }

  if (lessons.length > 0) {
    lines.push("## Lessons Learned");
    lines.push("");
    for (const l of lessons.slice(0, 10)) {
      lines.push(`- ${l}`);
    }
    lines.push("");
  }

  // 4. Recent reflections summary
  if (recentReflections.length > 0) {
    const latest = recentReflections[0];
    lines.push("## Recent Reflection");
    lines.push("");
    lines.push(latest.content);
    if (latest.mood) {
      lines.push(`\nMood: ${latest.mood}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

// ── Bootstrap File ──

/**
 * Build the IDENTITY_CONTEXT.md bootstrap file for injection at session start.
 *
 * This gives the agent awareness of its evolving self-model, key relationships,
 * and lessons learned — without requiring explicit memory recall.
 *
 * Returns null if there's insufficient identity data to inject.
 */
export function buildIdentityContextFile(store: MemuStore): WorkspaceBootstrapFile | null {
  try {
    const identity = buildDynamicIdentity(store);
    if (!identity || identity.length < 50) return null;

    const content = [
      "# Identity Context",
      "",
      "Your evolving self-model, key relationships, and lessons (auto-generated at startup):",
      "",
      identity,
      "",
      "This is a snapshot. Use `memory_recall` for deeper searches. Use `memory_reflect` to add new reflections.",
    ].join("\n");

    return {
      name: "IDENTITY_CONTEXT.md",
      content,
      path: "<auto-generated>",
    };
  } catch {
    // Identity system not available — gracefully skip
    return null;
  }
}
