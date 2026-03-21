# New Mac USB Installer (ArgentOS)

## What already existed (notes found)

- Runtime release tarball builder: `scripts/make-release.sh`
- Runtime installer in tarball: `install.sh`
- macOS app/DMG packager: `scripts/package-standalone-app.sh`
- Migration guide for state/workspace transfer: `docs/install/migrating.md`

## New one-command USB kit builder

- Script: `scripts/make-mac-usb-installer.sh`
- Output: `dist/usb-installer/ArgentOS-USB-<version>-<timestamp>/`

Kit contents:

- `INSTALL_ON_NEW_MAC.sh` (entrypoint on target Mac)
- `README.txt`
- `CHECKSUMS.txt`
- `assets/argent-<version>-darwin-<arch>.tar.gz` (required)
- `assets/ArgentOS-<version>.dmg` (optional, if available)

## Build the kit (on source machine)

```bash
cd /Users/sem/code/argentos
scripts/make-mac-usb-installer.sh
```

Optional DMG inclusion strategies:

```bash
# Build DMG as part of kit generation (slower)
BUILD_DMG=1 scripts/make-mac-usb-installer.sh

# Reuse existing dist/ArgentOS-<version>.dmg if already built (default behavior)
INCLUDE_EXISTING_DMG=1 scripts/make-mac-usb-installer.sh
```

## Test on a fresh Mac (from USB)

1. Copy/open the generated kit folder from USB.
2. Run:

```bash
cd <kit-folder>
chmod +x ./INSTALL_ON_NEW_MAC.sh
./INSTALL_ON_NEW_MAC.sh
```

3. Verify:

```bash
argent --help
argent gateway status
open http://localhost:9242
```

## If you are migrating existing identity/state

After install on the new Mac:

1. Restore your state dir/workspace (typically `~/.argentos` and workspace files).
2. Run:

```bash
argent doctor
argent gateway restart
```

See full migration procedure: `docs/install/migrating.md`.

## Notes

- The USB installer path is macOS-only.
- The tarball install path does not require internet for Node/CLI runtime because it is bundled.
- If DMG is included, `INSTALL_ON_NEW_MAC.sh` opens it and you can drag `ArgentOS.app` to `/Applications`.
