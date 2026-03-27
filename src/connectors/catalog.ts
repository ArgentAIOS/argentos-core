import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CONNECTOR_CATALOG_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONNECTOR_TIMEOUT_MS = 4_000;
const MODE_FALLBACK = ["readonly", "write", "full", "admin"] as const;

export type ConnectorInstallState = "ready" | "needs-setup" | "repo-only" | "error";

export type ConnectorCatalogCommand = {
  id: string;
  summary?: string;
  requiredMode?: string;
  supportsJson?: boolean;
  resource?: string;
  actionClass?: string;
};

export type ConnectorCatalogEntry = {
  tool: string;
  label: string;
  description?: string;
  backend?: string;
  version?: string;
  manifestSchemaVersion?: string;
  category?: string;
  categories: string[];
  resources: string[];
  modes: string[];
  commands: ConnectorCatalogCommand[];
  installState: ConnectorInstallState;
  status: {
    ok: boolean;
    label: string;
    detail?: string;
  };
  discovery: {
    binaryPath?: string;
    repoDir?: string;
    harnessDir?: string;
    requiresPython?: string;
    sources: Array<"path" | "repo">;
  };
  auth?: {
    kind?: string;
    required?: boolean;
    serviceKeys?: string[];
    interactiveSetup?: string[];
  };
};

export type ConnectorsCatalogResult = {
  total: number;
  connectors: ConnectorCatalogEntry[];
};

type DiscoverConnectorCatalogOptions = {
  repoRoots?: string[];
  pathEnv?: string;
  timeoutMs?: number;
};

type RepoCandidate = {
  tool: string;
  repoDir: string;
  harnessDir?: string;
  pyprojectPath?: string;
  permissionsPath?: string;
  connectorMetaPath?: string;
  readmePath?: string;
};

type RepoMetadata = {
  tool: string;
  name?: string;
  version?: string;
  description?: string;
  requiresPython?: string;
  backend?: string;
  commands: ConnectorCatalogCommand[];
  connectorDescriptor?: {
    label?: string;
    category?: string;
    categories?: string[];
    resources?: string[];
  };
  auth?: ConnectorCatalogEntry["auth"];
};

type RawCapabilities = {
  tool?: string;
  version?: string;
  manifest_schema_version?: string;
  backend?: string;
  modes?: unknown;
  commands?: unknown;
  connector?: unknown;
  auth?: unknown;
};

type CommandRunSuccess = {
  ok: true;
  data: unknown;
};

type CommandRunFailure = {
  ok: false;
  detail: string;
};

export type ConnectorCommandExecutionResult =
  | {
      ok: true;
      exitCode: number;
      stdout: string;
      stderr: string;
      envelope?: Record<string, unknown>;
      data: unknown;
    }
  | {
      ok: false;
      exitCode: number;
      stdout: string;
      stderr: string;
      detail: string;
      envelope?: Record<string, unknown>;
      data?: unknown;
    };

function splitSearchPath(pathEnv?: string): string[] {
  return (pathEnv ?? process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function defaultRepoRoots(): string[] {
  const envRoots = (process.env.ARGENT_CONNECTOR_REPOS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const home = os.homedir();
  const vendoredRoots = [
    path.resolve(process.cwd(), "tools", "aos"),
    path.resolve(CONNECTOR_CATALOG_MODULE_DIR, "..", "..", "tools", "aos"),
  ];
  const userRoots = [path.join(home, ".argentos", "connectors")];
  const externalRoots = [
    path.join(home, "code", "agent-cli-tools"),
    path.resolve(process.cwd(), "..", "agent-cli-tools"),
  ];
  return Array.from(
    new Set([...envRoots, ...vendoredRoots, ...userRoots, ...externalRoots].filter(Boolean)),
  );
}

function discoverPathExecutables(pathEnv?: string): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const dir of splitSearchPath(pathEnv)) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.name.startsWith("aos-")) continue;
      if (!(entry.isFile() || entry.isSymbolicLink())) continue;
      if (resolved.has(entry.name)) continue;
      resolved.set(entry.name, path.join(dir, entry.name));
    }
  }
  return resolved;
}

function discoverRepoCandidates(repoRoots?: string[]): Map<string, RepoCandidate> {
  const candidates = new Map<string, RepoCandidate>();
  for (const root of repoRoots ?? defaultRepoRoots()) {
    if (!root || !fs.existsSync(root)) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("aos-")) continue;
      if (candidates.has(entry.name)) continue;
      const repoDir = path.join(root, entry.name);
      const harnessDir = path.join(repoDir, "agent-harness");
      const pyprojectPath = path.join(harnessDir, "pyproject.toml");
      const permissionsPath = path.join(harnessDir, "permissions.json");
      const connectorMetaPath = path.join(repoDir, "connector.json");
      const readmePath = path.join(repoDir, "README.md");
      candidates.set(entry.name, {
        tool: entry.name,
        repoDir,
        harnessDir: fs.existsSync(harnessDir) ? harnessDir : undefined,
        pyprojectPath: fs.existsSync(pyprojectPath) ? pyprojectPath : undefined,
        permissionsPath: fs.existsSync(permissionsPath) ? permissionsPath : undefined,
        connectorMetaPath: fs.existsSync(connectorMetaPath) ? connectorMetaPath : undefined,
        readmePath: fs.existsSync(readmePath) ? readmePath : undefined,
      });
    }
  }
  return candidates;
}

function readFileIfExists(filePath?: string): string | null {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function extractTomlSection(source: string, sectionName: string): string | null {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^\\[${escaped}\\]\\s*\\n([\\s\\S]*?)(?=^\\[|\\Z)`, "m"));
  return match?.[1] ?? null;
}

function extractTomlString(section: string | null, key: string): string | undefined {
  if (!section) return undefined;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.match(new RegExp(`^${escaped}\\s*=\\s*"([^"]+)"`, "m"));
  return match?.[1]?.trim() || undefined;
}

function extractTomlScripts(section: string | null): string[] {
  if (!section) return [];
  return Array.from(section.matchAll(/^([A-Za-z0-9._-]+)\s*=\s*"[^"]+"/gm), (match) =>
    match[1]?.trim(),
  ).filter((value): value is string => Boolean(value));
}

function parsePermissionsFile(raw: string | null): {
  backend?: string;
  commands: ConnectorCatalogCommand[];
} {
  if (!raw) {
    return { commands: [] };
  }
  try {
    const parsed = JSON.parse(raw) as {
      backend?: unknown;
      permissions?: Record<string, unknown>;
    };
    const commands = Object.entries(parsed.permissions ?? {})
      .filter(([id]) => typeof id === "string" && id.trim())
      .map(([id, requiredMode]) => ({
        id,
        summary: humanizeCommandId(id),
        requiredMode: typeof requiredMode === "string" ? requiredMode : undefined,
        supportsJson: true,
        resource: inferResourceFromCommandId(id),
        actionClass: inferActionClass(id),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    return {
      backend: typeof parsed.backend === "string" ? parsed.backend : undefined,
      commands,
    };
  } catch {
    return { commands: [] };
  }
}

function parseConnectorMetaFile(raw: string | null): {
  backend?: string;
  connectorDescriptor?: RepoMetadata["connectorDescriptor"];
  auth?: ConnectorCatalogEntry["auth"];
  commands: ConnectorCatalogCommand[];
} {
  if (!raw) {
    return { commands: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      backend: typeof parsed.backend === "string" ? parsed.backend : undefined,
      connectorDescriptor: normalizeConnectorDescriptor(parsed.connector),
      auth: normalizeAuth(parsed.auth),
      commands: normalizeConnectorCommands(parsed.commands),
    };
  } catch {
    return { commands: [] };
  }
}

function readRepoMetadata(candidate: RepoCandidate): RepoMetadata {
  const pyproject = readFileIfExists(candidate.pyprojectPath);
  const projectSection = extractTomlSection(pyproject ?? "", "project");
  const scriptsSection = extractTomlSection(pyproject ?? "", "project.scripts");
  const permissions = parsePermissionsFile(readFileIfExists(candidate.permissionsPath));
  const connectorMeta = parseConnectorMetaFile(readFileIfExists(candidate.connectorMetaPath));
  const scripts = extractTomlScripts(scriptsSection);
  const declaredTool = scripts.find((entry) => entry.startsWith("aos-")) ?? candidate.tool;
  const mergedCommandMap = new Map<string, ConnectorCatalogCommand>();
  const repoVisibleCommands =
    connectorMeta.commands.length > 0 ? connectorMeta.commands : permissions.commands;
  for (const command of repoVisibleCommands) {
    const permissionCommand = permissions.commands.find((entry) => entry.id === command.id);
    mergedCommandMap.set(command.id, {
      ...(permissionCommand ?? { id: command.id }),
      ...command,
      requiredMode: command.requiredMode ?? permissionCommand?.requiredMode,
      supportsJson: command.supportsJson ?? permissionCommand?.supportsJson,
      summary: command.summary ?? permissionCommand?.summary,
      resource: command.resource ?? permissionCommand?.resource,
      actionClass: command.actionClass ?? permissionCommand?.actionClass,
    });
  }
  const commands = Array.from(mergedCommandMap.values()).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return {
    tool: declaredTool,
    name: extractTomlString(projectSection, "name"),
    version: extractTomlString(projectSection, "version"),
    description: extractTomlString(projectSection, "description"),
    requiresPython: extractTomlString(projectSection, "requires-python"),
    backend: permissions.backend ?? connectorMeta.backend,
    commands,
    connectorDescriptor: connectorMeta.connectorDescriptor,
    auth: connectorMeta.auth,
  };
}

function findLocalHarnessBinary(tool: string, harnessDir?: string): string | undefined {
  if (!harnessDir) return undefined;
  const candidates = [
    path.join(harnessDir, ".venv", "bin", tool),
    path.join(harnessDir, "venv", "bin", tool),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function parseEnvelopeData(raw: string): unknown {
  const parsed = JSON.parse(raw) as { ok?: unknown; data?: unknown };
  if (typeof parsed?.ok === "boolean" && "data" in parsed) {
    return parsed.data;
  }
  return parsed;
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

async function runConnectorJson(params: {
  binaryPath: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
}): Promise<CommandRunSuccess | CommandRunFailure> {
  try {
    const { stdout, stderr } = await execFileAsync(params.binaryPath, params.args, {
      cwd: params.cwd,
      timeout: params.timeoutMs,
      maxBuffer: 1_000_000,
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    });
    const output = `${stdout ?? ""}`.trim();
    if (!output) {
      return {
        ok: false,
        detail: `${(stderr ?? "").trim() || "connector returned no JSON output"}`.trim(),
      };
    }
    return { ok: true, data: parseEnvelopeData(output) };
  } catch (error) {
    const detail = [
      error instanceof Error ? error.message : String(error),
      typeof (error as { stderr?: unknown })?.stderr === "string"
        ? ((error as { stderr?: string }).stderr ?? "").trim()
        : "",
      typeof (error as { stdout?: unknown })?.stdout === "string"
        ? ((error as { stdout?: string }).stdout ?? "").trim()
        : "",
    ]
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(" | ");
    return {
      ok: false,
      detail: detail || "connector command failed",
    };
  }
}

export async function runConnectorCommandJson(params: {
  binaryPath: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}): Promise<ConnectorCommandExecutionResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_CONNECTOR_TIMEOUT_MS;
  try {
    const { stdout = "", stderr = "" } = await execFileAsync(params.binaryPath, params.args, {
      cwd: params.cwd,
      timeout: timeoutMs,
      maxBuffer: 1_000_000,
      env: {
        ...process.env,
        ...(params.env ?? {}),
        NO_COLOR: "1",
      },
    });
    const envelope = tryParseJsonObject(stdout);
    const data = envelope ? parseEnvelopeData(stdout) : stdout.trim();
    return {
      ok: true,
      exitCode: 0,
      stdout: `${stdout}`,
      stderr: `${stderr}`,
      envelope: envelope ?? undefined,
      data,
    };
  } catch (error) {
    const stdout =
      typeof (error as { stdout?: unknown })?.stdout === "string"
        ? ((error as { stdout?: string }).stdout ?? "")
        : "";
    const stderr =
      typeof (error as { stderr?: unknown })?.stderr === "string"
        ? ((error as { stderr?: string }).stderr ?? "")
        : "";
    const envelope = tryParseJsonObject(stdout);
    const envelopeError =
      envelope?.error && typeof envelope.error === "object" && !Array.isArray(envelope.error)
        ? (envelope.error as Record<string, unknown>)
        : undefined;
    const detail = [
      typeof envelopeError?.message === "string" ? envelopeError.message : "",
      error instanceof Error ? error.message : String(error),
      stderr.trim(),
    ]
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(" | ");
    return {
      ok: false,
      exitCode:
        typeof (error as { code?: unknown })?.code === "number"
          ? ((error as { code?: number }).code ?? 10)
          : 10,
      stdout,
      stderr,
      detail: detail || "connector command failed",
      envelope: envelope ?? undefined,
      data: envelope ? parseEnvelopeData(stdout) : undefined,
    };
  }
}

function titleCaseWords(input: string): string {
  return input
    .split(/[-_\s]+/)
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function humanizeCommandId(commandId: string): string {
  return commandId
    .split(/[.:]/)
    .map((part) => titleCaseWords(part))
    .join(" ");
}

function inferResourceFromCommandId(commandId: string): string | undefined {
  const [first] = commandId.split(/[.:]/);
  const value = first?.trim().toLowerCase();
  return value ? value : undefined;
}

function inferActionClass(commandId: string): string | undefined {
  const normalized = commandId.toLowerCase();
  if (
    normalized.includes("list") ||
    normalized.includes("read") ||
    normalized.includes("show") ||
    normalized.includes("search") ||
    normalized.includes("status") ||
    normalized.includes("health")
  ) {
    return "read";
  }
  if (
    normalized.includes("create") ||
    normalized.includes("update") ||
    normalized.includes("write") ||
    normalized.includes("send") ||
    normalized.includes("edit") ||
    normalized.includes("generate") ||
    normalized.includes("upload") ||
    normalized.includes("append")
  ) {
    return "write";
  }
  if (
    normalized.includes("delete") ||
    normalized.includes("remove") ||
    normalized.includes("revoke")
  ) {
    return "destructive";
  }
  return undefined;
}

function inferCategories(params: {
  tool: string;
  description?: string;
  backend?: string;
  commands: ConnectorCatalogCommand[];
}): { category?: string; categories: string[]; resources: string[] } {
  const resources = new Set<string>();
  const categories = new Set<string>();
  const normalizedTool = params.tool.toLowerCase();
  const normalizedDescription = (params.description ?? "").toLowerCase();
  const normalizedBackend = (params.backend ?? "").toLowerCase();

  for (const command of params.commands) {
    const resource = (
      command.resource ??
      inferResourceFromCommandId(command.id) ??
      ""
    ).toLowerCase();
    if (resource) {
      resources.add(resource);
    }
  }

  const haystack = [normalizedTool, normalizedDescription, normalizedBackend, ...resources].join(
    " ",
  );

  if (haystack.includes("gmail") || haystack.includes("mail") || haystack.includes("inbox")) {
    categories.add("inbox");
  }
  if (haystack.includes("ticket") || haystack.includes("queue") || haystack.includes("helpdesk")) {
    categories.add("ticket-queue");
  }
  if (haystack.includes("sheet") || haystack.includes("table") || haystack.includes("csv")) {
    categories.add("table");
  }
  if (
    haystack.includes("quickbooks") ||
    haystack.includes("invoice") ||
    haystack.includes("ledger") ||
    haystack.includes("accounting")
  ) {
    categories.add("accounting");
  }
  if (
    haystack.includes("alert") ||
    haystack.includes("security") ||
    haystack.includes("siem") ||
    haystack.includes("log")
  ) {
    categories.add("alert-stream");
  }
  if (haystack.includes("drive") || haystack.includes("doc") || haystack.includes("file")) {
    categories.add("files-docs");
  }
  if (haystack.includes("calendar")) {
    categories.add("calendar");
  }
  if (haystack.includes("crm") || haystack.includes("lead") || haystack.includes("customer")) {
    categories.add("crm");
  }
  if (haystack.includes("social") || haystack.includes("hootsuite") || haystack.includes("post")) {
    categories.add("social-publishing");
  }
  if (categories.size === 0 && resources.size > 0) {
    categories.add("general");
  }

  const categoryList = Array.from(categories);
  return {
    category: categoryList[0],
    categories: categoryList,
    resources: Array.from(resources),
  };
}

function isWorkerVisibleConnectorCommand(commandId: string): boolean {
  const normalized = commandId.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "capabilities" || normalized === "health" || normalized === "doctor") {
    return false;
  }
  if (normalized === "config" || normalized.startsWith("config.")) {
    return false;
  }
  return true;
}

function normalizeConnectorCommands(raw: unknown): ConnectorCatalogCommand[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const typed = entry as Record<string, unknown>;
      const id = typeof typed.id === "string" ? typed.id.trim() : "";
      if (!id) return null;
      return {
        id,
        summary: typeof typed.summary === "string" ? typed.summary : humanizeCommandId(id),
        requiredMode: typeof typed.required_mode === "string" ? typed.required_mode : undefined,
        supportsJson: typeof typed.supports_json === "boolean" ? typed.supports_json : undefined,
        resource:
          typeof typed.resource === "string" ? typed.resource : inferResourceFromCommandId(id),
        actionClass:
          typeof typed.action_class === "string" ? typed.action_class : inferActionClass(id),
      } satisfies ConnectorCatalogCommand;
    })
    .filter((entry): entry is ConnectorCatalogCommand => Boolean(entry))
    .filter((entry) => isWorkerVisibleConnectorCommand(entry.id))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeModes(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [...MODE_FALLBACK];
  }
  const values = raw
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return values.length > 0 ? values : [...MODE_FALLBACK];
}

function normalizeAuth(raw: unknown): ConnectorCatalogEntry["auth"] | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const typed = raw as Record<string, unknown>;
  return {
    kind: typeof typed.kind === "string" ? typed.kind : undefined,
    required: typeof typed.required === "boolean" ? typed.required : undefined,
    serviceKeys: Array.isArray(typed.service_keys)
      ? typed.service_keys.filter((item): item is string => typeof item === "string")
      : undefined,
    interactiveSetup: Array.isArray(typed.interactive_setup)
      ? typed.interactive_setup.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

function normalizeConnectorDescriptor(raw: unknown): {
  label?: string;
  category?: string;
  categories?: string[];
  resources?: string[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const typed = raw as Record<string, unknown>;
  return {
    label: typeof typed.label === "string" ? typed.label : undefined,
    category: typeof typed.category === "string" ? typed.category : undefined,
    categories: Array.isArray(typed.categories)
      ? typed.categories.filter((item): item is string => typeof item === "string")
      : undefined,
    resources: Array.isArray(typed.resources)
      ? typed.resources.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

function buildLabel(tool: string, capabilitiesLabel?: string, description?: string): string {
  if (capabilitiesLabel?.trim()) {
    return capabilitiesLabel.trim();
  }
  if (description?.trim()) {
    const trimmed = description
      .trim()
      .replace(/^agent-native\s+/i, "")
      .replace(/\s+cli wrapper$/i, "")
      .replace(/\s+cli$/i, "")
      .replace(/\s+connector$/i, "");
    if (trimmed) {
      return trimmed;
    }
  }
  return titleCaseWords(tool.replace(/^aos-/, ""));
}

async function buildCatalogEntry(params: {
  tool: string;
  binaryPath?: string;
  repo?: RepoCandidate;
  timeoutMs: number;
}): Promise<ConnectorCatalogEntry> {
  const repoMetadata = params.repo ? readRepoMetadata(params.repo) : null;
  const discoveredBinaryPath =
    params.binaryPath ?? findLocalHarnessBinary(params.tool, params.repo?.harnessDir);
  const capabilityResult = discoveredBinaryPath
    ? await runConnectorJson({
        binaryPath: discoveredBinaryPath,
        args: ["--json", "capabilities"],
        cwd: params.repo?.harnessDir,
        timeoutMs: params.timeoutMs,
      })
    : null;

  const rawCapabilities =
    capabilityResult?.ok && capabilityResult.data && typeof capabilityResult.data === "object"
      ? (capabilityResult.data as RawCapabilities)
      : null;

  const normalizedCommands = normalizeConnectorCommands(rawCapabilities?.commands);
  const commands =
    normalizedCommands.length > 0 ? normalizedCommands : (repoMetadata?.commands ?? []);
  const inferred = inferCategories({
    tool: params.tool,
    description: repoMetadata?.description,
    backend:
      (typeof rawCapabilities?.backend === "string" ? rawCapabilities.backend : undefined) ??
      repoMetadata?.backend,
    commands: commands.length > 0 ? commands : (repoMetadata?.commands ?? []),
  });
  const capabilitiesConnectorDescriptor = normalizeConnectorDescriptor(rawCapabilities?.connector);
  const connectorDescriptor = {
    label: capabilitiesConnectorDescriptor.label ?? repoMetadata?.connectorDescriptor?.label,
    category:
      capabilitiesConnectorDescriptor.category ?? repoMetadata?.connectorDescriptor?.category,
    categories:
      capabilitiesConnectorDescriptor.categories ?? repoMetadata?.connectorDescriptor?.categories,
    resources:
      capabilitiesConnectorDescriptor.resources ?? repoMetadata?.connectorDescriptor?.resources,
  };
  const auth = normalizeAuth(rawCapabilities?.auth) ?? repoMetadata?.auth;
  const description = repoMetadata?.description;

  let installState: ConnectorInstallState = "repo-only";
  let statusLabel = "Repo only";
  let statusDetail = "Connector repo is present, but no runnable adapter binary was found yet.";

  if (capabilityResult?.ok && discoveredBinaryPath) {
    const healthResult = await runConnectorJson({
      binaryPath: discoveredBinaryPath,
      args: ["--json", "health"],
      cwd: params.repo?.harnessDir,
      timeoutMs: params.timeoutMs,
    });
    if (healthResult.ok) {
      const healthData =
        healthResult.data && typeof healthResult.data === "object"
          ? (healthResult.data as Record<string, unknown>)
          : {};
      const healthStatus =
        typeof healthData.status === "string" ? healthData.status.toLowerCase() : "healthy";
      if (healthStatus === "healthy" || healthStatus === "ok") {
        installState = "ready";
        statusLabel = "Ready";
        statusDetail = "Connector is runnable and passed its health check.";
      } else {
        installState = "needs-setup";
        statusLabel = "Needs setup";
        statusDetail = `Connector is installed but reported status=${healthStatus}.`;
      }
    } else {
      installState = "needs-setup";
      statusLabel = "Needs setup";
      statusDetail = healthResult.detail;
    }
  } else if (discoveredBinaryPath) {
    installState = "error";
    statusLabel = "Error";
    statusDetail = capabilityResult?.detail || "Connector binary exists but capabilities failed.";
  } else if (params.repo) {
    installState = "repo-only";
    statusLabel = "Repo only";
    statusDetail =
      params.repo?.harnessDir && repoMetadata?.requiresPython
        ? `Connector scaffold exists in the repo but is not installed in a runnable environment yet (requires Python ${repoMetadata.requiresPython}).`
        : "Connector scaffold exists in the repo but is not installed in a runnable environment yet.";
  } else {
    installState = "error";
    statusLabel = "Error";
    statusDetail = "Connector was discovered without a repo scaffold or runnable binary.";
  }

  return {
    tool:
      (typeof rawCapabilities?.tool === "string" && rawCapabilities.tool.trim()) ||
      repoMetadata?.tool ||
      params.tool,
    label: buildLabel(params.tool, connectorDescriptor.label, description),
    description,
    backend:
      (typeof rawCapabilities?.backend === "string" ? rawCapabilities.backend : undefined) ??
      repoMetadata?.backend,
    version:
      (typeof rawCapabilities?.version === "string" ? rawCapabilities.version : undefined) ??
      repoMetadata?.version,
    manifestSchemaVersion:
      typeof rawCapabilities?.manifest_schema_version === "string"
        ? rawCapabilities.manifest_schema_version
        : undefined,
    category: connectorDescriptor.category ?? inferred.category,
    categories: Array.from(
      new Set([...(connectorDescriptor.categories ?? []), ...inferred.categories]),
    ),
    resources: Array.from(
      new Set([...(connectorDescriptor.resources ?? []), ...inferred.resources]),
    ),
    modes: normalizeModes(rawCapabilities?.modes),
    commands: commands.length > 0 ? commands : (repoMetadata?.commands ?? []),
    installState,
    status: {
      ok: installState === "ready",
      label: statusLabel,
      detail: statusDetail,
    },
    discovery: {
      binaryPath: discoveredBinaryPath,
      repoDir: params.repo?.repoDir,
      harnessDir: params.repo?.harnessDir,
      requiresPython: repoMetadata?.requiresPython,
      sources: [
        ...(params.repo ? (["repo"] as const) : []),
        ...(discoveredBinaryPath ? (["path"] as const) : []),
      ],
    },
    auth,
  };
}

export async function discoverConnectorCatalog(
  options: DiscoverConnectorCatalogOptions = {},
): Promise<ConnectorsCatalogResult> {
  const pathExecutables = discoverPathExecutables(options.pathEnv);
  const repoCandidates = discoverRepoCandidates(options.repoRoots);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECTOR_TIMEOUT_MS;
  const toolNames = Array.from(new Set([...pathExecutables.keys(), ...repoCandidates.keys()])).sort(
    (a, b) => a.localeCompare(b),
  );

  const connectors = await Promise.all(
    toolNames.map((tool) =>
      buildCatalogEntry({
        tool,
        binaryPath: pathExecutables.get(tool),
        repo: repoCandidates.get(tool),
        timeoutMs,
      }),
    ),
  );

  return {
    total: connectors.length,
    connectors,
  };
}

export function discoverConnectorRuntimeCatalogSync(
  options: Pick<DiscoverConnectorCatalogOptions, "repoRoots" | "pathEnv"> = {},
): ConnectorsCatalogResult {
  const pathExecutables = discoverPathExecutables(options.pathEnv);
  const repoCandidates = discoverRepoCandidates(options.repoRoots);
  const toolNames = Array.from(new Set([...pathExecutables.keys(), ...repoCandidates.keys()])).sort(
    (a, b) => a.localeCompare(b),
  );

  const connectors = toolNames.map((tool) => {
    const repo = repoCandidates.get(tool);
    const repoMetadata = repo ? readRepoMetadata(repo) : null;
    const binaryPath = pathExecutables.get(tool) ?? findLocalHarnessBinary(tool, repo?.harnessDir);
    const commands = repoMetadata?.commands ?? [];
    const inferred = inferCategories({
      tool,
      description: repoMetadata?.description,
      backend: repoMetadata?.backend,
      commands,
    });

    return {
      tool: repoMetadata?.tool || tool,
      label: buildLabel(tool, undefined, repoMetadata?.description),
      description: repoMetadata?.description,
      backend: repoMetadata?.backend,
      version: repoMetadata?.version,
      manifestSchemaVersion: undefined,
      category: inferred.category,
      categories: inferred.categories,
      resources: inferred.resources,
      modes: [...MODE_FALLBACK],
      commands,
      installState: binaryPath ? ("ready" as const) : ("repo-only" as const),
      status: {
        ok: Boolean(binaryPath),
        label: binaryPath ? "Ready" : "Repo only",
        detail: binaryPath
          ? "Connector binary is available for runtime execution."
          : "Connector scaffold exists but no runnable binary was found.",
      },
      discovery: {
        binaryPath,
        repoDir: repo?.repoDir,
        harnessDir: repo?.harnessDir,
        requiresPython: repoMetadata?.requiresPython,
        sources: [...(repo ? (["repo"] as const) : []), ...(binaryPath ? (["path"] as const) : [])],
      },
      auth: undefined,
    } satisfies ConnectorCatalogEntry;
  });

  return {
    total: connectors.length,
    connectors,
  };
}
