/**
 * pi-bridge — `AgentSession` structural type bridge (GH #301).
 *
 * Why this file exists
 * --------------------
 * Argent's runtime imports pi-coding-agent's `AgentSession` class as a *type*
 * at the embedded-runner call sites (attempt.ts, compact.ts, system-prompt.ts).
 * pi 0.70.2 already added ~78 private members to that class, so the original
 * `as AgentSession` casts — which target the concrete class identity — now
 * fail with TS2352 ("Conversion of type X to type AgentSession may be a
 * mistake because neither type sufficiently overlaps with the other"). The
 * forward-direction unification (PR #275 / #276 attempt) introduced a net 22
 * new errors because argent's local `AgentSessionImpl` cannot satisfy 78
 * private members it never owned.
 *
 * The structural bridge sidesteps the identity problem entirely: argent's
 * runtime types against `AgentSessionLike`, an interface that captures only
 * the public surface argent actually uses. Argent's own
 * `AgentSession` interface satisfies it directly; pi's `AgentSession` class
 * satisfies the read subset (`messages`, `sessionId`, `isStreaming`,
 * `dispose`, `abort`, `steer`, `prompt`) as well, so either runtime source
 * flows through the same type.
 *
 * Scope guardrails
 * ----------------
 * History replacement was previously `Agent.replaceMessages(msgs)` — a method
 * pi 0.73+ removed and pi 0.70.2's public `Agent` shape never exposed. GH
 * #302 migrated this surface to pi's new API: `agent.state.messages = msgs`
 * (the setter copies the top-level array). The bridge models pi's
 * `AgentState` slice as `AgentSessionAgentStateLike` and exposes a
 * `replaceAgentMessages(agent, msgs)` helper so call sites do not need to
 * touch the raw setter. The matching `BashExecutionMessage.content` cluster
 * lives behind GH #304.
 *
 * Migration policy (matches the rest of pi-bridge)
 * ------------------------------------------------
 *   - argent code MUST consume `AgentSessionLike` rather than reach for pi's
 *     `AgentSession` class directly. When pi's class evolves, only this file
 *     needs touching.
 *
 * @module argent-agent/pi-bridge/agent-session
 */

import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";

/**
 * Pi-shaped agent state slice argent's bridge writes to.
 *
 * Models the public slice of pi 0.70.2's `AgentState` that argent depends
 * on. The `messages` setter copies the supplied array (matches pi's class
 * accessor contract). Both pi's `Agent` class and argent's `AgentImpl`
 * satisfy this shape — see GH #302.
 */
export interface AgentSessionAgentStateLike {
  /** Conversation transcript. Assigning a new array copies it. */
  messages: AgentMessage[];
}

/**
 * Inner-agent surface argent reads on `AgentSessionLike.agent`.
 *
 * `streamFn` is assignable so the runtime can swap providers per-turn (see
 * `attempt.ts` provider-switch block). `setSystemPrompt` is argent-shaped —
 * pi's public `Agent` class doesn't expose it, but every production runtime
 * source for `agent` flows through `createArgentAgentSession` (which
 * `agent-core/coding.ts` rebinds `createAgentSession` to), so the field is
 * always present at runtime.
 *
 * `state` models pi 0.70.2+'s `AgentState` slice argent writes to —
 * specifically `state.messages`, which replaced `Agent.replaceMessages`
 * (removed in pi 0.73+; never publicly exposed in 0.70.2). Call sites MUST
 * route through `replaceAgentMessages(agent, msgs)` rather than touching the
 * raw setter, so future pi API drift only needs one update. See GH #302.
 */
export interface AgentSessionAgentLike {
  /**
   * Streaming function used for LLM calls. Assignable for provider swapping.
   * Forwarded from pi-agent-core to keep identity unified with PR #275's
   * already-proven `StreamFn` re-export.
   */
  streamFn: StreamFn;

  /** Replace the system prompt entirely (argent-shaped — see header). */
  setSystemPrompt(prompt: string): void;

  /**
   * Pi-shaped agent state. Mutate the transcript via `state.messages = msgs`
   * (or, preferred, the `replaceAgentMessages` helper). See GH #302.
   */
  readonly state: AgentSessionAgentStateLike;
}

/**
 * Replace the agent's conversation transcript.
 *
 * Encapsulates the pi 0.70.2+ API (`agent.state.messages = msgs`, where the
 * setter copies the top-level array). This is the GH #302 replacement for
 * the now-removed `Agent.replaceMessages(msgs)` method. Centralising the
 * write through this helper means any future pi API drift — a renamed
 * setter, a new `setHistory(...)` method, etc. — only needs one update.
 *
 * Runtime safety: every production source for `agent` flows through
 * `createArgentAgentSession`, whose `AgentImpl` exposes a matching
 * `state.messages` accessor that delegates to its internal `_messages`
 * field. Pi's `Agent` class also satisfies the same shape via its public
 * `AgentState` accessor.
 */
export function replaceAgentMessages(agent: AgentSessionAgentLike, messages: AgentMessage[]): void {
  agent.state.messages = messages;
}

/**
 * Options for `AgentSessionLike.prompt(...)`. Structural — does not depend on
 * pi-ai's `ImageContent` identity, so the type-check survives pi-ai version
 * drift. Argent passes `ImageContent[]` from its own `argent-ai/types`; pi's
 * class accepts `ImageContent[]` from `@mariozechner/pi-ai`. Both flow into
 * the structural `unknown[]` slot without an `unknown` cast at the call site.
 */
export interface AgentSessionPromptOptionsLike {
  readonly images?: ReadonlyArray<unknown>;
}

/**
 * Structural surface for an active agent session.
 *
 * Captures only the public members argent's pi-embedded-runner reads. Both
 * argent's `AgentSession` interface and pi's `AgentSession` class satisfy
 * this for the read-only subset; argent's interface additionally satisfies
 * `agent.setSystemPrompt`.
 *
 * **Migration policy:** code under `src/agents/pi-embedded-runner/` consumes
 * sessions through this type rather than importing pi's class. When argent
 * expands the surface it relies on, add the new member here and verify both
 * argent's runtime impl and pi's class shape continue to satisfy it.
 */
export interface AgentSessionLike {
  /** Inner agent (stream function, system prompt). */
  readonly agent: AgentSessionAgentLike;

  /** Current session ID. */
  readonly sessionId: string;

  /** Full message history. Mutation routes through `replaceAgentMessages` (#302). */
  readonly messages: AgentMessage[];

  /** Whether the agent is currently streaming a response. */
  readonly isStreaming: boolean;

  /** Tear down the session — remove listeners, disconnect from agent. */
  dispose(): void;

  /** Abort the current run, if one is active. */
  abort(): Promise<void>;

  /** Queue a steering message while the agent is running. */
  steer(text: string): Promise<void>;

  /** Send a prompt to the agent. */
  prompt(text: string, options?: AgentSessionPromptOptionsLike): Promise<void>;
}
