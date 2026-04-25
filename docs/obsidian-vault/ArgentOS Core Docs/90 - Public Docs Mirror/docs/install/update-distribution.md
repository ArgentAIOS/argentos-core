# ArgentOS Update Distribution (Private Repo + Desktop App)

This document explains how ArgentOS updates work today, what each updater can
and cannot update, and how to stage artifacts when the source repo is private.

## Update Rails

ArgentOS has two separate update rails:

1. Runtime/Gateway rail (Node/TS):

- Triggered by `argent update` or Gateway RPC `update.run` (Dashboard "Update & Restart Gateway").
- Updates CLI/runtime code used by gateway, dashboard API, and control services.
- Does **not** update the native macOS app bundle in `/Applications/Argent.app`.
- During install/bootstrap, the shell installer may install `/Applications/Argent.app` from the public macOS release manifest when no embedded app bundle is present.

2. Native macOS app rail (Swift + Sparkle):

- Triggered by Sparkle ("Check for Updates") inside the app.
- Updates `/Applications/Argent.app` itself.
- Does **not** replace runtime tarballs or package-manager installs directly.

## Runtime Updater Behavior

`runGatewayUpdate` supports two install modes:

1. Git/source install:

- Detects repo root and performs source update flow (fetch/rebase/build/doctor).
- `update.run` restart is now only scheduled when update status is `ok`.
- On failure, gateway stays on current running version and reports failure.

2. Global package-manager install:

- Detects npm/pnpm/bun global install and runs manager-specific upgrade.
- Uses package tags/channels for stable/beta/dev behavior.

If no supported install root is detected, updater returns a skipped/error result.

## Dashboard RPC Path

Gateway tab now exposes "Update & Restart Gateway" and calls RPC `update.run`
with extended timeout so long updates do not fail at 60s.

Result semantics:

- `ok=true` + `result.status=ok`: update applied, restart scheduled.
- `ok=false` + `result.status=error`: update failed, restart not scheduled.

## Swift App Auto-Update (Sparkle)

The macOS app uses Sparkle in release-signed builds. Packaging injects:

- `SUFeedURL`
- `SUPublicEDKey`
- `SUEnableAutomaticChecks`

into app `Info.plist` during `scripts/package-mac-app.sh`.

For Sparkle to work in production, you must host:

1. `appcast.xml`
2. Signed update archive(s) referenced by appcast
3. Over HTTPS at a URL reachable by client Macs

Helper scripts:

- `scripts/make_appcast.sh`
- `scripts/release-argent-manager.sh`
- `scripts/notarize-mac-artifact.sh`

Repository note:

- `appcast.xml` in the repo should be treated as the source file that ultimately feeds the product's canonical Sparkle URL.
- If the public release feed is served directly from GitHub, use `https://raw.githubusercontent.com/ArgentAIOS/argentos-core/main/appcast.xml` as the public `appcast.xml` URL.
- If the source repo or release pipeline is private, do **not** treat the raw GitHub URL as canonical; publish the generated `appcast.xml` to a separate public release endpoint instead, and point `SUFeedURL` there.
- Keep the checked-in `appcast.xml` file as either the latest generated ArgentOS appcast or a neutral placeholder that points operators to the intended public feed endpoint.
- Any inherited or upstream feed entries inside `appcast.xml` must be removed or replaced with the intended ArgentOS public feed URL, or clients can silently follow the wrong product feed.

## Private Repo Constraints

If `ArgentAIOS/argentos` stays private:

1. Runtime git-mode updates:

- Every target Mac must have git credentials that can pull the private repo.
- `update.run` in git mode depends on that access.

2. Sparkle app updates:

- Sparkle cannot rely on private raw GitHub URLs without auth plumbing.
- The public-facing Sparkle feed may still be generated from `ArgentAIOS/argentos-core`, but clients must consume it from a public release endpoint if the source repo is not public.
- Treat Sparkle feed as a separate release artifact endpoint.

## Recommended Staging Model

Use a dedicated release origin (public-read or org-network reachable), not the
private git source URL, for update artifacts.

Recommended layout:

- Runtime artifacts:
  - `/runtime/stable/argent-<version>-darwin-arm64.tar.gz`
  - `/runtime/beta/...`
- Sparkle feed:
  - `/sparkle/stable/appcast.xml`
  - `/sparkle/stable/Argent-<version>.zip` (or dmg/pkg as referenced)
- Optional DMG/manual install:
  - `/desktop/Argent-<version>.dmg`

Good hosts:

- Cloudflare R2 + custom domain
- S3 + CloudFront
- GitHub Releases (public assets) if acceptable

## What Updates What

1. Dashboard `update.run`:

- Updates runtime/gateway stack.
- Does not replace `/Applications/Argent.app`.

2. Sparkle update:

- Updates macOS app bundle.
- Does not run full runtime migration scripts by itself.

3. USB/full installer:

- Fresh machine bootstrap for runtime + services + optional app install.
- Should be used for first install and disaster recovery.

## Operational Guidance

1. Keep runtime and app releases versioned together (same semantic version).
2. Publish runtime tarball and Sparkle appcast in same release pipeline.
3. Point `SUFeedURL` to release endpoint, not private git raw URL.
4. Use `argent doctor` after runtime updates to verify service and migrations.
