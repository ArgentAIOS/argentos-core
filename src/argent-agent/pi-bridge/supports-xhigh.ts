/**
 * supportsXhigh — drift-absorbing wrapper around pi's "xhigh thinking" capability check.
 *
 * Tracking issue: GH #306. Origin breakage: GH #182.
 *
 * # Why a wrapper, not a re-export
 *
 * Pi 0.73+ removes the `supportsXhigh` named export from `@mariozechner/pi-ai`
 * (and replaces it, internally, with `getSupportedThinkingLevels(model).includes("xhigh")`).
 * Earlier pi releases — including the 0.70.2 argent currently pins — still export
 * `supportsXhigh` as a top-level function.
 *
 * Re-exporting pi's `supportsXhigh` directly would re-break every consumer the
 * moment argent bumps to pi 0.73+. The bridge promise (see ./README.md) is that
 * pi drift gets absorbed in ONE place. A local re-implementation makes the
 * argent call sites forward-compatible across that bump without touching them.
 *
 * # Authority
 *
 * The capability list is duplicated from pi 0.70.2's `models.ts` (the only
 * upstream source of truth before getSupportedThinkingLevels lands). Keep it
 * in sync when pi adds new xhigh-capable families.
 *
 * @module argent-agent/pi-bridge/supports-xhigh
 */

import type { Api, Model } from "@mariozechner/pi-ai";

/**
 * Check if a model supports the `xhigh` thinking level.
 *
 * Supported today (mirrors pi 0.70.2 + Anthropic Opus 4.6 max effort):
 * - OpenAI: `gpt-5.1-codex-max`, `gpt-5.2*`, `gpt-5.3*`, `gpt-5.4*`, `gpt-5.5*`
 * - Anthropic: `opus-4-6*` (xhigh maps to adaptive effort `max`)
 *
 * @param model - pi-shape Model<Api>
 * @returns true if the model accepts `thinkingLevel: "xhigh"`
 */
export function supportsXhigh<TApi extends Api>(model: Model<TApi>): boolean {
  const id = model.id.toLowerCase();

  // Anthropic Opus 4.6 (xhigh → adaptive effort "max")
  if (model.provider === "anthropic" && id.includes("opus-4-6")) {
    return true;
  }

  // OpenAI GPT-5.1-codex-max + GPT-5.2 / 5.3 / 5.4 / 5.5 families
  if (model.provider === "openai") {
    if (
      id.includes("5.1-codex-max") ||
      id.startsWith("gpt-5.2") ||
      id.startsWith("gpt-5.3") ||
      id.startsWith("gpt-5.4") ||
      id.startsWith("gpt-5.5")
    ) {
      return true;
    }
  }

  return false;
}
