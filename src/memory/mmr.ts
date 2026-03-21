/**
 * Maximal Marginal Relevance (MMR) re-ranking algorithm.
 *
 * MMR balances relevance with diversity by iteratively selecting results
 * that maximize: lambda * relevance - (1-lambda) * max_similarity_to_selected
 */

export type MMRItem = {
  id: string;
  score: number;
  content: string;
};

export type MMRConfig = {
  /** Enable/disable MMR re-ranking. Default: false (opt-in) */
  enabled: boolean;
  /** Lambda parameter: 0 = max diversity, 1 = max relevance. Default: 0.7 */
  lambda: number;
};

export const DEFAULT_MMR_CONFIG: MMRConfig = {
  enabled: false,
  lambda: 0.7,
};

export function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return new Set(tokens);
}

export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  let intersectionSize = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;

  for (const token of smaller) {
    if (larger.has(token)) {
      intersectionSize++;
    }
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function maxSimilarityToSelected(
  item: MMRItem,
  selectedItems: MMRItem[],
  tokenCache: Map<string, Set<string>>,
): number {
  if (selectedItems.length === 0) {
    return 0;
  }

  let maxSim = 0;
  const itemTokens = tokenCache.get(item.id) ?? tokenize(item.content);

  for (const selected of selectedItems) {
    const selectedTokens = tokenCache.get(selected.id) ?? tokenize(selected.content);
    const sim = jaccardSimilarity(itemTokens, selectedTokens);
    if (sim > maxSim) {
      maxSim = sim;
    }
  }

  return maxSim;
}

export function computeMMRScore(relevance: number, maxSimilarity: number, lambda: number): number {
  return lambda * relevance - (1 - lambda) * maxSimilarity;
}

export function mmrRerank<T extends MMRItem>(items: T[], config: Partial<MMRConfig> = {}): T[] {
  const { enabled = DEFAULT_MMR_CONFIG.enabled, lambda = DEFAULT_MMR_CONFIG.lambda } = config;

  if (!enabled || items.length <= 1) {
    return [...items];
  }

  const clampedLambda = Math.max(0, Math.min(1, lambda));
  if (clampedLambda === 1) {
    return [...items].sort((a, b) => b.score - a.score);
  }

  const tokenCache = new Map<string, Set<string>>();
  for (const item of items) {
    tokenCache.set(item.id, tokenize(item.content));
  }

  const maxScore = Math.max(...items.map((i) => i.score));
  const minScore = Math.min(...items.map((i) => i.score));
  const scoreRange = maxScore - minScore;
  const normalizeScore = (score: number): number => {
    if (scoreRange === 0) {
      return 1;
    }
    return (score - minScore) / scoreRange;
  };

  const selected: T[] = [];
  const remaining = new Set(items);

  while (remaining.size > 0) {
    let bestItem: T | null = null;
    let bestMMRScore = -Infinity;

    for (const candidate of remaining) {
      const normalizedRelevance = normalizeScore(candidate.score);
      const maxSim = maxSimilarityToSelected(candidate, selected, tokenCache);
      const mmrScore = computeMMRScore(normalizedRelevance, maxSim, clampedLambda);

      if (
        mmrScore > bestMMRScore ||
        (mmrScore === bestMMRScore && candidate.score > (bestItem?.score ?? -Infinity))
      ) {
        bestMMRScore = mmrScore;
        bestItem = candidate;
      }
    }

    if (!bestItem) {
      break;
    }
    selected.push(bestItem);
    remaining.delete(bestItem);
  }

  return selected;
}

export function applyMMRToHybridResults<
  T extends { score: number; snippet: string; path: string; startLine: number },
>(results: T[], config: Partial<MMRConfig> = {}): T[] {
  if (results.length === 0) {
    return results;
  }

  const itemById = new Map<string, T>();
  const mmrItems: MMRItem[] = results.map((r, index) => {
    const id = `${r.path}:${r.startLine}:${index}`;
    itemById.set(id, r);
    return {
      id,
      score: r.score,
      content: r.snippet,
    };
  });

  const reranked = mmrRerank(mmrItems, config);
  return reranked.map((item) => itemById.get(item.id)!);
}
