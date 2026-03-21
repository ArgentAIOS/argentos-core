export { MemoryIndexManager } from "./manager.js";
export type {
  MemoryEmbeddingProbeResult,
  MemorySearchManager,
  MemorySearchResult,
} from "./types.js";
export { getMemorySearchManager, type MemorySearchManagerResult } from "./search-manager.js";

// Memo - Persistent Memory (session/tool capture)
export {
  ensureObservationsSchema as ensureMemoSchema,
  getOrCreateSession,
  addObservation as addMemory,
  searchObservations as searchMemory,
  getObservationsByIds as getMemoriesById,
  getObservationTimeline as getMemoryTimeline,
  endSession,
  getRecentObservations as getRecentMemories,
  type Session as MemoSession,
  type Observation as MemoEntry,
  type ObservationSearchResult as MemoSearchResult,
} from "./memo-schema.js";

// Memo Hooks (auto-capture from agent runtime)
export {
  registerObservationHooks as registerMemo,
  registerAgentEventObserver as enableMemoCapture,
  triggerToolResultHook,
  triggerSessionStartHook,
  triggerSessionEndHook,
  closeObservationsDb as closeMemo,
  type ToolResultHookContext,
  type SessionLifecycleContext,
} from "./memo.js";

// ── MemU — Three-Layer Memory System ──

// Types
export type {
  MemoryType,
  ResourceModality,
  Resource,
  MemoryItem,
  MemoryCategory,
  CategoryItem,
  CreateResourceInput,
  CreateMemoryItemInput,
  CreateCategoryInput,
  MemorySearchOptions,
  MemorySearchResult as MemuSearchResult,
  CategorySearchResult,
  ExtractedFact,
  ExtractionResult,
  SalienceParams,
} from "./memu-types.js";
export { MEMORY_TYPES } from "./memu-types.js";

// Store
export {
  MemuStore,
  contentHash,
  cosineSimilarity,
  recencyDecay,
  salienceScore,
} from "./memu-store.js";

// Schema
export { ensureMemuSchema } from "./memu-schema.js";

// Embeddings
export { getMemuEmbedder, resetMemuEmbedder, type MemuEmbedder } from "./memu-embed.js";

// Workflow
export {
  runWorkflow,
  validateWorkflow,
  type WorkflowStep,
  type WorkflowResult,
} from "./memu-workflow.js";

// Extraction Pipeline
export {
  runExtractionPipeline,
  queueExtraction,
  extractFacts,
  deduplicateFacts,
  categorizeFacts,
  buildExtractionPrompt,
  EXTRACTION_PROMPTS,
  type DedupeResult,
  type CategorizeResult,
} from "./extract/index.js";

// Retrieval Pipeline
export {
  retrieveMemory,
  quickRecall,
  deepRecall,
  type RetrievalOptions,
  type RetrievalResult,
  SUFFICIENCY_PROMPT,
  RERANK_PROMPT,
  buildSufficiencyPrompt,
  buildRerankPrompt,
} from "./retrieve/index.js";

// Categories Manager
export {
  refreshCategorySummary,
  refreshTouchedCategorySummaries,
  cleanupEmptyCategories,
  CATEGORY_SUMMARY_PROMPT,
  buildCategorySummaryPrompt,
} from "./categories/index.js";

// Journaling (heartbeat + cron → MemU Resources)
export { startJournal, stopJournal, getCronJournalHandler } from "./journal.js";
