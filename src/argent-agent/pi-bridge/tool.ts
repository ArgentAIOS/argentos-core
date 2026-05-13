/**
 * pi-bridge — Tool / Context / typebox identity bridge.
 *
 * Why this file exists
 * --------------------
 * pi-ai 0.70+ uses the `typebox` package at 1.x. argent uses `@sinclair/typebox`
 * at 0.34.x. They are by the same author and structurally compatible, but
 * TypeScript treats the two `TSchema` identities as distinct because they come
 * from different package names. That mismatch ripples through every site that
 * builds a pi `Tool` / `ToolDefinition` from an argent `AgentTool`:
 *
 *   Type 'ToolDefinition<TSchema, unknown, any>[]'        ← argent TSchema
 *     is not assignable to type 'ToolDefinition[]'         ← pi TSchema
 *
 * (See GH #305 / #182.)
 *
 * Strategy (option 3 — adapter pattern, per #305)
 * -----------------------------------------------
 * Option 1 (bump argent's typebox) and option 2 (package alias) both involve
 * touching ~100+ argent files that import `@sinclair/typebox` directly and
 * risk breaking argent's downstream consumers that already standardize on
 * `@sinclair/typebox`. The adapter pattern is the cheapest, safest fix:
 *
 *   - This module re-exports `TSchema`, `Static`, `Type`, `Tool`, `Context`
 *     from `@earendil-works/pi-ai` (which itself forwards them from `typebox` 1.x).
 *     Code that constructs / hands a value to pi imports from here so the
 *     identity is unified.
 *   - `bridgeToolParameters()` is the boundary cast: it accepts argent's
 *     `@sinclair/typebox` TSchema and returns pi's TSchema identity. Both
 *     packages produce the same JSON-Schema shape at runtime, so the cast is
 *     safe — TypeScript just needs the identity coercion.
 *
 * When pi removes typebox 0.34 compat or argent migrates off `@sinclair/typebox`,
 * delete `bridgeToolParameters` and let the types unify naturally.
 *
 * @module argent-agent/pi-bridge/tool
 */

import type { TSchema as PiTSchema } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// CANONICAL TYPEBOX IDENTITY (pi's 1.x — forwarded from pi-ai)
// ---------------------------------------------------------------------------
//
// New code that interacts with pi MUST import these from the bridge so
// TypeScript sees a single unified identity. Importing `TSchema` directly
// from `@sinclair/typebox` reintroduces the 0.34/1.x split.
//
export type { TSchema, Static } from "@earendil-works/pi-ai";
export { Type } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// CANONICAL TOOL / CONTEXT TYPES (pi's identities — forwarded from pi-ai)
// ---------------------------------------------------------------------------
//
// pi-ai defines:
//
//   export interface Tool<TParameters extends TSchema = TSchema> {
//     name: string;
//     description: string;
//     parameters: TParameters;
//   }
//   export interface Context {
//     systemPrompt?: string;
//     messages: Message[];
//     tools?: Tool[];
//   }
//
// argent has structurally identical types in `argent-ai/types.ts` but with
// `@sinclair/typebox`'s TSchema as the parameter constraint. Re-exporting
// here gives bridge consumers the *pi* identity for the few sites that hand
// values to pi (`createAgentSession`, `streamSimple` etc.).
//
export type { Tool, Context } from "@earendil-works/pi-ai";

/**
 * Cast an argent (`@sinclair/typebox` 0.34) schema to pi's (`typebox` 1.x)
 * TSchema identity. Both produce the same JSON-Schema shape at runtime; this
 * helper exists purely so call sites don't have to reach for `as unknown as`
 * at every pi-bound tool construction.
 *
 * @example
 * ```typescript
 * // before: TS error — argent TSchema ≠ pi TSchema
 * const def: ToolDefinition = {
 *   name: tool.name,
 *   description: tool.description,
 *   parameters: tool.parameters,         // ← TSchema mismatch
 *   execute: ...
 * };
 *
 * // after: identity unified at the boundary
 * const def: ToolDefinition = {
 *   name: tool.name,
 *   description: tool.description,
 *   parameters: bridgeToolParameters(tool.parameters),
 *   execute: ...
 * };
 * ```
 */
export function bridgeToolParameters<TParameters>(parameters: TParameters): PiTSchema {
  // The two packages serialize to the same JSON-Schema shape; the cast is the
  // whole point of this adapter. Marked `unknown` so the cast is explicit.
  return parameters as unknown as PiTSchema;
}
