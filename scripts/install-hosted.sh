#!/usr/bin/env bash
set -euo pipefail

# Ensure CWD is valid — if the user ran `rm -rf ~/argentos` while standing in
# that directory, the shell CWD becomes invalid and git/node will fail.
cd "$HOME" 2>/dev/null || cd / 2>/dev/null || true

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
FORCE_CLI_ONBOARD="${ARGENT_FORCE_CLI_ONBOARD:-0}"
NO_PROMPT="${ARGENTOS_NO_PROMPT:-0}"
DRY_RUN="${ARGENTOS_DRY_RUN:-0}"
PACKAGE_SPEC_OVERRIDE="${ARGENT_INSTALL_PACKAGE_SPEC:-}"
NPM_PREFIX_OVERRIDE="${ARGENT_INSTALL_NPM_PREFIX:-}"
BIN_DIR_OVERRIDE="${ARGENT_INSTALL_BIN_DIR:-$HOME/bin}"
PACKAGE_DIR_OVERRIDE="${ARGENT_INSTALL_PACKAGE_DIR:-$HOME/.argentos/lib/node_modules/argentos}"
GIT_REMOTE="${ARGENTOS_GIT_REMOTE:-https://github.com/ArgentAIOS/argentos-core.git}"
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
PNPM_SHIM_DIR=""

usage() {
  cat <<'EOF'
ArgentOS hosted shell installer

Usage:
  bash install-hosted.sh [options]

Options:
  --install-method <git>      Public Core installs are git-only
  --channel <stable|beta|dev> Select release channel (default: stable)
  --beta                      Alias for --channel beta
  --version <version>         Git tag/branch/ref (default: channel-dependent)
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
  ARGENTOS_GIT_REMOTE
  ARGENTOS_DRY_RUN
  ARGENTOS_NO_PROMPT
  ARGENT_NO_ONBOARD
  ARGENT_FORCE_CLI_ONBOARD
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

run_git_nohooks() {
  run_cmd git -c core.hooksPath=/dev/null "$@"
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

  mkdir -p "$runtime_root"
  new_root="${runtime_root}/node.new.$$"
  rm -rf "$new_root"
  mkdir -p "$(dirname "$new_root")"
  mv "$extracted_root" "$new_root"

  backup_root=""
  if [[ -d "$node_root" ]]; then
    backup_root="${runtime_root}/node.old.$$"
    rm -rf "$backup_root"
    mv "$node_root" "$backup_root"
  fi
  mkdir -p "$(dirname "$node_root")"
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
    if [[ -x "$node_dir/pnpm" ]]; then
      PNPM_EXEC="$node_dir/pnpm"
      return 0
    fi
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

ensure_pnpm_shim() {
  local node_dir pnpm_target
  node_dir="$(dirname "$NODE_BIN")"
  PNPM_SHIM_DIR="${RUNTIME_DIR}/bin"

  if is_truthy "$DRY_RUN"; then
    info "Would ensure pnpm shim under ${PNPM_SHIM_DIR}"
    return 0
  fi

  mkdir -p "$PNPM_SHIM_DIR"
  pnpm_target="${PNPM_SHIM_DIR}/pnpm"

  if [[ -x "$node_dir/pnpm" ]]; then
    ln -sf "$node_dir/pnpm" "$pnpm_target"
    return 0
  fi

  [[ -n "$PNPM_EXEC" ]] || return 0
  cat > "$pnpm_target" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec $(printf '%q' "$PNPM_EXEC") ${PNPM_SUBCOMMAND:+$(printf '%q ' "$PNPM_SUBCOMMAND")}"\$@"
EOF
  chmod +x "$pnpm_target"
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
  NPM_BIN="$node_dir/npm"
  if [[ ! -x "$NPM_BIN" ]]; then
    NPM_BIN="$(command -v npm 2>/dev/null || true)"
  fi
  resolve_pnpm_runner "$NODE_BIN" || true
  ensure_pnpm_shim
  if [[ -n "$PNPM_SHIM_DIR" ]]; then
    PATH_LINE="export PATH=\"$node_dir:$PNPM_SHIM_DIR:\$PATH\""
  else
    PATH_LINE="export PATH=\"$node_dir:\$PATH\""
  fi
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
    if [[ "$INSTALL_METHOD" != "git" ]]; then
      err "Unsupported install method: $INSTALL_METHOD"
      err "Public Core installs are git-only. Re-run without --install-method or use --install-method git."
      exit 1
    fi
  fi
  printf 'git\n'
}

resolve_effective_version() {
  if [[ -n "$VERSION" ]]; then
    printf '%s\n' "$VERSION"
    return 0
  fi
  case "$CHANNEL" in
    stable) printf 'latest stable GitHub release tag\n' ;;
    beta) printf 'latest beta-or-stable GitHub release tag\n' ;;
    dev) printf 'main\n' ;;
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
  local path_prefix
  path_prefix="$(dirname "$NODE_BIN")"
  if [[ -n "$PNPM_SHIM_DIR" ]]; then
    path_prefix="$path_prefix:$PNPM_SHIM_DIR"
  fi
  if [[ -n "$PNPM_EXEC" ]]; then
    local pnpm_dir
    pnpm_dir="$(dirname "$PNPM_EXEC")"
    if [[ "$pnpm_dir" != "$path_prefix" ]]; then
      path_prefix="$path_prefix:$pnpm_dir"
    fi
  fi
  if [[ -n "$PNPM_SUBCOMMAND" ]]; then
    PATH="$path_prefix:$PATH" run_cmd "$PNPM_EXEC" "$PNPM_SUBCOMMAND" --dir "$dir" "$@"
  else
    PATH="$path_prefix:$PATH" run_cmd "$PNPM_EXEC" --dir "$dir" "$@"
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
    ARGENT_INSTALLER_ONBOARD=1 "$argent_bin" "${onboard_args[@]}"
    return 0
  fi

  if [[ -r /dev/tty && -w /dev/tty ]]; then
    ARGENT_INSTALLER_ONBOARD=1 "$argent_bin" "${onboard_args[@]}" </dev/tty >/dev/tty 2>/dev/tty
    return 0
  fi

  err "Interactive onboarding requires a terminal. Re-run in a terminal, or pass --no-prompt / --no-onboard."
  exit 1
}

read_master_key_from_keychain() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return 1
  fi
  security find-generic-password -s "ArgentOS-MasterKey" -a "ArgentOS" -w 2>/dev/null || true
}

generate_master_key_inline() {
  local key_path="$HOME/.argentos/.master-key"
  local key_dir
  key_dir="$(dirname "$key_path")"
  mkdir -p "$key_dir"

  if [[ -f "$key_path" ]]; then
    cat "$key_path" 2>/dev/null || true
    return 0
  fi

  local existing_keychain=""
  existing_keychain="$(read_master_key_from_keychain)"
  if [[ "$existing_keychain" =~ ^[0-9a-fA-F]{64}$ ]]; then
    printf '%s' "$existing_keychain" >"$key_path"
    chmod 600 "$key_path" 2>/dev/null || true
    printf '%s' "$existing_keychain"
    return 0
  fi

  local hex=""
  if command -v openssl >/dev/null 2>&1; then
    hex="$(openssl rand -hex 32 2>/dev/null || true)"
  fi
  if [[ ! "$hex" =~ ^[0-9a-fA-F]{64}$ ]]; then
    hex="$("$NODE_BIN" -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" 2>/dev/null || true)"
  fi
  if [[ ! "$hex" =~ ^[0-9a-fA-F]{64}$ ]]; then
    return 1
  fi

  printf '%s' "$hex" >"$key_path"
  chmod 600 "$key_path" 2>/dev/null || true

  if [[ "$(uname -s)" == "Darwin" ]]; then
    security add-generic-password -U -s "ArgentOS-MasterKey" -a "ArgentOS" -w "$hex" >/dev/null 2>&1 || true
  fi

  printf '%s' "$hex"
  return 0
}

should_run_cli_onboard() {
  if is_truthy "$NO_ONBOARD"; then
    return 1
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && ! is_truthy "$FORCE_CLI_ONBOARD"; then
    info "Skipping terminal onboarding on macOS; Argent.app will guide first run."
    return 1
  fi
  return 0
}

persist_bin_dir_on_path() {
  local bin_dir="$1"
  local path_expr="$bin_dir"
  if [[ "$bin_dir" == "$HOME/"* ]]; then
    path_expr="\$HOME/${bin_dir#"$HOME"/}"
  fi
  local marker="# ArgentOS installer PATH"
  local export_line="export PATH=\"${path_expr}:\$PATH\""
  local shell_file
  for shell_file in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    if is_truthy "$DRY_RUN"; then
      printf 'DRY-RUN: ensure PATH stanza in %q\n' "$shell_file"
      continue
    fi
    touch "$shell_file"
    if grep -Fq "$marker" "$shell_file" 2>/dev/null || grep -Fq "$export_line" "$shell_file" 2>/dev/null; then
      continue
    fi
    {
      printf '\n%s\n' "$marker"
      printf '%s\n' "$export_line"
    } >>"$shell_file"
  done
}

persist_cli_aliases() {
  local shell_file
  local marker="# ArgentOS installer alias"
  local alias_line="alias Argent=argent"
  for shell_file in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    if is_truthy "$DRY_RUN"; then
      printf 'DRY-RUN: ensure CLI alias in %q\n' "$shell_file"
      continue
    fi
    touch "$shell_file"
    if grep -Fq "$marker" "$shell_file" 2>/dev/null || grep -Fq "$alias_line" "$shell_file" 2>/dev/null; then
      continue
    fi
    {
      printf '\n%s\n' "$marker"
      printf '%s\n' "$alias_line"
    } >>"$shell_file"
  done
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
  local escaped_git_dir
  printf -v escaped_git_dir '%q' "$GIT_DIR"
  cat > "$bin_dir/argent" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export ARGENT_GIT_DIR=${escaped_git_dir}
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
    persist_bin_dir_on_path "$NPM_PREFIX_OVERRIDE/bin"
    persist_cli_aliases
    info "Ensured shell PATH includes: $NPM_PREFIX_OVERRIDE/bin"
  else
    PATH="$(dirname "$NODE_BIN"):$PATH" run_cmd "$NPM_BIN" install -g "$package_spec"
    target_bin="$(
      PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" bin -g 2>/dev/null
    )/argent"
    ok "Installed globally with npm"
  fi

  if should_run_cli_onboard; then
    run_onboard "$target_bin"
  fi
}

download_argent_app() {
  info "═══ Downloading Argent.app ═══"

  local manifest_url="https://argentos.ai/releases/macos/latest.json"
  local tmp_dir
  tmp_dir="$(mktemp -d)"

  # 1. Fetch release manifest
  info "Checking for latest Argent.app release..."
  local manifest
  manifest="$(curl -fsSL "$manifest_url" 2>/dev/null)" || {
    warn "Could not fetch release manifest from $manifest_url"
    warn "Argent.app not installed — you can download it later from https://argentos.ai"
    return 0
  }

  # 2. Parse manifest (portable JSON parsing with Node --input-type=module)
  local zip_url zip_filename
  zip_url="$(echo "$manifest" | "$NODE_BIN" --input-type=module -e "
    import { readFileSync } from 'fs';
    const m = JSON.parse(readFileSync(0, 'utf8'));
    process.stdout.write(m.macos.artifacts.zip.url);
  " 2>/dev/null)" || zip_url=""
  zip_filename="$(echo "$manifest" | "$NODE_BIN" --input-type=module -e "
    import { readFileSync } from 'fs';
    const m = JSON.parse(readFileSync(0, 'utf8'));
    process.stdout.write(m.macos.artifacts.zip.filename);
  " 2>/dev/null)" || zip_filename=""

  if [[ -z "$zip_url" || -z "$zip_filename" ]]; then
    warn "Could not parse release manifest (url=${zip_url:-empty}, file=${zip_filename:-empty})"
    warn "Argent.app not installed — you can download it later from https://argentos.ai"
    return 0
  fi

  info "Found release: $zip_filename"

  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: curl -fsSL %q -o %q/%q\n' "$zip_url" "$tmp_dir" "$zip_filename"
    printf 'DRY-RUN: unzip → /Applications/Argent.app\n'
    printf 'DRY-RUN: open /Applications/Argent.app\n'
    return 0
  fi

  # 3. Download
  info "Downloading $zip_filename..."
  curl -fsSL "$zip_url" -o "$tmp_dir/$zip_filename" || {
    warn "Download failed: $zip_url"
    warn "Argent.app not installed — you can download it later from https://argentos.ai"
    rm -rf "$tmp_dir"
    return 0
  }
  ok "Downloaded $zip_filename"

  # 4. Install to /Applications
  info "Installing Argent.app to /Applications..."
  rm -rf /Applications/Argent.app 2>/dev/null || true
  (cd "$tmp_dir" && unzip -qo "$zip_filename" 2>/dev/null)
  if [[ -d "$tmp_dir/Argent.app" ]]; then
    ditto "$tmp_dir/Argent.app" /Applications/Argent.app
  elif [[ -d "$tmp_dir/Argent/Argent.app" ]]; then
    ditto "$tmp_dir/Argent/Argent.app" /Applications/Argent.app
  else
    warn "Could not find Argent.app in downloaded archive"
    rm -rf "$tmp_dir"
    return 0
  fi
  rm -rf "$tmp_dir"
  ok "Installed Argent.app to /Applications"
}

launch_argent_app() {
  # Ensure we launch a fresh app process so first-run defaults are re-read.
  killall Argent 2>/dev/null || true

  # Read gateway token from config for authenticated dashboard URLs
  local gw_token=""
  if [[ -f "$HOME/.argentos/argent.json" ]]; then
    gw_token="$("$NODE_BIN" -e "
      try {
        const c = JSON.parse(require('fs').readFileSync('$HOME/.argentos/argent.json','utf8'));
        process.stdout.write(c.gateway?.auth?.token || '');
      } catch {}
    " 2>/dev/null)" || gw_token=""
  fi
  local dash_url="http://127.0.0.1:8080/"
  [[ -n "$gw_token" ]] && dash_url="http://127.0.0.1:8080/?token=${gw_token}"

  echo ""
  echo "  ╔══════════════════════════════════════════════════╗"
  echo "  ║         ArgentOS is ready!                       ║"
  echo "  ╚══════════════════════════════════════════════════╝"
  echo ""
  echo "  How would you like to meet Argent?"
  echo ""
  echo "    1) Launch Argent.app (recommended)"
  echo "       Full native macOS experience with dashboard"
  echo ""
  echo "    2) Open dashboard in browser"
  echo "       ${dash_url}"
  echo ""
  echo "    3) Stay in the terminal"
  echo "       Use: argent chat"
  echo ""

  # Fresh installs should always see the native onboarding flow.
  # If the app has never stored onboarding defaults on this machine,
  # seed an explicit incomplete state before first launch.
  if [[ "$(uname -s)" == "Darwin" ]]; then
    local onboarding_domain="ai.argent.mac"
    if ! defaults read "$onboarding_domain" argent.onboardingSeen >/dev/null 2>&1 \
      && ! defaults read "$onboarding_domain" argent.onboardingVersion >/dev/null 2>&1; then
      defaults write "$onboarding_domain" argent.onboardingSeen -bool false >/dev/null 2>&1 || true
      defaults write "$onboarding_domain" argent.onboardingVersion -int 0 >/dev/null 2>&1 || true
    fi
  fi

  if is_truthy "$NO_PROMPT" || [[ ! -r /dev/tty ]]; then
    info "Launching Argent.app..."
    open -n -a /Applications/Argent.app 2>/dev/null || true
    return 0
  fi

  printf "  Select [1]: " >/dev/tty
  local choice
  IFS= read -r choice </dev/tty 2>/dev/null || choice="1"
  choice="${choice:-1}"

  case "$choice" in
    1)
      info "Launching Argent.app..."
      open -n -a /Applications/Argent.app 2>/dev/null || true
      ok "Argent.app launched"
      ;;
    2)
      info "Opening dashboard in browser..."
      open "$dash_url" 2>/dev/null || true
      ok "Dashboard opened"
      ;;
    3)
      ok "You're in control. Run: argent chat"
      ;;
    *)
      info "Launching Argent.app..."
      open -n -a /Applications/Argent.app 2>/dev/null || true
      ok "Argent.app launched"
      ;;
  esac

  echo ""
  info "Argent.app is always available at: /Applications/Argent.app"
  info "Dashboard: ${dash_url}"
  info "CLI is always available with: argent chat"
  echo ""
}

write_core_distribution_and_storage_defaults() {
  local config_path="$HOME/.argentos/argent.json"
  if is_truthy "$DRY_RUN"; then
    info "Would write Core public-surface + PG/Redis defaults to $config_path"
    return 0
  fi

  mkdir -p "$HOME/.argentos"
  ARGENT_INSTALL_CONFIG_PATH="$config_path" ARGENT_INSTALL_CHANNEL="${CHANNEL:-stable}" "$NODE_BIN" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const configPath = process.env.ARGENT_INSTALL_CONFIG_PATH;
const raw = (() => {
  try {
    return fs.readFileSync(configPath, "utf8");
  } catch {
    return "";
  }
})();

let parsed = {};
if (raw.trim()) {
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
}

// Generate a random 64-char hex token for gateway auth if not already set
const crypto = require("node:crypto");
const existingToken = parsed.gateway?.auth?.token;
const gwToken = existingToken || crypto.randomBytes(32).toString("hex");

const installChannel = process.env.ARGENT_INSTALL_CHANNEL || "stable";

const next = {
  ...parsed,
  update: {
    ...(parsed.update || {}),
    channel: parsed.update?.channel || installChannel,
  },
  gateway: {
    ...(parsed.gateway || {}),
    mode: parsed.gateway?.mode || "local",
    port: parsed.gateway?.port || 18789,
    auth: {
      ...(parsed.gateway?.auth || {}),
      mode: parsed.gateway?.auth?.mode || "token",
      token: gwToken,
    },
  },
  distribution: {
    ...(parsed.distribution || {}),
    surfaceProfile: "public-core",
  },
  storage: {
    ...(parsed.storage || {}),
    backend: "postgres",
    readFrom: "postgres",
    writeTo: ["postgres"],
    postgres: {
      ...((parsed.storage || {}).postgres || {}),
      connectionString: "postgres://localhost:5433/argentos",
    },
    redis: {
      host: "127.0.0.1",
      port: 6380,
      ...((parsed.storage || {}).redis || {}),
    },
  },
};

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
NODE
  ok "Configured Core defaults for public-core surface + PostgreSQL 17 + Redis"
}

provision_core_storage_stack() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return 0
  fi

  mkdir -p "$HOME/Library/LaunchAgents"

  local pg_script="$GIT_DIR/scripts/setup-postgres.sh"
  local redis_script="$GIT_DIR/scripts/setup-redis.sh"

  if [[ ! -f "$pg_script" ]]; then
    err "Missing PostgreSQL setup script: $pg_script"
    exit 1
  fi
  if [[ ! -f "$redis_script" ]]; then
    err "Missing Redis setup script: $redis_script"
    exit 1
  fi

  info "Provisioning PostgreSQL 17 for ArgentOS Core..."
  run_cmd bash "$pg_script"
  info "Provisioning Redis for ArgentOS Core..."
  run_cmd bash "$redis_script"
  write_core_distribution_and_storage_defaults
}

ensure_pg_tables_helper() {
  local pg_script="$GIT_DIR/scripts/ensure-pg-tables.sh"
  [[ -f "$pg_script" ]] && return 0

  local fallback_url="https://argentos.ai/ensure-pg-tables.sh"
  info "Restoring PostgreSQL schema bootstrap helper..."
  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: curl -fsSL %q -o %q\n' "$fallback_url" "$pg_script"
    return 0
  fi
  mkdir -p "$(dirname "$pg_script")"
  curl -fsSL "$fallback_url" -o "$pg_script" 2>/dev/null || return 1
  chmod +x "$pg_script" 2>/dev/null || true
  [[ -f "$pg_script" ]]
}

ensure_workspace_main_alias() {
  local state_dir="$HOME/.argentos"
  local workspace_dir="$state_dir/workspace"
  local workspace_main="$state_dir/workspace-main"
  [[ -d "$workspace_dir" ]] || return 0
  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: ensure workspace-main alias for %q\n' "$workspace_dir"
    return 0
  fi
  if [[ -e "$workspace_main" || -L "$workspace_main" ]]; then
    return 0
  fi
  ln -s "$workspace_dir" "$workspace_main" 2>/dev/null || cp -R "$workspace_dir" "$workspace_main"
}

seed_starter_family() {
  local state_dir="$HOME/.argentos"
  local workspace_dir="$state_dir/workspace"
  local manifest_path="$GIT_DIR/src/agents/starter-family.json"
  [[ -d "$workspace_dir" ]] || return 0
  [[ -f "$manifest_path" ]] || return 0

  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: seed starter family under %q\n' "$state_dir/agents"\n
    return 0
  fi

  ARGENT_STARTER_FAMILY_MANIFEST="$manifest_path" "$NODE_BIN" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const home = process.env.HOME || "";
const stateDir = path.join(home, ".argentos");
const workspaceDir = path.join(stateDir, "workspace");
const agentsRoot = path.join(stateDir, "agents");
const manifestPath = process.env.ARGENT_STARTER_FAMILY_MANIFEST || "";
if (!fs.existsSync(workspaceDir)) process.exit(0);
if (!manifestPath || !fs.existsSync(manifestPath)) process.exit(0);
fs.mkdirSync(agentsRoot, { recursive: true });
const starter = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const bootstrapFiles = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md",
  "HEARTBEAT.md",
  "CONTEMPLATION.md",
  "BOOTSTRAP.md",
  "WORKFLOWS.md",
  "MEMORY.md",
];
for (const agent of starter) {
  const rootDir = path.join(agentsRoot, agent.id);
  const agentDir = path.join(rootDir, "agent");
  fs.mkdirSync(agentDir, { recursive: true });
  for (const file of bootstrapFiles) {
    const src = path.join(workspaceDir, file);
    const dest = path.join(agentDir, file);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
  const identity = [
    "# IDENTITY.md",
    "",
    `- **Name:** ${agent.name}`,
    `- **Role:** ${agent.role}`,
    `- **Team:** ${agent.team}`,
    "",
  ].join("\n");
  const identityPath = path.join(agentDir, "IDENTITY.md");
  if (!fs.existsSync(identityPath)) {
    fs.writeFileSync(identityPath, `${identity}\n`, "utf8");
  }
  const identityJsonPath = path.join(rootDir, "identity.json");
  if (!fs.existsSync(identityJsonPath)) {
    fs.writeFileSync(
      identityJsonPath,
      `${JSON.stringify(
        {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          team: agent.team,
          ...(agent.model ? { model: agent.model } : {}),
          ...(agent.provider ? { provider: agent.provider } : {}),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
}
NODE
}

seed_safe_core_defaults() {
  local state_dir="$HOME/.argentos"
  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: write safe nudges defaults to %q\n' "$state_dir/nudges.json"
    return 0
  fi
  mkdir -p "$state_dir"
  cat > "$state_dir/nudges.json" <<'EOF'
{
  "version": 1,
  "globalEnabled": false,
  "nudges": []
}
EOF
}

install_git() {
  require_command git

  if [[ -d "$GIT_DIR/.git" ]]; then
    info "Using existing checkout: $GIT_DIR"
    run_git_nohooks -C "$GIT_DIR" fetch --tags --prune
  else
    info "Cloning source checkout from $GIT_REMOTE to $GIT_DIR"
    run_git_nohooks clone "$GIT_REMOTE" "$GIT_DIR"
  fi

  # Resolve release-tag placeholders to actual git tags
  if [[ "$VERSION" == "latest stable GitHub release tag" || "$VERSION" == "latest beta-or-stable GitHub release tag" ]]; then
    local resolved_tag=""
    local all_tags
    all_tags="$(git -C "$GIT_DIR" tag --list 'v*' --sort=-v:refname 2>/dev/null)"
    if [[ "$VERSION" == *"beta"* ]]; then
      resolved_tag="$(echo "$all_tags" | head -n 1)"
    else
      while IFS= read -r t; do
        local lower
        lower="$(printf '%s' "$t" | tr '[:upper:]' '[:lower:]')"
        if [[ -n "$t" && "$lower" != *"-beta"* ]]; then
          resolved_tag="$t"
          break
        fi
      done <<< "$all_tags"
    fi
    if [[ -z "$resolved_tag" ]]; then
      err "No stable release tag found in $GIT_DIR"
      exit 1
    fi
    info "Checking out stable release tag: $resolved_tag"
    VERSION="$resolved_tag"
  fi

  if [[ -n "$VERSION" && "$VERSION" != "main" ]]; then
    info "Checking out git ref: $VERSION"
    run_git_nohooks -C "$GIT_DIR" checkout "$VERSION"
    if is_truthy "$GIT_UPDATE"; then
      if git -C "$GIT_DIR" show-ref --verify --quiet "refs/remotes/origin/$VERSION"; then
        info "Updating git ref from origin/$VERSION"
        run_git_nohooks -C "$GIT_DIR" reset --hard "origin/$VERSION"
      fi
    fi
  else
    info "Tracking source checkout on main"
    run_git_nohooks -C "$GIT_DIR" checkout main
    if is_truthy "$GIT_UPDATE"; then
      # Reset lockfile that pnpm install may have modified — will be regenerated below
      run_git_nohooks -C "$GIT_DIR" checkout -- pnpm-lock.yaml 2>/dev/null || true
      run_git_nohooks -C "$GIT_DIR" pull origin main
    fi
  fi

  # Clean stale build artifacts and node_modules to prevent version mismatch
  rm -rf "$GIT_DIR/dist" 2>/dev/null || true
  rm -rf "$GIT_DIR/node_modules/.pnpm" 2>/dev/null || true
  run_pnpm "$GIT_DIR" install --ignore-workspace --frozen-lockfile \
    || run_pnpm "$GIT_DIR" install --ignore-workspace
  # Restore lockfile if pnpm mutated it (keeps git checkout clean for argent update)
  run_git_nohooks -C "$GIT_DIR" checkout -- pnpm-lock.yaml 2>/dev/null || true
  run_pnpm "$GIT_DIR" build
  run_pnpm "$GIT_DIR" rebuild better-sqlite3
  snapshot_git_runtime "$GIT_DIR" "$PACKAGE_DIR_OVERRIDE"
  ok "Installed stable runtime snapshot: $PACKAGE_DIR_OVERRIDE"
  write_git_wrapper "$BIN_DIR_OVERRIDE"
  persist_bin_dir_on_path "$BIN_DIR_OVERRIDE"
  persist_cli_aliases
  ok "Installed git wrapper: $BIN_DIR_OVERRIDE/argent"
  info "Ensured shell PATH includes: $BIN_DIR_OVERRIDE"

  provision_core_storage_stack

  info "Seeding agent workspace..."
  PATH="$(dirname "$NODE_BIN"):$PATH" run_cmd "$BIN_DIR_OVERRIDE/argent" setup
  ensure_workspace_main_alias
  seed_starter_family
  seed_safe_core_defaults
  ok "Seeded agent workspace"

  # Create all PG tables (knowledge, memory, tasks, etc.) using safe CREATE IF NOT EXISTS.
  # Must run AFTER PG is provisioned.
  info "Creating PostgreSQL schema tables..."
  if ensure_pg_tables_helper; then
    bash "$GIT_DIR/scripts/ensure-pg-tables.sh" 2>/dev/null \
      || warn "Table creation failed — run manually: bash ~/argentos/scripts/ensure-pg-tables.sh"
  else
    warn "PostgreSQL schema helper missing and could not be restored"
    warn "Run manually once available: bash ~/argentos/scripts/ensure-pg-tables.sh"
  fi

  # macOS: Download Argent.app from R2 BEFORE onboarding (runs during service setup)
  if [[ "$(uname -s)" == "Darwin" ]]; then
    download_argent_app || true
  fi

  if should_run_cli_onboard; then
    run_onboard "$BIN_DIR_OVERRIDE/argent" || true
  fi

  # Build and start the dashboard (React UI on port 8080)
  info "Setting up dashboard..."
  local dashboard_dir="$GIT_DIR/dashboard"
  local node_dir
  node_dir="$(dirname "$NODE_BIN")"

  if [[ -d "$dashboard_dir" ]]; then
    # Install dashboard deps
    info "Installing dashboard dependencies..."
    PATH="$node_dir:$PATH" run_pnpm "$dashboard_dir" install --ignore-workspace --frozen-lockfile 2>/dev/null \
      || PATH="$node_dir:$PATH" run_pnpm "$dashboard_dir" install --ignore-workspace 2>/dev/null \
      || warn "Dashboard deps failed"
    # Restore root workspace lockfile if dashboard install mutated it
    # (this repo uses a single root pnpm-lock.yaml, not dashboard/pnpm-lock.yaml)
    run_git_nohooks -C "$GIT_DIR" checkout -- pnpm-lock.yaml 2>/dev/null || true

    # Build dashboard (skip tsc — use vite directly to avoid pre-existing TS strict errors)
    info "Building dashboard..."
    (cd "$dashboard_dir" && PATH="$node_dir:$PATH" "$node_dir/npx" --yes vite build 2>&1 | tail -3) \
      || warn "Dashboard build failed — run later: cd ~/argentos/dashboard && npx vite build"

    # Start dashboard UI and API services. The UI proxies /api/* to the API
    # service on port 9242, so both must be running for settings/auth writes.
    if [[ "$(uname -s)" == "Darwin" && -d "$dashboard_dir/dist" ]] && ! is_truthy "$DRY_RUN"; then
      mkdir -p "$HOME/.argentos/logs"

      # Kill anything on 8080/9242 first
      lsof -ti :8080 | xargs kill 2>/dev/null || true
      lsof -ti :9242 | xargs kill 2>/dev/null || true

      local static_server="$dashboard_dir/static-server.cjs"
      local api_server="$dashboard_dir/api-server.cjs"
      if [[ ! -f "$static_server" ]]; then
        warn "Dashboard static server missing at $static_server"
        return 0
      fi
      if [[ ! -f "$api_server" ]]; then
        warn "Dashboard API server missing at $api_server"
        return 0
      fi

      # Start dashboard API in background
      PORT=9242 API_PORT=9242 HOST=127.0.0.1 PATH="$node_dir:$PATH" nohup "$NODE_BIN" "$api_server" \
        > "$HOME/.argentos/logs/dashboard-api.log" 2>&1 &

      # Start dashboard UI in background
      PORT=8080 API_PORT=9242 PATH="$node_dir:$PATH" nohup "$NODE_BIN" "$static_server" \
        > "$HOME/.argentos/logs/dashboard-ui.log" 2>&1 &

      # Create LaunchAgents so services survive reboots
      local api_plist="$HOME/Library/LaunchAgents/ai.argent.dashboard-api.plist"
      cat > "$api_plist" <<APIPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.argent.dashboard-api</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$api_server</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$dashboard_dir</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>$node_dir:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOST</key>
    <string>127.0.0.1</string>
    <key>API_PORT</key>
    <string>9242</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/.argentos/logs/dashboard-api.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/.argentos/logs/dashboard-api.log</string>
</dict>
</plist>
APIPLIST

      local ui_plist="$HOME/Library/LaunchAgents/ai.argent.dashboard-ui.plist"
      cat > "$ui_plist" <<UIPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.argent.dashboard-ui</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$static_server</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$dashboard_dir</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>$node_dir:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOST</key>
    <string>127.0.0.1</string>
    <key>PORT</key>
    <string>8080</string>
    <key>API_PORT</key>
    <string>9242</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/.argentos/logs/dashboard-ui.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/.argentos/logs/dashboard-ui.log</string>
</dict>
</plist>
UIPLIST

      local launch_domain
      launch_domain="gui/$(id -u)"
      /bin/launchctl bootout "$launch_domain" "$api_plist" >/dev/null 2>&1 || true
      /bin/launchctl bootout "$launch_domain" "$ui_plist" >/dev/null 2>&1 || true
      /bin/launchctl bootstrap "$launch_domain" "$api_plist" >/dev/null 2>&1 || true
      /bin/launchctl bootstrap "$launch_domain" "$ui_plist" >/dev/null 2>&1 || true
      /bin/launchctl kickstart -k "$launch_domain/ai.argent.dashboard-api" >/dev/null 2>&1 || true
      /bin/launchctl kickstart -k "$launch_domain/ai.argent.dashboard-ui" >/dev/null 2>&1 || true

      sleep 2
      if lsof -i :9242 >/dev/null 2>&1 && lsof -i :8080 >/dev/null 2>&1; then
        ok "Dashboard running on http://127.0.0.1:8080/ (API on 127.0.0.1:9242)"
      else
        warn "Dashboard may not have started cleanly — check ~/.argentos/logs/dashboard-api.log and ~/.argentos/logs/dashboard-ui.log"
      fi
    elif [[ ! -d "$dashboard_dir/dist" ]]; then
      warn "Dashboard build output missing — dashboard will not be available on port 8080"
    fi
  else
    warn "dashboard/ directory not found"
  fi

  # ── Master Encryption Key Ceremony ──────────────────────────────────
  # This key encrypts all API keys and secrets stored by ArgentOS.
  # If lost, all encrypted secrets become unrecoverable.
  # The operator MUST acknowledge this before we hand off.

  local argent_bin="$BIN_DIR_OVERRIDE/argent"
  local master_key_file="$HOME/.argentos/.master-key"
  local master_key=""

  # Generate key if it doesn't exist
  if [[ ! -f "$master_key_file" ]]; then
    info "Generating master encryption key..."
    master_key="$(generate_master_key_inline)" || master_key=""
  fi

  # Read the key
  if [[ -z "$master_key" && -f "$master_key_file" ]]; then
    master_key="$(cat "$master_key_file" 2>/dev/null)" || master_key=""
  fi

  if [[ -z "$master_key" ]]; then
    # Try backup-key as fallback (checks keychain too)
    master_key="$(PATH="$(dirname "$NODE_BIN"):$PATH" "$argent_bin" secrets backup-key 2>/dev/null | grep -oE '[0-9a-f]{32,}')" || master_key=""
  fi

  if [[ -z "$master_key" ]]; then
    echo ""
    err "═══ MASTER KEY GENERATION FAILED ═══"
    err "Could not generate or locate a master encryption key."
    err "Run manually: argent gateway install --force"
    err "Then verify:  argent secrets backup-key"
    err "Do NOT enter any API keys until this is resolved."
    echo ""
    # Don't proceed to app launch — this is a hard blocker
  else
    # ── Full key ceremony ──────────────────────────────────────────
    echo ""
    echo "  ╔══════════════════════════════════════════════════════════════╗"
    echo "  ║              MASTER ENCRYPTION KEY                          ║"
    echo "  ║              Save this now.                                  ║"
    echo "  ╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "  This key encrypts all API keys and secrets stored by ArgentOS."
    echo "  If you lose this key, all encrypted secrets become unrecoverable."
    echo ""
    echo "  Copy this key now and store it in a safe place."
    echo ""
    echo "  ┌──────────────────────────────────────────────────────────────┐"
    echo "  │ Key: $master_key"
    echo "  └──────────────────────────────────────────────────────────────┘"
    echo ""
    echo "  Stored at: $master_key_file"
    echo ""
    echo "  To restore on another machine:"
    echo "    Dashboard: Settings → Encryption → Restore Key"
    echo "    CLI:       argent secrets restore-key <paste-key-here>"
    echo ""

    if is_truthy "$NO_PROMPT" || [[ ! -r /dev/tty ]]; then
      # Non-interactive — just print and continue
      ok "Master encryption key generated. Back it up immediately."
    else
      # Interactive — require explicit acknowledgment
      while true; do
        printf "  Type YES once you have copied this key: " >/dev/tty
        local ack=""
        IFS= read -r ack </dev/tty 2>/dev/null || ack=""
        ack="$(printf '%s' "$ack" | tr '[:lower:]' '[:upper:]')"
        if [[ "$ack" == "YES" ]]; then
          ok "Key acknowledged. Continuing setup."
          break
        fi
        echo "  Please type YES to confirm you have saved the key."
      done
    fi
    echo ""
  fi

  # Ensure the gateway service is installed before health verification.
  # On macOS we skip terminal onboarding by default because Argent.app guides
  # first-run UX, but the service itself still needs to exist.
  info "Installing gateway service..."
  PATH="$(dirname "$NODE_BIN"):$PATH" "$argent_bin" gateway install --force >/dev/null 2>&1 \
    || warn "Gateway service install failed — run manually: argent gateway install --force"

  # ── Gateway health verification ───────────────────────────────────
  # Deterministic: TCP probe on the gateway port. The gateway binds
  # port 18789 only after full initialisation, so a successful connect
  # means it is ready to accept WebSocket clients.
  # Uses nc (netcat) — available on macOS and Linux by default.
  # /dev/tcp is NOT available on macOS default bash (Apple disables it).
  local gw_port=18789
  local gw_healthy=false
  info "Waiting for gateway on port ${gw_port}..."
  for _attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if nc -z 127.0.0.1 "${gw_port}" 2>/dev/null; then
      gw_healthy=true
      break
    fi
    sleep 2
  done
  if $gw_healthy; then
    ok "Gateway is healthy (port ${gw_port} accepting connections)"
  else
    warn "Gateway did not become healthy within 30 s"
    warn "Check logs: ~/.argentos/logs/gateway.log"
    warn "Or run:     argent gateway status"
  fi

  # macOS: Launch Argent.app after onboarding completes
  if [[ -n "$master_key" && "$(uname -s)" == "Darwin" && -d /Applications/Argent.app ]]; then
    launch_argent_app || true
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
require_command curl
require_command tar

# macOS: check for Homebrew early — required for PostgreSQL, Redis, and system services
if [[ "$(uname -s)" == "Darwin" ]] && ! command -v brew >/dev/null 2>&1; then
  echo ""
  err "Homebrew is required but not installed."
  echo ""
  info "ArgentOS uses Homebrew to install PostgreSQL, Redis, and other"
  info "system services on macOS. Please install Homebrew first:"
  echo ""
  echo "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  echo ""
  info "Then re-run the ArgentOS installer:"
  echo ""
  echo "  curl -fsSL https://argentos.ai/install.sh | bash"
  echo ""
  exit 1
fi

validate_channel
INSTALL_METHOD="$(resolve_effective_install_method)"
VERSION="$(resolve_effective_version)"
activate_runtime

info "Install rail: $INSTALL_METHOD"
info "Channel: $CHANNEL"
info "Version/ref: $VERSION"

install_git
