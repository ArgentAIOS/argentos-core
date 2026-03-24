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

upload_with_boto3() {
  local source_path="$1"
  local object_key="$2"
  local content_type="$3"
  local cache_control="$4"

  python3 - "$source_path" "$object_key" "$content_type" "$cache_control" <<'PY'
import os
import sys

import boto3
from botocore.config import Config

source_path, object_key, content_type, cache_control = sys.argv[1:5]

client = boto3.client(
    "s3",
    aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    endpoint_url=os.environ["R2_ENDPOINT_URL"],
    region_name="auto",
    config=Config(signature_version="s3v4"),
)

with open(source_path, "rb") as fh:
    client.put_object(
        Bucket=os.environ["R2_BUCKET_NAME"],
        Key=object_key,
        Body=fh,
        ContentType=content_type,
        CacheControl=cache_control,
    )
PY
}

upload_object() {
  local source_path="$1"
  local object_key="$2"
  local content_type="$3"
  local cache_control="$4"

  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "$source_path" "s3://${BUCKET}/${object_key}" \
      --endpoint-url "$ENDPOINT" \
      --content-type "$content_type" \
      --cache-control "$cache_control"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1 && python3 - <<'PY' >/dev/null 2>&1
import importlib.util
import sys
sys.exit(0 if importlib.util.find_spec("boto3") else 1)
PY
  then
    upload_with_boto3 "$source_path" "$object_key" "$content_type" "$cache_control"
    return 0
  fi

  echo "ERROR: need either aws CLI or python3+boto3 to upload release artifacts." >&2
  exit 1
}

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
export R2_ENDPOINT_URL="$ENDPOINT"

upload_object \
  "$ZIP_PATH" \
  "${VERSION_PREFIX}/$(basename "$ZIP_PATH")" \
  "application/zip" \
  "public,max-age=31536000,immutable"

upload_object \
  "$DMG_PATH" \
  "${VERSION_PREFIX}/$(basename "$DMG_PATH")" \
  "application/x-apple-diskimage" \
  "public,max-age=31536000,immutable"

if [[ -f "$DSYM_PATH" ]]; then
  upload_object \
    "$DSYM_PATH" \
    "${VERSION_PREFIX}/$(basename "$DSYM_PATH")" \
    "application/zip" \
    "private,max-age=31536000,immutable"
fi

upload_object \
  "$MANIFEST_PATH" \
  "${R2_PREFIX%/}/${VERSION}.json" \
  "application/json" \
  "public,max-age=300"

upload_object \
  "$MANIFEST_PATH" \
  "${R2_PREFIX%/}/latest.json" \
  "application/json" \
  "no-store,max-age=0"

cat <<EOF
Published macOS release artifacts to R2.

Manifest:
  ${R2_PUBLIC_BASE_URL%/}/latest.json
  ${R2_PUBLIC_BASE_URL%/}/${VERSION}.json

Versioned assets:
  ${PUBLIC_VERSION_BASE}/$(basename "$ZIP_PATH")
  ${PUBLIC_VERSION_BASE}/$(basename "$DMG_PATH")
EOF
