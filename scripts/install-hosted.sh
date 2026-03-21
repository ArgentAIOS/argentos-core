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

INSTALL_METHOD="${ARGENTOS_INSTALL_METHOD:-npm}"
VERSION="${ARGENT_INSTALL_VERSION:-latest}"
GIT_DIR="${ARGENTOS_GIT_DIR:-$HOME/argentos}"
GIT_UPDATE=1
NO_ONBOARD="${ARGENT_NO_ONBOARD:-0}"
NO_PROMPT="${ARGENTOS_NO_PROMPT:-0}"
DRY_RUN="${ARGENTOS_DRY_RUN:-0}"
PACKAGE_SPEC_OVERRIDE="${ARGENT_INSTALL_PACKAGE_SPEC:-}"
NPM_PREFIX_OVERRIDE="${ARGENT_INSTALL_NPM_PREFIX:-}"
BIN_DIR_OVERRIDE="${ARGENT_INSTALL_BIN_DIR:-$HOME/bin}"

usage() {
  cat <<'EOF'
ArgentOS hosted shell installer

Usage:
  bash install.sh [options]

Options:
  --install-method <npm|git>  Install globally via npm or from a git checkout
  --version <version>         Package version/tag (default: latest)
  --git-dir <path>            Source checkout path for git installs
  --no-git-update             Do not pull when an existing git checkout is present
  --no-onboard                Skip onboarding after install
  --no-prompt                 Disable prompts
  --dry-run                   Print actions only
  --help                      Show this help

Environment equivalents:
  ARGENTOS_INSTALL_METHOD
  ARGENTOS_GIT_DIR
  ARGENTOS_DRY_RUN
  ARGENTOS_NO_PROMPT
  ARGENT_NO_ONBOARD
  ARGENT_INSTALL_PACKAGE_SPEC
  ARGENT_INSTALL_NPM_PREFIX
  ARGENT_INSTALL_BIN_DIR
EOF
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

ensure_node() {
  require_command node
  require_command npm
  local version
  version="$(node -p 'process.versions.node' 2>/dev/null || true)"
  if [[ -z "$version" ]]; then
    err "Unable to determine Node.js version."
    exit 1
  fi
  local major="${version%%.*}"
  if [[ "${major:-0}" -lt 22 ]]; then
    err "Node.js 22+ is required. Current version: $version"
    exit 1
  fi
  ok "Using Node.js $version"
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  require_command corepack
  if is_truthy "$DRY_RUN"; then
    printf 'DRY-RUN: corepack enable pnpm\n'
    return 0
  fi
  corepack enable pnpm >/dev/null 2>&1 || true
  command -v pnpm >/dev/null 2>&1 || {
    err "pnpm is required for git installs."
    exit 1
  }
}

install_npm() {
  local package_spec="${PACKAGE_SPEC_OVERRIDE:-argentos@${VERSION}}"
  local target_bin="argent"

  info "Installing $package_spec via npm"
  if [[ -n "$NPM_PREFIX_OVERRIDE" ]]; then
    mkdir -p "$NPM_PREFIX_OVERRIDE"
    run_cmd npm install -g --prefix "$NPM_PREFIX_OVERRIDE" "$package_spec"
    target_bin="$NPM_PREFIX_OVERRIDE/bin/argent"
    ok "Installed into prefix: $NPM_PREFIX_OVERRIDE"
    info "Add this to PATH if needed: $NPM_PREFIX_OVERRIDE/bin"
  else
    run_cmd npm install -g "$package_spec"
    ok "Installed globally with npm"
  fi

  if ! is_truthy "$NO_ONBOARD"; then
    run_cmd "$target_bin" onboard --install-daemon
  fi
}

write_git_wrapper() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/argent" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$GIT_DIR"
exec node "$GIT_DIR/argent.mjs" "\$@"
EOF
  chmod +x "$bin_dir/argent"
  ln -sf "$bin_dir/argent" "$bin_dir/argentos"
}

install_git() {
  require_command git
  ensure_pnpm

  if [[ -d "$GIT_DIR/.git" ]]; then
    info "Using existing checkout: $GIT_DIR"
    if is_truthy "$GIT_UPDATE"; then
      run_cmd git -C "$GIT_DIR" pull --rebase
    else
      info "Skipping git update (--no-git-update)"
    fi
  else
    info "Cloning source checkout to $GIT_DIR"
    run_cmd git clone https://github.com/ArgentAIOS/argentos.git "$GIT_DIR"
  fi

  run_cmd pnpm --dir "$GIT_DIR" install
  run_cmd pnpm --dir "$GIT_DIR" build
  write_git_wrapper "$BIN_DIR_OVERRIDE"
  ok "Installed git wrapper: $BIN_DIR_OVERRIDE/argent"
  info "Add this to PATH if needed: $BIN_DIR_OVERRIDE"

  if ! is_truthy "$NO_ONBOARD"; then
    run_cmd "$BIN_DIR_OVERRIDE/argent" onboard --install-daemon
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-method)
      [[ $# -ge 2 ]] || { err "Missing value for --install-method"; exit 1; }
      INSTALL_METHOD="$2"
      shift 2
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
ensure_node

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
