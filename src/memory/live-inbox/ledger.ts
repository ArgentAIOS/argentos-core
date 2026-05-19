/**
 * Live Inbox — Compaction-Safe Ledger
 *
 * Generates a rolling "must-keep" markdown ledger from recently promoted
 * live candidates and high-significance memories. Injected at startup
 * so post-compaction/reset sessions still carry critical truths.
 */

import type { MemuStore } from "../memu-store.js";

/**
 * Build the live inbox ledger content from recently promoted candidates
 * and high-significance memories.
 */
export function buildLiveInboxLedger(params: {
  store: MemuStore;
  maxItems?: number;
}): string | null {
  const { store } = params;
  const maxItems = params.maxItems ?? 20;

  const lines: string[] = [];

  // Recently promoted candidates (last 7 days)
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const promoted = store.listLiveCandidates({ status: "promoted", limit: maxItems });
    const recent = promoted.filter((c) => c.updatedAt >= sevenDaysAgo);

    if (recent.length > 0) {
      lines.push("## Recently Captured Truths");
      lines.push("");
      lines.push("These were captured from live conversation and promoted to permanent memory:");
      lines.push("");

      for (const c of recent.slice(0, Math.floor(maxItems / 2))) {
        const date = new Date(c.updatedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        const typeLabel = c.candidateType;
        lines.push(`- [${typeLabel}, ${date}] ${c.factText.slice(0, 200)}`);
      }
      lines.push("");
    }
  } catch {
    // Non-fatal — MemU may not have the table yet
  }

  // High-significance memories (core + important)
  try {
    const coreItems = store.listItems({ significance: "core", limit: 10 });
    const importantItems = store.listItems({ significance: "important", limit: 10 });

    const highSig = [...coreItems, ...importantItems]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.floor(maxItems / 2));

    if (highSig.length > 0) {
      lines.push("## Core Knowledge");
      lines.push("");

      for (const item of highSig) {
        const sig = item.significance === "core" ? "CORE" : "important";
        const type = item.memoryType || "note";
        lines.push(`- [${type}, ${sig}] ${item.summary.slice(0, 200)}`);
      }
      lines.push("");
    }
  } catch {
    // Non-fatal
  }

  if (lines.length === 0) return null;

  return [
    "# Live Inbox Ledger",
    "",
    "Critical truths captured from conversations and promoted to permanent memory.",
    "This ledger survives session resets and context compaction.",
    "",
    ...lines,
    "Use `memory_recall` for deeper searches. This is just the essential context.",
  ].join("\n");
}
