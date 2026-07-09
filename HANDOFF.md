# HANDOFF — argent-core session bridge

**From:** 2026-07-07 → 07-08 session (Fable 5). Covered: first real remote user support
(Jack's Titanium mini), the **v2026.7.7 public release end-to-end** (first since
2026-05-29), and a critical post-release discovery (LFS-hook updater landmine).

Full narrative: Obsidian vault `argenos-core/` — [[01 - Current State]] is fresh
(2026-07-08), plus `Daily Updates/2026-07-08` and
`Orchestration Handoffs/2026-07-08 - v2026.7.7 release + Jack's box rescue`.
Backlog: `Follow-Ups & To-Dos.md` closet (three new 🔴 items dated 2026-07-08).

---

## 🔴 START HERE — cut v2026.7.7.1 (morning item #1)

v2026.7.7 shipped tonight, but the tag **immutably carries accidental git-lfs hooks**
(`git-hooks/post-checkout` etc., committed in `012d30ea`; the repo has ZERO LFS content).
Effect: **`argent update` → v2026.7.7 fails `checkout-failed` on every box without
git-lfs** (default macOS). Hit live on Jack's mini. Fresh installs are immune (installer
runs `run_git_nohooks`); only the updater path is broken.

- Hooks already REMOVED on dev: `dafb3404` (post-checkout/post-commit/post-merge deleted;
  pre-push kept repo-lane only). A new hookless tag fixes updates TO it (post-checkout
  resolves against the new worktree → file absent → git silently skips).
- **Do:** rerun `ops/runbooks/release-core.md` from dev → tag `v2026.7.7.1` → GH release →
  `export:hosted-installers` + `sync:hosted-installers:site` + argentos.ai push → verify a
  5.6.7→7.7.1 update on a box WITHOUT git-lfs. Delta on top of the release commit is only
  hook-removal + docs, so gates should be quick.
- Companion (filed in closet): make the updater run its git ops nohooks like the installer.
- Failed-update trap: a hook-failed checkout leaves the clone HEAD at the new tag →
  next `argent update` lies "up-to-date/SKIPPED" (split-brain). Reset the clone to the
  installed version's tag before rerunning.

## Shipped: v2026.7.7 (all rails verified live)

| Surface                          | State                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Tag `v2026.7.7`                  | `b4cdc1ed`, immutable, pushed                                                    |
| GitHub Release "argent 2026.7.7" | published, **Latest**                                                            |
| `main`                           | promoted via PR #471 (integrate-merge `71e5eae7`; main @ `acbf9294`)             |
| `dev`                            | `2026.7.7-dev.1` (`63953ce9`) + LFS-hook fix (`dafb3404`)                        |
| argentos.ai                      | serving new install.sh (manifest sha `dda32686…` verified live 20:44 CDT)        |
| Gates                            | `pnpm check` ✓ `pnpm test` ✓ `release:check` ✓ installer direct-container gate ✓ |

33 PRs bundled (see `CHANGELOG.md` §2026.7.7): Worker Runtime v2 end-to-end, Business
distillation merge, approval integrity, fail-closed Rust daemon auth, unattended
installer, Dependabot criticals, CI unit gate.

Release-tooling debt found while cutting (all filed, runbook fixed in-tree):

- Install-smoke harness resolves + would install a **foreign npm package** `argent`@0.1.0,
  and defaults to testing the LIVE installer URL — rework spec in the closet + vault Gotchas
- #431 Docker Release workflow still fails on every tag (new signature commented on issue)

## Jack's Titanium mini (100.84.34.59) — ✅ FULLY DONE tonight

All complaints fixed and verified: TinyFish/env (legacy env block removed → proper
`tools.web.*` keys), gateway bootout recovery, ollama auth profile added, Ollama-app
popup killed (keepalive `open -gja`), **timeouts = 1-min idle sleep → never-sleep set,
full wake asserted**, box **updated to v2026.7.7** (hook bypass:
`core.hookspath hooks-disabled-no-lfs` in `~/argentos`), model pinned
`zai/glm-4.7` (hot-reloaded — ends the glm-5.1 tool-claim fallback round-trip).
Morning follow-up is soft only: ask Jack if turns feel fast. Access recipe + traps:
auto-memory `jack-titanium-mini-remote-box`.

## ⚠️ Jason's laptop — still deliberately PARKED (unchanged since 07-04)

Gateway STOPPED, kernel/contemplation/SIS disabled, workforce paused
(`globalPaused` resets on gateway restart — re-pause!), evy paused, LM Studio empty.
Bring-back table in vault [[01 - Current State]]. Kernel stays off until the prompt
diet lands (`contemplation-runner.ts:994` → `promptMode:"subagent"` + narrowed tools).

## Priority queue for next session

1. 🔴 v2026.7.7.1 hotfix cut (above)
2. Updater nohooks code fix + install-smoke harness rework (closet, specs written)
3. Kernel prompt diet → re-enable kernel/contemplation/SIS supervised
4. P1 arm step (execd token); P2–P5 delegation seam; workforce first-hire grading
5. Soft: Jack satisfaction check; consider a git-lfs presence check in installer preflight

## Verify-fresh commands

```bash
git ls-remote --tags origin v2026.7.7                          # b4cdc1ed
gh release list --repo ArgentAIOS/argentos-core --limit 1      # argent 2026.7.7 · Latest
curl -fsSL https://argentos.ai/manifest.json | grep -c dda32686 # 1 (new installer live)
git log --oneline origin/dev -3                                 # dafb3404 hook fix on top
# Jack's box (password auth — recipe in auto-memory jack-titanium-mini-remote-box):
#   argent --version → 2026.7.7 ; gateway :18789 → 200
```

_Session ended 2026-07-08 ~21:30 CDT. Everything above is committed/pushed/live-verified;
nothing is in flight. Next session: read this file, cut v2026.7.7.1._
