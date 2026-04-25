import type { MemoryAdapter } from "../../data/adapter.js";
import type { MemoryCategory } from "../memu-types.js";

export type MemoryCategorySort = "name" | "itemCount";
export type MemoryCategorySortDirection = "asc" | "desc";

export type MemoryCategoryWithCount = {
  id: string;
  name: string;
  description: string | null;
  summary: string | null;
  itemCount: number;
};

export type MemoryCategoryMergeResult = {
  targetCategory: MemoryCategory;
  mergedSources: Array<{
    id: string;
    name: string;
    itemCount: number;
    linkedItems: number;
  }>;
  skipped: Array<{ id: string; reason: string }>;
  totalLinkedItems: number;
};

export type MemoryCategoryCleanupMergePlan = {
  sourceCategoryId: string;
  sourceName: string;
  sourceItemCount: number;
  targetCategoryId: string;
  targetName: string;
  targetItemCount: number;
  reason: "exact" | "similar" | "subset";
  score: number;
};

export type MemoryCategoryCleanupPlan = {
  dryRun: boolean;
  emptyCategories: MemoryCategoryWithCount[];
  merges: MemoryCategoryCleanupMergePlan[];
  deletedEmptyCount: number;
  mergedCategoryCount: number;
  linkedItemCount: number;
};

type ListCategoryOptions = {
  query?: string;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  sort?: MemoryCategorySort;
  sortDirection?: MemoryCategorySortDirection;
  limit?: number;
};

type CleanupOptions = {
  dryRun?: boolean;
  deleteEmpty?: boolean;
  mergeSimilar?: boolean;
  similarityThreshold?: number;
  maxMergeSourceItems?: number;
};

function normalizeCategoryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function categoryTokens(name: string): string[] {
  return normalizeCategoryName(name).split(" ").filter(Boolean);
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return right.length;
  }
  if (!right) {
    return left.length;
  }
  const previous = Array.from({ length: right.length + 1 }, (_entry, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitution,
      );
    }
    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }
  return previous[right.length] ?? 0;
}

function nameSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeCategoryName(left);
  const normalizedRight = normalizeCategoryName(right);
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  if (maxLength === 0) {
    return 1;
  }
  return 1 - levenshteinDistance(normalizedLeft, normalizedRight) / maxLength;
}

function startsWithTokenSequence(longer: string[], shorter: string[]): boolean {
  if (shorter.length < 2 || shorter.length >= longer.length) {
    return false;
  }
  return shorter.every((token, index) => longer[index] === token);
}

function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function compareCategoryRows(
  left: MemoryCategoryWithCount,
  right: MemoryCategoryWithCount,
  sort: MemoryCategorySort,
  direction: MemoryCategorySortDirection,
): number {
  const multiplier = direction === "desc" ? -1 : 1;
  if (sort === "itemCount") {
    const diff = left.itemCount - right.itemCount;
    if (diff !== 0) {
      return diff * multiplier;
    }
  }
  return left.name.localeCompare(right.name) * multiplier;
}

function compareMergeTargets(
  left: MemoryCategoryWithCount,
  right: MemoryCategoryWithCount,
): number {
  const countDiff = right.itemCount - left.itemCount;
  if (countDiff !== 0) {
    return countDiff;
  }
  const lengthDiff = left.name.length - right.name.length;
  if (lengthDiff !== 0) {
    return lengthDiff;
  }
  return left.name.localeCompare(right.name);
}

export async function listMemoryCategoriesWithCounts(
  memory: MemoryAdapter,
  options: ListCategoryOptions = {},
): Promise<MemoryCategoryWithCount[]> {
  const fetchLimit = Math.max(options.limit ?? 10_000, 10_000);
  const categories = await memory.listCategories({ query: options.query, limit: fetchLimit });
  const pattern = options.pattern ? compilePattern(options.pattern) : null;
  const patternNeedle = pattern ? null : options.pattern?.toLowerCase();
  const rows = await Promise.all(
    categories.map(async (category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      summary: category.summary,
      itemCount: await memory.getCategoryItemCount(category.id),
    })),
  );
  return rows
    .filter((row) => {
      if (options.minItems !== undefined && row.itemCount < options.minItems) {
        return false;
      }
      if (options.maxItems !== undefined && row.itemCount > options.maxItems) {
        return false;
      }
      if (pattern && !pattern.test(row.name)) {
        return false;
      }
      if (patternNeedle && !row.name.toLowerCase().includes(patternNeedle)) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) =>
      compareCategoryRows(
        left,
        right,
        options.sort ?? "name",
        options.sortDirection ?? (options.sort === "itemCount" ? "desc" : "asc"),
      ),
    )
    .slice(0, options.limit ?? 20);
}

export async function mergeMemoryCategories(params: {
  memory: MemoryAdapter;
  sourceCategoryIds: string[];
  targetCategoryId: string;
}): Promise<MemoryCategoryMergeResult> {
  const targetCategory = await params.memory.getCategory(params.targetCategoryId);
  if (!targetCategory) {
    throw new Error(`Target category not found: ${params.targetCategoryId}`);
  }

  const sourceIds = Array.from(new Set(params.sourceCategoryIds)).filter(
    (id) => id !== params.targetCategoryId,
  );
  const mergedSources: MemoryCategoryMergeResult["mergedSources"] = [];
  const skipped: MemoryCategoryMergeResult["skipped"] = [];
  let totalLinkedItems = 0;

  for (const sourceId of sourceIds) {
    const source = await params.memory.getCategory(sourceId);
    if (!source) {
      skipped.push({ id: sourceId, reason: "not_found" });
      continue;
    }
    const itemCount = await params.memory.getCategoryItemCount(sourceId);
    const items = await params.memory.getCategoryItems(sourceId, Math.max(itemCount, 1));
    for (const item of items) {
      await params.memory.linkItemToCategory(item.id, params.targetCategoryId);
    }
    await params.memory.deleteCategory(sourceId);
    mergedSources.push({
      id: source.id,
      name: source.name,
      itemCount,
      linkedItems: items.length,
    });
    totalLinkedItems += items.length;
  }

  return { targetCategory, mergedSources, skipped, totalLinkedItems };
}

export async function renameMemoryCategory(params: {
  memory: MemoryAdapter;
  categoryId: string;
  newName: string;
}): Promise<MemoryCategory> {
  const name = params.newName.trim();
  if (!name) {
    throw new Error("newName required");
  }
  const existing = await params.memory.getCategoryByName(name);
  if (existing && existing.id !== params.categoryId) {
    throw new Error(`Category name already exists: ${name}`);
  }
  const updated = await params.memory.updateCategoryName(params.categoryId, name);
  if (!updated) {
    throw new Error(`Category not found: ${params.categoryId}`);
  }
  return updated;
}

export async function planMemoryCategoryCleanup(
  memory: MemoryAdapter,
  options: CleanupOptions = {},
): Promise<MemoryCategoryCleanupPlan> {
  const dryRun = options.dryRun ?? true;
  const deleteEmpty = options.deleteEmpty ?? true;
  const mergeSimilar = options.mergeSimilar ?? true;
  const threshold = Math.max(0, Math.min(1, options.similarityThreshold ?? 0.8));
  const maxMergeSourceItems = Math.max(1, Math.floor(options.maxMergeSourceItems ?? 3));
  const categories = await listMemoryCategoriesWithCounts(memory, {
    limit: 10_000,
    sort: "name",
  });
  const emptyCategories = deleteEmpty
    ? categories.filter((category) => category.itemCount === 0)
    : [];
  const candidates = categories.filter((category) => category.itemCount > 0);
  const lowCountSources = candidates.filter(
    (category) => category.itemCount <= maxMergeSourceItems,
  );
  const merges: MemoryCategoryCleanupMergePlan[] = [];

  if (mergeSimilar) {
    for (const source of lowCountSources) {
      const sourceNormalized = normalizeCategoryName(source.name);
      const sourceTokens = categoryTokens(source.name);
      const matches: Array<{
        target: MemoryCategoryWithCount;
        reason: MemoryCategoryCleanupMergePlan["reason"];
        score: number;
      }> = [];
      for (const target of candidates) {
        if (target.id === source.id) {
          continue;
        }
        if (target.itemCount <= maxMergeSourceItems) {
          continue;
        }
        const targetNormalized = normalizeCategoryName(target.name);
        const targetTokens = categoryTokens(target.name);
        let reason: MemoryCategoryCleanupMergePlan["reason"] | null = null;
        let score = 0;
        if (sourceNormalized === targetNormalized) {
          reason = "exact";
          score = 1;
        } else if (startsWithTokenSequence(sourceTokens, targetTokens)) {
          reason = "subset";
          score = 0.95;
        } else {
          score = nameSimilarity(source.name, target.name);
          if (score >= threshold) {
            reason = "similar";
          }
        }
        if (!reason) {
          continue;
        }
        matches.push({ target, reason, score });
      }
      const best = matches.toSorted((left, right) => {
        if (left.reason === "exact" && right.reason !== "exact") {
          return -1;
        }
        if (left.reason !== "exact" && right.reason === "exact") {
          return 1;
        }
        const targetCompare = compareMergeTargets(left.target, right.target);
        if (targetCompare !== 0) {
          return targetCompare;
        }
        return right.score - left.score;
      })[0];
      if (best) {
        merges.push({
          sourceCategoryId: source.id,
          sourceName: source.name,
          sourceItemCount: source.itemCount,
          targetCategoryId: best.target.id,
          targetName: best.target.name,
          targetItemCount: best.target.itemCount,
          reason: best.reason,
          score: best.score,
        });
      }
    }
  }

  const plan: MemoryCategoryCleanupPlan = {
    dryRun,
    emptyCategories,
    merges,
    deletedEmptyCount: 0,
    mergedCategoryCount: 0,
    linkedItemCount: 0,
  };

  if (dryRun) {
    return plan;
  }

  for (const category of emptyCategories) {
    await memory.deleteCategory(category.id);
    plan.deletedEmptyCount += 1;
  }

  const mergesByTarget = new Map<string, string[]>();
  for (const merge of merges) {
    mergesByTarget.set(merge.targetCategoryId, [
      ...(mergesByTarget.get(merge.targetCategoryId) ?? []),
      merge.sourceCategoryId,
    ]);
  }
  for (const [targetCategoryId, sourceCategoryIds] of mergesByTarget) {
    const result = await mergeMemoryCategories({ memory, targetCategoryId, sourceCategoryIds });
    plan.mergedCategoryCount += result.mergedSources.length;
    plan.linkedItemCount += result.totalLinkedItems;
  }

  return plan;
}
