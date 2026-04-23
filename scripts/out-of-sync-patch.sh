#!/usr/bin/env bash
# out-of-sync-patch.sh
#
# One-shot recovery for Argent installs that got wedged by the pre-fix
# update-runner: `argent update` fails during its `pnpm install` step because
# the hosted Core checkout has a pnpm-workspace.yaml that confuses pnpm.
#
# This script mirrors what install-hosted.sh does — but only the recovery
# parts: build in the git source dir with --ignore-workspace, then rsync the
# built runtime over to the install dir (which sits inside node_modules).
#
# Steps:
#   1. Locate GIT_DIR (default ~/argentos, or $ARGENT_GIT_DIR exported by launcher).
#   2. Locate PACKAGE_DIR (default ~/.argentos/lib/node_modules/argentos).
#   3. In GIT_DIR: git fetch --tags, pnpm install --ignore-workspace, pnpm build,
#      dashboard install + build.
#   4. Snapshot GIT_DIR → PACKAGE_DIR (rsync, exclude .git) — swaps atomically.
#   5. Run `argent update` so the launcher lands on current Core (stale fake
#      skills / old System-tab seeds get reconciled by the new code).
#   6. Bounce the gateway LaunchAgent so the new build is live.
#
# Safe to re-run. Idempotent.
#
# Usage:
#   curl -fsSL <raw-url>/out-of-sync-patch.sh | bash
#
# Overrides:
#   ARGENT_GIT_DIR=/path            # force source/git dir
#   ARGENT_INSTALL_DIR=/path        # force package/install dir
#   SKIP_UPDATE=1                   # skip final `argent update`
#   SKIP_GATEWAY_RESTART=1          # skip LaunchAgent bounce
#   SKIP_FETCH=1                    # skip git fetch (keep current checkout)
#   SKIP_DASHBOARD=1                # skip dashboard rebuild

set -euo pipefail

INFO() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
OK()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
WARN() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
FAIL() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

INFO "Argent out-of-sync patch"
INFO "Running as: $(whoami)   Host: $(hostname)   Date: $(date '+%Y-%m-%d %H:%M:%S')"

# ---------- Pick node + pnpm FIRST (everything downstream needs them) ----------
BUNDLED_NODE=""
for cand in \
  "$HOME/.argentos/runtime/node/bin" \
  "$HOME/.argentos/node/bin"; do
  [[ -x "$cand/node" ]] && BUNDLED_NODE="$cand" && break
done
if [[ -n "$BUNDLED_NODE" ]]; then
  export PATH="$BUNDLED_NODE:$HOME/.argentos/runtime/bin:$PATH"
  INFO "node: $("$BUNDLED_NODE/node" -v) (bundled: $BUNDLED_NODE)"
elif command -v node >/dev/null 2>&1; then
  INFO "node: $(node -v) (system)"
else
  FAIL "No node found. Install node 22+ first."
fi

if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
  corepack enable pnpm 2>/dev/null || true
fi
command -v pnpm >/dev/null 2>&1 || FAIL "pnpm not found — run: npm i -g pnpm"
INFO "pnpm: $(pnpm --version)"

[[ -x "$HOME/bin/argent" ]] && export PATH="$HOME/bin:$PATH"

# ---------- Locate GIT_DIR ----------
if [[ -n "${ARGENT_GIT_DIR:-}" ]]; then
  GIT_DIR="$ARGENT_GIT_DIR"
else
  # Try to read the launcher for its exported ARGENT_GIT_DIR value
  launcher=""
  command -v argent >/dev/null 2>&1 && launcher="$(command -v argent)"
  if [[ -n "$launcher" ]]; then
    inferred="$(grep -oE 'ARGENT_GIT_DIR=[^ "]*' "$launcher" 2>/dev/null | head -1 | cut -d= -f2-)"
    [[ -n "$inferred" ]] && GIT_DIR="$inferred"
  fi
  GIT_DIR="${GIT_DIR:-$HOME/argentos}"
fi
[[ -d "$GIT_DIR/.git" ]] || FAIL "GIT_DIR is not a git checkout: $GIT_DIR (set ARGENT_GIT_DIR=)"
INFO "GIT_DIR: $GIT_DIR"
INFO "HEAD before: $(git -C "$GIT_DIR" log -1 --oneline 2>/dev/null)"
before_ver="$(node -p "require('$GIT_DIR/package.json').version" 2>/dev/null || echo '?')"
INFO "Version before: $before_ver"

# ---------- Locate PACKAGE_DIR ----------
if [[ -n "${ARGENT_INSTALL_DIR:-}" ]]; then
  PACKAGE_DIR="$ARGENT_INSTALL_DIR"
else
  PACKAGE_DIR="$HOME/.argentos/lib/node_modules/argentos"
fi
INFO "PACKAGE_DIR: $PACKAGE_DIR (will be overwritten)"

# ---------- Fetch + reset to latest tag ----------
if [[ "${SKIP_FETCH:-}" != "1" ]]; then
  INFO "git fetch --tags --prune"
  git -C "$GIT_DIR" fetch --tags --prune

  # Keep checkout clean for idempotent re-runs
  git -C "$GIT_DIR" checkout -- pnpm-lock.yaml 2>/dev/null || true

  # Resolve latest stable tag and reset to it
  latest_tag="$(git -C "$GIT_DIR" tag --list 'v*' --sort=-v:refname | grep -v -- '-beta\|-rc\|-alpha' | head -1)"
  if [[ -n "$latest_tag" ]]; then
    INFO "Checking out latest stable tag: $latest_tag"
    git -C "$GIT_DIR" checkout "$latest_tag" 2>&1 | tail -2
  else
    WARN "No stable tag found — staying on current ref"
  fi
fi

# ---------- Build in GIT_DIR ----------
cd "$GIT_DIR"
INFO "Clearing stale dist/ and .pnpm cache in GIT_DIR"
rm -rf "$GIT_DIR/dist" "$GIT_DIR/node_modules/.pnpm" 2>/dev/null || true

INFO "pnpm install --ignore-workspace --frozen-lockfile"
if ! pnpm install --ignore-workspace --frozen-lockfile; then
  WARN "Frozen install failed — retrying without --frozen-lockfile"
  pnpm install --ignore-workspace
fi

INFO "pnpm build"
pnpm build

# Keep checkout clean so next `argent update` sees no spurious diff
git -C "$GIT_DIR" checkout -- pnpm-lock.yaml 2>/dev/null || true

# ---------- Dashboard ----------
if [[ "${SKIP_DASHBOARD:-}" != "1" && -d "$GIT_DIR/dashboard" && -f "$GIT_DIR/dashboard/package.json" ]]; then
  INFO "Rebuilding dashboard"
  cd "$GIT_DIR/dashboard"
  rm -rf dist 2>/dev/null || true
  pnpm install --ignore-workspace --frozen-lockfile 2>/dev/null \
    || pnpm install --ignore-workspace 2>/dev/null \
    || WARN "Dashboard install failed — continuing"
  # Use vite directly (matches install-hosted.sh — avoids pre-existing strict TS errors)
  if command -v npx >/dev/null 2>&1; then
    npx --yes vite build 2>&1 | tail -3 || WARN "Dashboard build failed — continuing"
  else
    pnpm build 2>&1 | tail -3 || WARN "Dashboard build failed — continuing"
  fi
  cd "$GIT_DIR"
  git -C "$GIT_DIR" checkout -- pnpm-lock.yaml 2>/dev/null || true
fi

# ---------- Snapshot GIT_DIR → PACKAGE_DIR ----------
INFO "Snapshotting GIT_DIR → PACKAGE_DIR (atomic rsync + swap)"
parent_dir="$(dirname "$PACKAGE_DIR")"
tmp_dir="${PACKAGE_DIR}.new.$$"
backup_dir="${PACKAGE_DIR}.old.$$"

mkdir -p "$parent_dir"
rm -rf "$tmp_dir" "$backup_dir"
mkdir -p "$tmp_dir"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude '.git' "$GIT_DIR/" "$tmp_dir/"
else
  ( cd "$GIT_DIR" && tar --exclude='.git' -cf - . ) | ( cd "$tmp_dir" && tar -xf - )
fi

if [[ -e "$PACKAGE_DIR" || -L "$PACKAGE_DIR" ]]; then
  mv "$PACKAGE_DIR" "$backup_dir"
fi
if ! mv "$tmp_dir" "$PACKAGE_DIR"; then
  WARN "Snapshot swap failed — rolling back"
  mv "$backup_dir" "$PACKAGE_DIR" || true
  FAIL "Could not install new snapshot"
fi
rm -rf "$backup_dir"
OK "Snapshot installed at $PACKAGE_DIR"

after_ver="$(node -p "require('$PACKAGE_DIR/package.json').version" 2>/dev/null || echo '?')"
INFO "Version after:  $after_ver (was $before_ver)"

# ---------- Run argent update so state reconciles with new code ----------
if [[ "${SKIP_UPDATE:-}" != "1" ]] && command -v argent >/dev/null 2>&1; then
  INFO "Running: argent update (reconciles stale System-tab / Personal Skills data)"
  if argent update --yes 2>/dev/null || argent update; then
    OK "argent update completed"
  else
    WARN "argent update returned non-zero — run it manually later"
  fi
fi

# ---------- Bounce the gateway ----------
plist="$HOME/Library/LaunchAgents/ai.argent.gateway.plist"
if [[ "${SKIP_GATEWAY_RESTART:-}" != "1" && -f "$plist" ]]; then
  INFO "Restarting gateway LaunchAgent"
  launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
  sleep 1
  launchctl bootstrap "gui/$(id -u)" "$plist" || WARN "Bootstrap failed — start manually"
  sleep 2
  command -v argent >/dev/null 2>&1 && argent gateway status 2>/dev/null | head -5 || true
fi

echo
OK "Out-of-sync patch complete."
echo
echo "Verify:"
echo "  argent --version                  # expect: $after_ver"
echo "  argent gateway status             # expect: RPC probe: ok"
echo "  # Dashboard → Config → System tab should now show current Personal Skills, not stale seeds"
