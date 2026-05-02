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
  "_ENVIRONMENT",
  "_EMAIL",
  "_FIELD",
  "_HTTP_TIMEOUT_SECONDS",
  "_ID",
  "_ITEM",
  "_KEY",
  "_MINOR_VERSION",
  "_PORTAL_ID",
  "_REALM_ID",
  "_SECRET",
  "_TEAM_ID",
  "_TENANT_ID",
  "_TIMEOUT_SECONDS",
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

function extractServiceKeys(manifest) {
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

function optionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function commandClass(command) {
  if (
    command.action_class === "write" ||
    command.required_mode === "write" ||
    command.required_mode === "full"
  ) {
    return "write";
  }
  return "read";
}

function isPreviewOnlyCommand(command) {
  return (
    command.preview_only === true ||
    command.runtime_available === false ||
    command.side_effect_level === "local_preview_only" ||
    command.side_effect_level === "preview_or_scaffold_only"
  );
}

function classifyConnector({ manifest, harness }) {
  const commands = Array.isArray(manifest.commands) ? manifest.commands : [];
  const writeCommands = commands.filter((command) => commandClass(command) === "write");
  const readCommands = commands.filter((command) => commandClass(command) === "read");
  const scope = manifest.scope ?? {};
  const serialized = JSON.stringify(manifest).toLowerCase();
  const previewWriteCommands = writeCommands.filter(isPreviewOnlyCommand);
  const hasPreviewWrites =
    writeCommands.length > 0 &&
    (scope.write_bridge_available === false ||
      serialized.includes("scaffolded_write") ||
      serialized.includes("scaffolded write") ||
      previewWriteCommands.length === writeCommands.length);

  if (!harness.present || commands.length === 0) return "manifest-only";
  if (scope.scaffold_only === true || manifest.scaffold_only === true) return "scaffold/deferred";
  if (hasPreviewWrites) return "preview-only";
  if (writeCommands.length > 0 && scope.write_bridge_available === true) return "live-ready";
  if (
    writeCommands.length > 0 &&
    scope.live_backend_available === true &&
    scope.write_bridge_available !== false
  )
    return "live-ready";
  if (writeCommands.length > 0 && harness.tests && scope.write_bridge_available !== false)
    return "live-ready";
  if (readCommands.length > 0) return "read-only";
  return "manifest-only";
}

function commandReadiness({ command, connectorReadiness, manifest }) {
  if (isPreviewOnlyCommand(command)) {
    return "preview-only";
  }
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
    return readiness === "preview-only" ? "preview_or_scaffold_only" : "external_mutation";
  }
  return "none";
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
  const commands = Array.isArray(manifest.commands) ? manifest.commands : [];
  const readiness = classifyConnector({ manifest, harness });
  assert(READINESS_LEVELS.has(readiness), `invalid readiness ${readiness}`);

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
      service_keys: extractServiceKeys(manifest),
      operator_service_keys_preferred: true,
      local_env_fallback_only: true,
    },
    runtime: {
      harness,
      command_count: commands.length,
      read_command_count: commands.filter((command) => commandClass(command) === "read").length,
      write_command_count: commands.filter((command) => commandClass(command) === "write").length,
    },
    commands: commands.map((command) => {
      const readinessLevel = commandReadiness({ command, connectorReadiness: readiness, manifest });
      return {
        id: command.id,
        summary: command.summary ?? "",
        required_mode: command.required_mode ?? "readonly",
        action_class: commandClass(command),
        readiness: readinessLevel,
        runtime_available: !["manifest-only", "scaffold/deferred"].includes(readinessLevel),
        side_effect_level: commandSideEffect(command, readinessLevel),
        supports_json: command.supports_json === true,
      };
    }),
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
      return acc;
    },
    {
      connectors: 0,
      commands: 0,
      read_commands: 0,
      write_commands: 0,
      by_readiness: Object.fromEntries([...READINESS_LEVELS].map((level) => [level, 0])),
    },
  );

  return {
    schema_version: "1.0.0",
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
      ],
      do_not_infer: [
        "private harness internals",
        "unstated write support",
        "production smoke coverage",
      ],
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
    caveats: [
      "This index is generated from repository evidence, not live external account probes.",
      "production_smoke_tested=false means do not claim production live coverage.",
      "Consumers must still enforce required_mode, permissions, and side-effect approval at runtime.",
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
