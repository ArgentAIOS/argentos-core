---
summary: "Stable, beta, and dev channels: semantics, switching, and tagging"
read_when:
  - You want to switch between stable/beta/dev
  - You are tagging or publishing prereleases
title: "Development Channels"
---

# Development channels

Last updated: 2026-01-21

ArgentOS ships three update channels on the supported git rail:

- **stable**: latest non-beta GitHub release tag.
- **beta**: latest beta-or-stable GitHub release tag.
- **dev**: moving head of `main`.

The public website installer defaults to the **git rail**. GitHub branches and
release tags are the source of truth for customer-facing installs and updates.

## Switching channels

Hosted/default git checkout:

```bash
argent update --channel stable
argent update --channel beta
argent update --channel dev
```

- `stable`/`beta` check out the latest matching GitHub release tag.
- `dev` switches to `main` and rebases on the upstream.

When you **explicitly** switch channels with `--channel`, ArgentOS stays on the git rail:

- `stable`/`beta` move between release tags.
- `dev` switches to `main` and keeps following upstream.

Tip: if you want stable + dev in parallel, keep two clones and point your gateway at the stable one.

## Plugins and channels

When you switch channels with `argent update`, ArgentOS also syncs plugin sources:

- `dev` prefers bundled plugins from the git checkout.
- `stable` and `beta` restore the bundled release-compatible plugin state.

## Tagging best practices

- Tag releases you want git checkouts to land on (`vYYYY.M.D` or `vYYYY.M.D-<patch>`).
- Keep tags immutable: never move or reuse a tag.
- Publish a new tag for each release candidate instead of mutating an old one.

## macOS app availability

Beta and dev builds may **not** include a macOS app release. That’s OK:

- The git tag can still be published.
- Call out “no macOS build for this beta” in release notes or changelog.
