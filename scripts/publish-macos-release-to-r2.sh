#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="${DIST_DIR:-$ROOT_DIR/dist}"
CHANNEL="${ARGENTOS_INSTALL_CHANNEL:-stable}"
VERSION="${APP_VERSION:-$(cd "$ROOT_DIR" && node -p "require('./package.json').version")}"
R2_PREFIX="${R2_PREFIX:-releases/macos}"
R2_PUBLIC_BASE_URL="${R2_PUBLIC_BASE_URL:-}"
MANIFEST_PATH="${MANIFEST_PATH:-$DIST_DIR/macos-release-manifest.json}"
BUCKET="${R2_BUCKET_NAME:-}"
ACCOUNT_ID="${R2_ACCOUNT_ID:-}"
ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}"
SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}"
ENDPOINT=""

usage() {
  cat <<'EOF'
Publish signed/notarized macOS release artifacts to Cloudflare R2.

Required env:
  R2_ACCOUNT_ID
  R2_BUCKET_NAME
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_PUBLIC_BASE_URL     Public base URL that serves the uploaded objects

Optional env:
  APP_VERSION            Defaults to package.json version
  ARGENTOS_INSTALL_CHANNEL
  DIST_DIR               Defaults to ./dist
  R2_PREFIX              Defaults to releases/macos
  MANIFEST_PATH          Defaults to dist/macos-release-manifest.json

Artifacts uploaded:
  <prefix>/<version>/Argent-<version>.zip
  <prefix>/<version>/Argent-<version>.dmg
  <prefix>/<version>/Argent-<version>.dSYM.zip  (if present)
  <prefix>/<version>.json
  <prefix>/latest.json
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

command -v aws >/dev/null 2>&1 || {
  echo "ERROR: aws CLI is required to publish release artifacts." >&2
  exit 1
}

[[ -n "$R2_PUBLIC_BASE_URL" ]] || {
  echo "ERROR: R2_PUBLIC_BASE_URL is required." >&2
  exit 1
}
[[ -n "$BUCKET" && -n "$ACCOUNT_ID" && -n "$ACCESS_KEY_ID" && -n "$SECRET_ACCESS_KEY" ]] || {
  echo "ERROR: R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required." >&2
  exit 1
}

ENDPOINT="https://${ACCOUNT_ID}.r2.cloudflarestorage.com"
VERSION_PREFIX="${R2_PREFIX%/}/${VERSION}"
PUBLIC_VERSION_BASE="${R2_PUBLIC_BASE_URL%/}/${VERSION}"
ZIP_PATH="$DIST_DIR/Argent-${VERSION}.zip"
DMG_PATH="$DIST_DIR/Argent-${VERSION}.dmg"
DSYM_PATH="$DIST_DIR/Argent-${VERSION}.dSYM.zip"

[[ -f "$ZIP_PATH" ]] || { echo "ERROR: Missing $ZIP_PATH" >&2; exit 1; }
[[ -f "$DMG_PATH" ]] || { echo "ERROR: Missing $DMG_PATH" >&2; exit 1; }

cd "$ROOT_DIR"
node --import tsx ./scripts/write-macos-release-manifest.ts \
  --base-url "$PUBLIC_VERSION_BASE" \
  --bundle-id "ai.argent.mac" \
  --channel "$CHANNEL" \
  --dist-dir "$DIST_DIR" \
  --out "$MANIFEST_PATH" \
  --version "$VERSION" >/dev/null

export AWS_ACCESS_KEY_ID="$ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$SECRET_ACCESS_KEY"

aws s3 cp "$ZIP_PATH" "s3://${BUCKET}/${VERSION_PREFIX}/$(basename "$ZIP_PATH")" \
  --endpoint-url "$ENDPOINT" \
  --content-type application/zip \
  --cache-control "public,max-age=31536000,immutable"

aws s3 cp "$DMG_PATH" "s3://${BUCKET}/${VERSION_PREFIX}/$(basename "$DMG_PATH")" \
  --endpoint-url "$ENDPOINT" \
  --content-type application/x-apple-diskimage \
  --cache-control "public,max-age=31536000,immutable"

if [[ -f "$DSYM_PATH" ]]; then
  aws s3 cp "$DSYM_PATH" "s3://${BUCKET}/${VERSION_PREFIX}/$(basename "$DSYM_PATH")" \
    --endpoint-url "$ENDPOINT" \
    --content-type application/zip \
    --cache-control "private,max-age=31536000,immutable"
fi

aws s3 cp "$MANIFEST_PATH" "s3://${BUCKET}/${R2_PREFIX%/}/${VERSION}.json" \
  --endpoint-url "$ENDPOINT" \
  --content-type application/json \
  --cache-control "public,max-age=300"

aws s3 cp "$MANIFEST_PATH" "s3://${BUCKET}/${R2_PREFIX%/}/latest.json" \
  --endpoint-url "$ENDPOINT" \
  --content-type application/json \
  --cache-control "no-store,max-age=0"

cat <<EOF
Published macOS release artifacts to R2.

Manifest:
  ${R2_PUBLIC_BASE_URL%/}/latest.json
  ${R2_PUBLIC_BASE_URL%/}/${VERSION}.json

Versioned assets:
  ${PUBLIC_VERSION_BASE}/$(basename "$ZIP_PATH")
  ${PUBLIC_VERSION_BASE}/$(basename "$DMG_PATH")
EOF
