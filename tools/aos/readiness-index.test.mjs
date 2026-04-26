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

function baseManifest(tool, scope, commands, auth = { service_keys: ["FIXTURE_API_KEY"] }) {
  return {
    tool,
    backend: `${tool}-api`,
    manifest_schema_version: "1.0.0",
    scope,
    setup: {
      service_keys: auth.setup_service_keys ?? [],
    },
    auth: {
      kind: "service-key",
      required: auth.required ?? true,
      service_keys: auth.service_keys ?? [],
      optional_scope_service_keys: auth.optional_scope_service_keys ?? [],
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
      {
        service_keys: ["FIXTURE_API_KEY"],
        optional_scope_service_keys: ["FIXTURE_ITEM_ID"],
      },
    ),
  );

  const [entry] = buildReadinessIndex({ rootDir: root }).connectors;

  assert.equal(entry.production_smoke_tested, false);
  assert.equal(entry.auth.operator_service_keys_preferred, true);
  assert.equal(entry.auth.local_env_fallback_only, true);
  assert.deepEqual(entry.auth.service_keys, ["FIXTURE_API_KEY"]);
  assert.deepEqual(entry.auth.optional_scope_service_keys, ["FIXTURE_ITEM_ID"]);
  assert.equal(entry.auth.service_key_provider, "operator-service-keys");
  assert.equal(entry.scope.scaffold_only, false);
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

test("keeps unflagged tested write harnesses out of live destinations", () => {
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

  assert.equal(entry.readiness, "preview-only");
  assert.equal(entry.commands[0].readiness, "preview-only");
  assert.equal(entry.commands[0].workflow_destination_allowed, false);
  assert.equal(entry.commands[0].live_write_available, false);
  assert.equal(entry.production_smoke_tested, false);
});

test("adds workflow destination metadata only for live writable commands", () => {
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
        pickerHints: {
          item: {
            kind: "item",
            selection_surface: "item",
            resource: "fixture.item",
            source_command: "item.list",
            source_fields: ["id", "name"],
          },
        },
      },
      [
        {
          id: "item.list",
          action_class: "read",
          required_mode: "readonly",
          supports_json: true,
          resource: "item",
        },
        {
          id: "item.create",
          action_class: "write",
          required_mode: "write",
          supports_json: true,
          resource: "item",
          test_supported: true,
          test_evidence: "fixture-command-test",
        },
      ],
    ),
  );

  const [entry] = buildReadinessIndex({ rootDir: root }).connectors;
  const list = entry.commands.find((command) => command.id === "item.list");
  const create = entry.commands.find((command) => command.id === "item.create");

  assert.equal(entry.workflow.output_destination_allowed, true);
  assert.equal(entry.runtime.writable_command_count, 1);
  assert.deepEqual(entry.workflow.writable_resources, ["item"]);
  assert.deepEqual(entry.workflow.writable_operations, ["item.create"]);
  assert.equal(list.workflow_source_allowed, true);
  assert.equal(list.workflow_destination_allowed, false);
  assert.equal(list.side_effect_class, "none");
  assert.equal(list.dry_run_supported, true);
  assert.equal(create.resource, "item");
  assert.equal(create.operation, "create");
  assert.equal(create.resource_label, "Item");
  assert.equal(create.operation_label, "Create");
  assert.equal(create.writable, true);
  assert.equal(create.live_write_available, true);
  assert.equal(create.credential_binding_available, true);
  assert.equal(create.workflow_destination_allowed, true);
  assert.equal(create.workflow_source_allowed, false);
  assert.equal(create.approval_required, true);
  assert.equal(create.credential_required, true);
  assert.equal(create.required_service_key_provider, "operator-service-keys");
  assert.deepEqual(create.required_service_keys, ["FIXTURE_API_KEY"]);
  assert.equal(create.dry_run_supported, false);
  assert.equal(create.test_supported, true);
  assert.equal(create.test_evidence, "fixture-command-test");
  assert.equal(create.picker_hint_available, true);
  assert.deepEqual(create.picker_hint.source_fields, ["id", "name"]);
});

test("does not promote connector harness tests to command-level test support", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-readiness-"));
  writeConnector(
    root,
    "aos-harness-only",
    baseManifest(
      "aos-harness-only",
      {
        scaffold_only: false,
        live_backend_available: true,
        live_read_available: true,
        write_bridge_available: false,
      },
      [
        { id: "item.list", action_class: "read", required_mode: "readonly", supports_json: true },
        {
          id: "item.read",
          action_class: "read",
          required_mode: "readonly",
          supports_json: true,
          test_supported: true,
        },
      ],
    ),
  );

  const [entry] = buildReadinessIndex({ rootDir: root }).connectors;
  const list = entry.commands.find((command) => command.id === "item.list");
  const read = entry.commands.find((command) => command.id === "item.read");

  assert.equal(entry.runtime.harness.tests, true);
  assert.equal(list.test_supported, false);
  assert.equal(list.test_evidence, null);
  assert.equal(read.test_supported, true);
  assert.equal(read.test_evidence, "manifest-command-evidence");
});

test("excludes connector diagnostics from workflow source actions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-readiness-"));
  writeConnector(
    root,
    "aos-source-filter",
    baseManifest(
      "aos-source-filter",
      {
        scaffold_only: false,
        live_backend_available: true,
        live_read_available: true,
        write_bridge_available: false,
      },
      [
        { id: "capabilities", action_class: "read", required_mode: "readonly", supports_json: true, resource: "connector" },
        { id: "config.show", action_class: "read", required_mode: "readonly", supports_json: true, resource: "connector" },
        { id: "health", action_class: "read", required_mode: "readonly", supports_json: true, resource: "connector" },
        { id: "doctor", action_class: "read", required_mode: "readonly", supports_json: true, resource: "connector" },
        { id: "item.list", action_class: "read", required_mode: "readonly", supports_json: true, resource: "item" },
      ],
    ),
  );

  const [entry] = buildReadinessIndex({ rootDir: root }).connectors;

  assert.equal(entry.workflow.source_command_count, 1);
  assert.deepEqual(
    entry.commands
      .filter((command) => command.workflow_source_allowed)
      .map((command) => command.id),
    ["item.list"],
  );
});

test("requires operator service-key binding before allowing workflow destinations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-readiness-"));
  writeConnector(
    root,
    "aos-oauth-local",
    baseManifest(
      "aos-oauth-local",
      {
        scaffold_only: false,
        live_backend_available: true,
        live_read_available: true,
        write_bridge_available: true,
      },
      [{ id: "event.create", action_class: "write", required_mode: "write", supports_json: true, resource: "event" }],
      { required: true, service_keys: [] },
    ),
  );

  const [entry] = buildReadinessIndex({ rootDir: root }).connectors;
  const create = entry.commands[0];

  assert.equal(entry.readiness, "live-ready");
  assert.equal(entry.workflow.output_destination_allowed, false);
  assert.equal(create.live_write_available, true);
  assert.equal(create.credential_binding_available, false);
  assert.equal(create.workflow_destination_allowed, false);
  assert.equal(create.required_service_key_provider, null);
  assert.equal(create.approval_required, false);
});

test("keeps preview writes out of workflow output destinations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-readiness-"));
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

  const [entry] = buildReadinessIndex({ rootDir: root }).connectors;
  const schedule = entry.commands.find((command) => command.id === "item.schedule");

  assert.equal(entry.workflow.output_destination_allowed, false);
  assert.equal(schedule.preview_only, true);
  assert.equal(schedule.workflow_destination_allowed, false);
  assert.equal(schedule.writable, false);
  assert.equal(schedule.side_effect_class, "preview_or_scaffold_only");
  assert.equal(schedule.dry_run_supported, true);
});

test("falls back to extracted service keys when auth fields are absent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-readiness-"));
  writeConnector(root, "aos-token-scan", {
    tool: "aos-token-scan",
    backend: "token-api",
    manifest_schema_version: "1.0.0",
    scope: {
      kind: "records",
      surface: "record",
      workerFields: {
        "record.list": {
          args: ["FALLBACK_API_KEY"],
        },
      },
    },
    commands: [
      { id: "record.list", action_class: "read", required_mode: "readonly", supports_json: true },
    ],
  });

  const [entry] = buildReadinessIndex({ rootDir: root }).connectors;

  assert.deepEqual(entry.auth.service_keys, ["FALLBACK_API_KEY"]);
  assert.equal(entry.commands[0].required_service_key_provider, "operator-service-keys");
});

test("publishes observed side-effect classes from manifests and derived commands", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-readiness-"));
  writeConnector(
    root,
    "aos-side-effect",
    baseManifest(
      "aos-side-effect",
      {
        scaffold_only: false,
        live_backend_available: true,
        live_read_available: true,
        write_bridge_available: true,
      },
      [
        { id: "item.list", action_class: "read", required_mode: "readonly", supports_json: true },
        {
          id: "item.send",
          action_class: "write",
          required_mode: "write",
          supports_json: true,
          side_effect_level: "outbound_delivery",
        },
      ],
    ),
  );

  const index = buildReadinessIndex({ rootDir: root });

  assert.deepEqual(index.side_effect_classes, ["none", "outbound_delivery"]);
  assert.equal(index.connectors[0].commands[1].side_effect_class, "outbound_delivery");
});
