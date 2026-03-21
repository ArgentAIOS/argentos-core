import type { ArgentConfig } from "../config/config.js";

export const V3_EMBEDDING_DIMENSIONS = 768;
const PREFLIGHT_PROBE_TEXT = "ArgentOS V3 embedding contract startup preflight";

function sanitizeFiniteEmbedding(values: ReadonlyArray<number>): number[] {
  const sanitized: number[] = [];
  for (const value of values) {
    if (Number.isFinite(value)) {
      sanitized.push(value);
    }
  }
  return sanitized;
}

export function requireEmbeddingDimensions(
  values: ReadonlyArray<number>,
  context: string,
  expectedDimensions = V3_EMBEDDING_DIMENSIONS,
): number[] {
  const sanitized = sanitizeFiniteEmbedding(values);
  if (sanitized.length === expectedDimensions) {
    return sanitized;
  }
  throw new Error(
    `[EMBEDDING-CONTRACT] Expected ${expectedDimensions} dimensions for ${context}, got ${sanitized.length}.`,
  );
}

export function shouldEnforceV3EmbeddingContract(config?: ArgentConfig): boolean {
  const memory = config?.memory;
  const contemplation = config?.agents?.defaults?.contemplation;
  return (
    memory?.vault?.enabled === true ||
    memory?.vault?.ingest?.enabled === true ||
    memory?.cognee?.enabled === true ||
    memory?.cognee?.retrieval?.enabled === true ||
    contemplation?.discoveryPhase?.enabled === true
  );
}

export function resolveOpenAiEmbeddingDimensions(
  model: string,
  config?: ArgentConfig,
): number | undefined {
  if (!shouldEnforceV3EmbeddingContract(config)) {
    return undefined;
  }
  const normalized = model
    .trim()
    .toLowerCase()
    .replace(/^openai\//, "");
  if (normalized.startsWith("text-embedding-3-")) {
    return V3_EMBEDDING_DIMENSIONS;
  }
  return undefined;
}

export async function runV3EmbeddingContractPreflight(params: {
  config?: ArgentConfig;
  probe: (text: string) => Promise<number[]>;
  context: string;
}): Promise<void> {
  if (!shouldEnforceV3EmbeddingContract(params.config)) {
    return;
  }
  const vector = await params.probe(PREFLIGHT_PROBE_TEXT);
  requireEmbeddingDimensions(vector, `${params.context} startup preflight`);
}
