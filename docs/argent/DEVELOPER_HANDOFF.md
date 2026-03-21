# ArgentOS Developer Handoff

> Last updated: 2026-02-15

This document covers the recent work done on the main branch to migrate from ArgentOS to ArgentOS, create a consumer-grade macOS installer, and get the `argent` CLI working from source.

---

## 1. ArgentOS Removal

The repo was forked from ArgentOS. Running `pnpm install` was pulling in `argent@2026.2.12` from npm (696 packages) because two extensions declared it as a peer dependency.

**What was done:**

- Removed `"argent": ">=2026.1.26"` peer dependency from:
  - `extensions/googlechat/package.json`
  - `extensions/memory-core/package.json`
- Regenerated `pnpm-lock.yaml` (dropped 13 packages)
- Removed orphaned `.pnpm/argent@2026.2.12` directory
- Uninstalled the global `argent` npm package (`npm uninstall -g argent`)
- Added `tweetnacl@^1.0.3` as a direct dependency — it was previously a transitive dep of the `argent` npm package, but `src/gateway/relay-client.ts` and `src/gateway/gateway-keys.ts` import it directly

**Note:** Many extensions still have `"argent": { ... }` metadata blocks in their `package.json` files. These are plugin config sections (channel IDs, install paths), **not** npm dependency declarations. They can be renamed to `"argentos"` as part of a broader rename effort.

---

## 2. CLI Binary (`argent` command)

The `argent` command was not available in the terminal after cloning the repo. The `package.json` defines `"bin": { "argent": "argent.mjs", "argentos": "argent.mjs" }` but that only works for global npm installs. For local dev from a git checkout, the install script creates a wrapper.

**What was done:**

- Fixed `scripts/install-argent.sh` to handle git checkouts (no bundled `bin/node`):
  - Detects whether `$ARGENT_HOME/bin/node` exists (tarball) or not (git checkout)
  - Falls back to system Node from nvm/PATH
  - All `$ARGENT_HOME/bin/node` references throughout the script now use `$NODE_BIN`
- Fixed the default config template to remove invalid `"workspace"` key
- Renamed env vars and log prefix in `scripts/run-node.mjs`:
  - `ARGENTOS_FORCE_BUILD` -> `ARGENT_FORCE_BUILD`
  - `ARGENTOS_RUNNER_LOG` -> `ARGENT_RUNNER_LOG`
  - Log prefix `[argent]` -> `[argent]`
  - Entry point `argent.mjs` -> `argent.mjs`

**How to set up the CLI for local dev:**

```bash
# Option 1: Use pnpm scripts (no install needed)
pnpm argent --version

# Option 2: Run the installer (creates ~/bin/argent wrapper)
scripts/install-argent.sh
# Then in a new terminal:
argent --version
```

The wrapper lives at `~/bin/argent` and looks like:

```bash
#!/bin/bash
ARGENT_HOME="/Users/sem/argentos"
export PATH="/path/to/node/dir:$PATH"
cd "$ARGENT_HOME"
exec "/path/to/node" argent.mjs "$@"
```

---

## 3. macOS Consumer Installer (DMG)

The goal: **download DMG, drag to Applications, double-click, done** — zero terminal commands for end users.

### Architecture

```
ArgentOS.dmg (580MB compressed)
  └── ArgentOS.app
        ├── Contents/MacOS/ArgentManager        <- Swift menu bar app
        ├── Contents/Resources/AppIcon.icns     <- ArgentOS purple logo
        └── Contents/Resources/argent-runtime/  <- Self-contained runtime
              ├── bin/node                       <- Node.js 22.22.0
              ├── dist/                          <- Compiled CLI
              ├── dashboard/                     <- Dashboard (if built)
              ├── argent.mjs                     <- Entry point
              ├── package.json
              └── node_modules/                  <- Production deps only
```

### First-Launch Flow

When a user opens ArgentOS.app for the first time:

1. Swift app detects no `~/.argentos/agents/main/agent/auth-profiles.json`
2. Shows "Welcome to ArgentOS" setup wizard with API key input
3. Copies bundled runtime from `.app/Contents/Resources/argent-runtime/` to `~/.argentos/runtime/`
4. Runs `argent onboard --non-interactive --accept-risk --anthropic-api-key <key>`
5. Runs `argent daemon install` (creates Gateway LaunchAgent)
6. Runs `argent cs install` (channel services)
7. Registers as login item (survives reboot)
8. Menu bar icon appears with service controls

### How to Build

```bash
# Full build (compiles Swift + TypeScript, bundles Node, creates DMG):
ARGENT_A2UI_SKIP_MISSING=1 scripts/package-argentos.sh

# Quick rebuild (skip TS build, reuse existing dist/):
SKIP_BUILD=1 SKIP_UI_BUILD=1 SKIP_SIGN=1 ARGENT_A2UI_SKIP_MISSING=1 scripts/package-argentos.sh

# Skip DMG (just build the .app):
SKIP_DMG=1 SKIP_SIGN=1 ARGENT_A2UI_SKIP_MISSING=1 scripts/package-argentos.sh
```

**Environment variables:**

| Variable                   | Default             | Purpose                                                    |
| -------------------------- | ------------------- | ---------------------------------------------------------- |
| `SKIP_BUILD`               | `0`                 | Skip `pnpm build` (use existing dist/)                     |
| `SKIP_UI_BUILD`            | `0`                 | Skip dashboard build                                       |
| `SKIP_SIGN`                | `0`                 | Skip code signing                                          |
| `SKIP_DMG`                 | `0`                 | Skip DMG creation                                          |
| `SKIP_NOTARIZE`            | `1`                 | Skip Apple notarization                                    |
| `ARGENT_A2UI_SKIP_MISSING` | -                   | Set to `1` to skip A2UI canvas bundle (currently required) |
| `SIGN_IDENTITY`            | auto-detect         | Code signing certificate identity                          |
| `BUNDLE_ID`                | `ai.argent.manager` | App bundle identifier                                      |
| `BUILD_CONFIG`             | `release`           | `debug` or `release`                                       |

**Output:**

- `dist/ArgentOS.app` — the app bundle
- `dist/ArgentOS-{version}.dmg` — the installer DMG (if SKIP_DMG!=1)

### Build Pipeline Scripts

| Script                             | Purpose                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `scripts/package-argentos.sh`      | Main orchestrator — builds Swift app, bundles runtime, assembles .app, signs, creates DMG |
| `scripts/bundle-runtime.sh`        | Downloads Node.js, builds CLI + dashboard, creates self-contained runtime directory       |
| `scripts/create-dmg.sh`            | Creates styled DMG with drag-to-Applications UX and background image                      |
| `scripts/codesign-mac-app.sh`      | Deep code signing (standalone, also usable for ArgentOS.app)                              |
| `scripts/notarize-mac-artifact.sh` | Apple notarization via `xcrun notarytool`                                                 |

### Known Issues

1. **A2UI canvas bundle missing**: `pnpm build` fails at the `canvas-a2ui-copy.ts` step. Set `ARGENT_A2UI_SKIP_MISSING=1` to work around this. The A2UI feature is not required for core functionality.

2. **Dashboard TypeScript errors**: The dashboard (`dashboard/`) has ~20 pre-existing TS errors that prevent `tsc -b` from succeeding. Use `SKIP_UI_BUILD=1` to skip. The dashboard can still be served from a pre-built state.

3. **App size**: The .app is ~1.4GB uncompressed (580MB in DMG) due to the bundled Node.js runtime and full `node_modules`. This is normal for a self-contained app.

4. **Ad-hoc signing**: Without a Developer ID certificate, the app is ad-hoc signed. macOS Gatekeeper will warn users. For distribution, use a proper signing identity and notarize.

---

## 4. Swift Menu Bar App (`apps/argent-manager/`)

A lightweight native SwiftUI menu bar app. **Already fully ArgentOS-branded** — no ArgentOS references.

### Source Files

| File                     | Purpose                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `ArgentManagerApp.swift` | App entry point, menu bar registration, first-run detection                           |
| `MenuContentView.swift`  | Menu bar dropdown UI — service status, start/stop, Open Dashboard, Documentation link |
| `SetupView.swift`        | First-launch wizard — API key input, runtime copy, onboard, daemon install            |
| `ServiceManager.swift`   | Service lifecycle — start/stop Gateway, Dashboard UI, Dashboard API via launchctl     |
| `ServiceStatus.swift`    | Health checks — HTTP pings + launchctl fallback                                       |

### Recent Changes

- Setup wizard now shows the ArgentOS logo (from AppIcon.icns) instead of a generic SF Symbol
- Logo displayed with rounded black background for contrast
- Added "Documentation" link (book icon) in menu dropdown -> https://docs.argentos.ai
- Added "Docs" link in the about/info section alongside argentos.ai

---

## 5. Packaging Script Changes (ArgentOS -> ArgentOS)

These shared scripts were updated to work with both ArgentOS and ArgentOS app bundles:

### `scripts/create-dmg.sh`

- Fallback app name: `"ArgentOS"` -> `"ArgentOS"`
- Temp dir prefix: `/tmp/argent-dmg.*` -> `/tmp/argent-dmg.*`
- Volume icon: now checks `DMG_VOLUME_ICON` env -> `assets/argent-icon.icns` -> falls back to legacy ArgentOS icon
- Temp limits file: `argent-dmg-limits` -> `argent-dmg-limits`

### `scripts/codesign-mac-app.sh`

- Default app path: `dist/ArgentOS.app` -> `dist/ArgentOS.app`
- Temp file prefixes: `argent-entitlements-*` -> `argent-entitlements-*`
- Main binary signing: reads `CFBundleExecutable` from Info.plist dynamically (works for both ArgentOS and ArgentManager binaries)

### `scripts/bundle-runtime.sh`

- **Critical fix**: Reordered steps so `pnpm build` (which cleans `dist/`) runs **before** creating the output directory and downloading Node. Previously, tsdown would wipe `dist/argent-runtime/bin/node` during the build step.

### `scripts/notarize-mac-artifact.sh`

- Updated usage example comment from `dist/ArgentOS.app` to `dist/ArgentOS.app`

---

## 6. App Icon

- `assets/argent-icon.icns` — Generated from the ArgentOS website logo (`argentos.ai` repo at `public/img/Argent_OS_ICON.png`)
- Source is 687x687 purple "AOS" logo on black background
- Converted to .icns with all required macOS icon sizes (16-1024px)
- The website repo was cloned to `/Users/sem/argentos.ai` — the `Argent_OS_ICON.png` source lives there
- For a higher quality icon, provide a 1024x1024 or larger source PNG

---

## 7. For Release Distribution

To create a notarized DMG for public distribution:

```bash
# Requires Apple Developer ID certificate
SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
SKIP_NOTARIZE=0 \
ARGENT_A2UI_SKIP_MISSING=1 \
scripts/package-argentos.sh
```

This will:

1. Build the .app with proper code signing
2. Create the DMG
3. Sign and notarize the DMG via Apple
4. Output a Gatekeeper-clean `dist/ArgentOS-{version}.dmg`

---

## 8. File Inventory

### New Files

- `assets/argent-icon.icns` — macOS app icon
- `docs/argent/DEVELOPER_HANDOFF.md` — this document

### Modified Files

- `package.json` — added `tweetnacl` dependency
- `pnpm-lock.yaml` — regenerated (argent removed, tweetnacl added)
- `extensions/googlechat/package.json` — removed argent peer dep
- `extensions/memory-core/package.json` — removed argent peer dep
- `scripts/install-argent.sh` — git checkout support, dynamic Node detection
- `scripts/run-node.mjs` — argent -> argent rename
- `scripts/bundle-runtime.sh` — build step reorder fix
- `scripts/create-dmg.sh` — argent -> argent rename
- `scripts/codesign-mac-app.sh` — dynamic binary detection, argent defaults
- `scripts/notarize-mac-artifact.sh` — comment update
- `apps/argent-manager/Sources/ArgentManager/SetupView.swift` — logo, rounded bg
- `apps/argent-manager/Sources/ArgentManager/MenuContentView.swift` — docs link
