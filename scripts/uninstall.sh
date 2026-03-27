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

echo ""
echo "  ╔══════════════════════════════════════════════════════════╗"
echo "  ║           ArgentOS Uninstaller                           ║"
echo "  ║                                                          ║"
echo "  ║  This will remove ArgentOS services, CLI, and app.       ║"
echo "  ║  Your data (memory, config, workspace) is preserved      ║"
echo "  ║  unless you explicitly choose to delete it.              ║"
echo "  ╚══════════════════════════════════════════════════════════╝"
echo ""

REMOVE_DATA=0
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remove-data) REMOVE_DATA=1; shift ;;
    --force) FORCE=1; shift ;;
    --help|-h)
      echo "Usage: uninstall.sh [--remove-data] [--force]"
      echo ""
      echo "  --remove-data  Also remove ~/.argentos (memory, config, logs)"
      echo "  --force        Skip confirmation prompts"
      exit 0
      ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

# Confirmation
if [[ "$FORCE" != "1" ]]; then
  printf "  ${RED}?${RESET} Are you sure you want to uninstall ArgentOS? [y/N] "
  read -r confirm
  if [[ ! "$confirm" =~ ^[Yy] ]]; then
    info "Cancelled."
    exit 0
  fi
fi

echo ""
info "═══ Stopping Services ═══"

# 1. Stop and remove Argent.app
if [[ -d "/Applications/Argent.app" ]]; then
  info "Stopping Argent.app..."
  osascript -e 'tell application "Argent" to quit' 2>/dev/null || true
  sleep 1
  killall Argent 2>/dev/null || true
  rm -rf "/Applications/Argent.app"
  ok "Removed /Applications/Argent.app"
else
  info "Argent.app not found in /Applications"
fi

# 2. Unload and remove gateway LaunchAgent
GATEWAY_PLIST="$HOME/Library/LaunchAgents/ai.argent.gateway.plist"
if [[ -f "$GATEWAY_PLIST" ]]; then
  info "Stopping gateway service..."
  launchctl bootout "gui/$(id -u)" "$GATEWAY_PLIST" 2>/dev/null || \
    launchctl unload "$GATEWAY_PLIST" 2>/dev/null || true
  rm -f "$GATEWAY_PLIST"
  ok "Removed gateway LaunchAgent"
else
  info "Gateway LaunchAgent not found"
fi

# 3. Unload and remove Redis LaunchAgent
REDIS_PLIST="$HOME/Library/LaunchAgents/ai.argent.redis.plist"
if [[ -f "$REDIS_PLIST" ]]; then
  info "Stopping ArgentOS Redis..."
  launchctl bootout "gui/$(id -u)" "$REDIS_PLIST" 2>/dev/null || \
    launchctl unload "$REDIS_PLIST" 2>/dev/null || true
  rm -f "$REDIS_PLIST"
  ok "Removed Redis LaunchAgent"
else
  info "Redis LaunchAgent not found"
fi

# 4. Unload and remove curiosity monitor LaunchAgent
MONITOR_PLIST="$HOME/Library/LaunchAgents/ai.argent.curiosity-monitor.plist"
if [[ -f "$MONITOR_PLIST" ]]; then
  info "Stopping curiosity monitor..."
  launchctl bootout "gui/$(id -u)" "$MONITOR_PLIST" 2>/dev/null || \
    launchctl unload "$MONITOR_PLIST" 2>/dev/null || true
  rm -f "$MONITOR_PLIST"
  ok "Removed curiosity monitor LaunchAgent"
else
  info "Curiosity monitor not found"
fi

# 5. Unload and remove any other argent LaunchAgents
for plist in "$HOME/Library/LaunchAgents/ai.argent."*.plist; do
  if [[ -f "$plist" ]]; then
    local_name=$(basename "$plist")
    info "Removing leftover LaunchAgent: $local_name"
    launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
    rm -f "$plist"
    ok "Removed $local_name"
  fi
done

echo ""
info "═══ Removing CLI ═══"

# 6. Remove CLI wrappers
for cmd in argent argentos; do
  for dir in "$HOME/bin" "/usr/local/bin"; do
    if [[ -f "$dir/$cmd" ]]; then
      rm -f "$dir/$cmd"
      ok "Removed $dir/$cmd"
    fi
  done
done

echo ""
info "═══ Removing Source Checkout ═══"

# 7. Remove source checkout
GIT_DIR="${ARGENTOS_GIT_DIR:-$HOME/argentos}"
if [[ -d "$GIT_DIR" ]]; then
  rm -rf "$GIT_DIR"
  ok "Removed source checkout: $GIT_DIR"
else
  info "Source checkout not found at $GIT_DIR"
fi

# 8. Remove private Node runtime
RUNTIME_DIR="$HOME/.argentos/runtime"
if [[ -d "$RUNTIME_DIR" ]]; then
  rm -rf "$RUNTIME_DIR"
  ok "Removed private Node runtime"
fi

echo ""
info "═══ Removing UserDefaults ═══"

# 9. Clear app UserDefaults
defaults delete ai.argent.mac 2>/dev/null && ok "Cleared Argent.app UserDefaults" || info "No UserDefaults to clear"

# 10. Optionally remove data
if [[ "$REMOVE_DATA" == "1" ]]; then
  echo ""
  info "═══ Removing Data (--remove-data) ═══"

  if [[ "$FORCE" != "1" ]]; then
    echo ""
    printf "  ${RED}⚠ WARNING:${RESET} This will permanently delete:\n"
    echo "    - Memory database (~/.argentos/memory.db)"
    echo "    - Agent configuration (~/.argentos/argent.json)"
    echo "    - Agent state and alignment docs"
    echo "    - Logs, backups, and all local data"
    echo ""
    printf "  ${RED}?${RESET} Type 'DELETE' to confirm: "
    read -r delete_confirm
    if [[ "$delete_confirm" != "DELETE" ]]; then
      info "Data preserved."
    else
      local backup_name=".argentos.backup.$(date +%Y%m%d-%H%M%S)"
      if [[ -d "$HOME/.argentos" ]]; then
        mv "$HOME/.argentos" "$HOME/$backup_name"
        ok "Backed up ~/.argentos → ~/$backup_name"
      fi
      rm -rf "$HOME/.argent" 2>/dev/null  # symlink
      rm -rf "$HOME/argent"  # workspace
      ok "Removed workspace and symlinks"
    fi
  else
    local backup_name=".argentos.backup.$(date +%Y%m%d-%H%M%S)"
    if [[ -d "$HOME/.argentos" ]]; then
      mv "$HOME/.argentos" "$HOME/$backup_name"
      ok "Backed up ~/.argentos → ~/$backup_name"
    fi
    rm -rf "$HOME/.argent" 2>/dev/null
    rm -rf "$HOME/argent"
    ok "Removed all ArgentOS data"
  fi
else
  echo ""
  info "Data preserved at ~/.argentos (memory, config, logs)"
  info "To also remove data, re-run with: --remove-data"
fi

# Note: PostgreSQL and Redis Homebrew packages are NOT removed.
# They may be used by other applications.
echo ""
info "═══ Not Removed (shared system packages) ═══"
info "PostgreSQL 17 (brew) — may be used by other apps"
info "Redis (brew) — may be used by other apps"
info "Homebrew — system package manager"
info "To remove these manually: brew uninstall postgresql@17 redis"

echo ""
ok "═══ ArgentOS uninstall complete ═══"
echo ""
