#!/usr/bin/env bash
set -euo pipefail

base_commit="${CODERABBIT_BASE_COMMIT:-}"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if command -v cr >/dev/null 2>&1; then
  tool="cr"
elif command -v coderabbit >/dev/null 2>&1; then
  tool="coderabbit"
else
  echo "CodeRabbit CLI is not installed." >&2
  echo "Install it with: curl -fsSL https://cli.coderabbit.ai/install.sh | sh" >&2
  exit 1
fi

if [[ -z "$base_commit" ]]; then
  if git rev-parse --verify --quiet HEAD~1 >/dev/null; then
    base_commit="HEAD~1"
  else
    base_commit="HEAD"
  fi
fi

if [[ "${1:-}" == "--prompt-only" ]]; then
  shift
  exec "$tool" --prompt-only --base-commit "$base_commit" "$@"
fi

exec "$tool" --base-commit "$base_commit" "$@"
