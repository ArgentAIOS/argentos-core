#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

ok()   { printf "${GREEN}  ✓${RESET} %s\n" "$1"; }
warn() { printf "${YELLOW}  ⚠${RESET} %s\n" "$1" >&2; }
err()  { printf "${RED}  ✗${RESET} %s\n" "$1" >&2; }
info() { printf "${CYAN}  →${RESET} %s\n" "$1"; }

PREFIX="${HOME}/.argent"
VERSION="latest"
JSON=0
NO_ONBOARD=0
SET_NPM_PREFIX=0

NODE_VERSION="${ARGENT_NODE_VERSION:-v22.14.0}"
NODE_BIN_OVERRIDE="${ARGENT_NODE_BIN:-}"
NODE_DIST_URL_BASE="${ARGENT_NODE_DIST_URL_BASE:-https://nodejs.org/dist}"
PACKAGE_SPEC_OVERRIDE="${ARGENT_INSTALL_PACKAGE_SPEC:-}"
PACKAGE_TGZ_OVERRIDE="${ARGENT_INSTALL_SOURCE_TGZ:-}"

usage() {
  cat <<'EOF'
ArgentOS CLI installer

Usage:
  bash install-cli.sh [options]

Options:
  --prefix <path>      Install prefix (default: ~/.argent)
  --version <version>  Package version/tag (default: latest)
  --json               Emit JSON event lines for app integration
  --no-onboard         Skip onboarding after install
  --set-npm-prefix     Print PATH guidance for the chosen prefix
  --help               Show this help

Environment overrides:
  ARGENT_NODE_BIN=<path>            Use an existing Node 22+ binary
  ARGENT_NODE_VERSION=<version>     Node release to download if Node is absent
  ARGENT_NODE_DIST_URL_BASE=<url>   Override Node distribution base URL
  ARGENT_INSTALL_SOURCE_TGZ=<path>  Install from a local package tarball
  ARGENT_INSTALL_PACKAGE_SPEC=<pkg> Install from an explicit npm spec
EOF
}

emit_json() {
  [[ "$JSON" == "1" ]] || return 0
  local event="$1"
  local message="${2:-}"
  local version="${3:-}"
  printf '{"event":"%s"' "$event"
  if [[ -n "$message" ]]; then
    printf ',"message":"%s"' "$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  fi
  if [[ -n "$version" ]]; then
    printf ',"version":"%s"' "$(printf '%s' "$version" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  fi
  printf '}\n'
}

fail() {
  local message="$1"
  emit_json "error" "$message"
  err "$message"
  exit 1
}

shell_escape() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\"'\"'/g")"
}

version_ge() {
  local left="$1"
  local right="$2"
  [[ "$(printf '%s\n%s\n' "$right" "$left" | sort -V | tail -n1)" == "$left" ]]
}

node_os() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    Linux) printf 'linux' ;;
    *) fail "Unsupported OS: $(uname -s)" ;;
  esac
}

node_arch() {
  case "$(uname -m)" in
    arm64|aarch64) printf 'arm64' ;;
    x86_64|amd64) printf 'x64' ;;
    *) fail "Unsupported architecture: $(uname -m)" ;;
  esac
}

download_node() {
  local prefix="$1"
  local os arch filename url tmp_dir
  os="$(node_os)"
  arch="$(node_arch)"
  filename="node-${NODE_VERSION}-${os}-${arch}.tar.gz"
  url="${NODE_DIST_URL_BASE}/${NODE_VERSION}/${filename}"
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/argent-node.XXXXXX")"
  trap 'rm -rf "$tmp_dir"' RETURN

  emit_json "download_node" "Downloading Node ${NODE_VERSION} for ${os}-${arch}" "$NODE_VERSION"
  info "Downloading Node ${NODE_VERSION} (${os}-${arch})"
  curl -fsSL "$url" -o "$tmp_dir/node.tar.gz" || fail "Failed to download Node from ${url}"
  rm -rf "$prefix/node"
  mkdir -p "$prefix/node"
  tar -xzf "$tmp_dir/node.tar.gz" -C "$prefix/node" --strip-components=1 || fail "Failed to extract Node archive"
  test -x "$prefix/node/bin/node" || fail "Extracted Node runtime is missing node binary"
  ok "Installed dedicated Node runtime at $prefix/node"
  printf '%s\n' "$prefix/node/bin/node"
}

resolve_node_bin() {
  if [[ -n "$NODE_BIN_OVERRIDE" ]]; then
    [[ -x "$NODE_BIN_OVERRIDE" ]] || fail "ARGENT_NODE_BIN is not executable: $NODE_BIN_OVERRIDE"
    printf '%s\n' "$NODE_BIN_OVERRIDE"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    local candidate version
    candidate="$(command -v node)"
    version="$("$candidate" -p 'process.versions.node' 2>/dev/null || true)"
    if [[ -n "$version" ]] && version_ge "$version" "22.0.0"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  download_node "$PREFIX"
}

install_wrapper() {
  local prefix="$1"
  local runtime_prefix="$2"
  local node_bin="$3"
  local entry="$runtime_prefix/lib/node_modules/argentos/argent.mjs"
  local wrapper="$prefix/bin/argent"
  local alias_wrapper="$prefix/bin/argentos"

  [[ -f "$entry" ]] || fail "Installed package entrypoint not found: $entry"
  mkdir -p "$prefix/bin"

  cat > "$wrapper" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="$(dirname "$node_bin"):\$PATH"
exec "$node_bin" "$entry" "\$@"
EOF
  chmod +x "$wrapper"
  ln -sf "$wrapper" "$alias_wrapper"
}

run_onboard() {
  local prefix="$1"
  local node_bin="$2"
  local entry="$prefix/runtime/lib/node_modules/argentos/argent.mjs"
  [[ "$NO_ONBOARD" == "1" ]] && return 0
  emit_json "onboard" "Running onboarding"
  "$node_bin" "$entry" onboard --install-daemon || warn "Onboarding failed; run 'argent onboard --install-daemon' manually."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      [[ $# -ge 2 ]] || fail "Missing value for --prefix"
      PREFIX="$2"
      shift 2
      ;;
    --version)
      [[ $# -ge 2 ]] || fail "Missing value for --version"
      VERSION="$2"
      shift 2
      ;;
    --json)
      JSON=1
      shift
      ;;
    --no-onboard)
      NO_ONBOARD=1
      shift
      ;;
    --set-npm-prefix)
      SET_NPM_PREFIX=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

mkdir -p "$PREFIX"
RUNTIME_PREFIX="$PREFIX/runtime"
mkdir -p "$RUNTIME_PREFIX"

emit_json "start" "Installing argent CLI" "$VERSION"
info "Install prefix: $PREFIX"
NODE_BIN="$(resolve_node_bin)"
info "Using Node: $NODE_BIN ($("$NODE_BIN" -p 'process.versions.node'))"

NPM_BIN="$(dirname "$NODE_BIN")/npm"
[[ -x "$NPM_BIN" ]] || NPM_BIN="$(command -v npm 2>/dev/null || true)"
[[ -n "$NPM_BIN" && -x "$NPM_BIN" ]] || fail "npm is not available for the selected Node runtime"

PACKAGE_SPEC="${PACKAGE_SPEC_OVERRIDE:-argentos@${VERSION}}"
if [[ -n "$PACKAGE_TGZ_OVERRIDE" ]]; then
  PACKAGE_SPEC="$PACKAGE_TGZ_OVERRIDE"
fi

emit_json "install_package" "Installing ${PACKAGE_SPEC}" "$VERSION"
info "Installing package: $PACKAGE_SPEC"
rm -rf "$RUNTIME_PREFIX/lib/node_modules/argentos" "$RUNTIME_PREFIX/bin/argent" "$RUNTIME_PREFIX/bin/argentos"
SHARP_IGNORE_GLOBAL_LIBVIPS=1 \
  "$NPM_BIN" install --global --prefix "$RUNTIME_PREFIX" "$PACKAGE_SPEC" >/dev/null \
  || fail "npm install failed for ${PACKAGE_SPEC}"

install_wrapper "$PREFIX" "$RUNTIME_PREFIX" "$NODE_BIN"
ok "Installed CLI wrappers to $PREFIX/bin"

if [[ "$SET_NPM_PREFIX" == "1" ]]; then
  info "Add this to your shell PATH if needed:"
  printf 'export PATH=%s:$PATH\n' "$(shell_escape "$PREFIX/bin")"
fi

run_onboard "$PREFIX" "$NODE_BIN"

INSTALLED_VERSION="$("$NODE_BIN" "$RUNTIME_PREFIX/lib/node_modules/argentos/argent.mjs" --version 2>/dev/null | head -n1 | tr -d '\r')"
INSTALLED_VERSION="${INSTALLED_VERSION:-$VERSION}"
emit_json "done" "Installed argent CLI" "$INSTALLED_VERSION"
ok "Installed argent CLI ($INSTALLED_VERSION)"
