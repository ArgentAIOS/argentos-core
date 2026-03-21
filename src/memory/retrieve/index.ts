/**
 * MemU Retrieval — Public exports
 */

export {
  retrieveMemory,
  quickRecall,
  deepRecall,
  type RetrievalOptions,
  type RetrievalResult,
} from "./search.js";

export {
  SUFFICIENCY_PROMPT,
  RERANK_PROMPT,
  buildSufficiencyPrompt,
  buildRerankPrompt,
} from "./prompts/index.js";
