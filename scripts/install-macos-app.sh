#!/usr/bin/env bash
set -euo pipefail

ok() { printf '  OK %s\n' "$1"; }
warn() { printf '  WARN %s\n' "$1"; }
info() { printf '  -> %s\n' "$1"; }

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

compute_sha256() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return 0
  fi
  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $NF}'
    return 0
  fi
  return 1
}

manifest_field() {
  local manifest_file="$1"
  local field="$2"
  "$NODE_FOR_JSON" -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = process.argv[2].split(".").reduce((current, key) => current && current[key], manifest);
    if (value !== undefined && value !== null) process.stdout.write(String(value));
  ' "$manifest_file" "$field" 2>/dev/null || true
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  info "Skipping Argent.app install (not macOS)"
  exit 0
fi

if is_truthy "${ARGENT_SKIP_APP_INSTALL:-${ARGENT_INSTALL_SKIP_APP:-0}}"; then
  info "Skipping Argent.app install (ARGENT_SKIP_APP_INSTALL=1)"
  exit 0
fi

NODE_FOR_JSON="${ARGENT_NODE_BIN:-${NODE_BIN:-}}"
if [[ -z "$NODE_FOR_JSON" ]]; then
  NODE_FOR_JSON="$(command -v node || true)"
fi
if [[ -z "$NODE_FOR_JSON" || ! -x "$NODE_FOR_JSON" ]]; then
  warn "Node is required to parse the Argent.app release manifest"
  warn "Argent.app not installed; download it later from https://argentos.ai"
  exit 0
fi

APP_DEST="${ARGENT_APP_DEST:-/Applications/Argent.app}"
BASE_URL="${ARGENT_APP_RELEASE_BASE_URL:-https://argentos.ai/releases/macos}"
CHANNEL="${ARGENT_APP_RELEASE_CHANNEL:-${ARGENTOS_INSTALL_CHANNEL:-${ARGENT_INSTALL_CHANNEL:-stable}}}"
REF="${ARGENT_APP_RELEASE_REF:-${ARGENT_INSTALL_VERSION:-}}"
ALLOW_STABLE_FALLBACK="${ARGENT_APP_ALLOW_STABLE_FALLBACK:-1}"
DRY_RUN="${ARGENT_APP_DRY_RUN:-${ARGENTOS_DRY_RUN:-0}}"
OPEN_APP="${ARGENT_APP_OPEN:-0}"

manifest_urls=()
if [[ -n "${ARGENT_APP_MANIFEST_URL:-}" ]]; then
  manifest_urls+=("$ARGENT_APP_MANIFEST_URL")
else
  if [[ "$CHANNEL" != "stable" ]]; then
    if [[ -n "$REF" ]]; then
      manifest_urls+=("${BASE_URL}/${CHANNEL}/${REF}/latest.json")
      manifest_urls+=("${BASE_URL}/${CHANNEL}/${REF}.json")
    fi
    manifest_urls+=("${BASE_URL}/${CHANNEL}/latest.json")
  fi
  if [[ "$CHANNEL" == "stable" ]] || is_truthy "$ALLOW_STABLE_FALLBACK"; then
    manifest_urls+=("${BASE_URL}/latest.json")
  fi
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

manifest_path="$tmp_dir/latest.json"
selected_manifest=""

info "Checking for Argent.app release manifest..."
for url in "${manifest_urls[@]}"; do
  if curl -fsSL "$url" -o "$manifest_path" 2>/dev/null; then
    selected_manifest="$url"
    break
  fi
  if [[ "$url" == *"/${CHANNEL}/"* || "$url" == *"/${CHANNEL}/latest.json" ]]; then
    warn "No Argent.app manifest at $url"
  fi
done

if [[ -z "$selected_manifest" ]]; then
  warn "Could not fetch an Argent.app release manifest"
  warn "Argent.app not installed; download it later from https://argentos.ai"
  exit 0
fi

if [[ "$CHANNEL" != "stable" && "$selected_manifest" == "${BASE_URL}/latest.json" ]]; then
  warn "No ${CHANNEL} Argent.app artifact found; using stable app release"
fi

zip_url="$(manifest_field "$manifest_path" "macos.artifacts.zip.url")"
zip_filename="$(manifest_field "$manifest_path" "macos.artifacts.zip.filename")"
zip_sha256="$(manifest_field "$manifest_path" "macos.artifacts.zip.sha256")"
release_version="$(manifest_field "$manifest_path" "version")"

if [[ -z "$zip_url" || -z "$zip_filename" ]]; then
  warn "Could not parse Argent.app release manifest from $selected_manifest"
  warn "Argent.app not installed; download it later from https://argentos.ai"
  exit 0
fi

info "Found Argent.app ${release_version:-release}: $zip_filename"

zip_path="$tmp_dir/$zip_filename"
if is_truthy "$DRY_RUN"; then
  printf 'DRY-RUN: curl -fsSL %q -o %q\n' "$zip_url" "$zip_path"
  if [[ -n "$zip_sha256" ]]; then
    printf 'DRY-RUN: verify sha256 %q\n' "$zip_sha256"
  fi
  printf 'DRY-RUN: unzip %q\n' "$zip_path"
  printf 'DRY-RUN: install Argent.app to %q\n' "$APP_DEST"
  if is_truthy "$OPEN_APP"; then
    printf 'DRY-RUN: open %q\n' "$APP_DEST"
  fi
  exit 0
fi

info "Downloading $zip_filename..."
if ! curl -fsSL "$zip_url" -o "$zip_path"; then
  warn "Download failed: $zip_url"
  warn "Argent.app not installed; download it later from https://argentos.ai"
  exit 0
fi

if [[ -n "$zip_sha256" ]]; then
  actual_sha256="$(compute_sha256 "$zip_path" || true)"
  if [[ -z "$actual_sha256" ]]; then
    warn "Could not verify SHA-256 for $zip_filename"
  elif [[ "$actual_sha256" != "$zip_sha256" ]]; then
    warn "Argent.app checksum mismatch; refusing to install downloaded archive"
    exit 0
  else
    ok "Verified Argent.app checksum"
  fi
fi

if ! (cd "$tmp_dir" && unzip -qo "$zip_filename" 2>/dev/null); then
  warn "Could not unzip $zip_filename"
  warn "Argent.app not installed; download it later from https://argentos.ai"
  exit 0
fi

app_source=""
if [[ -d "$tmp_dir/Argent.app" ]]; then
  app_source="$tmp_dir/Argent.app"
elif [[ -d "$tmp_dir/Argent/Argent.app" ]]; then
  app_source="$tmp_dir/Argent/Argent.app"
else
  app_source="$(find "$tmp_dir" -maxdepth 3 -type d -name 'Argent.app' -print -quit 2>/dev/null || true)"
fi

if [[ -z "$app_source" ]]; then
  warn "Could not find Argent.app in downloaded archive"
  exit 0
fi

info "Installing Argent.app to $APP_DEST..."
rm -rf "$APP_DEST" 2>/dev/null || true
if ! mkdir -p "$(dirname "$APP_DEST")"; then
  warn "Could not create $(dirname "$APP_DEST")"
  warn "Check permissions or set ARGENT_APP_DEST to a writable Applications directory"
  exit 0
fi
if ! ditto "$app_source" "$APP_DEST"; then
  warn "Could not install Argent.app to $APP_DEST"
  warn "Check permissions or set ARGENT_APP_DEST to a writable Applications directory"
  exit 0
fi

ok "Installed Argent.app to $APP_DEST"
if is_truthy "$OPEN_APP"; then
  open -a "$APP_DEST" 2>/dev/null || true
fi
