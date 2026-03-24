#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Skipping macOS artifact smoke test on non-macOS host."
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/argent-install-hosted-macos-artifact.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

FAKE_APP="$TMP_ROOT/stage/Argent.app"
FAKE_RUNTIME="$FAKE_APP/Contents/Resources/argent-runtime"
FAKE_NODE="$FAKE_RUNTIME/bin/node"
FAKE_ENTRY="$FAKE_RUNTIME/argent.mjs"
ZIP_PATH="$TMP_ROOT/Argent-test.zip"
MANIFEST_PATH="$TMP_ROOT/latest.json"
INSTALL_TARGET="$TMP_ROOT/Applications/Argent.app"
BIN_DIR="$TMP_ROOT/bin"

mkdir -p "$FAKE_RUNTIME/bin"
cat > "$FAKE_NODE" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$FAKE_NODE"
cat > "$FAKE_ENTRY" <<'EOF'
console.log("argent stub");
EOF

ditto -c -k --keepParent "$FAKE_APP" "$ZIP_PATH"
ZIP_SHA="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"

cat > "$MANIFEST_PATH" <<EOF
{
  "manifestVersion": 1,
  "channel": "stable",
  "generatedAt": "2026-03-24T00:00:00Z",
  "version": "test",
  "macos": {
    "appName": "Argent.app",
    "bundleId": "ai.argent.mac",
    "installTarget": "/Applications/Argent.app",
    "artifacts": {
      "zip": {
        "filename": "Argent-test.zip",
        "sha256": "$ZIP_SHA",
        "sizeBytes": $(stat -f '%z' "$ZIP_PATH"),
        "url": "file://$ZIP_PATH"
      }
    }
  }
}
EOF

(
  cd "$ROOT_DIR"
  ARGENTOS_MACOS_RELEASE_MANIFEST_URL="file://$MANIFEST_PATH" \
  ARGENTOS_MACOS_APP_TARGET="$INSTALL_TARGET" \
  ARGENT_INSTALL_BIN_DIR="$BIN_DIR" \
  ARGENT_NO_ONBOARD=1 \
  ARGENTOS_NO_PROMPT=1 \
  ARGENT_NODE_BIN="$(command -v node)" \
  bash ./scripts/install-hosted.sh --no-onboard --no-prompt
)

test -d "$INSTALL_TARGET"
test -x "$BIN_DIR/argent"
grep -q "Argent.app/Contents/Resources/argent-runtime/bin/node" "$BIN_DIR/argent"

echo "OK"
