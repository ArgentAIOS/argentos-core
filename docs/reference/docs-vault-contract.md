---
title: Docs vault contract
description: Contract for keeping public ArgentOS docs and the shipped Obsidian Core Docs vault in sync.
---

The public Core docs and the shipped Obsidian Core Docs vault are one documentation surface.

When a change edits, adds, renames, or deletes public documentation under `docs/`, the same change must regenerate and stage the Obsidian vault mirror:

```bash
pnpm docs:vault
```

The generated vault lives at:

```text
docs/obsidian-vault/ArgentOS Core Docs
```

Release and review gates should verify the mirror is current with:

```bash
pnpm docs:vault:check
```

The vault is generated content. Do not hand-edit files inside `docs/obsidian-vault/ArgentOS Core Docs`; edit the source doc under `docs/` and rerun `pnpm docs:vault`.

The generator intentionally excludes private/debug/agent-only material, including `docs/debug`, archived material, research dumps, generated vault output, and `CLAUDE.md` files. Public Core operator knowledge should be written in public docs first so it can flow into the vault.
