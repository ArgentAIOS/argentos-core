# Release Runbook — macOS Sparkle app rail

Companion to [`docs/platforms/mac/release.md`](../../docs/platforms/mac/release.md). Walk this top to bottom; do not skip steps. Verification gates are marked **STOP** — do not proceed past a gate that didn't pass.

This runbook covers the **macOS Sparkle rail only**: building, signing, notarizing, and publishing the `ArgentOS.app` bundle plus its Sparkle appcast feed. For the npm / CLI rail, see [`release-core.md`](./release-core.md).

Run this AFTER the core release runbook reaches step 5 — the version number and CHANGELOG section come from there.

## When to use

- The core release runbook ([`release-core.md`](./release-core.md)) reached step 5 with substantive `apps/macos/` changes since the last `.app` shipped
- The Sparkle appcast needs to advertise a new build that an existing user's "Check for Updates…" should pull
- A new menu-bar `Argent.app` (manager) needs to ship to a second Mac

## Preconditions (must hold before step 1)

- [ ] On macOS — the build needs `xcodebuild`, `codesign`, `xcrun notarytool`, and Sparkle's `sign_update` tool
- [ ] Developer ID Application cert installed in the login keychain
- [ ] `SPARKLE_PRIVATE_KEY_FILE` env var points at the ed25519 private key (key lives in `~/.profile`; if missing check `~/Library/CloudStorage/Dropbox/Backup/Sparkle`)
- [ ] App Store Connect API key env vars exported: `APP_STORE_CONNECT_API_KEY_P8`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`
- [ ] `argent-notary` keychain profile exists (see [Notary setup](#notary-setup) below if not)
- [ ] `pnpm install --config.node-linker=hoisted` ran cleanly (Sparkle tools are fetched via SwiftPM at `apps/macos/.build/artifacts/sparkle/Sparkle/bin/`)
- [ ] You ran [`release-core.md`](./release-core.md) at least through step 4 (validation passed). The version number for this rail must match what core is shipping.

## Notary setup (one-time)

```bash
# Materialize the .p8 from the env var (escaped \n → real newlines)
echo "$APP_STORE_CONNECT_API_KEY_P8" | sed 's/\\n/\n/g' > /tmp/argent-notary.p8

# Create the keychain profile
xcrun notarytool store-credentials "argent-notary" \
  --key /tmp/argent-notary.p8 \
  --key-id "$APP_STORE_CONNECT_KEY_ID" \
  --issuer "$APP_STORE_CONNECT_ISSUER_ID"

# Wipe the temp key
rm /tmp/argent-notary.p8
```

If `notarytool` returns HTTP `403` with "A required agreement is missing or has expired" — **stop**. Fix the Apple Developer / App Store Connect agreement state for team `F2DH8T4BVH` before retrying. Signed-but-unstapled output is not release-complete.

---

## Step 1 — Build, sign, notarize the main app

Use `scripts/package-standalone-app.sh` (NOT `package-mac-app.sh` — that one is dev-only).

```bash
NOTARIZE=1 \
NOTARYTOOL_PROFILE=argent-notary \
BUNDLE_ID=bot.molt.mac \
APP_VERSION=2026.5.6.6 \
APP_BUILD="$(git rev-list --count HEAD)" \
BUILD_CONFIG=release \
SIGN_IDENTITY="Developer ID Application: Jason Brashear (F2DH8T4BVH)" \
scripts/package-standalone-app.sh
```

`APP_BUILD` MUST be numeric + monotonic and MUST NOT carry `-beta` or any non-numeric suffix — Sparkle compares this as an integer, and a non-numeric value silently compares as equal to the previous build (the new version will never roll out).

Default is the current arch (`uname -m`). For a universal binary, prepend `BUILD_ARCHS="arm64 x86_64"`.

**STOP** — verify:

- [ ] `ls dist/ArgentOS.app` exists and the bundle is signed: `codesign -dvv dist/ArgentOS.app 2>&1 | grep "Authority"`
- [ ] Notarization stapled: `xcrun stapler validate dist/ArgentOS.app` returns "The validate action worked"
- [ ] Gatekeeper accepts the bundle: `spctl --assess --verbose=4 dist/ArgentOS.app` returns "accepted"

---

## Step 2 — Zip for distribution

Sparkle delta updates require the zip to preserve resource forks via `ditto --sequesterRsrc`:

```bash
ditto -c -k --sequesterRsrc --keepParent dist/ArgentOS.app dist/ArgentOS-2026.5.6.6.zip

# Optional: DMG for humans
scripts/create-dmg.sh dist/ArgentOS.app dist/ArgentOS-2026.5.6.6.dmg

# Optional: dSYM for crash symbolication
ditto -c -k --keepParent apps/macos/.build/release/ArgentOS.app.dSYM dist/ArgentOS-2026.5.6.6.dSYM.zip
```

**STOP** — verify:

- [ ] `dist/ArgentOS-2026.5.6.6.zip` exists and is non-empty (`ls -la dist/ArgentOS-2026.5.6.6.zip` shows >100MB typically)
- [ ] If DMG built: `hdiutil verify dist/ArgentOS-2026.5.6.6.dmg` passes
- [ ] (Pre-publish gate) Drag the DMG to /Applications on a clean Mac and the first-launch flow works under Gatekeeper

---

## Step 3 — Generate and sign the appcast entry

The appcast is the XML feed that Sparkle polls. The release-note generator pulls HTML from `CHANGELOG.md` via `scripts/changelog-to-html.sh` and bakes it into the entry.

```bash
SPARKLE_PRIVATE_KEY_FILE=/path/to/ed25519-private-key \
scripts/make_appcast.sh \
  dist/ArgentOS-2026.5.6.6.zip \
  https://raw.githubusercontent.com/ArgentAIOS/argentos-core/main/appcast.xml
```

The script:

1. Runs `sign_update` against the zip with your Sparkle private key → produces an `ed25519` signature
2. Generates HTML release notes from the matching CHANGELOG section
3. Appends a new `<item>` entry to `appcast.xml` with: enclosure URL, signature, version, build number, and embedded release notes

**STOP** — verify:

- [ ] `appcast.xml` got a new `<item>` at the top with `<sparkle:version>` matching `APP_BUILD` and `<sparkle:shortVersionString>` matching `APP_VERSION`
- [ ] The `<enclosure>` `url` attribute points at the GitHub release URL the zip will be uploaded to (`https://github.com/ArgentAIOS/argentos-core/releases/download/v2026.5.6.6/ArgentOS-2026.5.6.6.zip`)
- [ ] The `<enclosure>` `sparkle:edSignature` attribute is present and non-empty
- [ ] HTML notes inside `<description><![CDATA[…]]></description>` render the new section's Highlights + Changes

---

## Step 4 — Optional: menu-bar manager app

If this release also ships a new `Argent.app` (menu bar manager for second-Mac installs), use the wrapper. This is a separable artifact; skip if you're only shipping the main app.

```bash
SIGN_IDENTITY="Developer ID Application: Jason Brashear (F2DH8T4BVH)" \
NOTARYTOOL_PROFILE="ArgentOS" \
APP_VERSION="2026.5.6.6" \
APP_BUILD="$(git rev-list --count HEAD)" \
scripts/release-argent-manager.sh
```

The wrapper does:

1. `scripts/package-argentos.sh` in release mode
2. Developer ID signing
3. Notarization + stapling (using `NOTARYTOOL_PROFILE`, default `ArgentOS`)
4. Final signature + notary verification
5. SHA256 + release manifest in `dist/`

Artifacts:

- `dist/Argent-2026.5.6.6.dmg`
- `dist/Argent-2026.5.6.6.SHA256`
- `dist/Argent-2026.5.6.6-release.txt`

---

## Step 5 — Hand off to core release runbook

At this point you have:

- `dist/ArgentOS-2026.5.6.6.zip` (mandatory — main Sparkle artifact)
- `dist/ArgentOS-2026.5.6.6.dSYM.zip` (optional — crash symbolication)
- `dist/ArgentOS-2026.5.6.6.dmg` (optional — human drag-install)
- `dist/Argent-2026.5.6.6.dmg` (optional — menu-bar manager)
- Updated `appcast.xml` staged for commit

Return to [`release-core.md`](./release-core.md) **step 6** (commit + tag) and:

- Stage `appcast.xml` alongside the chore(release) commit so the Sparkle feed updates atomically with the tag
- Attach the `.zip`, `.dSYM.zip`, and any `.dmg` artifacts to the GitHub release in step 8

**STOP** — do not push the tag until:

- [ ] All Sparkle artifacts are built and validated
- [ ] `appcast.xml` is committed and pushed alongside the version bump
- [ ] You have a clean rollback plan if Sparkle's signed feed turns out to mismatch the uploaded zip (the only fix is to cut a new tag — appcast entries are immutable once Sparkle clients have seen them)

---

## Step 6 — Publish and verify (after core step 8 attached the artifacts)

These checks live here, not in core, because they validate the Sparkle feed end-to-end:

```bash
# 6a. Appcast served correctly
curl -I https://raw.githubusercontent.com/ArgentAIOS/argentos-core/main/appcast.xml
# Expected: HTTP 200, content-type XML

# 6b. Enclosure URL serves the zip
curl -I https://github.com/ArgentAIOS/argentos-core/releases/download/v2026.5.6.6/ArgentOS-2026.5.6.6.zip
# Expected: HTTP 200 or 302 to S3, content-length matches your local zip

# 6c. Sparkle signature verifies against the published zip
sign_update --verify dist/ArgentOS-2026.5.6.6.zip <ed25519-public-key-or-pubkey-fingerprint>
# Expected: signature OK
```

**Live verification (the only one that proves the rollout works):**

- [ ] Take a Mac running the IMMEDIATELY PREVIOUS public build
- [ ] Use **About → Check for Updates…** from inside that build
- [ ] Sparkle should see the new appcast, download the new zip, and install cleanly
- [ ] First launch of the upgraded app should NOT prompt Gatekeeper warnings

Definition of done:

- Signed + notarized + stapled `.app` published as a GitHub release asset
- Signed appcast entry committed to `main` and live at `raw.githubusercontent.com/.../appcast.xml`
- Update flow verified end-to-end from an older installed version
- All assets attached to the GitHub release for `v2026.5.6.6`

---

## Common failures and recoveries

**`xcrun notarytool` returns HTTP 403 / "agreement missing".**
Apple Developer / App Store Connect agreement state for team `F2DH8T4BVH` needs renewal. Sign in to App Store Connect, accept the new agreements, retry. Do NOT publish until notarization completes — Gatekeeper rejection in the wild is more damaging than a delayed release.

**Sparkle never offers the update even though the appcast is live.**
99% of the time this is a non-monotonic / non-numeric `APP_BUILD`. Sparkle compares `<sparkle:version>` (which is the `APP_BUILD`, NOT the human-readable version) as an integer. If your previous release had `APP_BUILD=12345` and you ship `APP_BUILD="2026-05-25"`, Sparkle reads them as `12345` vs `0` and refuses to upgrade. Fix: rebuild with a numeric monotonic `APP_BUILD` (e.g. `git rev-list --count HEAD`).

**Signature OK locally but fails for end users.**
Almost always means the zip was re-built without `ditto --sequesterRsrc`. Sparkle's delta-update format requires resource forks; a `zip -r` doesn't preserve them. Re-zip with the documented ditto flags and re-sign the appcast entry.

**Notarization succeeds but Gatekeeper still warns on first launch.**
The bundle wasn't stapled. Run `xcrun stapler staple dist/ArgentOS.app` and re-zip. Sparkle delta-update users will hit this until staple is committed.

**The release zip on GitHub doesn't match the appcast signature.**
The signature was generated against a different binary than what got uploaded. There is NO fix for the published `v2026.5.6.6` — cut `v2026.5.6.7` with consistent artifacts and add a CHANGELOG note. The `v2026.5.6.6` appcast entry can be removed from the XML to stop Sparkle from offering the broken upgrade, but any user who already pulled the appcast will keep retrying until you push the corrected XML.

---

## Operator notes

- The `apps/macos/` rail is strictly optional. ~80% of `argent` releases skip this runbook entirely because nothing in `apps/macos/` changed since the last `.app` shipped. Only run it when there's a real macOS surface change.
- `APP_VERSION` is human-readable ("2026.5.6.6"). `APP_BUILD` is what Sparkle actually compares — keep it numeric and monotonic forever. `git rev-list --count HEAD` is the canonical source.
- The Sparkle private key MUST stay private. If it leaks, every previously published appcast entry becomes spoofable. Rotation is invasive (every old install would need to manually re-trust); treat the key like a deploy credential.
- Two distinct apps live in `apps/macos/`: the main `ArgentOS.app` (default rail above) and `Argent.app` the menu-bar manager (step 4). They use different `BUNDLE_ID`s and different Sparkle feeds — don't cross the streams.

## See also

- [`docs/platforms/mac/release.md`](../../docs/platforms/mac/release.md) — flat checklist that this runbook orchestrates
- [`release-core.md`](./release-core.md) — npm/CLI rail; this runbook plugs into its step 5
- `apps/macos/Sources/` — the actual macOS app sources
- `appcast.xml` — the live Sparkle feed (at repo root)
- `scripts/make_appcast.sh`, `scripts/changelog-to-html.sh`, `scripts/package-standalone-app.sh`, `scripts/release-argent-manager.sh` — the scripts referenced above
