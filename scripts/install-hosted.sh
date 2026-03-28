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
PACKAGE_DIR_OVERRIDE="${ARGENT_INSTALL_PACKAGE_DIR:-$HOME/.argentos/lib/node_modules/argentos}"
NODE_VERSION="${ARGENT_NODE_VERSION:-22.22.0}"
NODE_DIST_URL_BASE="${ARGENT_NODE_DIST_URL_BASE:-https://nodejs.org/dist}"
NODE_BIN_OVERRIDE="${ARGENT_NODE_BIN:-}"
RUNTIME_DIR="${ARGENT_RUNTIME_DIR:-$HOME/.argentos/runtime}"

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
  --install-method <git|npm>  Install from a git checkout or globally via npm
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

  # 1. Try corepack (ships with Node 22+, needs enabling)
  if [[ -x "$node_dir/corepack" ]]; then
    # Enable corepack if not already (idempotent)
    "$node_dir/corepack" enable 2>/dev/null || true
    PNPM_EXEC="$node_dir/corepack"
    PNPM_SUBCOMMAND="pnpm"
    return 0
  fi

  # 2. Try system pnpm (PATH)
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_EXEC="$(command -v pnpm)"
    return 0
  fi

  # 3. Check standard pnpm standalone install locations (not always in PATH)
  local pnpm_home="${PNPM_HOME:-$HOME/Library/pnpm}"
  for candidate in "$pnpm_home/pnpm" "$HOME/.local/share/pnpm/pnpm" "$HOME/.pnpm/pnpm"; do
    if [[ -x "$candidate" ]]; then
      PNPM_EXEC="$candidate"
      return 0
    fi
  done

  # 4. Install pnpm via npm (brand new system fallback)
  local npm_bin="$node_dir/npm"
  if [[ ! -x "$npm_bin" ]]; then
    npm_bin="$(command -v npm 2>/dev/null || true)"
  fi
  if [[ -x "$npm_bin" ]]; then
    info "Installing pnpm via npm..."
    "$npm_bin" install -g pnpm 2>/dev/null || true
    if command -v pnpm >/dev/null 2>&1; then
      PNPM_EXEC="$(command -v pnpm)"
      return 0
    fi
    if [[ -x "$node_dir/pnpm" ]]; then
      PNPM_EXEC="$node_dir/pnpm"
      return 0
    fi
  fi

  # 5. Last resort: install pnpm standalone
  info "Installing pnpm via standalone installer..."
  curl -fsSL https://get.pnpm.io/install.sh | sh - 2>/dev/null || true
  # Re-check after install
  for candidate in "$pnpm_home/pnpm" "$HOME/Library/pnpm/pnpm" "$HOME/.local/share/pnpm/pnpm"; do
    if [[ -x "$candidate" ]]; then
      PNPM_EXEC="$candidate"
      return 0
    fi
  done
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
  printf 'git\n'
}

resolve_effective_version() {
  if [[ -n "$VERSION" ]]; then
    printf '%s\n' "$VERSION"
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

write_git_wrapper() {
  local bin_dir="$1"
  local escaped_package_dir escaped_node_bin escaped_entry
  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: mkdir -p %q\n' "$bin_dir"
    printf 'DRY-RUN: write wrapper %q\n' "$bin_dir/argent"
    printf 'DRY-RUN: chmod +x %q\n' "$bin_dir/argent"
    printf 'DRY-RUN: ln -sf %q %q\n' "$bin_dir/argent" "$bin_dir/argentos"
    return 0
  fi

  mkdir -p "$bin_dir"
  printf -v escaped_package_dir '%q' "$PACKAGE_DIR_OVERRIDE"
  printf -v escaped_node_bin '%q' "$WRAPPER_NODE_BIN"
  printf -v escaped_entry '%q' "$PACKAGE_DIR_OVERRIDE/argent.mjs"
  cat > "$bin_dir/argent" <<EOF
#!/usr/bin/env bash
set -euo pipefail
${PATH_LINE}
cd ${escaped_package_dir}
exec ${escaped_node_bin} ${escaped_entry} "\$@"
EOF
  chmod +x "$bin_dir/argent"
  ln -sf "$bin_dir/argent" "$bin_dir/argentos"
}

snapshot_git_runtime() {
  local source_dir="$1"
  local target_dir="$2"
  local parent_dir tmp_dir backup_dir
  parent_dir="$(dirname "$target_dir")"
  tmp_dir="${target_dir}.new.$$"
  backup_dir="${target_dir}.old.$$"

  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: mkdir -p %q\n' "$parent_dir"
    printf 'DRY-RUN: snapshot %q -> %q\n' "$source_dir" "$target_dir"
    return 0
  fi

  mkdir -p "$parent_dir"
  rm -rf "$tmp_dir" "$backup_dir"
  mkdir -p "$tmp_dir"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude '.git' "$source_dir/" "$tmp_dir/"
  else
    (
      cd "$source_dir"
      tar --exclude='.git' -cf - .
    ) | (
      cd "$tmp_dir"
      tar -xf -
    )
  fi

  if [[ -e "$target_dir" || -L "$target_dir" ]]; then
    mv "$target_dir" "$backup_dir"
  fi
  if ! mv "$tmp_dir" "$target_dir"; then
    mv "$backup_dir" "$target_dir" || true
    exit 1
  fi
  rm -rf "$backup_dir"
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
    run_cmd git clone https://github.com/ArgentAIOS/argentos.git "$GIT_DIR"
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
  snapshot_git_runtime "$GIT_DIR" "$PACKAGE_DIR_OVERRIDE"
  ok "Installed stable runtime snapshot: $PACKAGE_DIR_OVERRIDE"
  write_git_wrapper "$BIN_DIR_OVERRIDE"
  ok "Installed git wrapper: $BIN_DIR_OVERRIDE/argent"
  info "Add this to PATH if needed: $BIN_DIR_OVERRIDE"

  if ! is_truthy "$NO_ONBOARD"; then
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
