# Release Runbook — Core (npm + CLI rail)

Companion to [`docs/reference/RELEASING.md`](../../docs/reference/RELEASING.md). Walk this top to bottom; do not skip steps. Verification gates are marked **STOP** — do not proceed past a gate that didn't pass.

This runbook covers the **core** rail only: the `argentos` npm package + the `argent` CLI + the hosted installers at `argentos.ai`. For the macOS Sparkle app rail, see [`release-swift-mac.md`](./release-swift-mac.md). Most releases ship the core rail alone; ship the Sparkle rail only when `apps/macos/` has substantive changes.

## When to use

- The operator says "release", "cut a release", or "ship X.Y.Z"
- `dev` has accumulated merged PRs since the last `v2026.X.Y.Z` tag and we want to promote them
- A hotfix needs to ship under a new tag (do **not** repoint an existing tag — cut a new one)

## Preconditions (must hold before step 1)

- [ ] Logged into the right machine (release builds run from a clean checkout)
- [ ] `pnpm` available on `node 22+` (`node --version` reports v22.x or later)
- [ ] `gh` CLI authenticated against the target org (`gh auth status` reports logged in)
- [ ] Working tree on `dev`, clean (`git status --porcelain` returns nothing)
- [ ] Local `dev` matches origin (`git pull --ff-only origin dev` is a no-op)
- [ ] You know the next version number — date-based, monotonic, no reuse. Recent tags: see [Version naming](#version-naming) below.
- [ ] If a macOS Sparkle release is also planned for this version: env vars and keychain profile for [`release-swift-mac.md`](./release-swift-mac.md) are loaded (`SPARKLE_PRIVATE_KEY_FILE`, App Store Connect creds, `argent-notary` keychain profile)

## Version naming

Format: `vYYYY.M.D.N` (no leading zeros on M/D, no `-beta` suffix in Sparkle-eligible releases).

The `N` suffix increments per release on the same day-stamp. Recent history:

```
v2026.5.6.5  — 2026-05-18  (latest stable)
v2026.5.6.4  — 2026-05-13
v2026.5.6.3  — earlier
v2026.5.6.2  — earlier
v2026.5.6.1  — earlier
v2026.5.6    — earlier
v2026.4.30   — last main-branch promotion
```

The next release after `v2026.5.6.5` is `v2026.5.6.6` (continuing the same day-stamp series) unless you intend to start a new day-stamp series, in which case use `v2026.5.7` or the current date.

`package.json` `version` field on `dev` carries a `-dev.N` suffix (e.g. `2026.5.6-dev.54`) that gets dropped during release and re-incremented after.

---

## Step 1 — Version bump

Bump version metadata in three places, then run the plugin-sync helper:

```bash
# 1a. package.json — strip -dev.N suffix, set release version
node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json"));
  pkg.version = "2026.5.6.6";   // ← target version
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
'

# 1b/1c. (OBSOLETE as of v2026.7.7 — version is centralized.)
#     src/version.ts resolves VERSION from the build-time __ARGENT_VERSION__
#     define, falling back to package.json. src/provider-web.ts no longer
#     exists. package.json is the single version source; no other file edits.

# 1d. Sync extension package versions + changelogs
pnpm plugins:sync

# 1e. If dependencies changed since last release, refresh the lockfile
pnpm install
```

**STOP** — verify:

- [ ] `node -p "require('./package.json').version"` prints the target version (no `-dev.N`)
- [ ] `git diff --name-only` shows: `package.json`, `src/cli/program.ts`, `src/provider-web.ts`, plus extension `package.json` files touched by `plugins:sync`
- [ ] `pnpm-lock.yaml` is current if `pnpm install` modified anything

---

## Step 2 — Build artifacts

```bash
# 2a. Regenerate the canvas A2UI bundle ONLY if A2UI inputs changed since last release
pnpm canvas:a2ui:bundle  # writes src/canvas-host/a2ui/a2ui.bundle.js

# 2b. Full build — regenerates dist/
pnpm run build
```

The `build` script runs (per `package.json`):
`pnpm tsc:since && pnpm canvas:a2ui:bundle && export-provider-catalog && tsdown && canvas-a2ui-copy && copy-hook-metadata && write-build-info && write-cli-compat`

**STOP** — verify:

- [ ] `ls dist/build-info.json` exists
- [ ] `jq -r .commit dist/build-info.json` matches `git rev-parse HEAD`
- [ ] `ls dist/node-host/ dist/acp/` both exist (headless node + ACP CLI bundles)
- [ ] `ls dist/protocol.schema.json` exists

---

## Step 3 — Changelog

Append a new section to the **top** of `CHANGELOG.md`. Sections strictly descending by version.

Template:

```markdown
## 2026.5.6.6

### Highlights

- **One-line user-facing summary of the release theme.**
- 2-4 more highlights — each leads with the operator-visible improvement, not the implementation detail.

### Changes

- `category(area): one-line PR title (closes #NNN) (#PR)`
- ...

### Fixes

- `category(area): one-line PR title (closes #NNN) (#PR)`
- ...
```

Source the PR list:

```bash
# All PRs merged into dev since the previous tag
git log v2026.5.6.5..dev --merges --pretty=format:"%h %s" | head -40

# Or via gh — closed PRs targeting dev since the last release date
gh pr list --repo ArgentAIOS/argentos-core --base dev --state merged \
  --search "merged:>=2026-05-18" --limit 50 \
  --json number,title,labels,mergedAt
```

Tone reference: `CHANGELOG.md`'s `2026.4.30` section + `ops/OPENCLAW_RELEASE_CHANGELOG_PACKET.md` show the operator-facing voice. Lead with what the user sees, mention implementation detail only when it changes their workflow.

**STOP** — verify:

- [ ] New section is at the top (after `# Changelog` header), descending order preserved
- [ ] Every merged PR since the previous tag is accounted for (or explicitly omitted as non-user-facing)
- [ ] No bare GitHub links — references should be inline (`(closes #NNN)` / `(#PR)`)

---

## Step 4 — Validation (gate before tagging)

These are the gates that protect main. Run them all. The first ~3 are mandatory; later ones are situational but listed in priority order.

```bash
# 4a. Build + type + lint + format (mandatory)
pnpm build      # re-run if you made changes since step 2
pnpm check      # repo-lane + invariants + tsgo + lint + format

# 4b. Test suite (mandatory)
pnpm test

# 4c. Release-pack verification (mandatory)
pnpm release:check

# 4d. Installer smoke — repo-local (required if install.sh changed)
pnpm test:install:local:smoke

# 4e. Installer smoke — hosted (required if scripts/install-hosted.sh changed)
pnpm test:install:hosted:local:smoke

# 4f. Installer smoke — CLI (required if install-cli.sh changed)
pnpm test:install:cli:local:smoke

# 4g. Docker installer smoke (required before EVERY release)
#     NOTE: env prefixes are ARGENT_*, not ARGENTOS_* — the harness
#     (scripts/test-install-sh-docker.sh) reads ARGENT_INSTALL_SMOKE_*;
#     ARGENTOS_-prefixed vars are silently ignored.
#     TRAP: the smoke defaults ARGENT_INSTALL_URL to the LIVE
#     https://argentos.ai/install.sh — i.e. the PREVIOUS release's installer,
#     not the one you are about to ship. To gate the NEW installer, export it
#     and serve it locally first:
#       pnpm export:hosted-installers
#       python3 -m http.server 8765 --directory dist/hosted-installers &
#       ARGENT_INSTALL_URL=http://host.docker.internal:8765/install.sh \
#       ARGENT_INSTALL_CLI_URL=http://host.docker.internal:8765/install-cli.sh \
#       ARGENT_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke
ARGENT_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke
```

If a recent previous release is known broken, point the smoke at a known-good baseline:

```bash
ARGENT_INSTALL_SMOKE_PREVIOUS=v2026.5.6.4 pnpm test:install:smoke
# OR
ARGENT_INSTALL_SMOKE_SKIP_PREVIOUS=1 pnpm test:install:smoke
```

Optional but valuable when send/receive paths changed:

```bash
pnpm test:install:e2e:openai      # requires OPENAI_API_KEY
pnpm test:install:e2e:anthropic   # requires ANTHROPIC_API_KEY
pnpm test:install:e2e             # both
```

**STOP — irreversible after this gate.** Do not proceed unless:

- [ ] `pnpm check` is clean
- [ ] `pnpm test` is green (or any failures are documented pre-existing baselines)
- [ ] `pnpm release:check` reports the npm-pack contents you expect
- [ ] The Docker installer smoke passed end-to-end
- [ ] Any installer-script-related smokes passed if their inputs changed

---

## Step 5 — macOS Sparkle (skip if no `apps/macos/` changes)

If this release does NOT include macOS app changes: **skip to step 6**.

If it does: follow [`release-swift-mac.md`](./release-swift-mac.md) end-to-end before continuing. That runbook produces `ArgentOS-X.Y.Z.zip`, optional `ArgentOS-X.Y.Z.dSYM.zip`, and an updated `appcast.xml` — keep those artifacts ready for step 7.

`APP_BUILD` must be numeric + monotonic (no `-beta`) for Sparkle to compare versions correctly.

---

## Step 6 — Commit the release + tag

```bash
# 6a. Stage and commit the version bump + CHANGELOG (and any Sparkle artifacts that go in tree, e.g. appcast.xml)
git add package.json src/cli/program.ts src/provider-web.ts CHANGELOG.md pnpm-lock.yaml extensions/*/package.json extensions/*/CHANGELOG.md appcast.xml
git status                # eyeball — nothing unexpected
git commit -m "chore(release): v2026.5.6.6 — <one-line theme>"

# 6b. Tag (IMMUTABLE — never repoint, never reuse)
git tag v2026.5.6.6
git push origin dev
git push origin v2026.5.6.6
```

**STOP** — verify on GitHub:

- [ ] Tag `v2026.5.6.6` appears at `https://github.com/ArgentAIOS/argentos-core/releases/tag/v2026.5.6.6`
- [ ] Tag points at the chore(release) commit
- [ ] `dev` HEAD on origin matches your local HEAD

---

## Step 7 — Hosted installers

```bash
# 7a. Generate the installer payload from this tag
pnpm export:hosted-installers      # writes dist/hosted-installers/

# 7b. Inspect what got exported
ls -la dist/hosted-installers/
# Expected: install.sh, install-cli.sh, install.ps1

# 7c. Push to argentos.ai host
pnpm sync:hosted-installers:site
```

The sync script handles the actual upload to argentos.ai — read `scripts/sync-hosted-installers-to-site.ts` if you need to know which host / credentials it expects.

**STOP** — verify:

- [ ] `curl -fsSL https://argentos.ai/install.sh | head -5` returns the new installer (check version comment / commit ref if present)
- [ ] Same for `install-cli.sh`
- [ ] (Windows) `curl -fsSL https://argentos.ai/install.ps1 | head -5` same

---

## Step 8 — GitHub release

```bash
# 8a. Create the release with full inline changelog
gh release create v2026.5.6.6 \
  --repo ArgentAIOS/argentos-core \
  --title "argent 2026.5.6.6" \
  --notes-file <(awk '/^## 2026.5.6.6/,/^## /' CHANGELOG.md | sed '$d')

# 8b. Attach artifacts (Sparkle outputs if step 5 ran)
gh release upload v2026.5.6.6 dist/ArgentOS-2026.5.6.6.zip --repo ArgentAIOS/argentos-core    # if Sparkle ran
gh release upload v2026.5.6.6 dist/ArgentOS-2026.5.6.6.dSYM.zip --repo ArgentAIOS/argentos-core  # if dSYM was generated
```

Title MUST be `argent 2026.5.6.6` (not just the tag, not `v2026.5.6.6`). Body MUST contain the full Highlights + Changes + Fixes section inline (no bare GitHub links to CHANGELOG.md). Title MUST NOT be repeated inside the body.

---

## Step 9 — Smoke verify the published release

```bash
# 9a. From a CLEAN temp directory (no package.json present)
cd "$(mktemp -d)"
npx -y argentos@2026.5.6.6 send --help    # must exit 0 with usage output

# 9b. Optionally test the hosted installer end-to-end (Docker)
ARGENTOS_INSTALL_SMOKE_VERSION=2026.5.6.6 pnpm test:install:smoke
```

**STOP** — if `send --help` doesn't work cleanly, the published npm metadata is broken and we have a tag we can't fix. Do not announce. Cut a new tag with the fix instead of repointing.

---

## Step 10 — Bump dev to the next pre-release

```bash
node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json"));
  pkg.version = "2026.5.6-dev.55";   // ← next dev counter (was 54 before)
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
'
git add package.json
git commit -m "chore: bump dev to 2026.5.6-dev.55 after v2026.5.6.6 release"
git push origin dev
```

This is the convention established by commits `abb5aaec`, `ccf99b71`, `df3be469` — dev always carries a `-dev.N` suffix between releases so accidental builds off dev are visibly pre-release.

---

## Step 11 — Announce

- [ ] Post release notes wherever you usually post them (Slack, Linear, email, etc.)
- [ ] Update any pinned dashboard / docs that reference the previous version

---

## Common failures and recoveries

**`pnpm release:check` reports unexpected files in the npm pack.**
Inspect with `npm pack --dry-run` from the repo root. Most often this is local-build artifacts or app bundles that snuck into `dist/`. Fix the `files`/`.npmignore`/packaging step rather than editing the pack output.

**Installer smoke references a known-bad previous release.**
Set `ARGENTOS_INSTALL_SMOKE_PREVIOUS=<last-good-version>` or `ARGENTOS_INSTALL_SMOKE_SKIP_PREVIOUS=1`.

**Late fix after tagging.**
Do NOT `git push --force` the tag. Do NOT move the tag. Cut a new patch tag (e.g. `v2026.5.6.7`) with the fix and republish. The tag-immutability rule exists because Sparkle, npm, and `argent update` all cache tag-version-pairs; moving a tag silently desynchronises every install that already pulled the original.

**Hosted installer 404s or returns the old version after sync.**
`pnpm sync:hosted-installers:site` is the canonical push path — re-run it. If still stale, inspect the host directly (the sync script's `--help` will show the destination).

**`gh release create` rejects the title.**
The title must include `argent ` (lowercase) + version. Not `v…` and not just the version.

**You realize the version bump is wrong AFTER pushing the tag.**
Don't move the tag — see "Late fix after tagging" above. The wrong-version tag becomes a published artifact you can't retract; cut the next number with a CHANGELOG note explaining the skipped version.

---

## Operator notes

- This runbook produces an immutable release. Every irreversible step is gated by a **STOP** check; running them out of order or skipping gates is how releases get retracted.
- The `chore(release): vX.Y.Z — <theme> (#PR)` commit-message pattern is established by `6f108e42`, `da50…`, etc. — keep it.
- The `chore: bump dev to YYYY.M.D-dev.N after vX release` pattern is established by `abb5aaec`, `ccf99b71`, `df3be469` — keep it.
- The macOS Sparkle release is a strictly separable rail with its own runbook. Don't merge the two checklists; they have different gates.
- Two files are referenced by `RELEASING.md` that this runbook depends on:
  `scripts/release-check.ts`, `scripts/export-hosted-installers.ts`. Both exist; consult their headers for env vars and flags.

## See also

- [`docs/reference/RELEASING.md`](../../docs/reference/RELEASING.md) — flat checklist that this runbook orchestrates
- [`release-swift-mac.md`](./release-swift-mac.md) — macOS app rail
- [`docs/install/update-distribution.md`](../../docs/install/update-distribution.md) — how `argent update` discovers releases
- [`docs/install/partner-release-rc.md`](../../docs/install/partner-release-rc.md) — operator-side validation runbook
