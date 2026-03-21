#!/usr/bin/env bash
set -euo pipefail

# Bundle a self-contained ArgentOS runtime for distribution.
#
# Produces a directory with:
#   bin/node          — Node.js 22 macOS binary
#   dist/             — Built ArgentOS CLI
#   dashboard/        — Built dashboard (production)
#   argent.mjs        — CLI entry point
#   package.json      — Runtime package manifest
#   node_modules/     — Production dependencies
#
# Usage:
#   scripts/bundle-runtime.sh [output_dir]
#
# Env:
#   NODE_VERSION       Node.js version to bundle (default: 22.22.0)
#   NODE_ARCH          Architecture (default: arm64)
#   SKIP_BUILD         Skip pnpm build if already done (default: 0)
#   SKIP_UI_BUILD      Skip dashboard build (default: 0)

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/dist/argent-runtime}"
NODE_VERSION="${NODE_VERSION:-22.22.0}"
NODE_ARCH="${NODE_ARCH:-arm64}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_UI_BUILD="${SKIP_UI_BUILD:-0}"

echo "=== ArgentOS Runtime Bundler ==="
echo "Output: $OUTPUT_DIR"
echo "Node:   v${NODE_VERSION} (${NODE_ARCH})"

# ---------- Step 1: Build ArgentOS (if needed) ----------
# Build BEFORE creating the output dir — tsdown cleans dist/ and would wipe it.
if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "Building ArgentOS..."
  (cd "$ROOT_DIR" && pnpm install --no-frozen-lockfile --config.node-linker=hoisted)
  (cd "$ROOT_DIR" && pnpm build)
fi

# ---------- Step 2: Build Dashboard + Control UI (if needed) ----------
DASHBOARD_DIR="$ROOT_DIR/dashboard"
if [[ "$SKIP_UI_BUILD" != "1" ]] && [[ -d "$DASHBOARD_DIR" ]]; then
  echo "Building Dashboard..."
  (cd "$DASHBOARD_DIR" && npm install && npm run build)
fi

if [[ "$SKIP_UI_BUILD" != "1" ]]; then
  echo "Building Control UI..."
  (cd "$ROOT_DIR" && node scripts/ui.js build)
fi

# ---------- Step 3: Create output dir and download Node.js ----------
# Now safe to create the output dir — builds are done.
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

NODE_DIR="$OUTPUT_DIR/bin"
mkdir -p "$NODE_DIR"

NODE_TARBALL="node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"
NODE_CACHE_DIR="${HOME}/.cache/argent-node"
NODE_CACHE_PATH="${NODE_CACHE_DIR}/${NODE_TARBALL}"

if [[ -f "$NODE_CACHE_PATH" ]]; then
  echo "Using cached Node.js binary: $NODE_CACHE_PATH"
else
  echo "Downloading Node.js v${NODE_VERSION}..."
  mkdir -p "$NODE_CACHE_DIR"
  curl -fSL -o "$NODE_CACHE_PATH" "$NODE_URL"
fi

# Extract just the node binary
TMP_EXTRACT="$(mktemp -d)"
tar xzf "$NODE_CACHE_PATH" -C "$TMP_EXTRACT" --strip-components=2 "node-v${NODE_VERSION}-darwin-${NODE_ARCH}/bin/node"
mv "$TMP_EXTRACT/node" "$NODE_DIR/node"
chmod +x "$NODE_DIR/node"
rm -rf "$TMP_EXTRACT"

echo "Node binary: $("$NODE_DIR/node" --version)"

# ---------- Step 4: Copy dist ----------
echo "Copying built CLI..."
if [[ -d "$ROOT_DIR/dist" ]]; then
  # Copy dist, excluding this runtime output and any .app bundles
  rsync -a \
    --exclude 'argent-runtime' \
    --exclude '*.app' \
    --exclude '*.dmg' \
    --exclude '*.zip' \
    "$ROOT_DIR/dist/" "$OUTPUT_DIR/dist/"
else
  echo "ERROR: dist/ not found. Run 'pnpm build' first." >&2
  exit 1
fi

if [[ ! -f "$OUTPUT_DIR/dist/control-ui/index.html" ]]; then
  echo "ERROR: Missing Control UI assets in runtime bundle ($OUTPUT_DIR/dist/control-ui/index.html)." >&2
  echo "Run 'node scripts/ui.js build' (or 'pnpm ui:build') before packaging." >&2
  exit 1
fi

# ---------- Step 5: Copy Dashboard ----------
echo "Copying Dashboard..."
if [[ -d "$DASHBOARD_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR/dashboard"
  # Copy only production-essential files: built output, api server, package.json, public assets
  # Exclude node_modules entirely (build tools like esbuild, tailwind, rollup have unsigned native binaries)
  rsync -a \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '*.map' \
    --exclude '.env*' \
    --exclude 'CLAUDE.md' \
    --exclude '.tsbuildinfo' \
    "$DASHBOARD_DIR/" "$OUTPUT_DIR/dashboard/"

  # node_modules intentionally NOT pre-bundled.
  # install.sh will run 'npm install + npm rebuild' on the target machine so that:
  #   - .bin/ symlinks are created correctly
  #   - native addons (better-sqlite3) are compiled for the target arch/Node version
else
  echo "WARN: Dashboard not found at $DASHBOARD_DIR" >&2
fi

# ---------- Step 5b: Copy workspace templates ----------
echo "Copying workspace templates..."
if [[ -d "$ROOT_DIR/docs/reference/templates" ]]; then
  mkdir -p "$OUTPUT_DIR/docs/reference/templates"
  rsync -a "$ROOT_DIR/docs/reference/templates/" "$OUTPUT_DIR/docs/reference/templates/"
else
  echo "WARN: Workspace templates not found at $ROOT_DIR/docs/reference/templates" >&2
fi

if [[ ! -f "$OUTPUT_DIR/docs/reference/templates/AGENTS.md" ]]; then
  echo "ERROR: Missing required workspace template in runtime bundle: docs/reference/templates/AGENTS.md" >&2
  exit 1
fi

# ---------- Step 6: Create entry point ----------
echo "Creating entry point..."
# Always use a thin wrapper so chunk imports resolve relative to dist/.
if [[ -f "$OUTPUT_DIR/dist/index.js" ]]; then
  cat > "$OUTPUT_DIR/argent.mjs" << 'ENTRY'
#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

// Rewrite argv[1] to dist/index.js so the isMainModule guard inside it passes.
// Without this, argv[1] is 'argent.mjs' but dist/index.js checks for its own path,
// causing program.parseAsync() to never run and every command to silently exit 0.
const __dir = dirname(fileURLToPath(import.meta.url));
process.argv[1] = join(__dir, 'dist', 'index.js');

import('./dist/index.js').catch((err) => {
  console.error('[argent] Fatal:', err);
  process.exitCode = 1;
});
ENTRY
elif [[ -f "$OUTPUT_DIR/dist/main.js" ]]; then
  cat > "$OUTPUT_DIR/argent.mjs" << 'ENTRY'
#!/usr/bin/env node
import("./dist/main.js").catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
ENTRY
else
  echo "ERROR: Missing runtime entrypoint (expected dist/index.js or dist/main.js)." >&2
  exit 1
fi
chmod +x "$OUTPUT_DIR/argent.mjs"

# ---------- Step 7: Create package.json ----------
echo "Creating package.json..."
"$NODE_DIR/node" -e '
const fs = require("fs");
const path = require("path");
const root = JSON.parse(fs.readFileSync(path.join(process.argv[1], "package.json"), "utf8"));
const outPath = path.join(process.argv[2], "package.json");
const runtimePkg = {
  name: "argent-runtime",
  version: root.version || "0.0.0",
  type: "module",
  private: true,
  description: "ArgentOS self-contained runtime for distribution",
  dependencies: root.dependencies || {},
  optionalDependencies: root.optionalDependencies || {}
};
fs.writeFileSync(outPath, JSON.stringify(runtimePkg, null, 2) + "\n");
' "$ROOT_DIR" "$OUTPUT_DIR"

# ---------- Step 8: Install production dependencies ----------
echo "Installing production dependencies..."
(cd "$OUTPUT_DIR" && "$NODE_DIR/node" "$(which npm)" install --omit=dev --ignore-scripts 2>/dev/null || true)

if [[ -d "$OUTPUT_DIR/node_modules/better-sqlite3" ]]; then
  echo "Rebuilding better-sqlite3 for bundled Node ABI..."
  (cd "$OUTPUT_DIR" && "$NODE_DIR/node" "$(which npm)" rebuild better-sqlite3)
fi

# ---------- Step 9: Verify runtime dependency closure ----------
echo "Verifying runtime dependencies..."
"$NODE_DIR/node" "$ROOT_DIR/scripts/verify-runtime-deps.mjs" "$OUTPUT_DIR"

# Smoke test the bundled CLI entrypoint so missing modules fail fast during packaging.
"$NODE_DIR/node" "$OUTPUT_DIR/argent.mjs" --help >/dev/null
"$NODE_DIR/node" "$OUTPUT_DIR/argent.mjs" onboard --help >/dev/null
"$NODE_DIR/node" "$OUTPUT_DIR/argent.mjs" daemon --help >/dev/null

# ---------- Step 10: Clean up sensitive/dev files ----------
echo "Cleaning up..."
# Remove any .env files, auth configs, or dev artifacts
find "$OUTPUT_DIR" -name '.env*' -delete 2>/dev/null || true
find "$OUTPUT_DIR" -name '.DS_Store' -delete 2>/dev/null || true
find "$OUTPUT_DIR" -name 'CLAUDE.md' -delete 2>/dev/null || true
find "$OUTPUT_DIR" -name '*.test.*' -delete 2>/dev/null || true
find "$OUTPUT_DIR" -name '*.spec.*' -delete 2>/dev/null || true
find "$OUTPUT_DIR" -name 'tsconfig*' -delete 2>/dev/null || true

# Verify no actual API keys leaked (match real key patterns, not code references)
# Real keys: sk-ant-api03-... (40+ chars) or sk-ant-oat01-... (40+ chars)
if grep -rPq 'sk-ant-(?:api|oat)\d{2}-[A-Za-z0-9_-]{20,}' "$OUTPUT_DIR" 2>/dev/null; then
  echo "ERROR: Found actual API keys in bundled runtime! Aborting." >&2
  grep -rPl 'sk-ant-(?:api|oat)\d{2}-[A-Za-z0-9_-]{20,}' "$OUTPUT_DIR" 2>/dev/null
  exit 1
fi

RUNTIME_SIZE=$(du -sh "$OUTPUT_DIR" | awk '{print $1}')
echo ""
echo "=== Runtime bundled successfully ==="
echo "  Path: $OUTPUT_DIR"
echo "  Size: $RUNTIME_SIZE"
echo "  Node: $("$NODE_DIR/node" --version)"
