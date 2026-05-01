#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SOURCE_ROOT = path.resolve("tools/aos");
const DEFAULT_RUNTIME_ROOT = path.resolve(".");
const WORKFLOW_CONNECTOR_IDS = [
  "aos-slack",
  "aos-buffer",
  "aos-resend",
  "aos-telegram",
  "aos-quickbooks",
  "aos-github",
  "aos-calendar",
];
const KNOWN_PROVIDER_SURFACES = {
  "aos-calendar": ["aos-google", "aos-m365"],
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function connectorDir(rootDir, id) {
  return path.join(rootDir, id);
}

function manifestPath(rootDir, id) {
  return path.join(connectorDir(rootDir, id), "connector.json");
}

function loadManifest(rootDir, id) {
  const filePath = manifestPath(rootDir, id);
  if (!hasFile(filePath)) return null;
  return readJson(filePath);
}

function localBinaryPath(runtimeRoot, id, manifest) {
  const tool = typeof manifest?.tool === "string" ? manifest.tool : id;
  const harnessDir = path.join(runtimeRoot, "tools", "aos", id, "agent-harness");
  const candidates = [
    path.join(harnessDir, ".venv", "bin", tool),
    path.join(harnessDir, "venv", "bin", tool),
    path.join(harnessDir, "bin", tool),
    path.join(harnessDir, "shims", tool),
  ];
  return candidates.find(hasFile) ?? null;
}

function harnessStatus(sourceRoot, id) {
  const harnessDir = path.join(connectorDir(sourceRoot, id), "agent-harness");
  return {
    present: hasDirectory(harnessDir),
    pyproject: hasFile(path.join(harnessDir, "pyproject.toml")),
    tests: hasDirectory(path.join(harnessDir, "tests")),
  };
}

function commandIds(manifest) {
  return Array.isArray(manifest?.commands)
    ? manifest.commands
        .map((command) => command.id)
        .filter(Boolean)
        .sort()
    : [];
}

function commandById(manifest) {
  return new Map(
    Array.isArray(manifest?.commands)
      ? manifest.commands
          .filter((command) => typeof command?.id === "string")
          .map((command) => [command.id, command])
      : [],
  );
}

function isPreviewOnlyCommand(command) {
  return (
    command?.preview_only === true ||
    command?.runtime_available === false ||
    command?.side_effect_level === "local_preview_only" ||
    command?.side_effect_level === "preview_or_scaffold_only"
  );
}

function stableUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function credentialRequirements(manifest) {
  const auth = manifest?.auth && typeof manifest.auth === "object" ? manifest.auth : {};
  const serviceKeys = Array.isArray(auth.service_keys) ? auth.service_keys.filter(Boolean) : [];
  const requiredOneOf = Array.isArray(auth.required_one_of)
    ? auth.required_one_of
        .filter((group) => Array.isArray(group))
        .map((group) => group.filter(Boolean))
        .filter((group) => group.length > 0)
    : [];
  return {
    required: auth.required === true,
    kind: typeof auth.kind === "string" ? auth.kind : null,
    service_keys: serviceKeys,
    required_one_of: requiredOneOf,
  };
}

function credentialStatus(requirements, env) {
  const present = new Set();
  const missing = new Set();
  for (const group of requirements.required_one_of) {
    if (group.some((key) => Boolean(env[key]))) {
      for (const key of group) {
        if (env[key]) present.add(key);
      }
    } else {
      for (const key of group) missing.add(key);
    }
  }

  const oneOfKeys = new Set(requirements.required_one_of.flat());
  for (const key of requirements.service_keys) {
    if (oneOfKeys.has(key)) continue;
    if (env[key]) present.add(key);
    else missing.add(key);
  }

  const satisfied =
    !requirements.required ||
    (requirements.required_one_of.every((group) => group.some((key) => Boolean(env[key]))) &&
      requirements.service_keys
        .filter((key) => !oneOfKeys.has(key))
        .every((key) => Boolean(env[key])));

  return {
    satisfied,
    present: [...present].sort(),
    missing: [...missing].sort(),
  };
}

function workflowUsages(workflowTemplatePath) {
  if (!workflowTemplatePath || !hasFile(workflowTemplatePath)) return [];
  const source = fs.readFileSync(workflowTemplatePath, "utf8");
  const usages = [];
  const callPattern =
    /connector(?:Action|Output)\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"(aos-[^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"/gs;
  for (const match of source.matchAll(callPattern)) {
    usages.push({
      node_id: match[1],
      label: match[2],
      connector_id: match[3],
      resource: match[4],
      operation: match[5],
    });
  }
  return usages;
}

function classifyConnector({ manifest, harness, binaryPath, credentials }) {
  if (!manifest) {
    return {
      truth_label: "blocked",
      reasons: ["missing connector manifest"],
    };
  }
  if (manifest.scope?.scaffold_only === true || manifest.scaffold_only === true) {
    return {
      truth_label: "blocked",
      reasons: ["connector is explicitly scaffold-only pending a live adapter contract"],
    };
  }
  if (!harness.present) {
    return {
      truth_label: "blocked",
      reasons: ["manifest exists but no agent-harness is present"],
    };
  }
  if (!binaryPath) {
    return {
      truth_label: "repo-only",
      reasons: ["agent-harness exists in repo but no local runnable binary was found"],
    };
  }
  if (!credentials.satisfied) {
    return {
      truth_label: "missing credentials",
      reasons: ["local binary exists but required credentials are absent"],
    };
  }
  return {
    truth_label: "runnable",
    reasons: ["local binary and required credentials are present"],
  };
}

function providerSurfaceSummary(sourceRoot, id) {
  return (KNOWN_PROVIDER_SURFACES[id] ?? [])
    .map((providerId) => {
      const manifest = loadManifest(sourceRoot, providerId);
      if (!manifest) return null;
      return {
        connector_id: providerId,
        label: manifest.connector?.label ?? providerId,
        commands: commandIds(manifest).filter((command) => command.includes("calendar")),
      };
    })
    .filter(Boolean);
}

export function buildWorkflowConnectorReadiness({
  sourceRoot = DEFAULT_SOURCE_ROOT,
  runtimeRoot = DEFAULT_RUNTIME_ROOT,
  workflowTemplatePath = path.resolve("src/infra/workflow-owner-operator-templates.ts"),
  env = process.env,
} = {}) {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const usages = workflowUsages(workflowTemplatePath);
  const usageByConnector = new Map();
  for (const usage of usages) {
    const bucket = usageByConnector.get(usage.connector_id) ?? [];
    bucket.push(usage);
    usageByConnector.set(usage.connector_id, bucket);
  }

  const connectors = WORKFLOW_CONNECTOR_IDS.map((id) => {
    const manifest = loadManifest(resolvedSourceRoot, id);
    const harness = harnessStatus(resolvedSourceRoot, id);
    const binaryPath = localBinaryPath(resolvedRuntimeRoot, id, manifest);
    const credentials = credentialStatus(credentialRequirements(manifest), env);
    const commands = commandIds(manifest);
    const commandsById = commandById(manifest);
    const workflowConnectorUsages = usageByConnector.get(id) ?? [];
    const expectedOperations = stableUnique(
      workflowConnectorUsages.map((usage) => usage.operation),
    );
    const unsupportedOperations = expectedOperations.filter(
      (operation) => !commands.includes(operation),
    );
    const classification = classifyConnector({ manifest, harness, binaryPath, credentials });
    if (unsupportedOperations.length > 0) {
      classification.reasons = [
        ...classification.reasons,
        `workflow operations not advertised by manifest: ${unsupportedOperations.join(", ")}`,
      ];
    }
    const previewOnlyOperations = expectedOperations.filter((operation) =>
      isPreviewOnlyCommand(commandsById.get(operation)),
    );
    if (previewOnlyOperations.length > 0) {
      classification.reasons = [
        ...classification.reasons,
        `workflow operations are preview-only, not live operations: ${previewOnlyOperations.join(", ")}`,
      ];
    }
    return {
      connector_id: id,
      expected_by_workflows: usageByConnector.has(id),
      workflow_usages: workflowConnectorUsages,
      workflow_operation_status: {
        expected: expectedOperations,
        advertised: expectedOperations.filter((operation) => commands.includes(operation)),
        missing: unsupportedOperations,
        preview_only: previewOnlyOperations,
      },
      manifest: manifest
        ? {
            present: true,
            declared_tool: manifest.tool ?? null,
            label: manifest.connector?.label ?? id,
            backend: manifest.backend ?? null,
            commands,
          }
        : {
            present: false,
            declared_tool: null,
            label: null,
            backend: null,
            commands: [],
          },
      provider_surfaces: providerSurfaceSummary(resolvedSourceRoot, id),
      local_runtime: {
        harness,
        binary_path: binaryPath ? path.relative(resolvedRuntimeRoot, binaryPath) : null,
        binary_present: Boolean(binaryPath),
        credential_status: credentials,
      },
      ...classification,
    };
  });

  const liveReady = connectors.filter((connector) => connector.truth_label === "runnable");
  const blocked = connectors.filter((connector) => connector.truth_label !== "runnable");
  return {
    schema_version: "1.0.0",
    generated_from: {
      source_root: path.relative(process.cwd(), resolvedSourceRoot) || ".",
      runtime_root: path.relative(process.cwd(), resolvedRuntimeRoot) || ".",
      workflow_template_path: workflowTemplatePath
        ? path.relative(process.cwd(), path.resolve(workflowTemplatePath))
        : null,
    },
    overall_status: blocked.length === 0 ? "live-ready" : "blocked",
    live_ready_count: liveReady.length,
    blocked_count: blocked.length,
    connectors,
  };
}

function writeSummary(report) {
  for (const connector of report.connectors) {
    const binary = connector.local_runtime.binary_present ? "binary=yes" : "binary=no";
    const creds = connector.local_runtime.credential_status.satisfied
      ? "credentials=yes"
      : `credentials=missing:${connector.local_runtime.credential_status.missing.join(",") || "setup"}`;
    console.log(`${connector.connector_id}\t${connector.truth_label}\t${binary}\t${creds}`);
  }
  console.log(
    `overall\t${report.overall_status}\tlive-ready=${report.live_ready_count}\tblocked=${report.blocked_count}`,
  );
}

function parseArgs(argv) {
  const options = {
    sourceRoot: DEFAULT_SOURCE_ROOT,
    runtimeRoot: DEFAULT_RUNTIME_ROOT,
    workflowTemplatePath: path.resolve("src/infra/workflow-owner-operator-templates.ts"),
    summary: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-root") options.sourceRoot = argv[++index];
    else if (arg === "--runtime-root") options.runtimeRoot = argv[++index];
    else if (arg === "--workflow-template") options.workflowTemplatePath = argv[++index];
    else if (arg === "--summary") options.summary = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = buildWorkflowConnectorReadiness(options);
  assert.equal(report.schema_version, "1.0.0");
  if (options.summary) writeSummary(report);
  else console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
