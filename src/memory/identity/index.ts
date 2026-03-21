/**
 * Identity System — Module Exports
 *
 * Entity management, scoring, prompts, self-model, and reflection.
 */

export {
  resolveEntity,
  extractEntities,
  generateEntityProfile,
  calibrateBondStrength,
  autoLinkEntities,
} from "./entities.js";

export {
  ENTITY_EXTRACTION_PROMPT,
  SIGNIFICANCE_ASSESSMENT_PROMPT,
  EMOTIONAL_CONTEXT_PROMPT,
  buildEntityProfilePrompt,
  buildReflectionPrompt,
} from "./prompts.js";

export { callIdentityLlm } from "./llm.js";

export {
  buildDynamicIdentity,
  buildIdentityContextFile,
  extractSelfInsights,
} from "./self-model.js";

export { runReflection, processReflectionOutput, type ReflectionParams } from "./reflection.js";
