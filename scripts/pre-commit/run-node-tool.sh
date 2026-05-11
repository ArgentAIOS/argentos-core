#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: run-node-tool.sh <tool> [args...]" >&2
  exit 2
fi

tool="$1"
shift

# --- Worktree-aware tool resolution (closes #176) ---
#
# Linked git worktrees (e.g. bump-version worktrees created by merge-custody
# workers) share `.git` with the main checkout but have NO `node_modules`
# directory of their own. Without a fallback, `pnpm exec oxfmt` fails and the
# pre-commit hook breaks every bump commit, forcing each worker to manually
# symlink node_modules. Resolve binaries from the main worktree's node_modules
# in that case so the hook is self-healing.
#
# When `.git` is a file (gitlink) we're in a linked worktree, and
# `git rev-parse --git-common-dir` points at the shared .git dir owned by the
# main worktree. The main worktree root is its parent directory.

resolve_main_worktree_root() {
  local common_dir
  if ! common_dir="$(git -C "$ROOT_DIR" rev-parse --git-common-dir 2>/dev/null)"; then
    return 1
  fi
  if [[ "$common_dir" != /* ]]; then
    common_dir="$ROOT_DIR/$common_dir"
  fi
  (cd "$common_dir/.." && pwd)
}

resolve_tool_binary() {
  local name="$1"
  # 1. Local node_modules wins (developer-installed checkout).
  if [[ -x "$ROOT_DIR/node_modules/.bin/$name" ]]; then
    printf '%s' "$ROOT_DIR/node_modules/.bin/$name"
    return 0
  fi
  # 2. In a linked worktree, fall back to the main checkout's node_modules.
  if [[ -f "$ROOT_DIR/.git" ]]; then
    local main_root
    if main_root="$(resolve_main_worktree_root)" && [[ -n "$main_root" ]] && [[ "$main_root" != "$ROOT_DIR" ]]; then
      if [[ -x "$main_root/node_modules/.bin/$name" ]]; then
        printf '%s' "$main_root/node_modules/.bin/$name"
        return 0
      fi
    fi
  fi
  return 1
}

if resolved_bin="$(resolve_tool_binary "$tool")"; then
  exec "$resolved_bin" "$@"
fi

if [[ -f "$ROOT_DIR/pnpm-lock.yaml" ]] && command -v pnpm >/dev/null 2>&1; then
  exec pnpm exec "$tool" "$@"
fi

if { [[ -f "$ROOT_DIR/bun.lockb" ]] || [[ -f "$ROOT_DIR/bun.lock" ]]; } && command -v bun >/dev/null 2>&1; then
  exec bunx --bun "$tool" "$@"
fi

if command -v npm >/dev/null 2>&1; then
  exec npm exec -- "$tool" "$@"
fi

if command -v npx >/dev/null 2>&1; then
  exec npx "$tool" "$@"
fi

echo "Missing package manager: pnpm, bun, or npm required." >&2
exit 1
