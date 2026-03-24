#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

ok()   { printf "${GREEN}  ✓${RESET} %s\n" "$1"; }
warn() { printf "${YELLOW}  ⚠${RESET} %s\n" "$1"; }
err()  { printf "${RED}  ✗${RESET} %s\n" "$1" >&2; }
info() { printf "${CYAN}  →${RESET} %s\n" "$1"; }

INSTALL_METHOD="${ARGENTOS_INSTALL_METHOD:-}"
CHANNEL="${ARGENTOS_INSTALL_CHANNEL:-stable}"
VERSION="${ARGENT_INSTALL_VERSION:-}"
GIT_DIR="${ARGENTOS_GIT_DIR:-$HOME/argentos}"
GIT_UPDATE=1
NO_ONBOARD="${ARGENT_NO_ONBOARD:-0}"
NO_PROMPT="${ARGENTOS_NO_PROMPT:-0}"
DRY_RUN="${ARGENTOS_DRY_RUN:-0}"
PACKAGE_SPEC_OVERRIDE="${ARGENT_INSTALL_PACKAGE_SPEC:-}"
NPM_PREFIX_OVERRIDE="${ARGENT_INSTALL_NPM_PREFIX:-}"
BIN_DIR_OVERRIDE="${ARGENT_INSTALL_BIN_DIR:-$HOME/bin}"
NODE_VERSION="${ARGENT_NODE_VERSION:-22.22.0}"
NODE_DIST_URL_BASE="${ARGENT_NODE_DIST_URL_BASE:-https://nodejs.org/dist}"
NODE_BIN_OVERRIDE="${ARGENT_NODE_BIN:-}"
RUNTIME_DIR="${ARGENT_RUNTIME_DIR:-$HOME/.argentos/runtime}"
MACOS_APP_CLEAN_BUILD_STATE="${ARGENTOS_MAC_CLEAN_BUILD_STATE:-1}"
MACOS_RELEASE_MANIFEST_URL="${ARGENTOS_MACOS_RELEASE_MANIFEST_URL:-}"
MACOS_APP_TARGET="${ARGENTOS_MACOS_APP_TARGET:-/Applications/Argent.app}"

NODE_BIN=""
NPM_BIN=""
PNPM_EXEC=""
PNPM_SUBCOMMAND=""
WRAPPER_NODE_BIN=""
PATH_LINE=""
ONBOARD_NO_PROMPT=()

usage() {
  cat <<'EOF'
ArgentOS hosted shell installer

Usage:
  bash install-hosted.sh [options]

Options:
  --install-method <artifact|git|npm>
                              Install a prebuilt macOS app artifact, a git checkout,
                              or globally via npm
  --channel <stable|beta|dev> Select release channel (default: stable)
  --beta                      Alias for --channel beta
  --version <version>         Package version/tag/git ref (default: channel-dependent)
  --git-dir <path>            Source checkout path for git installs
  --no-git-update             Do not pull when an existing git checkout is present
  --no-onboard                Skip onboarding after install
  --no-prompt                 Disable prompts
  --dry-run                   Print actions only
  --help                      Show this help

Environment equivalents:
  ARGENTOS_INSTALL_METHOD
  ARGENTOS_INSTALL_CHANNEL
  ARGENTOS_GIT_DIR
  ARGENTOS_DRY_RUN
  ARGENTOS_NO_PROMPT
  ARGENT_NO_ONBOARD
  ARGENT_INSTALL_PACKAGE_SPEC
  ARGENT_INSTALL_NPM_PREFIX
  ARGENT_INSTALL_BIN_DIR
  ARGENT_NODE_VERSION
  ARGENT_NODE_BIN
  ARGENTOS_MAC_CLEAN_BUILD_STATE
  ARGENTOS_MACOS_RELEASE_MANIFEST_URL
  ARGENTOS_MACOS_APP_TARGET
EOF
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
  err "No SHA-256 tool found (need shasum, sha256sum, or openssl)"
  exit 1
}

verify_node_archive() {
  local cache_dir="$1"
  local cache_path="$2"
  local tarball="$3"
  local shasums_path="${cache_dir}/SHASUMS256-v${NODE_VERSION}.txt"
  local shasums_url="${NODE_DIST_URL_BASE}/v${NODE_VERSION}/SHASUMS256.txt"
  local expected actual

  if is_truthy "$DRY_RUN"; then
    info "Would verify SHA-256 for ${tarball}" >&2
    return 0
  fi

  if [[ ! -f "$shasums_path" ]]; then
    info "Downloading Node runtime checksums for v${NODE_VERSION}..." >&2
    curl -fsSL "$shasums_url" -o "$shasums_path"
  fi

  expected="$(awk -v name="$tarball" '$2 == name { print $1 }' "$shasums_path")"
  if [[ -z "$expected" ]]; then
    err "Could not find SHA-256 for ${tarball} in ${shasums_path}"
    exit 1
  fi

  actual="$(compute_sha256 "$cache_path")"
  if [[ "$actual" != "$expected" ]]; then
    err "SHA-256 verification failed for ${cache_path}"
    err "Expected: ${expected}"
    err "Actual:   ${actual}"
    exit 1
  fi
}

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

run_cmd() {
  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN:'
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
    return 0
  fi
  "$@"
}

is_supported_runtime_node() {
  local version="${1#v}"
  local major="${version%%.*}"
  local remainder="${version#*.}"
  local minor="${remainder%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] || return 1
  [[ "$minor" =~ ^[0-9]+$ ]] || minor=0
  if (( major < 22 )); then
    return 1
  fi
  if (( major % 2 == 1 )); then
    return 1
  fi
  if (( major == 22 && minor >= 12 )); then
    return 0
  fi
  if (( major >= 24 )); then
    return 0
  fi
  return 1
}

node_os() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    Linux) printf 'linux' ;;
    *)
      err "Unsupported OS for bundled runtime: $(uname -s)"
      exit 1
      ;;
  esac
}

node_arch() {
  case "$(uname -m)" in
    arm64|aarch64) printf 'arm64' ;;
    x86_64|amd64) printf 'x64' ;;
    *)
      err "Unsupported architecture for bundled runtime: $(uname -m)"
      exit 1
      ;;
  esac
}

resolve_requested_node() {
  if [[ -n "$NODE_BIN_OVERRIDE" ]]; then
    printf '%s\n' "$NODE_BIN_OVERRIDE"
    return 0
  fi
  command -v node 2>/dev/null || true
}

install_private_node_runtime() {
  local runtime_root="$1"
  local node_root="$runtime_root/node"
  local os arch tarball url cache_dir cache_path tmp_dir extracted_root new_root backup_root node_bin
  os="$(node_os)"
  arch="$(node_arch)"
  tarball="node-v${NODE_VERSION}-${os}-${arch}.tar.gz"
  url="${NODE_DIST_URL_BASE}/v${NODE_VERSION}/${tarball}"
  cache_dir="${HOME}/.cache/argent-node"
  cache_path="${cache_dir}/${tarball}"

  if is_truthy "$DRY_RUN"; then
    info "Would install private Node runtime v${NODE_VERSION} at ${node_root}" >&2
    printf '%s\n' "${node_root}/bin/node"
    return 0
  fi

  mkdir -p "$cache_dir" "$runtime_root"
  if [[ ! -f "$cache_path" ]]; then
    info "Downloading private Node runtime v${NODE_VERSION}..." >&2
    curl -fsSL "$url" -o "$cache_path"
  else
    info "Using cached private Node runtime: $cache_path" >&2
  fi
  verify_node_archive "$cache_dir" "$cache_path" "$tarball"

  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/argent-node-runtime.XXXXXX")"
  trap 'rm -rf "$tmp_dir"' RETURN
  tar -xzf "$cache_path" -C "$tmp_dir" || {
    err "Failed to extract private Node runtime"
    exit 1
  }
  extracted_root="$tmp_dir/node-v${NODE_VERSION}-${os}-${arch}"
  if [[ ! -d "$extracted_root" ]]; then
    err "Extracted private Node runtime is missing expected directory: $extracted_root"
    exit 1
  fi

  new_root="${runtime_root}/node.new.$$"
  rm -rf "$new_root"
  mv "$extracted_root" "$new_root"

  backup_root=""
  if [[ -d "$node_root" ]]; then
    backup_root="${runtime_root}/node.old.$$"
    rm -rf "$backup_root"
    mv "$node_root" "$backup_root"
  fi
  if ! mv "$new_root" "$node_root"; then
    rm -rf "$new_root"
    if [[ -n "$backup_root" && -d "$backup_root" ]]; then
      mv "$backup_root" "$node_root" || true
    fi
    err "Failed to activate private Node runtime at $node_root"
    exit 1
  fi
  if [[ -n "$backup_root" && -d "$backup_root" ]]; then
    rm -rf "$backup_root"
  fi
  rm -rf "$tmp_dir"
  trap - RETURN

  node_bin="$node_root/bin/node"
  if [[ ! -x "$node_bin" ]]; then
    err "Private Node runtime is missing $node_bin"
    exit 1
  fi

  ok "Installed private Node runtime: $("$node_bin" --version)" >&2
  printf '%s\n' "$node_bin"
}

resolve_pnpm_runner() {
  local node_bin="$1"
  local node_dir
  node_dir="$(dirname "$node_bin")"
  PNPM_EXEC=""
  PNPM_SUBCOMMAND=""
  if [[ -x "$node_dir/corepack" ]]; then
    PNPM_EXEC="$node_dir/corepack"
    PNPM_SUBCOMMAND="pnpm"
    return 0
  fi
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_EXEC="$(command -v pnpm)"
    return 0
  fi
  return 1
}

activate_runtime() {
  local resolved_node system_node_version node_dir

  resolved_node="$(resolve_requested_node)"
  if [[ -n "$resolved_node" && -x "$resolved_node" ]]; then
    system_node_version="$("$resolved_node" -p 'process.versions.node' 2>/dev/null || true)"
    if [[ -n "$system_node_version" ]] && is_supported_runtime_node "$system_node_version"; then
      NODE_BIN="$resolved_node"
      info "Using compatible system Node: $resolved_node (v$system_node_version)"
    else
      warn "System Node ${system_node_version:-unknown} at ${resolved_node} is outside the supported runtime range; installing a private Node ${NODE_VERSION} runtime."
      NODE_BIN="$(install_private_node_runtime "$RUNTIME_DIR")"
    fi
  else
    info "No compatible system Node detected; installing a private Node ${NODE_VERSION} runtime."
    NODE_BIN="$(install_private_node_runtime "$RUNTIME_DIR")"
  fi

  WRAPPER_NODE_BIN="$NODE_BIN"
  node_dir="$(dirname "$NODE_BIN")"
  PATH_LINE="export PATH=\"$node_dir:\$PATH\""
  NPM_BIN="$node_dir/npm"
  if [[ ! -x "$NPM_BIN" ]]; then
    NPM_BIN="$(command -v npm 2>/dev/null || true)"
  fi
  resolve_pnpm_runner "$NODE_BIN" || true
  ONBOARD_NO_PROMPT=()
  if is_truthy "$NO_PROMPT"; then
    ONBOARD_NO_PROMPT+=(--no-prompt)
  fi
  if is_truthy "$DRY_RUN" && [[ ! -x "$NODE_BIN" ]]; then
    ok "Using Node.js v${NODE_VERSION} (dry-run private runtime)"
  else
    ok "Using Node.js $("$NODE_BIN" --version)"
  fi
}

validate_channel() {
  case "$CHANNEL" in
    stable|beta|dev) ;;
    *)
      err "Unsupported channel: $CHANNEL"
      exit 1
      ;;
  esac
}

resolve_effective_install_method() {
  if [[ -n "$INSTALL_METHOD" ]]; then
    printf '%s\n' "$INSTALL_METHOD"
    return 0
  fi
  if is_macos; then
    printf 'artifact\n'
    return 0
  fi
  printf 'git\n'
}

resolve_effective_version() {
  if [[ -n "$VERSION" ]]; then
    printf '%s\n' "$VERSION"
    return 0
  fi
  if [[ "$INSTALL_METHOD" == "artifact" ]]; then
    printf 'latest\n'
    return 0
  fi
  if [[ "$INSTALL_METHOD" == "git" ]]; then
    printf 'main\n'
    return 0
  fi
  case "$CHANNEL" in
    stable) printf 'latest\n' ;;
    beta) printf 'beta\n' ;;
    dev) printf 'dev\n' ;;
    *)
      err "Unsupported channel: $CHANNEL"
      exit 1
      ;;
  esac
}

require_unix() {
  case "$(uname -s)" in
    Darwin|Linux) ;;
    *)
      err "The hosted shell installer currently supports macOS and Linux."
      exit 1
      ;;
  esac
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    err "Missing required command: $1"
    exit 1
  }
}

run_pnpm() {
  local dir="$1"
  shift
  if [[ -z "$PNPM_EXEC" ]]; then
    err "pnpm is required for git installs."
    exit 1
  fi
  if [[ -n "$PNPM_SUBCOMMAND" ]]; then
    PATH="$(dirname "$NODE_BIN"):$PATH" run_cmd "$PNPM_EXEC" "$PNPM_SUBCOMMAND" --dir "$dir" "$@"
  else
    PATH="$(dirname "$NODE_BIN"):$PATH" run_cmd "$PNPM_EXEC" --dir "$dir" "$@"
  fi
}

is_macos() {
  [[ "$(uname -s)" == "Darwin" ]]
}

drain_tty_input() {
  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
    return 0
  fi
  while IFS= read -r -s -n 1 -t 0.01 _ </dev/tty 2>/dev/null; do
    :
  done
}

select_number_from_tty() {
  local message="$1"
  local default_value="$2"
  shift 2
  local options=("$@")
  local answer index

  if is_truthy "$NO_PROMPT"; then
    printf '%s\n' "$default_value"
    return 0
  fi

  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
    err "Interactive setup requires a terminal. Re-run in a terminal, or pass --no-prompt."
    exit 1
  fi

  while true; do
    printf '\n%s\n' "$message" >/dev/tty
    index=1
    for option in "${options[@]}"; do
      printf '  %s) %s\n' "$index" "$option" >/dev/tty
      index=$((index + 1))
    done
    printf 'Select [%s]: ' "$default_value" >/dev/tty
    IFS= read -r answer </dev/tty || true
    answer="${answer:-$default_value}"
    if [[ "$answer" =~ ^[0-9]+$ ]] && (( answer >= 1 && answer <= ${#options[@]} )); then
      printf '%s\n' "$answer"
      return 0
    fi
    printf 'Invalid selection.\n' >/dev/tty
  done
}

prompt_text_from_tty() {
  local message="$1"
  local default_value="$2"
  local answer

  if is_truthy "$NO_PROMPT"; then
    printf '%s\n' "$default_value"
    return 0
  fi

  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
    err "Interactive setup requires a terminal. Re-run in a terminal, or pass --no-prompt."
    exit 1
  fi

  while true; do
    printf '%s [%s]: ' "$message" "$default_value" >/dev/tty
    IFS= read -r answer </dev/tty || true
    answer="${answer:-$default_value}"
    answer="${answer#"${answer%%[![:space:]]*}"}"
    answer="${answer%"${answer##*[![:space:]]}"}"
    if [[ -n "$answer" ]]; then
      printf '%s\n' "$answer"
      return 0
    fi
    printf 'Value is required.\n' >/dev/tty
  done
}

select_local_runtime_choice() {
  local selection
  selection="$(
    select_number_from_tty \
      "Choose a local runtime for first launch:" \
      "1" \
      "LM Studio — curated local models with Nomic embeddings" \
      "Ollama — local Qwen and Llama models sized for Mac Mini through Mac Studio" \
      "Skip for now"
  )"
  case "$selection" in
    1) printf 'lmstudio\n' ;;
    2) printf 'ollama\n' ;;
    *) printf 'skip\n' ;;
  esac
}

select_lmstudio_model_id() {
  local selection
  selection="$(
    select_number_from_tty \
      "Choose an LM Studio model:" \
      "1" \
      "Qwen 3.5 9B — smallest recommended default" \
      "Qwen 3.5 35B A3B — stronger local default for larger Macs" \
      "Nemotron 3 Nano 4B — very small local footprint" \
      "GPT OSS 20B — mid-size local model" \
      "GLM 4.7 Flash — larger local option" \
      "DeepSeek R1 Qwen3 8B — smaller reasoning-oriented option" \
      "GPT OSS 120B — very large option for high-RAM Macs" \
      "Enter model manually"
  )"
  case "$selection" in
    1) printf 'qwen/qwen3.5-9b\n' ;;
    2) printf 'qwen/qwen3.5-35b-a3b\n' ;;
    3) printf 'nvidia/nemotron-3-nano-4b\n' ;;
    4) printf 'openai/gpt-oss-20b\n' ;;
    5) printf 'zai-org/glm-4.7-flash\n' ;;
    6) printf 'deepseek/deepseek-r1-0528-qwen3-8b\n' ;;
    7) printf 'openai/gpt-oss-120b\n' ;;
    *)
      prompt_text_from_tty "Enter LM Studio model id" "qwen/qwen3.5-9b"
      ;;
  esac
}

select_ollama_model_id() {
  local selection
  selection="$(
    select_number_from_tty \
      "Choose an Ollama model:" \
      "1" \
      "Qwen 3 1.7B — fits 16 GB Macs" \
      "Qwen 3 14B — best general fit for 32–64 GB Macs" \
      "Qwen 3 30B A3B — best local quality for 64 GB+ Macs" \
      "Llama 3.3 — broad compatibility fallback" \
      "Enter model manually"
  )"
  case "$selection" in
    1) printf 'qwen3:1.7b\n' ;;
    2) printf 'qwen3:14b\n' ;;
    3) printf 'qwen3:30b-a3b-instruct-2507-q4_K_M\n' ;;
    4) printf 'llama3.3\n' ;;
    *)
      prompt_text_from_tty "Enter Ollama model id" "qwen3:14b"
      ;;
  esac
}

run_onboard() {
  local argent_bin="$1"
  local onboard_args=(onboard --install-daemon)
  if (( ${#ONBOARD_NO_PROMPT[@]} )); then
    onboard_args+=("${ONBOARD_NO_PROMPT[@]}")
  fi

  if is_truthy "$DRY_RUN"; then
    run_cmd "$argent_bin" "${onboard_args[@]}"
    return 0
  fi

  if (( ${#ONBOARD_NO_PROMPT[@]} )); then
    "$argent_bin" "${onboard_args[@]}"
    return 0
  fi

  if [[ -r /dev/tty && -w /dev/tty ]]; then
    "$argent_bin" "${onboard_args[@]}" </dev/tty >/dev/tty 2>/dev/tty
    return 0
  fi

  err "Interactive onboarding requires a terminal. Re-run in a terminal, or pass --no-prompt / --no-onboard."
  exit 1
}

run_mac_quickstart_onboard() {
  local argent_bin="$1"
  local auth_choice="skip"
  local local_model_id=""
  local onboard_args=(
    onboard
    --non-interactive
    --accept-risk
    --mode local
    --flow quickstart
    --install-daemon
    --skip-channels
    --skip-skills
    --skip-ui
  )

  if is_truthy "$NO_PROMPT"; then
    auth_choice="lmstudio"
    local_model_id="qwen/qwen3.5-9b"
  else
    drain_tty_input
    auth_choice="$(select_local_runtime_choice)"
    if [[ "$auth_choice" == "lmstudio" ]]; then
      local_model_id="$(select_lmstudio_model_id)"
    elif [[ "$auth_choice" == "ollama" ]]; then
      local_model_id="$(select_ollama_model_id)"
    fi
  fi

  if [[ "$auth_choice" != "skip" ]]; then
    onboard_args+=(--auth-choice "$auth_choice")
    if [[ -n "$local_model_id" ]]; then
      onboard_args+=(--local-model-id "$local_model_id")
    fi
  fi

  run_cmd "$argent_bin" "${onboard_args[@]}"
}

resolve_macos_release_manifest_url() {
  if [[ -n "$MACOS_RELEASE_MANIFEST_URL" ]]; then
    printf '%s\n' "$MACOS_RELEASE_MANIFEST_URL"
    return 0
  fi
  if [[ "$VERSION" == "latest" ]]; then
    printf 'https://argentos.ai/releases/macos/latest.json\n'
    return 0
  fi
  printf 'https://argentos.ai/releases/macos/%s.json\n' "$VERSION"
}

json_manifest_value() {
  local manifest_path="$1"
  local dotted_path="$2"
  "$NODE_BIN" - "$manifest_path" "$dotted_path" <<'EOF'
const fs = require("node:fs");

const [manifestPath, dottedPath] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
let current = manifest;
for (const segment of dottedPath.split(".")) {
  current = current?.[segment];
}
if (current === undefined || current === null) {
  process.exit(2);
}
if (typeof current === "object") {
  process.stdout.write(JSON.stringify(current));
} else {
  process.stdout.write(String(current));
}
EOF
}

download_file() {
  local url="$1"
  local output_path="$2"
  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: curl -fsSL %q -o %q\n' "$url" "$output_path"
    return 0
  fi
  curl -fsSL "$url" -o "$output_path"
}

write_app_wrapper() {
  local bin_dir="$1"
  local app_path="$2"
  local runtime_dir="$app_path/Contents/Resources/argent-runtime"
  local node_bin="$runtime_dir/bin/node"
  local entry_script="$runtime_dir/argent.mjs"
  local escaped_node_bin escaped_entry

  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: mkdir -p %q\n' "$bin_dir"
    printf 'DRY-RUN: write wrapper %q\n' "$bin_dir/argent"
    printf 'DRY-RUN: chmod +x %q\n' "$bin_dir/argent"
    printf 'DRY-RUN: ln -sf %q %q\n' "$bin_dir/argent" "$bin_dir/argentos"
    return 0
  fi

  if [[ ! -x "$node_bin" || ! -f "$entry_script" ]]; then
    warn "Skipping CLI wrapper: embedded runtime missing in $app_path"
    return 1
  fi

  mkdir -p "$bin_dir"
  printf -v escaped_node_bin '%q' "$node_bin"
  printf -v escaped_entry '%q' "$entry_script"
  cat > "$bin_dir/argent" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec ${escaped_node_bin} ${escaped_entry} "\$@"
EOF
  chmod +x "$bin_dir/argent"
  ln -sf "$bin_dir/argent" "$bin_dir/argentos"
}

install_macos_app_bundle() {
  local app_bundle="$1"
  local install_target="${2:-$MACOS_APP_TARGET}"
  local should_open="${3:-1}"

  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: rm -rf %q\n' "$install_target"
    printf 'DRY-RUN: ditto %q %q\n' "$app_bundle" "$install_target"
    printf 'DRY-RUN: xattr -dr com.apple.quarantine %q\n' "$install_target"
    if is_truthy "$should_open"; then
      printf 'DRY-RUN: open -a %q\n' "$install_target"
    fi
    return 0
  fi

  rm -rf "$install_target"
  ditto "$app_bundle" "$install_target"
  xattr -dr com.apple.quarantine "$install_target" 2>/dev/null || true
  ok "Installed Argent.app: $install_target"

  if is_truthy "$should_open"; then
    open -a "$install_target"
    ok "Opened Argent.app"
  else
    info "Skipped launching Argent.app"
  fi
}

install_macos_artifact() {
  local manifest_url manifest_path artifact_url artifact_sha artifact_version tmp_dir zip_path unpack_dir app_bundle should_open

  if ! is_macos; then
    err "Artifact installs are currently supported only on macOS."
    exit 1
  fi

  manifest_url="$(resolve_macos_release_manifest_url)"
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/argent-macos-artifact.XXXXXX")"
  trap 'rm -rf "$tmp_dir"' RETURN
  manifest_path="$tmp_dir/macos-release.json"
  zip_path="$tmp_dir/Argent.zip"
  unpack_dir="$tmp_dir/unpack"
  should_open="$([[ "$NO_ONBOARD" == "0" ]] && printf '1' || printf '0')"

  if ! is_truthy "$NO_ONBOARD"; then
    info "Deferring onboarding to Argent.app first-run setup"
  fi

  info "Fetching macOS release manifest: $manifest_url"
  download_file "$manifest_url" "$manifest_path"

  if is_truthy "$DRY_RUN"; then
    artifact_version="${VERSION}"
    artifact_url="<manifest-zip-url>"
    artifact_sha="<manifest-zip-sha256>"
  else
    artifact_version="$(json_manifest_value "$manifest_path" "version")" || {
      err "Manifest is missing version: $manifest_url"
      exit 1
    }
    artifact_url="$(json_manifest_value "$manifest_path" "macos.artifacts.zip.url")" || {
      err "Manifest is missing macos.artifacts.zip.url: $manifest_url"
      exit 1
    }
    artifact_sha="$(json_manifest_value "$manifest_path" "macos.artifacts.zip.sha256")" || {
      err "Manifest is missing macos.artifacts.zip.sha256: $manifest_url"
      exit 1
    }
  fi

  info "Downloading Argent.app ${artifact_version} zip"
  download_file "$artifact_url" "$zip_path"

  if ! is_truthy "$DRY_RUN"; then
    local actual_sha
    actual_sha="$(compute_sha256 "$zip_path")"
    if [[ "$actual_sha" != "$artifact_sha" ]]; then
      err "SHA-256 verification failed for ${artifact_url}"
      err "Expected: ${artifact_sha}"
      err "Actual:   ${actual_sha}"
      exit 1
    fi
    mkdir -p "$unpack_dir"
    ditto -x -k "$zip_path" "$unpack_dir"
    app_bundle="$unpack_dir/Argent.app"
    if [[ ! -d "$app_bundle" ]]; then
      err "Downloaded archive does not contain Argent.app"
      exit 1
    fi
  else
    app_bundle="$unpack_dir/Argent.app"
  fi

  install_macos_app_bundle "$app_bundle" "$MACOS_APP_TARGET" "$should_open"
  if write_app_wrapper "$BIN_DIR_OVERRIDE" "$MACOS_APP_TARGET"; then
    ok "Installed app-backed CLI wrapper: $BIN_DIR_OVERRIDE/argent"
    info "Add this to PATH if needed: $BIN_DIR_OVERRIDE"
  fi

  if ! is_truthy "$DRY_RUN"; then
    trap - RETURN
    rm -rf "$tmp_dir"
  fi
}

install_mac_app_from_checkout() {
  local app_bundle="${GIT_DIR}/dist/Argent.app"
  local should_open="${1:-1}"

  if ! is_macos; then
    return 0
  fi

  info "Packaging Argent.app for macOS"
  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: (cd %q && ALLOW_ADHOC_SIGNING=1 DISABLE_LIBRARY_VALIDATION=1 SKIP_TSC=1 SKIP_UI_BUILD=1 ./scripts/package-mac-app.sh)\n' "$GIT_DIR"
    printf 'DRY-RUN: rm -rf %q\n' "$MACOS_APP_TARGET"
    printf 'DRY-RUN: ditto %q %q\n' "$app_bundle" "$MACOS_APP_TARGET"
    printf 'DRY-RUN: open -a %q\n' "$MACOS_APP_TARGET"
    return 0
  fi

  if is_truthy "$MACOS_APP_CLEAN_BUILD_STATE"; then
    info "Resetting macOS app build caches for a clean package build"
    rm -rf \
      "$GIT_DIR/apps/macos/.build" \
      "$GIT_DIR/apps/macos/.build-swift" \
      "$GIT_DIR/apps/macos/.swiftpm" \
      "$GIT_DIR/apps/argent-audio-capture/.build"
  fi

  (
    cd "$GIT_DIR"
    ALLOW_ADHOC_SIGNING=1 DISABLE_LIBRARY_VALIDATION=1 SKIP_TSC=1 SKIP_UI_BUILD=1 ./scripts/package-mac-app.sh
  )

  if [[ ! -d "$app_bundle" ]]; then
    err "Packaged app bundle missing: $app_bundle"
    exit 1
  fi

  install_macos_app_bundle "$app_bundle" "$MACOS_APP_TARGET" "$should_open"
}

write_git_wrapper() {
  local bin_dir="$1"
  local escaped_git_dir escaped_node_bin escaped_entry
  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: mkdir -p %q\n' "$bin_dir"
    printf 'DRY-RUN: write wrapper %q\n' "$bin_dir/argent"
    printf 'DRY-RUN: chmod +x %q\n' "$bin_dir/argent"
    printf 'DRY-RUN: ln -sf %q %q\n' "$bin_dir/argent" "$bin_dir/argentos"
    return 0
  fi

  mkdir -p "$bin_dir"
  printf -v escaped_git_dir '%q' "$GIT_DIR"
  printf -v escaped_node_bin '%q' "$WRAPPER_NODE_BIN"
  printf -v escaped_entry '%q' "$GIT_DIR/argent.mjs"
  cat > "$bin_dir/argent" <<EOF
#!/usr/bin/env bash
set -euo pipefail
${PATH_LINE}
cd ${escaped_git_dir}
exec ${escaped_node_bin} ${escaped_entry} "\$@"
EOF
  chmod +x "$bin_dir/argent"
  ln -sf "$bin_dir/argent" "$bin_dir/argentos"
}

install_npm() {
  local package_spec="${PACKAGE_SPEC_OVERRIDE:-argentos@${VERSION}}"
  local target_bin="argent"

  [[ -n "$NPM_BIN" && -x "$NPM_BIN" ]] || {
    err "npm is unavailable for the selected runtime."
    exit 1
  }

  info "Installing $package_spec via npm"
  if [[ -n "$NPM_PREFIX_OVERRIDE" ]]; then
    if is_truthy "$DRY_RUN"; then
      printf 'DRY-RUN: mkdir -p %q\n' "$NPM_PREFIX_OVERRIDE"
    else
      mkdir -p "$NPM_PREFIX_OVERRIDE"
    fi
    PATH="$(dirname "$NODE_BIN"):$PATH" run_cmd "$NPM_BIN" install -g --prefix "$NPM_PREFIX_OVERRIDE" "$package_spec"
    target_bin="$NPM_PREFIX_OVERRIDE/bin/argent"
    ok "Installed into prefix: $NPM_PREFIX_OVERRIDE"
    info "Add this to PATH if needed: $NPM_PREFIX_OVERRIDE/bin"
  else
    PATH="$(dirname "$NODE_BIN"):$PATH" run_cmd "$NPM_BIN" install -g "$package_spec"
    target_bin="$(
      PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" bin -g 2>/dev/null
    )/argent"
    ok "Installed globally with npm"
  fi

  if ! is_truthy "$NO_ONBOARD"; then
    run_onboard "$target_bin"
  fi
}

install_git() {
  require_command git

  if [[ -d "$GIT_DIR/.git" ]]; then
    info "Using existing checkout: $GIT_DIR"
    run_cmd git -C "$GIT_DIR" fetch --tags --prune
  else
    info "Cloning source checkout to $GIT_DIR"
    run_cmd git clone https://github.com/ArgentAIOS/argentos-core.git "$GIT_DIR"
  fi

  if [[ -n "$VERSION" && "$VERSION" != "main" ]]; then
    info "Checking out git ref: $VERSION"
    run_cmd git -C "$GIT_DIR" checkout "$VERSION"
  else
    info "Tracking source checkout on main"
    run_cmd git -C "$GIT_DIR" checkout main
    if is_truthy "$GIT_UPDATE"; then
      run_cmd git -C "$GIT_DIR" pull --rebase origin main
    fi
  fi

  run_pnpm "$GIT_DIR" install
  run_pnpm "$GIT_DIR" build
  run_pnpm "$GIT_DIR" rebuild better-sqlite3
  write_git_wrapper "$BIN_DIR_OVERRIDE"
  ok "Installed git wrapper: $BIN_DIR_OVERRIDE/argent"
  info "Add this to PATH if needed: $BIN_DIR_OVERRIDE"

  if is_macos; then
    if ! is_truthy "$NO_ONBOARD"; then
      info "Deferring onboarding to Argent.app first-run setup"
    fi
    install_mac_app_from_checkout "$([[ "$NO_ONBOARD" == "0" ]] && printf '1' || printf '0')"
  elif ! is_truthy "$NO_ONBOARD"; then
    run_onboard "$BIN_DIR_OVERRIDE/argent"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-method)
      [[ $# -ge 2 ]] || { err "Missing value for --install-method"; exit 1; }
      INSTALL_METHOD="$2"
      shift 2
      ;;
    --channel)
      [[ $# -ge 2 ]] || { err "Missing value for --channel"; exit 1; }
      CHANNEL="$2"
      shift 2
      ;;
    --beta)
      CHANNEL="beta"
      shift
      ;;
    --version)
      [[ $# -ge 2 ]] || { err "Missing value for --version"; exit 1; }
      VERSION="$2"
      shift 2
      ;;
    --git-dir)
      [[ $# -ge 2 ]] || { err "Missing value for --git-dir"; exit 1; }
      GIT_DIR="$2"
      shift 2
      ;;
    --no-git-update)
      GIT_UPDATE=0
      shift
      ;;
    --no-onboard)
      NO_ONBOARD=1
      shift
      ;;
    --no-prompt)
      NO_PROMPT=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      err "Unknown option: $1"
      exit 1
      ;;
  esac
done

require_unix
validate_channel
INSTALL_METHOD="$(resolve_effective_install_method)"
VERSION="$(resolve_effective_version)"
activate_runtime

info "Install rail: $INSTALL_METHOD"
info "Channel: $CHANNEL"
info "Version/ref: $VERSION"

case "$INSTALL_METHOD" in
  artifact)
    install_macos_artifact
    ;;
  npm)
    install_npm
    ;;
  git)
    install_git
    ;;
  *)
    err "Unsupported install method: $INSTALL_METHOD"
    exit 1
    ;;
esac
