#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# ArgentOS Installer
#
# Works from a tarball extract OR the git repo root.
# No sudo required. Safe to run multiple times (idempotent).
#
# Usage (from extracted archive):
#   tar xzf argent-*.tar.gz && cd argentos && bash install.sh
#
# Usage (from git repo with a build present):
#   bash install.sh
#
# What this does:
#   1. Creates ~/.argentos (state) and ~/argent (workspace)
#   2. Writes a default config if none exists
#   3. Installs ~/bin/argent + ~/bin/argentos CLI wrappers
#   4. Adds ~/bin to PATH in your shell profile
#   5. Installs LaunchAgents (gateway + dashboard)
#   6. Starts the gateway + dashboard services
# ============================================================================

# -- Colors --
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { printf "${GREEN}  ✓${RESET} %s\n" "$1"; }
warn() { printf "${YELLOW}  ⚠${RESET} %s\n" "$1"; }
err()  { printf "${RED}  ✗${RESET} %s\n" "$1" >&2; }
info() { printf "${CYAN}  →${RESET} %s\n" "$1"; }
step() { printf "\n${BOLD}[$1/$TOTAL_STEPS] %s${RESET}\n" "$2"; }
is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}
version_ge() {
  local left="$1"
  local right="$2"
  [[ "$(printf '%s\n%s\n' "$right" "$left" | sort -V | tail -n1)" == "$left" ]]
}
is_supported_runtime_node() {
  local version="${1#v}"
  local major="${version%%.*}"
  local remainder="${version#*.}"
  local minor="${remainder%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] || return 1
  [[ "$minor" =~ ^[0-9]+$ ]] || minor=0
  if (( major == 22 && minor >= 12 )); then
    return 0
  fi
  if (( major == 24 )); then
    return 0
  fi
  return 1
}
build_local_macos_app_bundle() {
  local root_dir="$1"
  local package_script="$root_dir/scripts/package-mac-app.sh"
  local app_dist="$root_dir/dist/Argent.app"
  local node_dir=""
  local npm_dir=""

  [[ -x "$package_script" ]] || return 1
  command -v swift >/dev/null 2>&1 || return 1
  command -v xcode-select >/dev/null 2>&1 || return 1
  if [[ -n "${NODE_BIN:-}" ]]; then
    node_dir="$(dirname "$NODE_BIN")"
  fi
  if [[ -n "${NPM_BIN:-}" ]]; then
    npm_dir="$(dirname "$NPM_BIN")"
  fi

  info "Building Argent.app from local source checkout..." >&2
  if (
    cd "$root_dir" && \
      PATH="${node_dir:+$node_dir:}${npm_dir:+$npm_dir:}$PATH" \
      ALLOW_ADHOC_SIGNING=1 \
      SKIP_TSC=1 \
      SKIP_UI_BUILD=1 \
      NODE_BIN="${NODE_BIN:-}" \
      NPM_BIN="${NPM_BIN:-}" \
      PNPM_RUNNER="${PNPM_RUNNER:-}" \
      "$package_script" 1>&2
  ); then
    [[ -d "$app_dist" ]] || return 1
    printf '%s\n' "$app_dist"
    return 0
  fi

  return 1
}
is_valid_gateway_token() {
  local token="${1:-}"
  [[ "$token" =~ ^[0-9a-fA-F]{48}$ ]]
}
generate_gateway_token() {
  local token=""
  if command -v openssl >/dev/null 2>&1; then
    if token="$(openssl rand -hex 24 2>/dev/null)" && is_valid_gateway_token "$token"; then
      printf '%s\n' "$token"
      return 0
    fi
  fi
  if command -v python3 >/dev/null 2>&1; then
    if token="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(24))
PY
    )" && is_valid_gateway_token "$token"; then
      printf '%s\n' "$token"
      return 0
    fi
  fi
  if command -v uuidgen >/dev/null 2>&1; then
    if token="$(printf '%s%s\n' "$(uuidgen | tr -d '-')" "$(uuidgen | tr -d '-')" | cut -c1-48)" && is_valid_gateway_token "$token"; then
      printf '%s\n' "$token"
      return 0
    fi
  fi
  err "Could not generate a gateway token (need openssl, python3, or uuidgen)"
  exit 1
}
node_os() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    *) err "Unsupported OS for bundled runtime: $(uname -s)" ; exit 1 ;;
  esac
}
node_arch() {
  case "$(uname -m)" in
    arm64|aarch64) printf 'arm64' ;;
    x86_64|amd64) printf 'x64' ;;
    *) err "Unsupported architecture for bundled runtime: $(uname -m)" ; exit 1 ;;
  esac
}
resolve_requested_node() {
  if [[ -n "${NODE_BIN_OVERRIDE:-}" ]]; then
    printf '%s\n' "$NODE_BIN_OVERRIDE"
    return 0
  fi
  command -v node 2>/dev/null || true
}
install_private_node_runtime() {
  local runtime_root="$1"
  local node_root="$runtime_root/node"
  local os arch tarball url cache_dir cache_path tmp_dir node_bin extracted_root new_root backup_root
  os="$(node_os)"
  arch="$(node_arch)"
  tarball="node-v${NODE_VERSION}-${os}-${arch}.tar.gz"
  url="${NODE_DIST_URL_BASE}/v${NODE_VERSION}/${tarball}"
  cache_dir="${HOME}/.cache/argent-node"
  cache_path="${cache_dir}/${tarball}"

  mkdir -p "$cache_dir" "$runtime_root"
  if [[ ! -f "$cache_path" ]]; then
    info "Downloading private Node runtime v${NODE_VERSION}..." >&2
    curl -fsSL "$url" -o "$cache_path"
  else
    info "Using cached private Node runtime: $cache_path" >&2
  fi

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
  if [[ -x "$node_dir/corepack" ]]; then
    printf '%s %s\n' "$node_dir/corepack" "pnpm"
    return 0
  fi
  if command -v pnpm >/dev/null 2>&1; then
    printf '%s\n' "$(command -v pnpm)"
    return 0
  fi
  return 1
}

TOTAL_STEPS=10
DASHBOARD_PORT="${DASHBOARD_PORT:-8080}"
FULL_STACK_INSTALL="${ARGENT_FULL_STACK_INSTALL:-0}"
INSTALL_STEIPETE_TOOLS="${ARGENT_INSTALL_STEIPETE_TOOLS:-1}"
INSTALL_NOTEBOOKLM_TOOLS="${ARGENT_INSTALL_NOTEBOOKLM_TOOLS:-1}"
INSTALL_NOTEBOOKLM_BROWSER="${ARGENT_INSTALL_NOTEBOOKLM_BROWSER:-1}"
PULL_OLLAMA_MODELS="${ARGENT_PULL_OLLAMA_MODELS:-1}"
OLLAMA_MODELS="${ARGENT_OLLAMA_MODELS:-qwen3:30b-a3b,qwen3:1.7b}"
SKIP_PROFILE_PATH="${ARGENT_SKIP_PROFILE_PATH:-0}"
SKIP_APP_INSTALL="${ARGENT_SKIP_APP_INSTALL:-0}"
SKIP_DASHBOARD_DEPS="${ARGENT_SKIP_DASHBOARD_DEPS:-0}"
SKIP_LAUNCH_AGENTS="${ARGENT_SKIP_LAUNCH_AGENTS:-0}"
SKIP_SERVICE_START="${ARGENT_SKIP_SERVICE_START:-0}"
NODE_VERSION="${ARGENT_NODE_VERSION:-22.22.0}"
NODE_DIST_URL_BASE="${ARGENT_NODE_DIST_URL_BASE:-https://nodejs.org/dist}"
NODE_BIN_OVERRIDE="${ARGENT_NODE_BIN:-}"

# -- macOS only --
if [[ "$(uname -s)" != "Darwin" ]]; then
  err "ArgentOS currently supports macOS only."
  exit 1
fi

ARCH="$(uname -m)"
if [[ "$ARCH" != "arm64" && "$ARCH" != "x86_64" ]]; then
  err "Unsupported architecture: $ARCH"
  exit 1
fi

printf "\n${BOLD}  ArgentOS Installer${RESET}\n"
info "Detected macOS ($ARCH)"

# -- Determine ARGENT_HOME --
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$SCRIPT_DIR/bin/node" && -f "$SCRIPT_DIR/argent.mjs" ]]; then
  # Running from extracted tarball
  ARGENT_HOME="$SCRIPT_DIR"
  info "Source: extracted tarball → $ARGENT_HOME"
elif [[ -f "$SCRIPT_DIR/argent.mjs" && -d "$SCRIPT_DIR/dist" ]]; then
  # Running from repo root with a build present
  ARGENT_HOME="$SCRIPT_DIR"
  info "Source: git checkout → $ARGENT_HOME"
elif [[ -f "$SCRIPT_DIR/../argent.mjs" && -d "$SCRIPT_DIR/../dist" ]]; then
  # Invoked from scripts/ inside the repo
  ARGENT_HOME="$(cd "$SCRIPT_DIR/.." && pwd)"
  info "Source: git checkout (scripts/) → $ARGENT_HOME"
else
  err "Cannot locate ArgentOS runtime."
  err "Run this script from an extracted tarball or a built git checkout."
  exit 1
fi

# ============================================================================
# Step 1: Directory structure
# ============================================================================
step 1 "Creating directory structure"

STATE_DIR="${ARGENT_STATE_DIR:-$HOME/.argentos}"
WORKSPACE_DIR="${ARGENT_WORKSPACE_DIR:-$HOME/argent}"
RUNTIME_DIR="${ARGENT_RUNTIME_DIR:-$STATE_DIR/runtime}"

mkdir -p "$STATE_DIR/data"
ok "State dir: $STATE_DIR"

mkdir -p "$WORKSPACE_DIR/memory/journal"
ok "Workspace: $WORKSPACE_DIR"

# ============================================================================
# Step 2: Minimal config
# ============================================================================
step 2 "Checking configuration"

CONFIG_FILE="$STATE_DIR/argent.json"
if [[ -f "$CONFIG_FILE" ]]; then
  ok "Config already exists: $CONFIG_FILE"
else
  GATEWAY_TOKEN="$(generate_gateway_token)"
  (
    umask 077
    cat > "$CONFIG_FILE" << CONFIGJSON
{
  "gateway": {
    "mode": "local",
    "port": 18789,
    "auth": {
      "mode": "token",
      "token": "$GATEWAY_TOKEN"
    }
  }
}
CONFIGJSON
  )
  chmod 600 "$CONFIG_FILE"
  ok "Created default config: $CONFIG_FILE"
fi

# ============================================================================
# Step 3: CLI wrapper
# ============================================================================
step 3 "Installing CLI wrapper"

BIN_DIR="${ARGENT_BIN_DIR:-$HOME/bin}"
CLI_WRAPPER="$BIN_DIR/argent"
mkdir -p "$BIN_DIR"

# Pick the Node binary
if [[ -x "$ARGENT_HOME/bin/node" ]]; then
  NODE_BIN="$ARGENT_HOME/bin/node"
  WRAPPER_NODE_BIN="\$ARGENT_HOME/bin/node"
  PATH_LINE='export PATH="$ARGENT_HOME/bin:$PATH"'
  info "Using bundled Node runtime: $("$NODE_BIN" --version)"
else
  RESOLVED_NODE="$(resolve_requested_node)"
  if [[ -n "$RESOLVED_NODE" && -x "$RESOLVED_NODE" ]]; then
    SYSTEM_NODE_VERSION="$("$RESOLVED_NODE" -p 'process.versions.node' 2>/dev/null || true)"
    if [[ -n "$SYSTEM_NODE_VERSION" ]] && is_supported_runtime_node "$SYSTEM_NODE_VERSION"; then
      NODE_BIN="$RESOLVED_NODE"
      info "Using compatible system Node: $RESOLVED_NODE (v$SYSTEM_NODE_VERSION)"
    else
      warn "System Node ${SYSTEM_NODE_VERSION:-unknown} at ${RESOLVED_NODE} is outside the supported runtime range; installing a private Node ${NODE_VERSION} runtime."
      NODE_BIN="$(install_private_node_runtime "$RUNTIME_DIR")"
    fi
  else
    info "No compatible system Node detected; installing a private Node ${NODE_VERSION} runtime."
    NODE_BIN="$(install_private_node_runtime "$RUNTIME_DIR")"
  fi
  WRAPPER_NODE_BIN="$NODE_BIN"
  NODE_DIR="$(dirname "$NODE_BIN")"
  PATH_LINE="export PATH=\"$NODE_DIR:\$PATH\""
fi

NPM_BIN="$(dirname "$NODE_BIN")/npm"
if [[ ! -x "$NPM_BIN" ]]; then
  NPM_BIN="$(command -v npm 2>/dev/null || true)"
fi
PNPM_RUNNER="$(resolve_pnpm_runner "$NODE_BIN" || true)"

cat > "$CLI_WRAPPER" << WRAPPER
#!/bin/bash
ARGENT_HOME="${ARGENT_HOME}"
${PATH_LINE}
cd "\$ARGENT_HOME"
exec "${WRAPPER_NODE_BIN}" argent.mjs "\$@"
WRAPPER
chmod +x "$CLI_WRAPPER"
ok "CLI wrapper: $CLI_WRAPPER"

# argentos alias
if [[ ! -f "$BIN_DIR/argentos" ]] || [[ -L "$BIN_DIR/argentos" ]]; then
  ln -sf "$CLI_WRAPPER" "$BIN_DIR/argentos"
  ok "Alias: $BIN_DIR/argentos → argent"
fi

# -- Add ~/bin to PATH in shell profile --
add_to_path() {
  local profile="$1"
  local bin_path="$2"
  [[ ! -f "$profile" ]] && touch "$profile"
  if ! grep -Fq "$bin_path" "$profile" 2>/dev/null; then
    printf '\n# ArgentOS\nexport PATH="%s:$PATH"\n' "$bin_path" >> "$profile"
    ok "Added $bin_path to PATH in $(basename "$profile")"
  else
    ok "$bin_path already in PATH ($(basename "$profile"))"
  fi
}

add_explicit_path_to_profile() {
  local profile="$1"
  local bin_path="$2"
  [[ ! -f "$profile" ]] && touch "$profile"
  if ! grep -Fq "$bin_path" "$profile" 2>/dev/null; then
    printf '\n# ArgentOS Python tools\nexport PATH="%s:$PATH"\n' "$bin_path" >> "$profile"
    ok "Added $bin_path to PATH in $(basename "$profile")"
  fi
}

SHELL_NAME="$(basename "$SHELL")"
if is_truthy "$SKIP_PROFILE_PATH"; then
  info "Skipping shell profile PATH edits (ARGENT_SKIP_PROFILE_PATH=1)"
else
  case "$SHELL_NAME" in
    zsh)  add_to_path "$HOME/.zshrc" "$BIN_DIR" ;;
    bash) add_to_path "$HOME/.bash_profile" "$BIN_DIR"
          add_to_path "$HOME/.bashrc" "$BIN_DIR" ;;
    *)    warn "Unknown shell ($SHELL_NAME). Add $BIN_DIR to your PATH manually." ;;
  esac
fi

export PATH="$BIN_DIR:$PATH"

# ============================================================================
# Step 4: Install optional macOS app bundle (Swift menu bar)
# ============================================================================
step 4 "Installing optional macOS app bundle"

APP_BUNDLE_NEW="$ARGENT_HOME/app/Argent.app"
APP_BUNDLE_LEGACY="$ARGENT_HOME/app/ArgentOS.app"
APP_BUNDLE_DIST="$ARGENT_HOME/dist/Argent.app"
APP_DEST="${ARGENT_APP_DEST:-/Applications/Argent.app}"
APP_SOURCE=""

if [[ -d "$APP_BUNDLE_NEW" ]]; then
  APP_SOURCE="$APP_BUNDLE_NEW"
elif [[ -d "$APP_BUNDLE_LEGACY" ]]; then
  APP_SOURCE="$APP_BUNDLE_LEGACY"
elif [[ -d "$APP_BUNDLE_DIST" ]]; then
  APP_SOURCE="$APP_BUNDLE_DIST"
fi

if is_truthy "$SKIP_APP_INSTALL"; then
  info "Skipping app bundle install (ARGENT_SKIP_APP_INSTALL=1)"
elif [[ -z "$APP_SOURCE" ]] && [[ -d "$ARGENT_HOME/apps/macos" ]]; then
  if APP_SOURCE="$(build_local_macos_app_bundle "$ARGENT_HOME")"; then
    ok "Built local Argent.app bundle"
  else
    warn "Failed to build Argent.app from local source checkout — continuing without app bundle"
  fi
fi

if [[ -n "$APP_SOURCE" ]] && ! is_truthy "$SKIP_APP_INSTALL"; then
  APP_DEST_PARENT="$(dirname "$APP_DEST")"
  APP_TMP_DEST="${APP_DEST}.tmp.$$"
  if mkdir -p "$APP_DEST_PARENT"; then
    rm -rf "$APP_TMP_DEST"
    if cp -R "$APP_SOURCE" "$APP_TMP_DEST"; then
      if [[ -d "$APP_DEST" ]]; then
        rm -rf "$APP_DEST" || warn "Could not remove existing app bundle at $APP_DEST"
      fi
      if mv "$APP_TMP_DEST" "$APP_DEST"; then
        ok "Argent.app → $APP_DEST"
        # Launch it so it appears in menu bar
        open -a "$APP_DEST" 2>/dev/null || true
      else
        warn "Copied Argent.app but could not move it into place at $APP_DEST"
        rm -rf "$APP_TMP_DEST" || true
      fi
    else
      warn "Failed to copy Argent.app to $APP_DEST — continuing without app install"
      rm -rf "$APP_TMP_DEST" || true
    fi
  else
    warn "Could not create app destination directory for $APP_DEST — continuing without app install"
  fi
elif [[ -n "$APP_SOURCE" ]]; then
  :
elif is_truthy "$SKIP_APP_INSTALL"; then
  :
else
  warn "No macOS app bundle available — install Argent.app from DMG if needed"
fi

# ============================================================================
# Step 5: Dashboard dependencies
# ============================================================================
step 5 "Preparing runtime dependencies"

if [[ -d "$ARGENT_HOME/node_modules" ]]; then
  if [[ -n "$PNPM_RUNNER" ]]; then
    info "Rebuilding CLI native addons for $("$NODE_BIN" --version)..."
    if [[ "$PNPM_RUNNER" == *" "* ]]; then
      IFS=' ' read -r PNPM_BIN PNPM_SUBCOMMAND <<< "$PNPM_RUNNER"
      (cd "$ARGENT_HOME" && PATH="$(dirname "$NODE_BIN"):$PATH" "$PNPM_BIN" "$PNPM_SUBCOMMAND" rebuild better-sqlite3 2>&1 | tail -5) && \
        ok "CLI native addons rebuilt" || \
        warn "CLI native addon rebuild had errors — the CLI may fail to load better-sqlite3"
    else
      (cd "$ARGENT_HOME" && PATH="$(dirname "$NODE_BIN"):$PATH" "$PNPM_RUNNER" rebuild better-sqlite3 2>&1 | tail -5) && \
        ok "CLI native addons rebuilt" || \
        warn "CLI native addon rebuild had errors — the CLI may fail to load better-sqlite3"
    fi
  elif [[ -n "$NPM_BIN" && -x "$NPM_BIN" ]]; then
    info "Rebuilding CLI native addons for $("$NODE_BIN" --version)..."
    (cd "$ARGENT_HOME" && PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" rebuild better-sqlite3 2>&1 | tail -5) && \
      ok "CLI native addons rebuilt" || \
      warn "CLI native addon rebuild had errors — the CLI may fail to load better-sqlite3"
  else
    warn "Neither pnpm nor npm is available for the selected runtime; skipping CLI native addon rebuild"
  fi
else
  warn "Repo dependencies are missing at $ARGENT_HOME/node_modules — run 'pnpm install' before install.sh"
fi

DASHBOARD_DIR="$ARGENT_HOME/dashboard"
if [[ -d "$DASHBOARD_DIR" ]]; then
  if is_truthy "$SKIP_DASHBOARD_DEPS"; then
    info "Skipping dashboard dependency install/rebuild (ARGENT_SKIP_DASHBOARD_DEPS=1)"
  elif [[ ! -d "$DASHBOARD_DIR/node_modules" ]]; then
    info "Running npm install (compiles native addons for this machine)..."
    if [[ -n "$NPM_BIN" && -x "$NPM_BIN" ]]; then
      # Full install (not --production) — vite+react are devDeps needed at runtime
      (cd "$DASHBOARD_DIR" && PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" install 2>&1 | tail -5) && \
        ok "Dashboard dependencies installed" || \
        warn "npm install had errors — dashboard may not start cleanly"
    else
      warn "npm not found for the selected runtime — skipping dashboard deps"
    fi
  else
    ok "Dashboard dependencies already installed"
  fi

  if ! is_truthy "$SKIP_DASHBOARD_DEPS"; then
    if [[ -n "$NPM_BIN" && -x "$NPM_BIN" ]]; then
      info "Rebuilding dashboard native addons for $("$NODE_BIN" --version)..."
      (cd "$DASHBOARD_DIR" && PATH="$(dirname "$NODE_BIN"):$PATH" HUSKY=0 "$NPM_BIN" rebuild better-sqlite3 2>&1 | tail -3) && \
        ok "Dashboard native addons rebuilt" || \
        warn "npm rebuild had errors — dashboard API may fail to load better-sqlite3"
    else
      warn "npm not found for the selected runtime — skipping dashboard native addon rebuild"
    fi
  fi
else
  warn "Dashboard directory not found at $DASHBOARD_DIR"
fi

# ============================================================================
# Step 6: Research CLI requirements + optional full-stack provisioning
# ============================================================================
step 6 "Research CLI requirements + optional full-stack provisioning"

if is_truthy "$INSTALL_NOTEBOOKLM_TOOLS"; then
  info "Checking YouTube + NotebookLM research prerequisites (yt-dlp, notebooklm)"
  PYTHON_BIN="$(command -v python3 2>/dev/null || true)"
  if [[ -z "$PYTHON_BIN" ]]; then
    warn "python3 not found — cannot auto-install yt-dlp/notebooklm CLI"
  elif ! "$PYTHON_BIN" -m pip --version >/dev/null 2>&1; then
    warn "python3 -m pip unavailable — cannot auto-install yt-dlp/notebooklm CLI"
  else
    PY_USER_BIN="$("$PYTHON_BIN" -c 'import site; print(site.USER_BASE + "/bin")' 2>/dev/null || true)"
    if [[ -n "$PY_USER_BIN" ]]; then
      mkdir -p "$PY_USER_BIN"
      export PATH="$PY_USER_BIN:$PATH"
      case "$SHELL_NAME" in
        zsh)  add_explicit_path_to_profile "$HOME/.zshrc" "$PY_USER_BIN" ;;
        bash) add_explicit_path_to_profile "$HOME/.bash_profile" "$PY_USER_BIN"
              add_explicit_path_to_profile "$HOME/.bashrc" "$PY_USER_BIN" ;;
        *)    warn "Unknown shell ($SHELL_NAME). Add $PY_USER_BIN to PATH manually if needed." ;;
      esac
    fi

    if command -v yt-dlp >/dev/null 2>&1; then
      ok "yt-dlp already installed"
    else
      info "Installing yt-dlp with python user packages"
      if "$PYTHON_BIN" -m pip install --user --upgrade yt-dlp >/dev/null 2>&1; then
        ok "Installed yt-dlp"
      else
        warn "Failed to install yt-dlp automatically (run: python3 -m pip install --user yt-dlp)"
      fi
    fi

    if command -v notebooklm >/dev/null 2>&1; then
      ok "notebooklm CLI already installed"
    else
      info "Installing notebooklm-py[browser] with python user packages"
      if "$PYTHON_BIN" -m pip install --user --upgrade "notebooklm-py[browser]" >/dev/null 2>&1; then
        ok "Installed notebooklm CLI"
      else
        warn "Failed to install notebooklm CLI automatically (run: python3 -m pip install --user \"notebooklm-py[browser]\")"
      fi
    fi

    if command -v notebooklm >/dev/null 2>&1; then
      if is_truthy "$INSTALL_NOTEBOOKLM_BROWSER"; then
        info "Ensuring Playwright Chromium for NotebookLM login flow"
        if "$PYTHON_BIN" -m playwright install chromium >/dev/null 2>&1; then
          ok "Playwright Chromium ready"
        else
          warn "Failed to install Playwright Chromium (run: python3 -m playwright install chromium)"
        fi
      else
        info "Skipping Playwright Chromium install (ARGENT_INSTALL_NOTEBOOKLM_BROWSER=0)"
      fi
      info "NotebookLM requires one-time auth. Run: notebooklm login"
    fi
  fi
else
  info "Skipping NotebookLM/yt-dlp setup (ARGENT_INSTALL_NOTEBOOKLM_TOOLS=0)"
fi

if ! is_truthy "$FULL_STACK_INSTALL"; then
  info "Skipping full-stack provisioning (set ARGENT_FULL_STACK_INSTALL=1 to enable)"
else
  if ! command -v brew >/dev/null 2>&1; then
    warn "Homebrew not found — skipping PostgreSQL/Redis/Ollama/tool provisioning"
    warn "Install Homebrew first, then rerun with ARGENT_FULL_STACK_INSTALL=1"
  else
    BREW_PREFIX="$(brew --prefix)"
    info "Using Homebrew at $BREW_PREFIX"

    CORE_FORMULAE=(
      postgresql@17
      pgvector
      redis
      jq
      ripgrep
      fd
      ffmpeg
      ollama
    )
    for formula in "${CORE_FORMULAE[@]}"; do
      if brew list "$formula" >/dev/null 2>&1; then
        ok "brew formula present: $formula"
      else
        info "Installing brew formula: $formula"
        if brew install "$formula" >/dev/null 2>&1; then
          ok "Installed: $formula"
        else
          warn "Failed to install $formula"
        fi
      fi
    done

    if is_truthy "$INSTALL_STEIPETE_TOOLS"; then
      info "Installing steipete CLI toolchain"
      brew tap steipete/tap >/dev/null 2>&1 || true
      STEIPETE_FORMULAE=(
        imsg
        peekaboo
        oracle
        sag
        camsnap
        summarize
        blucli
        wacli
        gifgrep
        mcporter
        ordercli
        songsee
        sonoscli
        codexbar
        spogo
      )
      for formula in "${STEIPETE_FORMULAE[@]}"; do
        tap_formula="steipete/tap/$formula"
        if brew list "$tap_formula" >/dev/null 2>&1 || brew list "$formula" >/dev/null 2>&1; then
          ok "steipete tool present: $formula"
        else
          if ! brew info "$tap_formula" >/dev/null 2>&1; then
            warn "steipete tool unavailable on this platform: $formula"
            continue
          fi
          info "Installing steipete tool: $formula"
          if brew install "$tap_formula" >/dev/null 2>&1; then
            ok "Installed: $formula"
          else
            warn "Failed to install steipete tool: $formula"
          fi
        fi
      done
    else
      info "Skipping steipete toolchain (ARGENT_INSTALL_STEIPETE_TOOLS=0)"
    fi

    ARGENT_PG_PORT=5433
    ARGENT_PG_DB="argentos"
    PG_DATA="$BREW_PREFIX/var/postgresql@17"
    PG_CONF="$PG_DATA/postgresql.conf"
    INITDB="$BREW_PREFIX/opt/postgresql@17/bin/initdb"
    PSQL="$BREW_PREFIX/opt/postgresql@17/bin/psql"

    if [[ ! -f "$PG_CONF" ]]; then
      info "Initializing PostgreSQL 17 data dir"
      mkdir -p "$PG_DATA"
      if "$INITDB" -D "$PG_DATA" >/dev/null 2>&1; then
        ok "PostgreSQL cluster initialized"
      else
        warn "Failed to initialize PostgreSQL cluster"
      fi
    fi

    if [[ -f "$PG_CONF" ]]; then
      if ! grep -Eq "^[[:space:]]*port[[:space:]]*=[[:space:]]*${ARGENT_PG_PORT}([[:space:]]|$)" "$PG_CONF" 2>/dev/null; then
        sed -E -i '' "s/^[[:space:]]*#?[[:space:]]*port[[:space:]]*=.*/port = ${ARGENT_PG_PORT}/" "$PG_CONF" || true
      fi
    fi

    wait_for_pg() {
      local pg_port="$1"
      for _ in {1..30}; do
        if "$PSQL" -h 127.0.0.1 -p "$pg_port" -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
          return 0
        fi
        sleep 1
      done
      return 1
    }

    if brew services restart postgresql@17 >/dev/null 2>&1 || brew services start postgresql@17 >/dev/null 2>&1; then
      ok "PostgreSQL service started"
    else
      warn "Failed to start PostgreSQL service"
    fi

    if ! wait_for_pg "$ARGENT_PG_PORT"; then
      if wait_for_pg 5432; then
        warn "PostgreSQL is reachable on 5432 (expected ${ARGENT_PG_PORT}); forcing port override + restart"
        if [[ -f "$PG_CONF" ]]; then
          sed -E -i '' "s/^[[:space:]]*#?[[:space:]]*port[[:space:]]*=.*/port = ${ARGENT_PG_PORT}/" "$PG_CONF" || true
        fi
        brew services restart postgresql@17 >/dev/null 2>&1 || true
      fi
    fi

    if wait_for_pg "$ARGENT_PG_PORT"; then
      "$PSQL" -p "$ARGENT_PG_PORT" -d postgres -c "CREATE DATABASE ${ARGENT_PG_DB};" >/dev/null 2>&1 || true
      "$PSQL" -p "$ARGENT_PG_PORT" -d "$ARGENT_PG_DB" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1 || true
      "$PSQL" -p "$ARGENT_PG_PORT" -d "$ARGENT_PG_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;" >/dev/null 2>&1 || true
      ok "PostgreSQL ready at postgres://localhost:${ARGENT_PG_PORT}/${ARGENT_PG_DB}"
    else
      warn "PostgreSQL not reachable on port ${ARGENT_PG_PORT}"
    fi

    ARGENT_REDIS_PORT=6380
    LAUNCH_AGENTS_DIR="${ARGENT_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
    ARGENT_REDIS_CONF_DIR="${STATE_DIR}/redis"
    ARGENT_REDIS_CONF="${ARGENT_REDIS_CONF_DIR}/redis.conf"
    ARGENT_REDIS_DATA="${STATE_DIR}/redis/data"
    ARGENT_REDIS_LOG="${STATE_DIR}/logs/redis.log"
    REDIS_SERVER="$BREW_PREFIX/bin/redis-server"
    REDIS_CLI="$BREW_PREFIX/bin/redis-cli"
    REDIS_PLIST="${LAUNCH_AGENTS_DIR}/ai.argent.redis.plist"

    mkdir -p "$ARGENT_REDIS_CONF_DIR" "$ARGENT_REDIS_DATA" "$(dirname "$ARGENT_REDIS_LOG")" "$LAUNCH_AGENTS_DIR"
    cat > "$ARGENT_REDIS_CONF" << REDISCONF
port ${ARGENT_REDIS_PORT}
bind 127.0.0.1
protected-mode yes
daemonize no
appendonly yes
appendfilename "argentos.aof"
dir ${ARGENT_REDIS_DATA}
maxmemory 256mb
maxmemory-policy allkeys-lru
loglevel notice
logfile ${ARGENT_REDIS_LOG}
stream-node-max-bytes 4096
stream-node-max-entries 100
REDISCONF

    cat > "$REDIS_PLIST" << REDISPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.argent.redis</string>
    <key>ProgramArguments</key>
    <array>
        <string>${REDIS_SERVER}</string>
        <string>${ARGENT_REDIS_CONF}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>${ARGENT_REDIS_LOG}</string>
    <key>StandardOutPath</key>
    <string>${ARGENT_REDIS_LOG}</string>
</dict>
</plist>
REDISPLIST

    wait_for_redis() {
      local redis_port="$1"
      for _ in {1..30}; do
        if "$REDIS_CLI" -p "$redis_port" ping 2>/dev/null | grep -q "PONG"; then
          return 0
        fi
        sleep 1
      done
      return 1
    }

    launchctl bootout "gui/$(id -u)/ai.argent.redis" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$REDIS_PLIST" >/dev/null 2>&1 || true
    launchctl kickstart "gui/$(id -u)/ai.argent.redis" >/dev/null 2>&1 || true
    if wait_for_redis "$ARGENT_REDIS_PORT"; then
      ok "Redis ready on port ${ARGENT_REDIS_PORT}"
    else
      warn "Redis failed to start on port ${ARGENT_REDIS_PORT}"
      if wait_for_redis 6379; then
        warn "Redis appears to be running on default port 6379; ArgentOS expects ${ARGENT_REDIS_PORT}"
      fi
      launchctl print "gui/$(id -u)/ai.argent.redis" >/dev/null 2>&1 || warn "LaunchAgent ai.argent.redis did not load cleanly"
    fi

    if brew services start ollama >/dev/null 2>&1; then
      ok "Ollama service started"
    else
      warn "Failed to start Ollama via brew services"
    fi

    if command -v ollama >/dev/null 2>&1; then
      OLLAMA_READY=0
      for _ in {1..20}; do
        if ollama list >/dev/null 2>&1; then
          OLLAMA_READY=1
          break
        fi
        sleep 1
      done

      if [[ "$OLLAMA_READY" -eq 1 ]]; then
        ok "Ollama API reachable"
        if is_truthy "$PULL_OLLAMA_MODELS"; then
          IFS=',' read -r -a OLLAMA_MODEL_LIST <<< "$OLLAMA_MODELS"
          for model in "${OLLAMA_MODEL_LIST[@]}"; do
            model="$(echo "$model" | xargs)"
            [[ -z "$model" ]] && continue
            if ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "$model"; then
              ok "Ollama model present: $model"
            else
              info "Pulling Ollama model: $model"
              if ollama pull "$model" >/dev/null 2>&1; then
                ok "Pulled model: $model"
              else
                warn "Failed to pull Ollama model: $model"
              fi
            fi
          done
        else
          info "Skipping Ollama model pull (ARGENT_PULL_OLLAMA_MODELS=0)"
        fi
      else
        warn "Ollama API not reachable; skipping model checks"
      fi
    else
      warn "Ollama CLI not found after install attempt"
    fi

    if [[ -f "$CONFIG_FILE" ]]; then
      ARGENT_CONFIG_FILE="$CONFIG_FILE" ARGENT_PG_PORT="$ARGENT_PG_PORT" ARGENT_PG_DB="$ARGENT_PG_DB" "$NODE_BIN" << 'NODE'
const fs = require("node:fs");
const path = process.env.ARGENT_CONFIG_FILE;
if (!path) process.exit(0);
let raw = "";
try {
  raw = fs.readFileSync(path, "utf-8");
} catch {
  process.exit(0);
}
let cfg;
try {
  cfg = JSON.parse(raw);
} catch {
  process.exit(0);
}
const next = { ...cfg };
const storage = typeof next.storage === "object" && next.storage ? { ...next.storage } : {};
if (!storage.backend) storage.backend = "dual";
if (!storage.readFrom) storage.readFrom = "sqlite";
if (!Array.isArray(storage.writeTo) || storage.writeTo.length === 0) {
  storage.writeTo = ["sqlite", "postgres"];
}
if (!storage.postgres || typeof storage.postgres !== "object") storage.postgres = {};
if (!storage.postgres.connectionString) {
  storage.postgres.connectionString = `postgres://localhost:${process.env.ARGENT_PG_PORT || "5433"}/${process.env.ARGENT_PG_DB || "argentos"}`;
}
if (!storage.redis || typeof storage.redis !== "object") storage.redis = {};
if (!storage.redis.host) storage.redis.host = "127.0.0.1";
if (!storage.redis.port) storage.redis.port = 6380;
next.storage = storage;
if (JSON.stringify(next) !== JSON.stringify(cfg)) {
  fs.writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
}
NODE
      ok "Config checked for PostgreSQL/Redis defaults"
    fi
  fi
fi

# ============================================================================
# Step 7: Port conflict check
# ============================================================================
step 7 "Checking for port conflicts"

check_port() {
  local port=$1 label=$2
  if lsof -iTCP:"$port" -sTCP:LISTEN -t &>/dev/null; then
    warn "Port $port ($label) is already in use — service may fail to bind"
  else
    ok "Port $port ($label) is free"
  fi
}
check_port 18789 "Gateway"
check_port 9242  "Dashboard API"
check_port 8080  "Dashboard UI"
step 8 "Installing LaunchAgents"

LAUNCH_AGENTS_DIR="${ARGENT_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
PLIST_PATH="$LAUNCH_AGENTS_DIR/ai.argent.gateway.plist"
UI_PLIST_PATH="$LAUNCH_AGENTS_DIR/ai.argent.dashboard-ui.plist"
API_PLIST_PATH="$LAUNCH_AGENTS_DIR/ai.argent.dashboard-api.plist"

if is_truthy "$SKIP_LAUNCH_AGENTS"; then
  info "Skipping LaunchAgent install (ARGENT_SKIP_LAUNCH_AGENTS=1)"
else
  info "Installing gateway LaunchAgent..."
  "$NODE_BIN" "$ARGENT_HOME/argent.mjs" daemon install 2>&1 | while IFS= read -r line; do
    info "$line"
  done

  if [[ -f "$PLIST_PATH" ]]; then
    ok "Gateway LaunchAgent installed"
  else
    warn "Gateway LaunchAgent plist not found — check 'argent daemon install' output"
  fi

  info "Installing dashboard LaunchAgents..."
  "$NODE_BIN" "$ARGENT_HOME/argent.mjs" cs install 2>&1 | while IFS= read -r line; do
    info "$line"
  done

  if [[ -f "$UI_PLIST_PATH" && -f "$API_PLIST_PATH" ]]; then
    ok "Dashboard LaunchAgents installed"
  else
    warn "Dashboard LaunchAgent plists missing — check 'argent cs install' output"
  fi
fi

# ============================================================================
# Step 9: Start gateway
# ============================================================================
step 9 "Starting gateway"

if is_truthy "$SKIP_LAUNCH_AGENTS" || is_truthy "$SKIP_SERVICE_START"; then
  info "Skipping gateway start (LaunchAgents/services disabled for this run)"
elif launchctl list 2>/dev/null | grep -q "ai.argent.gateway"; then
  ok "Gateway already running"
else
  if [[ -f "$PLIST_PATH" ]]; then
    launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
    launchctl kickstart "gui/$(id -u)/ai.argent.gateway" 2>/dev/null || true
    sleep 1
    if launchctl list 2>/dev/null | grep -q "ai.argent.gateway"; then
      ok "Gateway started"
    else
      warn "Gateway may not have started — check 'argent gateway status'"
    fi
  else
    warn "No LaunchAgent plist — skipping gateway start"
  fi
fi

# ============================================================================
# Step 10: Start dashboard services
# ============================================================================
step 10 "Starting dashboard services"

if is_truthy "$SKIP_LAUNCH_AGENTS" || is_truthy "$SKIP_SERVICE_START"; then
  info "Skipping dashboard service start (LaunchAgents/services disabled for this run)"
elif [[ ! -f "$UI_PLIST_PATH" || ! -f "$API_PLIST_PATH" ]]; then
  warn "Dashboard LaunchAgent plist(s) missing — skipping dashboard service start"
else
  if launchctl list 2>/dev/null | grep -q "ai.argent.dashboard-ui"; then
    ok "Dashboard UI service already running"
  else
    launchctl bootstrap "gui/$(id -u)" "$UI_PLIST_PATH" 2>/dev/null || true
    launchctl kickstart "gui/$(id -u)/ai.argent.dashboard-ui" 2>/dev/null || true
  fi

  if launchctl list 2>/dev/null | grep -q "ai.argent.dashboard-api"; then
    ok "Dashboard API service already running"
  else
    launchctl bootstrap "gui/$(id -u)" "$API_PLIST_PATH" 2>/dev/null || true
    launchctl kickstart "gui/$(id -u)/ai.argent.dashboard-api" 2>/dev/null || true
  fi

  sleep 1
  if launchctl list 2>/dev/null | grep -q "ai.argent.dashboard-ui"; then
    ok "Dashboard UI service started"
  else
    warn "Dashboard UI may not have started — check: launchctl print gui/$(id -u)/ai.argent.dashboard-ui"
  fi
  if launchctl list 2>/dev/null | grep -q "ai.argent.dashboard-api"; then
    ok "Dashboard API service started"
  else
    warn "Dashboard API may not have started — check: launchctl print gui/$(id -u)/ai.argent.dashboard-api"
  fi
fi

# ============================================================================
# Step 7: Done
# ============================================================================
printf "\n${BOLD}  ✓ All steps complete${RESET}\n"

printf "\n"
printf "${BOLD}  ArgentOS is ready!${RESET}\n"
printf "\n"
printf "  ${CYAN}Dashboard:${RESET}  http://localhost:${DASHBOARD_PORT}\n"
printf "  ${CYAN}CLI:${RESET}        argent --help\n"
printf "  ${CYAN}Gateway:${RESET}    argent gateway status\n"
printf "  ${CYAN}State dir:${RESET}  ${STATE_DIR}\n"
printf "  ${CYAN}Workspace:${RESET}  ${WORKSPACE_DIR}\n"
printf "\n"
printf "  Open ${BOLD}http://localhost:${DASHBOARD_PORT}${RESET} in your browser to get started.\n"
printf "\n"

if command -v notebooklm >/dev/null 2>&1; then
  info "NotebookLM CLI detected. Run 'notebooklm login' once before using youtube_notebooklm."
fi

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  warn "Restart your terminal (or run: export PATH=\"$BIN_DIR:\$PATH\")"
fi
