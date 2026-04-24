# 2026-04-24 Core Release Readiness

## Goal

Prepare `ArgentAIOS/argentos-core` `dev` to become a true public Core release
instead of a Richard-only patch stream.

## Current branch

- Branch: `dev`
- Current head after Richard stabilization: `2a963f16 Make Marketplace a first-class Core tool`
- Version while stabilizing: `2026.4.24-dev.0`

## Release blockers found today

### Marketplace was not in the real agent tool surface

Status: fixed.

- `marketplace` is now wired directly into `createArgentTools`.
- The obsolete bundled `clawhub` skill was removed.
- Skills CLI hints now point to `argent marketplace search` and
  `argent marketplace install <package>`.
- Richard's M5 verified `argent marketplace --help` and a live marketplace
  search.

### Extension versions were stale

Status: fixed locally on `dev`.

- `pnpm release:check` failed because bundled extension packages were still at
  `2026.3.2`.
- `pnpm plugins:sync` aligned extension package versions to
  `2026.4.24-dev.0`.
- `pnpm release:check` then passed.

## Core verification checklist before merging to `main`

- Marketplace: Sapphire can discover and call `marketplace`.
- Provider routing: MiniMax and GLM route only through configured providers; no
  automatic Bedrock or Anthropic fallback unless explicitly configured.
- Settings navigation: System, Live Logs, Licensing, Database, Gateway, Agents,
  Memory, and Operations-relevant views are present when they are Core.
- Operations: main dashboard Operations tab and subviews are present in Core.
- Vault: vault routes work in public Core and do not show "Route not available
  in public Core".
- Memory/MemU: Memory v3 health does not incorrectly report Core features as
  missing; Cognee/connector status is clear.
- Tasks/tools: personal task and project tools are usable by the main agent.
- Tool policy: Core defaults allow personal tool use unless the operator marks a
  tool denied or ask-first.
- Attachments: image drag/drop reaches an image-capable model or gives a clear
  model-capability message.
- Update rail: `argent update` detects release changes and completes snapshot
  sync without the tiny-globby copy error.
- Pack rail: `pnpm build`, `pnpm release:check`, focused tests, and install
  smoke pass.

## Release procedure

1. Finish the verification checklist on `dev`.
2. Choose the release version.
3. Update `package.json`, extension versions, `CHANGELOG.md`, and any release
   log/manifest used by the public installer rail.
4. Run `pnpm build`.
5. Run `pnpm release:check`.
6. Run focused regression tests for the fixes included in the release.
7. Smoke-test public install/update on a clean or disposable machine.
8. Merge or fast-forward `dev` to `main`.
9. Let Railway/public installer deploy from `main`.
10. Verify a real `argent update` from the public rail.

## Business layering reminder

Business should not be used as the bucket for normal Core behavior. The Business
overlay is for worker agents, workforce/job orchestration, governance, training
observer mode, worker onboarding, organization entitlements, and private
registry distribution.

Everything else starts as Core unless `docs/concepts/core-business-boundary.md`
says otherwise.
