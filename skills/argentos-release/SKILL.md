---
name: argentos-release
description: End-to-end release workflow for ArgentOS. Covers PR creation, CodeRabbit review, Blacksmith CI, merge process, macOS app build/sign/notarize/publish, installer sync, and post-release verification. Use when shipping a release, creating PRs, handling review feedback, building the macOS app, publishing to R2, or when anyone mentions "release", "ship", "PR", "CodeRabbit", "notarize", "publish app", or "version bump".
---

# ArgentOS Release Workflow

The complete, repeatable process for shipping changes from development to production.

## 1. Version Bump

Before any release, bump the version to today's date format:

**Files to update:**

```
apps/macos/Sources/Argent/Resources/Info.plist
  → CFBundleShortVersionString: "2026.3.25"
  → CFBundleVersion: "20260325"

package.json
  → "version": "2026.3.25"
```

Format: `YYYY.M.D` (no leading zeros on month/day).

## 2. Create a PR

```bash
# Branch from main
git checkout -b feat/my-feature main

# Make changes, commit
git add . && git commit -m "feat: description of change"

# Push and create PR
git push origin feat/my-feature
gh pr create --title "feat: description" --base main
```

**For argentos-core:** PRs are required (branch protection). Direct push blocked.
**For other repos:** Direct push to main is OK for urgent fixes.

Document the PR in Linear before creating it.

## 3. CodeRabbit Review

Every PR gets automated CodeRabbit review. It runs automatically on push.

```bash
# Run locally before pushing (optional, catches issues early)
pnpm review:coderabbit

# Prompt-only for CI handoff
pnpm review:coderabbit:prompt
```

### Handling CodeRabbit Findings

| Severity                             | Action                                      |
| ------------------------------------ | ------------------------------------------- |
| **Critical** (security, data loss)   | Must fix before merge. No exceptions.       |
| **Warning** (code quality, patterns) | Fix if reasonable. Comment why if skipping. |
| **Suggestion** (style, naming)       | Apply or ignore at discretion.              |

**If CodeRabbit flags something you disagree with:**

1. Reply to the CodeRabbit comment explaining why
2. If it's a false positive, mark as resolved
3. Do NOT disable CodeRabbit or skip review

### After CodeRabbit Passes

Human review is still required for argentos-core. CodeRabbit passing is necessary but not sufficient.

## 4. Blacksmith CI

Blacksmith runners execute CI for argentos-core. Track status in Linear for release work.

**If CI fails on Blacksmith but passes locally:**

- Check runner environment (OS, Node version, native modules)
- Check for nondeterministic test failures
- Re-run the job before investigating deeply

## 5. Merge

**argentos-core:** Squash merge via GitHub PR UI after CodeRabbit + human review.
**Other repos:** Merge commit or direct push.

After merge:

1. Update Linear issue to Done
2. If installer changed → sync to website (see step 8)
3. If Swift app changed → run macOS artifact pipeline (see step 6)
4. If website/marketplace/docs changed → Railway auto-deploys

## 6. macOS App Artifact Pipeline

Run this whenever the Swift app changes or for a new release:

### Build

```bash
cd /Users/sem/code/argentos

# Clean Swift caches
rm -rf apps/macos/.build apps/macos/.build-swift apps/macos/.swiftpm apps/argent-audio-capture/.build

# Build signed release
APP_VERSION=2026.3.25 \
SKIP_TSC=1 \
SKIP_UI_BUILD=1 \
BUILD_CONFIG=release \
SIGN_IDENTITY='Developer ID Application: Jason Brashear (F2DH8T4BVH)' \
./scripts/package-mac-app.sh
```

Output: `dist/Argent.app`

### Zip

```bash
ditto -c -k --sequesterRsrc --keepParent dist/Argent.app dist/Argent-2026.3.25.zip
```

### Notarize

```bash
NOTARYTOOL_PROFILE=ArgentOS \
STAPLE_APP_PATH=/Users/sem/code/argentos/dist/Argent.app \
./scripts/notarize-mac-artifact.sh dist/Argent-2026.3.25.zip
```

Uses stored keychain profile `ArgentOS` (team F2DH8T4BVH, jbrashear72@icloud.com).

### Re-zip after stapling

```bash
rm dist/Argent-2026.3.25.zip
ditto -c -k --sequesterRsrc --keepParent dist/Argent.app dist/Argent-2026.3.25.zip
shasum -a 256 dist/Argent-2026.3.25.zip
```

### Upload to R2

Upload three files:

- `releases/macos/<version>/Argent-<version>.zip` — the signed, notarized app
- `releases/macos/<version>.json` — version manifest with SHA256
- `releases/macos/latest.json` — same manifest, overwrites previous latest

R2 bucket: `argentos-licensing-marketplace`

R2 credentials:

```
R2_ACCOUNT_ID=5a845e69fbed4f4e64e2176d86637680
R2_ACCESS_KEY_ID=(from .env)
R2_SECRET_ACCESS_KEY=(from .env)
```

### Verify

```bash
# Check manifest
curl -fsSL https://argentos-licensing-marketplace.*.r2.cloudflarestorage.com/releases/macos/latest.json

# Check zip is downloadable
curl -I https://argentos-licensing-marketplace.*.r2.cloudflarestorage.com/releases/macos/2026.3.25/Argent-2026.3.25.zip
```

## 7. Swift App Change Checklist

When the macOS Swift app itself changes (not just the JS runtime):

- [ ] Version bump in Info.plist + package.json
- [ ] Clean Swift caches before building
- [ ] Build with `BUILD_CONFIG=release` and signing identity
- [ ] Test the app opens and connects to running gateway
- [ ] Notarize with Apple
- [ ] Re-zip after stapling
- [ ] Upload to R2
- [ ] Verify latest.json updated
- [ ] Test installer downloads the new version

## 8. Installer Sync

When install-hosted.sh changes in argentos:

```
argentos/scripts/install-hosted.sh     ← source of truth
  ↓
argentos.ai/scripts/install.sh         ← Claude syncs
argentos.ai/public/install.sh          ← Claude syncs
  ↓
https://argentos.ai/install.sh         ← Railway deploys
```

Both website copies must be byte-for-byte identical.

```bash
# Verify live
curl -fsSL https://argentos.ai/install.sh | head -5
```

## 9. Post-Release Verification

- [ ] `curl -fsSL https://argentos.ai/install.sh | bash --dry-run` shows correct flow
- [ ] Marketplace at marketplace.argentos.ai loads with all packages
- [ ] Docs at docs.argentos.ai loads
- [ ] Main site at argentos.ai shows correct version/hero
- [ ] `argent health` on dev machine shows green
- [ ] Linear issues updated to Done
- [ ] Discord announcement if user-facing changes

## Quick Reference

| What Changed            | What To Do                                         |
| ----------------------- | -------------------------------------------------- |
| Runtime/gateway code    | PR → CodeRabbit → merge → verify gateway health    |
| Swift app               | PR → merge → build → sign → notarize → R2 → verify |
| Installer script        | PR → merge → sync to website → verify live URL     |
| Website/marketplace     | Push → Railway auto-deploys → verify               |
| Docs                    | Push → Railway auto-deploys → verify               |
| New marketplace package | Submit → VT scan → admin review → approve          |
