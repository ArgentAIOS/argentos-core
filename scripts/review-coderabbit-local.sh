#!/usr/bin/env bash
set -euo pipefail

base_branch="${CODERABBIT_BASE:-main}"

if command -v cr >/dev/null 2>&1; then
  tool="cr"
elif command -v coderabbit >/dev/null 2>&1; then
  tool="coderabbit"
else
  echo "CodeRabbit CLI is not installed." >&2
  echo "Install it with: curl -fsSL https://cli.coderabbit.ai/install.sh | sh" >&2
  exit 1
fi

if [[ "${1:-}" == "--prompt-only" ]]; then
  shift
  exec "$tool" --prompt-only --type uncommitted --base "$base_branch" "$@"
fi

exec "$tool" --base "$base_branch" "$@"
