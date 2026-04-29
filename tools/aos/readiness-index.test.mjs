import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildReadinessIndex } from "./readiness-index.mjs";

function writeConnector(root, name, manifest, { harness = true, tests = true } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "connector.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (harness) {
    const harnessDir = path.join(dir, "agent-harness");
    fs.mkdirSync(harnessDir, { recursive: true });
    fs.writeFileSync(path.join(harnessDir, "pyproject.toml"), '[project]\nname = "fixture"\n');
    if (tests) fs.mkdirSync(path.join(harnessDir, "tests"));
  }
}

function baseManifest(tool, scope, commands) {
  return {
    tool,
    backend: `${tool}-api`,
    manifest_schema_version: "1.0.0",
    scope,
    setup: {
      service_keys: ["FIXTURE_API_KEY"],
    },
    commands,
  };
}

test("classifies live write, read-only, preview, manifest-only, and scaffold connectors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-readiness-"));
  writeConnector(
    root,
    "aos-live",
    baseManifest(
      "aos-live",
      {
        scaffold_only: false,
        live_backend_available: true,
        live_read_available: true,
        write_bridge_available: true,
      },
      [
        { id: "item.list", action_class: "read", required_mode: "readonly", supports_json: true },
        { id: "item.create", action_class: "write", required_mode: "write", supports_json: true },
      ],
    ),
  );
  writeConnector(
    root,
    "aos-read",
    baseManifest(
      "aos-read",
      {
        scaffold_only: false,
        live_backend_available: true,
        live_read_available: true,
        write_bridge_available: false,
      },
      [{ id: "item.list", action_class: "read", required_mode: "readonly", supports_json: true }],
    ),
  );
  writeConnector(
    root,
    "aos-preview",
    baseManifest(
      "aos-preview",
      {
        scaffold_only: false,
        live_backend_available: true,
        live_read_available: true,
        write_bridge_available: false,
      },
      [
        { id: "item.list", action_class: "read", required_mode: "readonly", supports_json: true },
        { id: "item.schedule", action_class: "write", required_mode: "write", supports_json: true },
      ],
    ),
  );
  writeConnector(
    root,
    "aos-manifest",
    baseManifest(
      "aos-manifest",
      {
        scaffold_only: false,
        live_backend_available: false,
        live_read_available: false,
        write_bridge_available: false,
      },
      [{ id: "item.list", action_class: "read", required_mode: "readonly", supports_json: true }],
    ),
    { harness: false },
  );
  writeConnector(
    root,
    "aos-scaffold",
    baseManifest(
      "aos-scaffold",
      {
        scaffold_only: true,
        live_backend_available: false,
        live_read_available: false,
        write_bridge_available: false,
      },
      [{ id: "item.create", action_class: "write", required_mode: "write", supports_json: true }],
    ),
  );

  const byTool = Object.fromEntries(
    buildReadinessIndex({ rootDir: root }).connectors.map((entry) => [entry.tool, entry]),
  );

  assert.equal(byTool["aos-live"].readiness, "live-ready");
  assert.equal(
    byTool["aos-live"].commands.find((command) => command.id === "item.create").readiness,
    "live-ready",
  );
  assert.equal(
    byTool["aos-live"].commands.find((command) => command.id === "item.create").runtime_available,
    true,
  );
  assert.equal(byTool["aos-read"].readiness, "read-only");
  assert.equal(byTool["aos-preview"].readiness, "preview-only");
  assert.equal(
    byTool["aos-preview"].commands.find((command) => command.id === "item.schedule").readiness,
    "preview-only",
  );
  assert.equal(byTool["aos-manifest"].readiness, "manifest-only");
  assert.equal(byTool["aos-scaffold"].readiness, "scaffold/deferred");
});

test("records service-key and production-smoke caveats for consumers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-readiness-"));
  writeConnector(
    root,
    "aos-auth",
    baseManifest(
      "aos-auth",
      {
        scaffold_only: false,
        live_backend_available: true,
        live_read_available: true,
        write_bridge_available: true,
      },
      [{ id: "item.create", action_class: "write", required_mode: "write", supports_json: true }],
    ),
  );

  const [entry] = buildReadinessIndex({ rootDir: root }).connectors;

  assert.equal(entry.production_smoke_tested, false);
  assert.equal(entry.auth.operator_service_keys_preferred, true);
  assert.equal(entry.auth.local_env_fallback_only, true);
  assert.deepEqual(entry.auth.service_keys, ["FIXTURE_API_KEY"]);
  assert.equal(entry.scope.scaffold_only, false);
});

test("records operator-owned scanner config keys as service keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-readiness-"));
  writeConnector(root, "aos-alert-scanner", {
    tool: "aos-alert-scanner",
    backend: "scanner-api",
    manifest_schema_version: "1.0.0",
    scope: {
      scaffold_only: false,
      live_backend_available: true,
      live_read_available: true,
      write_bridge_available: false,
      required: ["VIP_EMAIL_SENDERS", "SLACK_ATTENTION_CHANNELS"],
      optional: [
        "SLACK_ATTENTION_KEYWORDS",
        "SLACK_ATTENTION_MENTION_USER_IDS",
        "SLACK_ATTENTION_MAX_MESSAGES",
        "VIP_EMAIL_ACCOUNTS",
        "VIP_EMAIL_DEDUPE_WINDOW_SECONDS",
      ],
    },
    commands: [
      { id: "scan.now", action_class: "read", required_mode: "readonly", supports_json: true },
    ],
  });

  const [entry] = buildReadinessIndex({ rootDir: root }).connectors;

  assert.deepEqual(entry.auth.service_keys, [
    "SLACK_ATTENTION_CHANNELS",
    "SLACK_ATTENTION_KEYWORDS",
    "SLACK_ATTENTION_MAX_MESSAGES",
    "SLACK_ATTENTION_MENTION_USER_IDS",
    "VIP_EMAIL_ACCOUNTS",
    "VIP_EMAIL_DEDUPE_WINDOW_SECONDS",
    "VIP_EMAIL_SENDERS",
  ]);
});

test("preserves unspecified manifest booleans as null instead of false", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-readiness-"));
  writeConnector(root, "aos-unknown", {
    tool: "aos-unknown",
    backend: "unknown-api",
    manifest_schema_version: "1.0.0",
    scope: {
      kind: "unknown",
      surface: "unknown",
    },
    commands: [
      { id: "item.list", action_class: "read", required_mode: "readonly", supports_json: true },
    ],
  });

  const [entry] = buildReadinessIndex({ rootDir: root }).connectors;

  assert.equal(entry.scope.live_backend_available, null);
  assert.equal(entry.scope.live_read_available, null);
  assert.equal(entry.scope.write_bridge_available, null);
});

test("treats unflagged tested write harnesses as live-ready unless explicitly previewed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-readiness-"));
  writeConnector(root, "aos-unflagged-write", {
    tool: "aos-unflagged-write",
    backend: "unflagged-api",
    manifest_schema_version: "1.0.0",
    scope: {
      kind: "records",
      surface: "record",
    },
    commands: [
      { id: "record.create", action_class: "write", required_mode: "write", supports_json: true },
    ],
  });

  const [entry] = buildReadinessIndex({ rootDir: root }).connectors;

  assert.equal(entry.readiness, "live-ready");
  assert.equal(entry.commands[0].readiness, "live-ready");
  assert.equal(entry.production_smoke_tested, false);
});
