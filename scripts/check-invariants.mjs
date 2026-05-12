#!/usr/bin/env node
// scripts/check-invariants.mjs
//
// Architectural invariant checks — small grep/AST-based assertions that pin
// structural properties whose drift caused recent regressions.
//
// Why this script exists
// ----------------------
// Between dev.18 → dev.25, four PRs (#160, #161, #163, #166) all fixed
// variants of the SAME drift class: `gateway.auth.token` was being read
// inconsistently by four different consumers (browser, static-server,
// gateway-port-18789, api-server). A grep-based test would have flagged all
// four in a single CI failure. This script encodes the "use the canonical
// resolver, never read the token directly" invariant — and a few related
// invariants — so that the next regression in the same class is caught at
// PR review time instead of in production.
//
// Each invariant is implemented as an independent function. Adding a new one
// is just appending to the `INVARIANTS` array and writing the check.
//
// Exit code
// ---------
//   0 — all invariants pass
//   1 — one or more invariants failed; see stderr
//   2 — internal error (couldn't run the check at all)
//
// CI hook
// -------
// Wired in via .github/workflows/ci.yml in the `repo-lane` job, adjacent to
// `pnpm check:repo-lane`.
//
// Local usage
// -----------
//   pnpm check-invariants
//
// Adding a grandfathered violator
// -------------------------------
// Some invariants (notably INV-2) carry an explicit `BASELINE` allowlist of
// pre-existing offenders. New code MUST NOT add to the baseline; instead,
// migrate to the canonical helper. The baseline shrinks as files are
// refactored — never expand it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Recursively walk a directory, yielding files matching `extPattern`. */
function* walk(
  dir,
  extPattern,
  skipNames = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "vendor",
    ".turbo",
    ".next",
    "coverage",
    ".vite",
  ]),
) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (skipNames.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, extPattern, skipNames);
    } else if (entry.isFile() && extPattern.test(entry.name)) {
      yield full;
    }
  }
}

function relPath(absPath) {
  return relative(REPO_ROOT, absPath).split(sep).join("/");
}

function readLines(absPath) {
  return readFileSync(absPath, "utf8").split("\n");
}

class Violation {
  constructor({ invariant, file, line, snippet, hint }) {
    this.invariant = invariant;
    this.file = file;
    this.line = line;
    this.snippet = snippet;
    this.hint = hint;
  }
}

// -----------------------------------------------------------------------------
// INV-1: `gateway.auth.token` consumers must use a per-request resolver
// -----------------------------------------------------------------------------
//
// Drift class: PRs #160 / #161 / #163 / #166 — four distinct daemons each had
// their own (buggy) read of `argent.json`.gateway.auth.token. The fix in each
// case was to re-read per-request via a canonical helper.
//
// Allowlist: only the four files that legitimately read the token directly:
//   - dashboard/api-server.cjs           (has resolveGatewayConfigToken)
//   - dashboard/static-server.cjs        (has resolveProxyAuthToken)
//   - src/gateway/gateway-proxy-token.ts (the canonical helper)
//   - src/gateway/call.ts                (gateway server bootstrap, not sidecar)
//
// Anything else under dashboard/** or src/gateway/** that touches the token
// path = drift candidate. New daemon? New handler? Use the helper.

const INV1_ALLOWED = new Set([
  "dashboard/api-server.cjs",
  "dashboard/static-server.cjs",
  "src/gateway/gateway-proxy-token.ts",
  "src/gateway/call.ts",
]);

// Match a real property-access expression like `config.gateway?.auth?.token`,
// not the bare string `"gateway.auth.token"` that appears in error messages.
// The leading character class requires the access to follow an identifier,
// `)`, or `]` — which strings can't.
const INV1_TOKEN_PATTERN = /[\w)\]]\??\.gateway(?:\?\.|\.)auth(?:\?\.|\.)token\b/;

function checkInv1GatewayAuthTokenResolver() {
  const violations = [];
  const scopes = [join(REPO_ROOT, "dashboard"), join(REPO_ROOT, "src", "gateway")];
  for (const scope of scopes) {
    for (const file of walk(scope, /\.(cjs|mjs|js|ts|tsx)$/)) {
      const rel = relPath(file);
      if (
        rel.endsWith(".test.ts") ||
        rel.endsWith(".test.tsx") ||
        rel.endsWith(".test.cjs") ||
        rel.endsWith(".test.mjs") ||
        rel.endsWith(".test.js")
      ) {
        continue;
      }
      // Tests directories also OK
      if (rel.includes("/tests/") || rel.includes("/__tests__/") || rel.includes("/test/")) {
        continue;
      }
      if (INV1_ALLOWED.has(rel)) continue;
      const lines = readLines(file);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments — drift is in code, not docs
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"))
          continue;
        if (INV1_TOKEN_PATTERN.test(line)) {
          violations.push(
            new Violation({
              invariant: "INV-1",
              file: rel,
              line: i + 1,
              snippet: trimmed,
              hint:
                "Read `gateway.auth.token` per-request via a canonical resolver, " +
                "not directly. Allowed call-sites: " +
                Array.from(INV1_ALLOWED).join(", ") +
                ". See dashboard/api-server.cjs:resolveGatewayConfigToken or " +
                "src/gateway/gateway-proxy-token.ts.",
            }),
          );
        }
      }
    }
  }
  return violations;
}

// -----------------------------------------------------------------------------
// INV-2: dashboard REST fetches must use the localApiFetch helper
// -----------------------------------------------------------------------------
//
// Background: components that called `fetch("/api/...")` directly bypassed
// `withDashboardApiAuth()` / the resolved Authorization header. Result was a
// rogue-fetch class that returned 401 after every token rotation (R-1c).
//
// This invariant uses a BASELINE allowlist: the set of files that already
// contain direct fetches as of dev.25. New files added to dashboard/src must
// NOT introduce direct `/api/` fetches — go through `fetchLocalApi()` from
// dashboard/src/utils/localApiFetch.ts.
//
// To migrate a baselined file: refactor it to use fetchLocalApi() and remove
// it from the baseline below in the same PR. Never expand the baseline.

const INV2_FETCH_HELPERS = new Set([
  "dashboard/src/utils/localApiFetch.ts",
  "dashboard/src/hooks/useGateway.ts", // WS path is special-cased
]);

// Frozen baseline — files containing pre-existing direct fetches as of
// dev.25. New entries are FORBIDDEN. Removing entries (after migration) is
// encouraged.
//
// As of #173 (2026-05-12) the baseline is EMPTY — every grandfathered file
// has been migrated to `fetchLocalApi()`. Going forward, any new dashboard
// REST fetch is required to use the helper; the empty set means INV-2 is
// now enforced without exception. Do not add entries here; migrate instead.
const INV2_BASELINE = new Set([]);

// Match: fetch("/api/..."), fetch('/api/...'), fetch(`/api/...`)
const INV2_FETCH_LITERAL_PATTERN = /\bfetch\s*\(\s*(?:"\/api\/|'\/api\/|`\/api\/)/;

function checkInv2DashboardFetchHelper() {
  const violations = [];
  const scope = join(REPO_ROOT, "dashboard", "src");
  for (const file of walk(scope, /\.(ts|tsx)$/)) {
    const rel = relPath(file);
    if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
    if (INV2_FETCH_HELPERS.has(rel)) continue;
    const lines = readLines(file);
    let firstHit = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (INV2_FETCH_LITERAL_PATTERN.test(line)) {
        firstHit = { line: i + 1, snippet: trimmed };
        break;
      }
    }
    if (!firstHit) continue;
    if (INV2_BASELINE.has(rel)) continue;
    violations.push(
      new Violation({
        invariant: "INV-2",
        file: rel,
        line: firstHit.line,
        snippet: firstHit.snippet,
        hint:
          "Use `fetchLocalApi()` from dashboard/src/utils/localApiFetch.ts " +
          "instead of a bare fetch. The helper attaches the dashboard auth " +
          "header resolved per-request — direct fetches return 401 after a " +
          "token rotation (the rogue-fetch class fixed in PR #163/#166). " +
          "If this file MUST stay raw, add an explicit baseline entry in " +
          "scripts/check-invariants.mjs and document why in the PR body — " +
          "but the strong default is to migrate.",
      }),
    );
  }
  return violations;
}

// -----------------------------------------------------------------------------
// INV-4: dashboard daemons must read JSON config per-request, not at module load
// -----------------------------------------------------------------------------
//
// The bug shape that caused the original drift: api-server / static-server
// would read `argent.json` ONCE at top-level (module load) and cache the
// result forever. Token rotations on disk never propagated → 401 drift.
//
// The fix shape: a function (resolver) that reads from disk inside its body,
// invoked per-request. We can't reliably detect "memoized at module load" via
// pure regex, but we can flag the most common bug shape: a top-level
// `const NAME = JSON.parse(fs.readFileSync(... argent.json ...))` outside any
// function body in the two dashboard daemon files.
//
// False positives are acceptable as long as they're rare; the script
// deliberately scopes to two files and the most distinctive cached-read
// pattern.

const INV4_TARGETS = ["dashboard/api-server.cjs", "dashboard/static-server.cjs"];

// Top-level (column-0) const/let/var that pulls argent.json into memory.
// Examples it WILL flag:
//   const config = JSON.parse(fs.readFileSync("...argent.json", "utf-8"));
// Examples it will NOT flag (per-request — the safe pattern):
//   function readArgentConfig() {
//     const cfg = JSON.parse(fs.readFileSync(p, "utf-8"));
//   }
const INV4_BAD_PATTERN =
  /^(const|let|var)\s+\w+\s*=\s*.*JSON\.parse\s*\(.*readFileSync.*argent(?:os)?\.json/;

function checkInv4PerRequestConfigRead() {
  const violations = [];
  for (const rel of INV4_TARGETS) {
    const abs = join(REPO_ROOT, rel);
    let lines;
    try {
      lines = readLines(abs);
    } catch {
      continue; // file missing — handled by other checks
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (INV4_BAD_PATTERN.test(line)) {
        violations.push(
          new Violation({
            invariant: "INV-4",
            file: rel,
            line: i + 1,
            snippet: line.trim(),
            hint:
              "Reading argent.json at module load caches the value forever. " +
              "Tokens rotated on disk (e.g. by `argent update`) won't be picked " +
              "up → 401 drift. Wrap this read in a function and call it " +
              "per-request, mirroring `readArgentConfig()` / " +
              "`resolveGatewayConfigToken()` in dashboard/api-server.cjs.",
          }),
        );
      }
    }
  }
  return violations;
}

// -----------------------------------------------------------------------------
// INV-3: LaunchAgent paths point at canonical install
// -----------------------------------------------------------------------------
//
// DEFERRED: LaunchAgent plists live on the user's machine
// (~/Library/LaunchAgents/ai.argent.*.plist), not in the repo, so this can't
// run in CI. Recommended placement: extend `argent doctor` to validate the
// plist BinaryPath against the canonical install path at runtime, and surface
// drift as a doctor warning. Tracked as a follow-up.

// -----------------------------------------------------------------------------
// driver
// -----------------------------------------------------------------------------

const INVARIANTS = [
  {
    id: "INV-1",
    name: "gateway.auth.token consumers use a per-request resolver",
    run: checkInv1GatewayAuthTokenResolver,
  },
  {
    id: "INV-2",
    name: "dashboard REST fetches use fetchLocalApi helper",
    run: checkInv2DashboardFetchHelper,
  },
  {
    id: "INV-4",
    name: "dashboard daemons read argent.json per-request, not at module load",
    run: checkInv4PerRequestConfigRead,
  },
];

function main() {
  let totalViolations = 0;
  const sections = [];
  for (const inv of INVARIANTS) {
    let violations;
    try {
      violations = inv.run();
    } catch (err) {
      console.error(`[check-invariants] ${inv.id} crashed: ${err.stack || err}`);
      process.exit(2);
    }
    if (violations.length === 0) {
      sections.push(`  ✔ ${inv.id}  ${inv.name}`);
    } else {
      sections.push(
        `  ✖ ${inv.id}  ${inv.name}  (${violations.length} violation${violations.length === 1 ? "" : "s"})`,
      );
      for (const v of violations) {
        sections.push(`      ${v.file}:${v.line}`);
        sections.push(`        ${v.snippet}`);
        sections.push(`        hint: ${v.hint}`);
      }
      totalViolations += violations.length;
    }
  }

  console.log("[check-invariants] Architectural invariants:");
  for (const line of sections) console.log(line);

  if (totalViolations === 0) {
    console.log(`[check-invariants] OK — ${INVARIANTS.length} invariants passed`);
    process.exit(0);
  }
  console.error(
    `\n[check-invariants] FAIL — ${totalViolations} violation(s) across ${INVARIANTS.length} invariants. ` +
      "See above for fix hints.",
  );
  process.exit(1);
}

main();
