export { extractFacts } from "./extract-items.js";
export { deduplicateFacts, type DedupeResult } from "./dedupe.js";
export { categorizeFacts, type CategorizeResult } from "./categorize.js";
export { runExtractionPipeline, queueExtraction } from "./pipeline.js";
export { buildExtractionPrompt, EXTRACTION_PROMPTS } from "./prompts/index.js";
