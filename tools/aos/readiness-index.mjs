#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const READINESS_LEVELS = new Set([
  "live-ready",
  "read-only",
  "preview-only",
  "manifest-only",
  "scaffold/deferred",
]);
const DEFAULT_ROOT = path.resolve("tools/aos");
const DEFAULT_OUTPUT = path.join(DEFAULT_ROOT, "readiness-index.json");
const OPERATOR_SERVICE_KEY_PROVIDER = "operator-service-keys";
const NON_WORKFLOW_SOURCE_COMMANDS = new Set(["capabilities", "health", "config.show", "doctor"]);
const SECRETISH_TOKEN = /\b[A-Z][A-Z0-9_]{2,}\b/g;
const SERVICE_KEY_SUFFIXES = [
  "_ACCOUNT",
  "_API_KEY",
  "_API_URL",
  "_APP_TOKEN",
  "_BASE_URL",
  "_BOT_TOKEN",
  "_CHANNEL_ID",
  "_CLIENT_ID",
  "_CLIENT_SECRET",
  "_FIELD",
  "_ITEM",
  "_KEY",
  "_PORTAL_ID",
  "_SECRET",
  "_TEAM_ID",
  "_TENANT_ID",
  "_TOKEN",
  "_URL",
  "_USER_ID",
  "_VAULT",
  "_WEBHOOK_URL",
];
const SERVICE_KEY_EXACT = new Set(["OP_ACCOUNT"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stableUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function hasFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function hasDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function connectorDirs(rootDir) {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("aos-"))
    .map((entry) => path.join(rootDir, entry.name))
    .filter((dir) => hasFile(path.join(dir, "connector.json")))
    .sort();
}

function extractedServiceKeys(manifest) {
  const tokens = JSON.stringify(manifest).match(SECRETISH_TOKEN) ?? [];
  return stableUnique(
    tokens.filter((token) => {
      if (["JSON", "REST", "HTTP", "HTTPS", "OAuth", "API"].includes(token)) return false;
      return (
        SERVICE_KEY_EXACT.has(token) ||
        SERVICE_KEY_SUFFIXES.some((suffix) => token.endsWith(suffix))
      );
    }),
  );
}

function explicitServiceKeys(manifest) {
  return stableUnique([
    ...(Array.isArray(manifest.auth?.service_keys) ? manifest.auth.service_keys : []),
    ...(Array.isArray(manifest.setup?.service_keys) ? manifest.setup.service_keys : []),
  ]);
}

function optionalScopeServiceKeys(manifest) {
  return stableUnique([
    ...(Array.isArray(manifest.auth?.optional_scope_service_keys)
      ? manifest.auth.optional_scope_service_keys
      : []),
    ...(Array.isArray(manifest.scope?.optional_scope_service_keys)
      ? manifest.scope.optional_scope_service_keys
      : []),
    ...(Array.isArray(manifest.scope?.optional_service_keys)
      ? manifest.scope.optional_service_keys
      : []),
  ]);
}

function serviceKeysForManifest(manifest) {
  const explicit = explicitServiceKeys(manifest);
  return explicit.length > 0 ? explicit : extractedServiceKeys(manifest);
}

function optionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function commandClass(command) {
  if (
    command.action_class === "write" ||
    command.required_mode === "write" ||
    command.required_mode === "full" ||
    command.required_mode === "admin"
  ) {
    return "write";
  }
  return "read";
}

function classifyConnector({ manifest, harness }) {
  const commands = Array.isArray(manifest.commands) ? manifest.commands : [];
  const writeCommands = commands.filter((command) => commandClass(command) === "write");
  const readCommands = commands.filter((command) => commandClass(command) === "read");
  const scope = manifest.scope ?? {};
  const serialized = JSON.stringify(manifest).toLowerCase();
  const hasPreviewWrites =
    writeCommands.length > 0 &&
    (scope.write_bridge_available === false ||
      serialized.includes("preview_only") ||
      serialized.includes("scaffolded_write") ||
      serialized.includes("scaffolded write"));

  if (!harness.present || commands.length === 0) return "manifest-only";
  if (scope.scaffold_only === true || manifest.scaffold_only === true) return "scaffold/deferred";
  if (hasPreviewWrites) return "preview-only";
  if (writeCommands.length > 0 && scope.write_bridge_available === true) return "live-ready";
  if (writeCommands.length > 0) return "preview-only";
  if (readCommands.length > 0) return "read-only";
  return "manifest-only";
}

function commandReadiness({ command, connectorReadiness, manifest }) {
  const actionClass = commandClass(command);
  if (actionClass === "read") {
    if (connectorReadiness === "manifest-only") return "manifest-only";
    if (connectorReadiness === "scaffold/deferred") return "scaffold/deferred";
    return "read-only";
  }

  if (connectorReadiness === "preview-only") return "preview-only";
  if (connectorReadiness === "live-ready") return "live-ready";
  if (connectorReadiness === "manifest-only") return "manifest-only";
  if (manifest.scope?.write_bridge_available === false) return "preview-only";
  return "scaffold/deferred";
}

function commandSideEffect(command, readiness) {
  if (command.side_effect_level) return command.side_effect_level;
  if (commandClass(command) === "write") {
    return readiness === "live-ready" ? "external_mutation" : "preview_or_scaffold_only";
  }
  return "none";
}

function commandResource(command) {
  if (command.resource) return command.resource;
  return String(command.id ?? "command").split(".")[0] || "command";
}

function commandOperation(command) {
  if (command.operation) return command.operation;
  const parts = String(command.id ?? "").split(".").filter(Boolean);
  if (parts.length > 1) return parts.slice(1).join(".");
  return parts[0] || "run";
}

function labelFromToken(value) {
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\./g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function pickerHints(manifest) {
  return manifest.scope?.pickerHints ?? manifest.pickerHints ?? {};
}

function normalizePickerHint(hint) {
  if (!hint || typeof hint !== "object") return null;
  return {
    kind: hint.kind ?? null,
    selection_surface: hint.selection_surface ?? null,
    resource: hint.resource ?? null,
    source_command: hint.source_command ?? null,
    source_fields: Array.isArray(hint.source_fields) ? hint.source_fields : [],
  };
}

function pickerHintForResource(manifest, resource) {
  const hints = pickerHints(manifest);
  if (hints[resource]) return normalizePickerHint(hints[resource]);
  const matched = Object.values(hints).find(
    (hint) =>
      hint?.kind === resource ||
      hint?.selection_surface === resource ||
      hint?.resource === resource ||
      String(hint?.resource ?? "").endsWith(`.${resource}`),
  );
  return normalizePickerHint(matched);
}

function explicitBoolean(command, ...keys) {
  for (const key of keys) {
    if (typeof command[key] === "boolean") return command[key];
  }
  return null;
}

function workflowSourceEligible({ actionClass, command, resource, runtimeAvailable }) {
  return (
    actionClass === "read" &&
    runtimeAvailable &&
    resource !== "connector" &&
    !NON_WORKFLOW_SOURCE_COMMANDS.has(command.id)
  );
}

function commandEntry({ command, connectorReadiness, manifest, requiredServiceKeys }) {
  const readiness = commandReadiness({ command, connectorReadiness, manifest });
  const actionClass = commandClass(command);
  const sideEffectLevel = commandSideEffect(command, readiness);
  const runtimeAvailable = !["manifest-only", "scaffold/deferred"].includes(readiness);
  const resource = commandResource(command);
  const operation = commandOperation(command);
  const liveWriteAvailable =
    actionClass === "write" && readiness === "live-ready" && runtimeAvailable;
  const credentialBindingAvailable = requiredServiceKeys.length > 0;
  const workflowDestinationAllowed = liveWriteAvailable && credentialBindingAvailable;
  const workflowSourceAllowed = workflowSourceEligible({
    actionClass,
    command,
    resource,
    runtimeAvailable,
  });
  const credentialRequired =
    manifest.auth?.required === true ||
    requiredServiceKeys.length > 0 ||
    ["write", "full", "admin"].includes(command.required_mode ?? "readonly");
  const dryRunExplicit = explicitBoolean(command, "dry_run_supported", "supports_dry_run");
  const dryRunSupported =
    dryRunExplicit ??
    (actionClass === "read" || (actionClass === "write" && readiness !== "live-ready"));
  const testExplicit = explicitBoolean(command, "test_supported", "tested");
  const testSupported = testExplicit === true;
  const pickerHint = pickerHintForResource(manifest, resource);

  return {
    id: command.id,
    summary: command.summary ?? "",
    required_mode: command.required_mode ?? "readonly",
    action_class: actionClass,
    readiness,
    runtime_available: runtimeAvailable,
    side_effect_level: sideEffectLevel,
    side_effect_class: sideEffectLevel,
    supports_json: command.supports_json === true,
    resource,
    operation,
    resource_label: command.resource_label ?? labelFromToken(resource),
    operation_label: command.operation_label ?? labelFromToken(operation),
    live_write_available: liveWriteAvailable,
    credential_binding_available: credentialBindingAvailable,
    writable: workflowDestinationAllowed,
    writable_resource: workflowDestinationAllowed ? resource : null,
    writable_operation: workflowDestinationAllowed ? operation : null,
    credential_required: credentialRequired,
    required_service_keys: requiredServiceKeys,
    required_service_key_provider:
      credentialRequired && requiredServiceKeys.length > 0 ? OPERATOR_SERVICE_KEY_PROVIDER : null,
    dry_run_supported: dryRunSupported,
    test_supported: testSupported,
    test_evidence: testSupported ? (command.test_evidence ?? "manifest-command-evidence") : null,
    picker_hint: pickerHint,
    picker_hint_available: pickerHint !== null,
    workflow_source_allowed: workflowSourceAllowed,
    workflow_destination_allowed: workflowDestinationAllowed,
    approval_required: workflowDestinationAllowed,
    preview_only: readiness === "preview-only",
    scaffold_or_deferred: ["manifest-only", "scaffold/deferred"].includes(readiness),
  };
}

function connectorWorkflow(commands) {
  const writableCommands = commands.filter((command) => command.workflow_destination_allowed);
  const sourceCommands = commands.filter((command) => command.workflow_source_allowed);

  return {
    output_destination_allowed: writableCommands.length > 0,
    source_command_count: sourceCommands.length,
    destination_command_count: writableCommands.length,
    writable_resources: stableUnique(writableCommands.map((command) => command.resource)),
    writable_operations: stableUnique(writableCommands.map((command) => command.id)),
    approval_required_for_writes: writableCommands.some((command) => command.approval_required),
  };
}

function connectorEntry(rootDir, connectorDir) {
  const manifestPath = path.join(connectorDir, "connector.json");
  const manifest = readJson(manifestPath);
  const relativeDir = path.relative(rootDir, connectorDir);
  const harnessDir = path.join(connectorDir, "agent-harness");
  const harness = {
    present: hasDirectory(harnessDir),
    pyproject: hasFile(path.join(harnessDir, "pyproject.toml")),
    tests: hasDirectory(path.join(harnessDir, "tests")),
  };
  const rawCommands = Array.isArray(manifest.commands) ? manifest.commands : [];
  const readiness = classifyConnector({ manifest, harness });
  const requiredServiceKeys = serviceKeysForManifest(manifest);
  const optionalScopeKeys = optionalScopeServiceKeys(manifest);
  assert(READINESS_LEVELS.has(readiness), `invalid readiness ${readiness}`);

  const commands = rawCommands.map((command) =>
    commandEntry({
      command,
      connectorReadiness: readiness,
      manifest,
      requiredServiceKeys,
    }),
  );

  return {
    tool: manifest.tool ?? path.basename(connectorDir),
    backend: manifest.backend ?? null,
    path: `tools/aos/${relativeDir}`,
    manifest_schema_version: manifest.manifest_schema_version ?? null,
    readiness,
    production_smoke_tested: false,
    production_smoke_caveat:
      "No production external-account smoke test evidence is recorded in this index.",
    scope: {
      kind: manifest.scope?.kind ?? null,
      surface: manifest.scope?.surface ?? null,
      scaffold_only: optionalBoolean(manifest.scope?.scaffold_only),
      live_backend_available: optionalBoolean(manifest.scope?.live_backend_available),
      live_read_available: optionalBoolean(manifest.scope?.live_read_available),
      write_bridge_available: optionalBoolean(manifest.scope?.write_bridge_available),
    },
    auth: {
      service_keys: requiredServiceKeys,
      optional_scope_service_keys: optionalScopeKeys,
      service_key_provider:
        requiredServiceKeys.length > 0 ? OPERATOR_SERVICE_KEY_PROVIDER : null,
      operator_service_keys_preferred: true,
      local_env_fallback_only: true,
    },
    runtime: {
      harness,
      command_count: commands.length,
      read_command_count: commands.filter((command) => command.action_class === "read").length,
      write_command_count: commands.filter((command) => command.action_class === "write").length,
      writable_command_count: commands.filter((command) => command.writable).length,
    },
    workflow: connectorWorkflow(commands),
    commands,
  };
}

export function buildReadinessIndex({ rootDir = DEFAULT_ROOT } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const connectors = connectorDirs(resolvedRoot).map((dir) => connectorEntry(resolvedRoot, dir));
  const totals = connectors.reduce(
    (acc, connector) => {
      acc.connectors += 1;
      acc.by_readiness[connector.readiness] = (acc.by_readiness[connector.readiness] ?? 0) + 1;
      acc.commands += connector.runtime.command_count;
      acc.read_commands += connector.runtime.read_command_count;
      acc.write_commands += connector.runtime.write_command_count;
      acc.writable_commands += connector.runtime.writable_command_count;
      return acc;
    },
    {
      connectors: 0,
      commands: 0,
      read_commands: 0,
      write_commands: 0,
      writable_commands: 0,
      by_readiness: Object.fromEntries([...READINESS_LEVELS].map((level) => [level, 0])),
    },
  );
  const sideEffectClasses = stableUnique(
    connectors.flatMap((connector) =>
      connector.commands.map((command) => command.side_effect_class),
    ),
  );

  return {
    schema_version: "1.1.0",
    generated_from: {
      root: "tools/aos",
      sources: ["aos-*/connector.json", "aos-*/agent-harness/"],
    },
    consumer_contract: {
      allowed_consumers: ["Workflows", "AppForge", "AOU"],
      consume_only: [
        "connector manifests",
        "permissions",
        "command capabilities",
        "action_class",
        "runtime command availability",
        "readiness labels",
        "side-effect metadata",
        "writable resource and operation metadata",
        "credential requirements",
        "dry-run and test-support flags",
        "picker hints",
      ],
      do_not_infer: [
        "private harness internals",
        "unstated write support",
        "production smoke coverage",
      ],
    },
    workflow_contract: {
      source_actions:
        "Workflows may offer connector source/read actions only when command.workflow_source_allowed is true.",
      output_destinations:
        "Workflows may offer connector output destinations only when command.workflow_destination_allowed is true and operator service keys can be bound.",
      approvals:
        "External mutation commands remain approval-gated when command.approval_required is true.",
      credentials:
        "Credential binding must use auth.service_key_provider and command.required_service_keys; local environment fallback is development-only.",
    },
    readiness_levels: {
      "live-ready":
        "Harness and manifest expose non-preview runtime commands; production_smoke_tested still records whether live account smoke evidence exists.",
      "read-only": "Harness and manifest expose read commands but no live write bridge.",
      "preview-only":
        "Write commands are surfaced only as preview/scaffold behavior or without a live write bridge.",
      "manifest-only":
        "Connector has manifest metadata but no usable harness evidence in this tree.",
      "scaffold/deferred": "Connector or commands are explicitly scaffold-only/deferred.",
    },
    side_effect_classes: sideEffectClasses,
    caveats: [
      "This index is generated from repository evidence, not live external account probes.",
      "production_smoke_tested=false means do not claim production live coverage.",
      "Consumers must still enforce required_mode, permissions, and side-effect approval at runtime.",
      "workflow_destination_allowed=true is metadata eligibility, not proof that operator credentials are currently configured.",
    ],
    totals,
    connectors,
  };
}

function writeIndex(index, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(index, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = { rootDir: DEFAULT_ROOT, outputPath: DEFAULT_OUTPUT, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.rootDir = argv[++index];
    else if (arg === "--output") options.outputPath = argv[++index];
    else if (arg === "--check") options.check = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const next = buildReadinessIndex({ rootDir: options.rootDir });
  if (options.check) {
    const current = readJson(options.outputPath);
    assert.deepEqual(
      current,
      next,
      `${options.outputPath} is stale; run tools/aos/readiness-index.mjs`,
    );
    return;
  }
  writeIndex(next, options.outputPath);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
