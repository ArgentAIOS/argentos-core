#!/usr/bin/env bash
set -euo pipefail

# Ensure all macOS packaging icon assets are synced from the canonical source.
# This prevents stale/legacy artwork from being shipped when local resources drift.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_ICNS="$ROOT_DIR/assets/argent-icon.icns"
TARGET_ICNS="$ROOT_DIR/apps/macos/Sources/Argent/Resources/Argent.icns"
TARGET_PNG="$ROOT_DIR/apps/macos/Icon.icon/Assets/argent-mac.png"

if [[ ! -f "$SOURCE_ICNS" ]]; then
  echo "ERROR: Canonical icon missing: $SOURCE_ICNS" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_ICNS")"
mkdir -p "$(dirname "$TARGET_PNG")"

if ! cmp -s "$SOURCE_ICNS" "$TARGET_ICNS"; then
  cp "$SOURCE_ICNS" "$TARGET_ICNS"
  echo "synced: $TARGET_ICNS"
else
  echo "ok: $TARGET_ICNS already current"
fi

if command -v sips >/dev/null 2>&1; then
  TMP_PNG="$(mktemp /tmp/argent-icon-sync.XXXXXX.png)"
  sips -s format png "$SOURCE_ICNS" --out "$TMP_PNG" >/dev/null
  if [[ ! -f "$TARGET_PNG" ]] || ! cmp -s "$TMP_PNG" "$TARGET_PNG"; then
    mv "$TMP_PNG" "$TARGET_PNG"
    echo "synced: $TARGET_PNG"
  else
    rm -f "$TMP_PNG"
    echo "ok: $TARGET_PNG already current"
  fi
else
  echo "WARN: sips unavailable; skipped PNG sync for $TARGET_PNG" >&2
fi
