/**
 * Operator Prefetch (Phase 0)
 *
 * Hermes-style background warming specifically for the primary operator fast path.
 * Goal: eliminate cold DB / cache hits on the first turn for high-value context
 * the main operator needs (SIS lessons, its own authored Personal Skills, etc.).
 *
 * Everything here must be strictly non-blocking and best-effort.
 * Never throw, never await in the hot path.
 *
 * This module is the single place to evolve prefetch strategy for the main agent
 * (add MemU warming, high-confidence skill candidates, frozen snapshot hydration, etc.).
 */

export interface WarmOperatorContextOptions {
  agentId?: string;
  /** Max number of SIS lessons to pre-warm */
  sisLessonLimit?: number;
  /** Max Personal Skill candidates to pre-warm (incubating + recent) */
  personalSkillLimit?: number;
  /**
   * Optional captured turn messages (messagesSnapshot) from the just-completed operator
   * fast-path turn — Hermes-aligned richer context. When present we record its presence/count
   * so the path is observable. Deep consumption into MemU/SIS (curator review quality, goal
   * state, skill extraction) is the documented NEXT slice — intentionally not written here yet
   * because it needs a real session/observation target and a wired, runnable operator surface.
   */
  lastTurnMessages?: readonly unknown[];
}

/**
 * Fire-and-forget warm of context that the primary operator fast path cares about.
 * Safe to call from anywhere; it will never block the caller.
 */
export function warmPrimaryOperatorContext(opts: WarmOperatorContextOptions = {}): void {
  const agentId = opts.agentId ?? "main";
  const sisLimit = opts.sisLessonLimit ?? 5;
  const skillLimit = opts.personalSkillLimit ?? 20;

  // Do not await — this entire function is intentionally fire-and-forget.
  void (async () => {
    try {
      // 1. SIS lessons (existing cache warming used by prompt builder)
      try {
        const sysPrompt = await import("../agents/system-prompt.js");
        if (typeof (sysPrompt as any).listPromptSisLessons === "function") {
          await (sysPrompt as any).listPromptSisLessons(sisLimit);
        }
      } catch {
        /* ignore */
      }

      // 2. Operator's own Personal Skill candidates (authored procedures)
      try {
        const { getMemoryAdapter } = await import("../data/storage-factory.js");
        const mem = await getMemoryAdapter();
        const scoped = mem.withAgentId ? mem.withAgentId(agentId) : mem;

        if (typeof scoped.listPersonalSkillCandidates === "function") {
          // Warm both incubating (what the operator recently created) and recent overall
          await scoped.listPersonalSkillCandidates({ state: "incubating", limit: skillLimit });
          await scoped.listPersonalSkillCandidates({ limit: Math.min(10, skillLimit) });
        }
      } catch {
        /* ignore */
      }

      // 3. Hermes-aligned richer turn context (messagesSnapshot from the completed turn).
      //    Plumbing only: record presence + count so the path is observable in fast-path runs.
      //    NEXT SLICE: consume these messages into MemU/SIS (curator review quality, goal state,
      //    skill extraction) — modeled on Hermes passing full messages to memory providers on
      //    completed turns. Intentionally NOT written here until the operator surface is wired
      //    and runnable, so we never guess the observation/session target blind.
      const lastTurnMessages = opts.lastTurnMessages;
      if (
        Array.isArray(lastTurnMessages) &&
        lastTurnMessages.length > 0 &&
        process.env.ARGENT_DEBUG
      ) {
        console.info(
          `[operator-prefetch] richer turn context available: ${lastTurnMessages.length} messages ` +
            `(agent=${agentId}); MemU/SIS consumption pending wiring`,
        );
      }

      // Future: MemU warming, high-confidence skill candidates only, frozen context blocks, etc.
      // Add here as the operator fast path matures.
    } catch (err) {
      // Absolute last-resort guard — prefetch must never surface errors.
      // (Intentionally silent; use ARGENT_DEBUG if you need visibility during development.)
      void err;
    }
  })();
}
