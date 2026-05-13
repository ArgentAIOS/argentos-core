/**
 * pi-bridge — `BashExecutionMessage` content accessor (GH #304).
 *
 * Why this file exists
 * --------------------
 * pi-coding-agent's `BashExecutionMessage` is the custom message type emitted
 * for `!`-prefixed bash executions. The textual content of that message has
 * drifted across pi releases:
 *
 *   - pre-0.70 (legacy):  `msg.content: string`
 *   - 0.70.2 (current):   `msg.output: string`   (+ `.command`, `.exitCode`, ...)
 *   - 0.73+  (incoming):  argent has not yet bumped, but #182's catalog
 *                         enumerates the 7 attempt.ts sites that surface
 *                         `AgentMessage[] not assignable to AgentMessage[]`
 *                         when pi flips the BashExecutionMessage shape.
 *
 * The bridge promise (see `./README.md`) is that pi drift is absorbed in ONE
 * place. `getBashExecutionContent(msg)` is the single chokepoint argent uses
 * to read the textual content of a bash execution message — when pi renames
 * the field again, only this file changes.
 *
 * The `AgentMessage` re-export from this module (see `./index.ts`) is what
 * the 7 attempt.ts sites consume via `AgentSessionLike.messages` so the
 * bridge identity flows end-to-end instead of crossing the
 * `agent-core/core.js` → pi seam where #182's `AgentMessage[] not assignable
 * to AgentMessage[]` symptom surfaces. Companion fix: GH #302's
 * `replaceAgentMessages` plus the wider `AgentMessage` forwarding from PR
 * #275 / #286 already absorb the transcript-write side of the same drift.
 *
 * @module argent-agent/pi-bridge/bash-execution
 */

import type { CustomAgentMessages } from "@earendil-works/pi-agent-core";

/**
 * Pi's `BashExecutionMessage` type, sourced via the `CustomAgentMessages`
 * declaration-merging extension pi-coding-agent installs on pi-agent-core.
 *
 * Indirecting through the merged map lets the bridge expose the type without
 * reaching into pi-coding-agent's non-exported deep path
 * (`@earendil-works/pi-coding-agent/dist/core/messages.js`). When pi promotes
 * the type to a public re-export — or renames it again — only this alias
 * changes.
 *
 * Consumers that need the type should import from
 * `argent-agent/pi-bridge` instead of `@earendil-works/pi-coding-agent` directly,
 * so the bridge can introduce shape drift in one place when pi bumps.
 */
export type BashExecutionMessage = CustomAgentMessages["bashExecution"];

/**
 * Structural view of a bash execution message that tolerates the pre-0.73
 * `.content` field alongside the current 0.70.2+ `.output` field.
 *
 * Used internally by `getBashExecutionContent` so the helper compiles on any
 * pi version argent might cross-link against during the 0.73+ bump without
 * relying on `// @ts-expect-error`.
 */
interface BashExecutionMessageWithLegacyContent {
  /** pi 0.70.2+ canonical text field. */
  readonly output?: string;
  /** Legacy text field (pre-0.70). */
  readonly content?: string;
}

/**
 * Derive the textual content of a `BashExecutionMessage` in a pi-version-stable way.
 *
 * Prefers `msg.output` (pi 0.70.2+ canonical field). Falls back to the legacy
 * `msg.content` for any older pi shape argent might encounter during the
 * 0.73+ bump cross-link. Returns an empty string if neither is set — callers
 * decide how to render an empty-output bash message.
 *
 * @param msg - the bash execution message
 * @returns the bash command's text output, or `""` when neither field is set
 *
 * @example
 * ```ts
 * import { getBashExecutionContent } from "../../argent-agent/pi-bridge/index.js";
 *
 * if (msg.role === "bashExecution") {
 *   const text = getBashExecutionContent(msg);
 *   if (text) log.info(`bash output: ${text.slice(0, 200)}`);
 * }
 * ```
 */
export function getBashExecutionContent(msg: BashExecutionMessage): string {
  const legacy = msg as unknown as BashExecutionMessageWithLegacyContent;
  if (typeof legacy.output === "string") {
    return legacy.output;
  }
  if (typeof legacy.content === "string") {
    return legacy.content;
  }
  return "";
}
