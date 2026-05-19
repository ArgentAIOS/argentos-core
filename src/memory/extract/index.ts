export { extractFacts } from "./extract-items.js";
export { deduplicateFacts, type DedupeResult } from "./dedupe.js";
export { categorizeFacts, type CategorizeResult } from "./categorize.js";
export { runExtractionPipeline, queueExtraction } from "./pipeline.js";
export { buildExtractionPrompt, EXTRACTION_PROMPTS } from "./prompts/index.js";
export {
  AUDIO_PREPROCESS_PROMPT,
  DOCUMENT_PREPROCESS_PROMPT,
  IMAGE_PREPROCESS_PROMPT,
  VIDEO_PREPROCESS_PROMPT,
  PREPROCESS_PROMPTS,
  buildAudioPreprocessPrompt,
  buildDocumentPreprocessPrompt,
  buildImagePreprocessPrompt,
  buildVideoPreprocessPrompt,
  type PreprocessModality,
} from "./prompts/index.js";
