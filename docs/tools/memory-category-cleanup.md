---
summary: "MemU category merge, rename, and cleanup tools"
read_when:
  - Cleaning duplicate or empty MemU memory categories
  - Reviewing memory category administration tools
title: "Memory Category Cleanup"
---

# Memory category cleanup

MemU category administration is exposed through four tools:

- `memory_categories`: list categories with item counts and filters
- `memory_category_merge`: merge source category IDs into one target category ID
- `memory_category_rename`: rename a category display name without changing linked items
- `memory_category_cleanup`: preview or apply an automated cleanup pass

`memory_category_cleanup` defaults to dry-run:

```json5
{
  dryRun: true,
  deleteEmpty: true,
  mergeSimilar: true,
  similarityThreshold: 0.8,
  maxMergeSourceItems: 3,
}
```

The cleanup pass removes empty category shells when applying changes, and plans conservative merges
from low-count sprawl categories into higher-count targets. By default, only source categories with
three or fewer linked items are eligible for automated merging, so established categories such as
`11 Labs V3 Audio Tags` and `11 Labs V3 Voice Model` stay out of the automated merge set. The merge
target is the category with the most linked items, with shorter names winning ties.

Manual merge example:

```json5
{
  sourceCategoryIds: ["cat_variant_1", "cat_variant_2"],
  targetCategoryId: "cat_clean",
}
```

Manual rename example:

```json5
{
  categoryId: "cat_clean",
  newName: "11 Labs V3",
}
```
