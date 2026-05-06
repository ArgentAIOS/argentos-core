// Regression coverage for PR #131 (lane allowlist extension).
//
// Background: PR #131 added "open-design-composio" to the knownLanes array
// in scripts/threadmaster-bus.mjs. Because every lane-validating CLI path
// (post --from / --to, list --lane, ack --lane, status --lane, task-add
// --owner) routes through the shared normalizeLane / normalizeTargets
// helpers, the single-array change covers all three paths structurally.
//
// PR #131 did not ship a regression test. A subsequent bus report claimed
// `ack --lane open-design-composio` was still rejected; verification on
// origin/dev showed the lane is in fact accepted (the error surfaced was
// "No message with id <id>", which only fires after lane validation
// passes). This test locks in that structural guarantee so any future
// regression — for instance, someone adding a redundant ack-only allowlist
// that drifts — fails CI loudly.
//
// Run: node --test scripts/threadmaster-bus.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "threadmaster-bus.mjs");

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    cwd: path.resolve(here, ".."),
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status,
  };
}

test("ack --lane open-design-composio passes lane allowlist", () => {
  // Use an id that cannot exist; if lane validation passed, the script
  // errors with "No message with id ..." (which means the lane was
  // accepted before the id check ran). If lane validation failed, the
  // error would be "Unknown lane lane" from normalizeLane.
  const result = run([
    "ack",
    "--lane",
    "open-design-composio",
    "--id",
    "tm-regression-test-bogus-id",
  ]);
  assert.match(
    result.stderr,
    /No message with id tm-regression-test-bogus-id/,
    `expected lane to be accepted; stderr was:\n${result.stderr}`,
  );
  assert.doesNotMatch(
    result.stderr,
    /Unknown lane lane/,
    `lane should not be rejected by allowlist; stderr was:\n${result.stderr}`,
  );
});

test("list --lane open-design-composio passes lane allowlist", () => {
  const result = run(["list", "--lane", "open-design-composio", "--limit", "1"]);
  assert.equal(result.code, 0, `expected exit 0; got ${result.code}\nstderr:\n${result.stderr}`);
  assert.doesNotMatch(result.stderr, /Unknown lane/);
});

test("status --lane open-design-composio passes lane allowlist", () => {
  const result = run(["status", "--lane", "open-design-composio"]);
  assert.equal(result.code, 0, `expected exit 0; got ${result.code}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /^open-design-composio: /);
});

test("ack --lane <unknown> is still rejected by the allowlist", () => {
  // Negative test: the allowlist must continue to reject non-registered
  // lanes. Guards against someone removing the validation entirely.
  const result = run([
    "ack",
    "--lane",
    "definitely-not-a-registered-lane",
    "--id",
    "tm-regression-test-bogus-id",
  ]);
  assert.notEqual(result.code, 0);
  assert.match(
    result.stderr,
    /Unknown lane lane "definitely-not-a-registered-lane"/,
    `expected lane allowlist rejection; stderr was:\n${result.stderr}`,
  );
});
