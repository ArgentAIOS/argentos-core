/**
 * Coolify Deploy Tool
 *
 * Deploys projects to Coolify using encrypted service keys resolved at runtime.
 * Supports both granular actions and a full GitHub -> Coolify provisioning flow.
 */

import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ArgentConfig } from "../../config/config.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { type AnyAgentTool, jsonResult, readNumberParam, readStringParam } from "./common.js";

const execFileAsync = promisify(execFile);

const DEFAULT_COOLIFY_API_URL = "https://coolify.semfreak.dev/api/v1";
const DEFAULT_GITHUB_ORG = "webdevtodayjason";
const DEFAULT_DOMAIN_SUFFIX = "semfreak.dev";

const CoolifyDeployToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("test_connection"),
    Type.Literal("list_servers"),
    Type.Literal("list_projects"),
    Type.Literal("create_project"),
    Type.Literal("create_database"),
    Type.Literal("create_redis"),
    Type.Literal("create_application"),
    Type.Literal("trigger_deploy"),
    Type.Literal("deployment_status"),
    Type.Literal("deployment_logs"),
    Type.Literal("update_application_envs"),
    Type.Literal("teardown_project"),
    Type.Literal("deploy_project"),
  ]),
  api_url: Type.Optional(Type.String()),
  project_name: Type.Optional(Type.String()),
  project_description: Type.Optional(Type.String()),
  project_uuid: Type.Optional(Type.String()),
  server_uuid: Type.Optional(Type.String()),
  environment_name: Type.Optional(Type.String()),
  environment_uuid: Type.Optional(Type.String()),
  database_name: Type.Optional(Type.String()),
  redis_name: Type.Optional(Type.String()),
  application_name: Type.Optional(Type.String()),
  application_uuid: Type.Optional(Type.String()),
  deployment_uuid: Type.Optional(Type.String()),
  repo_org: Type.Optional(Type.String()),
  repo_name: Type.Optional(Type.String()),
  repo_url: Type.Optional(Type.String()),
  branch: Type.Optional(Type.String()),
  domain: Type.Optional(Type.String()),
  app_port: Type.Optional(Type.Number()),
  stack: Type.Optional(
    Type.Union([Type.Literal("node"), Type.Literal("python"), Type.Literal("static")], {
      default: "node",
    }),
  ),
  with_database: Type.Optional(Type.Boolean()),
  with_postgres: Type.Optional(Type.Boolean()),
  with_redis: Type.Optional(Type.Boolean()),
  create_repo: Type.Optional(Type.Boolean()),
  repo_private: Type.Optional(Type.Boolean()),
  scaffold: Type.Optional(Type.Boolean()),
  push_changes: Type.Optional(Type.Boolean()),
  deploy_now: Type.Optional(Type.Boolean()),
  local_dir: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
  payload: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      description: "Optional raw payload override for create_* actions.",
    }),
  ),
  env_vars: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      description: "Application environment variables to upsert as key/value pairs.",
    }),
  ),
  include_raw: Type.Optional(Type.Boolean()),
});

type JsonObject = Record<string, unknown>;

type CoolifyContext = {
  apiBaseUrl: string;
  apiKey: string;
};

type CoolifyStack = "node" | "python" | "static";

type CoolifyEnvironment = {
  name: string;
  uuid?: string;
};

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  } as import("../../agent-core/core.js").AgentToolResult<unknown>;
}

function parseBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function slugifyProjectName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeApiBaseUrl(raw?: string): string {
  const base = trimTrailingSlash(raw?.trim() || DEFAULT_COOLIFY_API_URL);
  if (base.endsWith("/api/v1")) return base;
  if (/\/api\/v\d+$/i.test(base)) return base;
  if (/\/api$/i.test(base)) return `${base}/v1`;
  return `${base}/api/v1`;
}

function toJsonObject(raw: unknown, label: string): JsonObject {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} must be an object`);
  }
  return raw as JsonObject;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonBody(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function jsonPreview(value: unknown, max = 320): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function asArrayPayload(payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (isObject(payload)) {
    const data = payload.data;
    if (Array.isArray(data)) return data.filter(isObject);
    const deployments = payload.deployments;
    if (Array.isArray(deployments)) return deployments.filter(isObject);
    const items = payload.items;
    if (Array.isArray(items)) return items.filter(isObject);
    const result = payload.result;
    if (Array.isArray(result)) return result.filter(isObject);
  }
  return [];
}

function pickString(obj: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function resourceUuid(record: JsonObject): string | undefined {
  return pickString(record, ["uuid", "id", "project_uuid", "application_uuid", "database_uuid"]);
}

function findByName(list: JsonObject[], name: string): JsonObject | undefined {
  const needle = name.trim().toLowerCase();
  return list.find((item) => {
    const hay = pickString(item, ["name", "project_name", "application_name", "database_name"]);
    return Boolean(hay && hay.toLowerCase() === needle);
  });
}

function matchesProject(item: JsonObject, projectUuid: string): boolean {
  const candidate = pickString(item, [
    "project_uuid",
    "projectUuid",
    "project_id",
    "projectId",
    "project",
  ]);
  return (candidate || "").trim() === projectUuid.trim();
}

function extractLogs(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    return payload.trim() || undefined;
  }
  if (!isObject(payload)) {
    return undefined;
  }
  const direct = payload.logs ?? payload.log ?? payload.output ?? payload.stdout ?? payload.stderr;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const nested = payload.data;
  if (isObject(nested)) {
    const nestedLogs = nested.logs ?? nested.log ?? nested.output ?? nested.stdout ?? nested.stderr;
    if (typeof nestedLogs === "string" && nestedLogs.trim()) {
      return nestedLogs.trim();
    }
  }
  return undefined;
}

async function fetchDeploymentLogs(ctx: CoolifyContext, deploymentUuid: string): Promise<string> {
  const attempts: Array<{ endpoint: string; query?: Record<string, string | number | boolean> }> = [
    { endpoint: `/deployments/${deploymentUuid}/logs` },
    { endpoint: `/deployments/${deploymentUuid}/log` },
    { endpoint: `/deployments/${deploymentUuid}` },
    { endpoint: `/deployments/${deploymentUuid}`, query: { include_logs: true } },
  ];

  let lastErr: unknown = null;
  for (const attempt of attempts) {
    try {
      const payload = await coolifyRequest({
        ctx,
        endpoint: attempt.endpoint,
        query: attempt.query,
      });
      const logs = extractLogs(payload);
      if (logs?.trim()) {
        return logs;
      }
      if (typeof payload === "string" && payload.trim()) {
        return payload.trim();
      }
      if (isObject(payload)) {
        return JSON.stringify(payload, null, 2);
      }
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(
    `Could not fetch logs for deployment ${deploymentUuid}${lastErr ? `: ${String(lastErr)}` : ""}`,
  );
}

async function deleteResource(ctx: CoolifyContext, endpoint: string, uuid: string): Promise<void> {
  try {
    await coolifyRequest({
      ctx,
      method: "DELETE",
      endpoint: `${endpoint}/${uuid}`,
    });
    return;
  } catch {
    await coolifyRequest({
      ctx,
      method: "DELETE",
      endpoint,
      query: { uuid },
    });
  }
}

function ensureHttpsDomain(domainOrHost: string): string {
  const trimmed = domainOrHost.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function runCommand(binary: string, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(binary, args, {
      cwd,
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return String(stdout || "");
  } catch (err) {
    const error = err as { code?: string; stderr?: string; message?: string };
    if (error.code === "ENOENT") {
      throw new Error(`${binary} not found in PATH`);
    }
    const detail = error.stderr?.trim() || error.message || "unknown error";
    throw new Error(`${binary} ${args.join(" ")} failed: ${detail}`);
  }
}

async function runGh(args: string[]): Promise<string> {
  return await runCommand("gh", args);
}

async function runGit(args: string[], cwd: string): Promise<string> {
  return await runCommand("git", args, cwd);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  if (await pathExists(filePath)) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function scaffoldNodeProject(
  localDir: string,
  repoName: string,
  appPort: number,
): Promise<void> {
  await fs.mkdir(path.join(localDir, "src"), { recursive: true });

  const packageJson = {
    name: repoName,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      start: "node src/index.js",
    },
  };

  await writeFileIfMissing(
    path.join(localDir, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );

  await writeFileIfMissing(
    path.join(localDir, "src/index.js"),
    `import http from "node:http";

const port = Number(process.env.PORT || ${appPort});
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "${repoName}", ts: new Date().toISOString() }));
});

server.listen(port, "0.0.0.0", () => {
  console.log("${repoName} listening on", port);
});
`,
  );

  await writeFileIfMissing(
    path.join(localDir, "Dockerfile"),
    `FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY . .
EXPOSE ${appPort}
CMD ["npm", "run", "start"]
`,
  );

  await writeFileIfMissing(
    path.join(localDir, ".dockerignore"),
    "node_modules\n.git\nnpm-debug.log\n",
  );
  await writeFileIfMissing(path.join(localDir, ".gitignore"), "node_modules\n.env\n");
  await writeFileIfMissing(
    path.join(localDir, "README.md"),
    `# ${repoName}\n\nGenerated by ArgentOS coolify_deploy tool.\n`,
  );
}

async function scaffoldPythonProject(
  localDir: string,
  repoName: string,
  appPort: number,
): Promise<void> {
  await fs.mkdir(localDir, { recursive: true });

  await writeFileIfMissing(
    path.join(localDir, "main.py"),
    `from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from datetime import datetime

PORT = int(os.getenv("PORT", "${appPort}"))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        payload = {
            "ok": True,
            "service": "${repoName}",
            "ts": datetime.utcnow().isoformat() + "Z",
        }
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"${repoName} listening on {PORT}")
    server.serve_forever()
`,
  );

  await writeFileIfMissing(
    path.join(localDir, "Dockerfile"),
    `FROM python:3.12-slim
WORKDIR /app
COPY . .
EXPOSE ${appPort}
CMD ["python", "main.py"]
`,
  );

  await writeFileIfMissing(path.join(localDir, ".dockerignore"), ".git\n__pycache__\n*.pyc\n");
  await writeFileIfMissing(path.join(localDir, ".gitignore"), "__pycache__\n*.pyc\n.env\n");
  await writeFileIfMissing(
    path.join(localDir, "README.md"),
    `# ${repoName}\n\nGenerated by ArgentOS coolify_deploy tool.\n`,
  );
}

async function scaffoldStaticProject(localDir: string, repoName: string): Promise<void> {
  await fs.mkdir(localDir, { recursive: true });

  await writeFileIfMissing(
    path.join(localDir, "index.html"),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${repoName}</title>
  </head>
  <body>
    <main>
      <h1>${repoName}</h1>
      <p>Generated by ArgentOS coolify_deploy.</p>
    </main>
  </body>
</html>
`,
  );

  await writeFileIfMissing(
    path.join(localDir, "README.md"),
    `# ${repoName}\n\nGenerated by ArgentOS coolify_deploy tool.\n`,
  );
}

async function ensureGitIdentity(localDir: string): Promise<void> {
  const email = (await runGit(["config", "--get", "user.email"], localDir)).trim();
  if (!email) {
    await runGit(["config", "user.email", "argent@localhost"], localDir);
  }
  const name = (await runGit(["config", "--get", "user.name"], localDir)).trim();
  if (!name) {
    await runGit(["config", "user.name", "ArgentOS"], localDir);
  }
}

async function ensureGitRemote(localDir: string, remoteUrl: string): Promise<void> {
  try {
    const existing = (await runGit(["remote", "get-url", "origin"], localDir)).trim();
    if (existing !== remoteUrl) {
      await runGit(["remote", "set-url", "origin", remoteUrl], localDir);
    }
  } catch {
    await runGit(["remote", "add", "origin", remoteUrl], localDir);
  }
}

async function ensureGithubRepo(params: {
  org: string;
  repoName: string;
  description?: string;
  privateRepo: boolean;
}): Promise<{ fullName: string; url?: string; created: boolean }> {
  const fullName = `${params.org}/${params.repoName}`;

  try {
    const stdout = await runGh(["repo", "view", fullName, "--json", "nameWithOwner,url,isPrivate"]);
    const payload = parseJsonBody(stdout);
    const obj = isObject(payload) ? payload : {};
    return {
      fullName,
      url: pickString(obj, ["url"]),
      created: false,
    };
  } catch {
    const args = ["repo", "create", fullName, "--clone=false"];
    args.push(params.privateRepo ? "--private" : "--public");
    if (params.description?.trim()) {
      args.push("--description", params.description.trim());
    }
    await runGh(args);

    let url: string | undefined;
    try {
      const createdStdout = await runGh(["repo", "view", fullName, "--json", "url"]);
      const payload = parseJsonBody(createdStdout);
      if (isObject(payload)) {
        url = pickString(payload, ["url"]);
      }
    } catch {
      // Best effort only.
    }

    return { fullName, url, created: true };
  }
}

async function prepareAndPushRepo(params: {
  localDir: string;
  repoName: string;
  remoteUrl: string;
  branch: string;
  stack: CoolifyStack;
  appPort: number;
  scaffold: boolean;
  pushChanges: boolean;
}): Promise<{ committed: boolean; pushed: boolean; branch: string; localDir: string }> {
  await fs.mkdir(params.localDir, { recursive: true });

  if (params.scaffold) {
    if (params.stack === "python") {
      await scaffoldPythonProject(params.localDir, params.repoName, params.appPort);
    } else if (params.stack === "static") {
      await scaffoldStaticProject(params.localDir, params.repoName);
    } else {
      await scaffoldNodeProject(params.localDir, params.repoName, params.appPort);
    }
  }

  if (!(await pathExists(path.join(params.localDir, ".git")))) {
    await runGit(["init"], params.localDir);
  }

  await ensureGitIdentity(params.localDir);
  await runGit(["add", "-A"], params.localDir);

  const status = (await runGit(["status", "--porcelain"], params.localDir)).trim();
  let committed = false;
  if (status) {
    await runGit(["commit", "-m", `Initial scaffold for ${params.repoName}`], params.localDir);
    committed = true;
  }

  await runGit(["branch", "-M", params.branch], params.localDir);
  await ensureGitRemote(params.localDir, params.remoteUrl);

  let pushed = false;
  if (params.pushChanges) {
    await runGit(["push", "-u", "origin", params.branch], params.localDir);
    pushed = true;
  }

  return {
    committed,
    pushed,
    branch: params.branch,
    localDir: params.localDir,
  };
}

async function coolifyRequest(params: {
  ctx: CoolifyContext;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  endpoint: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: JsonObject;
}): Promise<unknown> {
  const method = params.method ?? "GET";
  const base = `${params.ctx.apiBaseUrl}/`;
  const endpoint = params.endpoint.replace(/^\//, "");
  const url = new URL(endpoint, base);

  for (const [key, rawValue] of Object.entries(params.query || {})) {
    if (rawValue === undefined || rawValue === null) continue;
    url.searchParams.set(key, String(rawValue));
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${params.ctx.apiKey}`,
      Accept: "application/json",
      ...(params.body ? { "Content-Type": "application/json" } : {}),
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });

  const rawText = await res.text();
  const payload = parseJsonBody(rawText);
  if (!res.ok) {
    throw new Error(
      `Coolify ${method} ${url.pathname} failed (${res.status}): ${jsonPreview(payload) || rawText}`,
    );
  }

  return payload;
}

function toResourceSummary(record: JsonObject): JsonObject {
  return {
    id: pickString(record, ["id"]),
    uuid: pickString(record, ["uuid", "id"]),
    name: pickString(record, ["name", "project_name", "application_name", "database_name"]),
    status: pickString(record, ["status", "health", "state"]),
    created_at: pickString(record, ["created_at", "createdAt"]),
  };
}

async function listResources(ctx: CoolifyContext, endpoint: string): Promise<JsonObject[]> {
  const payload = await coolifyRequest({ ctx, endpoint });
  return asArrayPayload(payload);
}

function normalizeStack(raw: unknown): CoolifyStack {
  if (typeof raw !== "string") return "node";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "python" || normalized === "static") return normalized;
  return "node";
}

function defaultAppPortForStack(stack: CoolifyStack, rawPort: number | undefined): number {
  const fallback = stack === "static" ? 80 : 3000;
  return Math.max(1, Math.trunc(rawPort || fallback));
}

async function resolveEnvironment(
  params: Record<string, unknown>,
  ctx: CoolifyContext,
  projectUuid: string,
) {
  const explicitName = readStringParam(params, "environment_name") || "production";
  const explicitUuid = readStringParam(params, "environment_uuid");
  if (explicitUuid?.trim()) {
    return {
      name: explicitName,
      uuid: explicitUuid.trim(),
    } satisfies CoolifyEnvironment;
  }

  try {
    const environments = await listResources(ctx, `/projects/${projectUuid}/environments`);
    const match =
      environments.find((item) => {
        const name = pickString(item, ["name"]);
        return Boolean(name && name.toLowerCase() === explicitName.toLowerCase());
      }) || environments[0];
    return {
      name: explicitName,
      uuid: match ? resourceUuid(match) : undefined,
    } satisfies CoolifyEnvironment;
  } catch {
    return {
      name: explicitName,
      uuid: undefined,
    } satisfies CoolifyEnvironment;
  }
}

function buildCreateApplicationRequest(params: {
  projectUuid: string;
  serverUuid: string;
  environment: CoolifyEnvironment;
  appName: string;
  repoUrl: string;
  branch: string;
  domain: string;
  appPort: number;
  stack: CoolifyStack;
}): { endpoint: string; body: JsonObject } {
  const body: JsonObject = {
    name: params.appName,
    project_uuid: params.projectUuid,
    server_uuid: params.serverUuid,
    environment_name: params.environment.name,
    git_repository: params.repoUrl,
    git_branch: params.branch,
    domains: ensureHttpsDomain(params.domain),
  };

  if (params.environment.uuid) {
    body.environment_uuid = params.environment.uuid;
  }

  if (params.stack === "static") {
    body.build_pack = "static";
    body.is_static = true;
    body.static_image = "nginx:alpine";
    body.publish_directory = "/";
    body.ports_exposes = String(params.appPort || 80);
  } else {
    body.build_pack = "dockerfile";
    body.ports_exposes = String(params.appPort || 3000);
  }

  return {
    endpoint: "/applications/public",
    body,
  };
}

function normalizeEnvVarEntries(raw: unknown): Array<{ key: string; value: string }> {
  if (!isObject(raw)) return [];
  const entries: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    if (typeof value === "string") {
      entries.push({ key: normalizedKey, value });
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      entries.push({ key: normalizedKey, value: String(value) });
    }
  }
  return entries;
}

function pickConnectionUrl(resource: JsonObject): string | undefined {
  return pickString(resource, ["internal_db_url", "external_db_url", "database_url", "url"]);
}

function setEnvValue(target: Map<string, string>, key: string, value: string | undefined): void {
  if (!key.trim() || value === undefined || value === null || value === "") return;
  target.set(key, value);
}

function addConnectionEnvVars(
  target: Map<string, string>,
  prefix: "POSTGRES" | "REDIS",
  urlValue: string | undefined,
): void {
  if (!urlValue) return;
  setEnvValue(target, `${prefix}_URL`, urlValue);

  try {
    const parsed = new URL(urlValue);
    const port = parsed.port || (prefix === "POSTGRES" ? "5432" : "6379");
    const dbName = parsed.pathname.replace(/^\/+/, "");
    setEnvValue(target, `${prefix}_HOST`, parsed.hostname);
    setEnvValue(target, `${prefix}_PORT`, port);
    setEnvValue(target, `${prefix}_USER`, decodeURIComponent(parsed.username));
    setEnvValue(target, `${prefix}_PASSWORD`, decodeURIComponent(parsed.password));
    if (dbName) {
      setEnvValue(target, prefix === "POSTGRES" ? "POSTGRES_DB" : "REDIS_DB", dbName);
    }
  } catch {
    // Best effort only; keep the URL env even if parsing fails.
  }
}

function buildApplicationEnvEntries(params: {
  postgres?: JsonObject;
  redis?: JsonObject;
  envVars?: unknown;
}): Array<{ key: string; value: string; is_runtime: boolean; is_buildtime: boolean }> {
  const envs = new Map<string, string>();

  const postgresUrl = params.postgres ? pickConnectionUrl(params.postgres) : undefined;
  if (postgresUrl) {
    setEnvValue(envs, "DATABASE_URL", postgresUrl);
    addConnectionEnvVars(envs, "POSTGRES", postgresUrl);
  }

  const redisUrl = params.redis ? pickConnectionUrl(params.redis) : undefined;
  if (redisUrl) {
    addConnectionEnvVars(envs, "REDIS", redisUrl);
  }

  for (const entry of normalizeEnvVarEntries(params.envVars)) {
    envs.set(entry.key, entry.value);
  }

  return [...envs.entries()].map(([key, value]) => ({
    key,
    value,
    is_runtime: true,
    is_buildtime: false,
  }));
}

async function upsertApplicationEnvs(
  ctx: CoolifyContext,
  applicationUuid: string,
  entries: Array<{ key: string; value: string; is_runtime: boolean; is_buildtime: boolean }>,
): Promise<unknown> {
  if (entries.length === 0) return [];
  return await coolifyRequest({
    ctx,
    method: "PATCH",
    endpoint: `/applications/${applicationUuid}/envs/bulk`,
    body: { data: entries },
  });
}

export function createCoolifyDeployTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  const resolveKey = (name: string) =>
    resolveServiceKey(name, options?.config, {
      sessionKey: options?.agentSessionKey,
      source: "coolify_deploy",
    });

  const resolveContext = (params: Record<string, unknown>): CoolifyContext => {
    const apiKey =
      resolveKey("COOLIFY_API_KEY") ||
      resolveKey("COOLIFY_API_TOKEN") ||
      process.env.COOLIFY_API_KEY ||
      process.env.COOLIFY_API_TOKEN;

    if (!apiKey) {
      throw new Error(
        "No Coolify API key found. Add COOLIFY_API_KEY in Settings > API Keys (encrypted store).",
      );
    }

    const apiUrl =
      readStringParam(params, "api_url") ||
      resolveKey("COOLIFY_API_URL") ||
      process.env.COOLIFY_API_URL ||
      DEFAULT_COOLIFY_API_URL;

    return {
      apiBaseUrl: normalizeApiBaseUrl(apiUrl),
      apiKey,
    };
  };

  const resolveServerUuid = async (
    params: Record<string, unknown>,
    ctx: CoolifyContext,
  ): Promise<string> => {
    const explicit =
      readStringParam(params, "server_uuid") ||
      resolveKey("COOLIFY_DEFAULT_SERVER_ID") ||
      resolveKey("COOLIFY_DEFAULT_SERVER_UUID") ||
      process.env.COOLIFY_DEFAULT_SERVER_ID ||
      process.env.COOLIFY_DEFAULT_SERVER_UUID;
    if (explicit?.trim()) return explicit.trim();

    const servers = await listResources(ctx, "/servers");
    if (servers.length === 0) {
      throw new Error("No Coolify servers found. Provide server_uuid explicitly.");
    }
    return resourceUuid(servers[0]) || pickString(servers[0], ["id"]) || "";
  };

  return {
    label: "Coolify Deploy",
    name: "coolify_deploy",
    description: `Deploy and manage applications in Coolify using encrypted service keys.

Use this tool for:
- Coolify connectivity checks
- listing servers/projects
- creating projects, databases, and applications
- triggering deploys and checking deploy status
- fetching deployment logs
- tearing down project resources
- full GitHub -> Coolify deployment pipeline (deploy_project)

Key resolution:
- COOLIFY_API_KEY (preferred)
- COOLIFY_API_TOKEN (alias)
- optional COOLIFY_API_URL and COOLIFY_DEFAULT_SERVER_ID`,
    parameters: CoolifyDeployToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        const ctx = resolveContext(params);
        const includeRaw = parseBoolean(params.include_raw, false);

        switch (action) {
          case "test_connection": {
            const payload = await coolifyRequest({ ctx, endpoint: "/version" });
            return jsonResult({
              action,
              ok: true,
              api_url: ctx.apiBaseUrl,
              version: isObject(payload) ? payload : undefined,
              raw: includeRaw ? payload : undefined,
            });
          }

          case "list_servers": {
            const servers = await listResources(ctx, "/servers");
            return jsonResult({
              action,
              count: servers.length,
              servers: servers.map(toResourceSummary),
              raw: includeRaw ? servers : undefined,
            });
          }

          case "list_projects": {
            const projects = await listResources(ctx, "/projects");
            return jsonResult({
              action,
              count: projects.length,
              projects: projects.map(toResourceSummary),
              raw: includeRaw ? projects : undefined,
            });
          }

          case "create_project": {
            const projectName = readStringParam(params, "project_name", { required: true });
            const body = params.payload
              ? toJsonObject(params.payload, "payload")
              : {
                  name: projectName,
                  description: readStringParam(params, "project_description") || "",
                };
            const payload = await coolifyRequest({
              ctx,
              method: "POST",
              endpoint: "/projects",
              body,
            });
            const obj = isObject(payload) ? payload : {};
            return jsonResult({
              action,
              project_uuid: resourceUuid(obj),
              project_name: pickString(obj, ["name", "project_name"]) || projectName,
              raw: includeRaw ? payload : undefined,
            });
          }

          case "create_database": {
            const projectUuid = readStringParam(params, "project_uuid", { required: true });
            const projectName =
              readStringParam(params, "project_name") || slugifyProjectName(projectUuid);
            const serverUuid = await resolveServerUuid(params, ctx);
            const environment = await resolveEnvironment(params, ctx, projectUuid);
            const dbName =
              readStringParam(params, "database_name") || `${slugifyProjectName(projectName)}-db`;

            const body = params.payload
              ? toJsonObject(params.payload, "payload")
              : {
                  name: dbName,
                  project_uuid: projectUuid,
                  server_uuid: serverUuid,
                  environment_name: environment.name,
                  ...(environment.uuid ? { environment_uuid: environment.uuid } : {}),
                  postgres_db: slugifyProjectName(projectName) || "app",
                  postgres_user: slugifyProjectName(projectName) || "app",
                };

            const payload = await coolifyRequest({
              ctx,
              method: "POST",
              endpoint: "/databases/postgresql",
              body,
            });

            const obj = isObject(payload) ? payload : {};
            return jsonResult({
              action,
              database_uuid: resourceUuid(obj),
              database_name: pickString(obj, ["name", "database_name"]) || dbName,
              internal_db_url: pickConnectionUrl(obj),
              raw: includeRaw ? payload : undefined,
            });
          }

          case "create_redis": {
            const projectUuid = readStringParam(params, "project_uuid", { required: true });
            const projectName =
              readStringParam(params, "project_name") || slugifyProjectName(projectUuid);
            const serverUuid = await resolveServerUuid(params, ctx);
            const environment = await resolveEnvironment(params, ctx, projectUuid);
            const redisName =
              readStringParam(params, "redis_name") ||
              readStringParam(params, "database_name") ||
              `${slugifyProjectName(projectName)}-redis`;

            const body = params.payload
              ? toJsonObject(params.payload, "payload")
              : {
                  name: redisName,
                  project_uuid: projectUuid,
                  server_uuid: serverUuid,
                  environment_name: environment.name,
                  ...(environment.uuid ? { environment_uuid: environment.uuid } : {}),
                };

            const payload = await coolifyRequest({
              ctx,
              method: "POST",
              endpoint: "/databases/redis",
              body,
            });

            const obj = isObject(payload) ? payload : {};
            return jsonResult({
              action,
              database_uuid: resourceUuid(obj),
              database_name: pickString(obj, ["name", "database_name"]) || redisName,
              internal_db_url: pickConnectionUrl(obj),
              raw: includeRaw ? payload : undefined,
            });
          }

          case "create_application": {
            const projectUuid = readStringParam(params, "project_uuid", { required: true });
            const projectName = readStringParam(params, "project_name") || projectUuid;
            const serverUuid = await resolveServerUuid(params, ctx);
            const environment = await resolveEnvironment(params, ctx, projectUuid);
            const appName =
              readStringParam(params, "application_name") ||
              `${slugifyProjectName(projectName)}-app`;
            const repoOrg = readStringParam(params, "repo_org") || DEFAULT_GITHUB_ORG;
            const repoName =
              readStringParam(params, "repo_name") || slugifyProjectName(projectName) || "app";
            const repoUrl =
              readStringParam(params, "repo_url") || `https://github.com/${repoOrg}/${repoName}`;
            const branch = readStringParam(params, "branch") || "main";
            const stack = normalizeStack(params.stack);
            const appPort = defaultAppPortForStack(stack, readNumberParam(params, "app_port"));
            const domain =
              readStringParam(params, "domain") ||
              `${slugifyProjectName(repoName)}.${DEFAULT_DOMAIN_SUFFIX}`;

            const request = params.payload
              ? {
                  endpoint: "/applications/public",
                  body: toJsonObject(params.payload, "payload"),
                }
              : buildCreateApplicationRequest({
                  projectUuid,
                  serverUuid,
                  environment,
                  appName,
                  repoUrl,
                  branch,
                  domain,
                  appPort,
                  stack,
                });

            const payload = await coolifyRequest({
              ctx,
              method: "POST",
              endpoint: request.endpoint,
              body: request.body,
            });

            const obj = isObject(payload) ? payload : {};
            return jsonResult({
              action,
              application_uuid: resourceUuid(obj),
              application_name: pickString(obj, ["name", "application_name"]) || appName,
              domain: ensureHttpsDomain(domain),
              raw: includeRaw ? payload : undefined,
            });
          }

          case "trigger_deploy": {
            const appUuid = readStringParam(params, "application_uuid", { required: true });
            const payload = await coolifyRequest({
              ctx,
              method: "POST",
              endpoint: "/deploy",
              query: { uuid: appUuid },
            });
            const rows = asArrayPayload(payload);
            const deployment = rows[0] ?? (isObject(payload) ? payload : {});
            return jsonResult({
              action,
              application_uuid: appUuid,
              deployment_uuid: pickString(deployment, ["deployment_uuid", "uuid", "id"]),
              status: pickString(deployment, ["status", "state"]),
              message: pickString(deployment, ["message"]),
              raw: includeRaw ? payload : undefined,
            });
          }

          case "deployment_status": {
            const deploymentUuid = readStringParam(params, "deployment_uuid");
            if (deploymentUuid) {
              const payload = await coolifyRequest({
                ctx,
                endpoint: `/deployments/${deploymentUuid}`,
              });
              const obj = isObject(payload) ? payload : {};
              return jsonResult({
                action,
                deployment_uuid: deploymentUuid,
                status: pickString(obj, ["status", "state"]),
                raw: includeRaw ? payload : undefined,
              });
            }

            const appUuid = readStringParam(params, "application_uuid", { required: true });
            const limit = Math.max(
              1,
              Math.min(50, Math.trunc(readNumberParam(params, "limit") || 5)),
            );
            const payload = await coolifyRequest({
              ctx,
              endpoint: `/deployments/applications/${appUuid}`,
              query: { skip: 0, take: limit },
            });
            const rows = asArrayPayload(payload);
            return jsonResult({
              action,
              application_uuid: appUuid,
              deployments: rows.map((row) => ({
                deployment_uuid: pickString(row, ["deployment_uuid", "uuid", "id"]),
                status: pickString(row, ["status", "state"]),
                created_at: pickString(row, ["created_at", "createdAt"]),
              })),
              raw: includeRaw ? payload : undefined,
            });
          }

          case "deployment_logs": {
            let deploymentUuid = readStringParam(params, "deployment_uuid");
            const applicationUuid = readStringParam(params, "application_uuid");

            if (!deploymentUuid) {
              if (!applicationUuid) {
                throw new Error("deployment_logs requires deployment_uuid or application_uuid");
              }
              const payload = await coolifyRequest({
                ctx,
                endpoint: `/deployments/applications/${applicationUuid}`,
                query: { skip: 0, take: 1 },
              });
              const rows = asArrayPayload(payload);
              deploymentUuid = rows.length
                ? pickString(rows[0] ?? {}, ["deployment_uuid", "uuid", "id"])
                : undefined;
              if (!deploymentUuid) {
                throw new Error(`No deployment found for application ${applicationUuid}`);
              }
            }

            const logs = await fetchDeploymentLogs(ctx, deploymentUuid);
            return jsonResult({
              action,
              deployment_uuid: deploymentUuid,
              application_uuid: applicationUuid,
              logs,
            });
          }

          case "update_application_envs": {
            const applicationUuid = readStringParam(params, "application_uuid", { required: true });
            const entries = buildApplicationEnvEntries({ envVars: params.env_vars });
            if (entries.length === 0) {
              throw new Error("update_application_envs requires env_vars with at least one key");
            }

            const payload = await upsertApplicationEnvs(ctx, applicationUuid, entries);
            return jsonResult({
              action,
              application_uuid: applicationUuid,
              count: entries.length,
              keys: entries.map((entry) => entry.key),
              raw: includeRaw ? payload : undefined,
            });
          }

          case "teardown_project": {
            const projectUuidInput = readStringParam(params, "project_uuid");
            const projectNameInput = readStringParam(params, "project_name");

            if (!projectUuidInput && !projectNameInput) {
              throw new Error("teardown_project requires project_uuid or project_name");
            }

            const projects = await listResources(ctx, "/projects");
            const project =
              (projectUuidInput
                ? projects.find((item) => resourceUuid(item) === projectUuidInput)
                : undefined) ||
              (projectNameInput ? findByName(projects, projectNameInput) : undefined);
            const projectUuid = projectUuidInput || (project ? resourceUuid(project) : undefined);
            if (!projectUuid) {
              throw new Error("Could not resolve project UUID for teardown");
            }

            const deleted: Array<{ kind: string; uuid?: string; name?: string }> = [];
            const failures: Array<{ kind: string; uuid?: string; error: string }> = [];

            const apps = await listResources(ctx, "/applications").catch(() => []);
            for (const app of apps.filter((item) => matchesProject(item, projectUuid))) {
              const appUuid = resourceUuid(app);
              if (!appUuid) continue;
              try {
                await deleteResource(ctx, "/applications", appUuid);
                deleted.push({
                  kind: "application",
                  uuid: appUuid,
                  name: pickString(app, ["name", "application_name"]),
                });
              } catch (err) {
                failures.push({
                  kind: "application",
                  uuid: appUuid,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }

            const databases = await listResources(ctx, "/databases").catch(() => []);
            for (const database of databases.filter((item) => matchesProject(item, projectUuid))) {
              const dbUuid = resourceUuid(database);
              if (!dbUuid) continue;
              try {
                await deleteResource(ctx, "/databases", dbUuid);
                deleted.push({
                  kind: "database",
                  uuid: dbUuid,
                  name: pickString(database, ["name", "database_name"]),
                });
              } catch (err) {
                failures.push({
                  kind: "database",
                  uuid: dbUuid,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }

            try {
              await deleteResource(ctx, "/projects", projectUuid);
              deleted.push({
                kind: "project",
                uuid: projectUuid,
                name: projectNameInput || pickString(project || {}, ["name", "project_name"]),
              });
            } catch (err) {
              failures.push({
                kind: "project",
                uuid: projectUuid,
                error: err instanceof Error ? err.message : String(err),
              });
            }

            return jsonResult({
              action,
              project_uuid: projectUuid,
              project_name: projectNameInput || pickString(project || {}, ["name", "project_name"]),
              deleted,
              failures,
              ok: failures.length === 0,
            });
          }

          case "deploy_project": {
            const projectName = readStringParam(params, "project_name", { required: true });
            const projectSlug = slugifyProjectName(projectName);
            if (!projectSlug) {
              throw new Error("project_name must include at least one alphanumeric character");
            }

            const projectDescription =
              readStringParam(params, "project_description") ||
              `Argent deployment for ${projectName}`;
            const repoOrg = readStringParam(params, "repo_org") || DEFAULT_GITHUB_ORG;
            const repoName = readStringParam(params, "repo_name") || projectSlug;
            const branch = readStringParam(params, "branch") || "main";
            const stack = normalizeStack(params.stack);
            const appPort = defaultAppPortForStack(stack, readNumberParam(params, "app_port"));
            const withPostgres = parseBoolean(
              params.with_postgres,
              parseBoolean(params.with_database, stack !== "static"),
            );
            const withRedis = parseBoolean(params.with_redis, false);
            const createRepo = parseBoolean(params.create_repo, true);
            const repoPrivate = parseBoolean(params.repo_private, true);
            const scaffold = parseBoolean(params.scaffold, true);
            const pushChanges = parseBoolean(params.push_changes, true);
            const deployNow = parseBoolean(params.deploy_now, true);
            const localDir =
              readStringParam(params, "local_dir") ||
              path.join(os.tmpdir(), "argent-coolify", repoName);
            const domain =
              readStringParam(params, "domain") || `${projectSlug}.${DEFAULT_DOMAIN_SUFFIX}`;
            const repoUrl =
              readStringParam(params, "repo_url") || `https://github.com/${repoOrg}/${repoName}`;

            let repoResult: { fullName: string; url?: string; created: boolean } | undefined;
            if (createRepo) {
              repoResult = await ensureGithubRepo({
                org: repoOrg,
                repoName,
                description: projectDescription,
                privateRepo: repoPrivate,
              });
            }

            const remoteUrl = `https://github.com/${repoOrg}/${repoName}.git`;
            const gitResult = await prepareAndPushRepo({
              localDir: path.resolve(localDir),
              repoName,
              remoteUrl,
              branch,
              stack,
              appPort,
              scaffold,
              pushChanges,
            });

            const projects = await listResources(ctx, "/projects");
            let project = findByName(projects, projectName);
            if (!project) {
              const created = await coolifyRequest({
                ctx,
                method: "POST",
                endpoint: "/projects",
                body: {
                  name: projectName,
                  description: projectDescription,
                },
              });
              project = isObject(created) ? created : {};
            }
            const projectUuid =
              resourceUuid(project || {}) || readStringParam(params, "project_uuid");
            if (!projectUuid) {
              throw new Error("Could not resolve Coolify project UUID");
            }

            const serverUuid = await resolveServerUuid(params, ctx);
            const environment = await resolveEnvironment(params, ctx, projectUuid);

            const databaseName = readStringParam(params, "database_name") || `${projectSlug}-db`;
            let postgresUuid: string | undefined;
            let postgresResource: JsonObject | undefined;
            if (withPostgres) {
              try {
                const databases = await listResources(ctx, "/databases");
                const existingDb = findByName(databases, databaseName);
                if (existingDb) {
                  postgresUuid = resourceUuid(existingDb);
                  postgresResource = existingDb;
                }
              } catch {
                // Some Coolify deployments may not expose list endpoint; create path below still works.
              }
            }

            if (withPostgres && !postgresUuid) {
              const createdDbPayload = await coolifyRequest({
                ctx,
                method: "POST",
                endpoint: "/databases/postgresql",
                body: {
                  name: databaseName,
                  project_uuid: projectUuid,
                  server_uuid: serverUuid,
                  environment_name: environment.name,
                  ...(environment.uuid ? { environment_uuid: environment.uuid } : {}),
                  postgres_db: projectSlug,
                  postgres_user: projectSlug,
                },
              });
              postgresResource = isObject(createdDbPayload) ? createdDbPayload : undefined;
              postgresUuid = postgresResource ? resourceUuid(postgresResource) : undefined;
            }

            const redisName = readStringParam(params, "redis_name") || `${projectSlug}-redis`;
            let redisUuid: string | undefined;
            let redisResource: JsonObject | undefined;
            if (withRedis) {
              try {
                const databases = await listResources(ctx, "/databases");
                const existingRedis = findByName(databases, redisName);
                if (existingRedis) {
                  redisUuid = resourceUuid(existingRedis);
                  redisResource = existingRedis;
                }
              } catch {
                // Some Coolify deployments may not expose list endpoint; create path below still works.
              }
            }

            if (withRedis && !redisUuid) {
              const createdRedisPayload = await coolifyRequest({
                ctx,
                method: "POST",
                endpoint: "/databases/redis",
                body: {
                  name: redisName,
                  project_uuid: projectUuid,
                  server_uuid: serverUuid,
                  environment_name: environment.name,
                  ...(environment.uuid ? { environment_uuid: environment.uuid } : {}),
                },
              });
              redisResource = isObject(createdRedisPayload) ? createdRedisPayload : undefined;
              redisUuid = redisResource ? resourceUuid(redisResource) : undefined;
            }

            const appName = readStringParam(params, "application_name") || `${projectSlug}-app`;
            let applicationUuid: string | undefined;
            try {
              const apps = await listResources(ctx, "/applications");
              const existingApp = findByName(apps, appName);
              if (existingApp) {
                applicationUuid = resourceUuid(existingApp);
              }
            } catch {
              // Some Coolify deployments may not expose list endpoint; create path below still works.
            }

            if (!applicationUuid) {
              const request = buildCreateApplicationRequest({
                projectUuid,
                serverUuid,
                environment,
                appName,
                repoUrl,
                branch,
                domain,
                appPort,
                stack,
              });
              const createdApp = await coolifyRequest({
                ctx,
                method: "POST",
                endpoint: request.endpoint,
                body: request.body,
              });
              applicationUuid = isObject(createdApp) ? resourceUuid(createdApp) : undefined;
            }

            const envEntries = applicationUuid
              ? buildApplicationEnvEntries({
                  postgres: postgresResource,
                  redis: redisResource,
                  envVars: params.env_vars,
                })
              : [];
            let envUpdatePayload: unknown;
            if (applicationUuid && envEntries.length > 0) {
              envUpdatePayload = await upsertApplicationEnvs(ctx, applicationUuid, envEntries);
            }

            let deployInfo: JsonObject | undefined;
            if (deployNow && applicationUuid) {
              const deployPayload = await coolifyRequest({
                ctx,
                method: "POST",
                endpoint: "/deploy",
                query: { uuid: applicationUuid },
              });
              deployInfo = isObject(deployPayload) ? deployPayload : undefined;
            }

            return jsonResult({
              action,
              project: {
                name: projectName,
                uuid: projectUuid,
              },
              repository: {
                org: repoOrg,
                name: repoName,
                url: repoResult?.url || `https://github.com/${repoOrg}/${repoName}`,
                created: repoResult?.created ?? false,
                pushed: gitResult.pushed,
                committed: gitResult.committed,
                local_dir: gitResult.localDir,
                branch: gitResult.branch,
              },
              resources: {
                server_uuid: serverUuid,
                environment_name: environment.name,
                environment_uuid: environment.uuid,
                database: {
                  name: databaseName,
                  uuid: postgresUuid,
                  skipped: !withPostgres,
                  internal_db_url: postgresResource
                    ? pickConnectionUrl(postgresResource)
                    : undefined,
                },
                postgres: {
                  name: databaseName,
                  uuid: postgresUuid,
                  skipped: !withPostgres,
                  internal_db_url: postgresResource
                    ? pickConnectionUrl(postgresResource)
                    : undefined,
                },
                redis: {
                  name: redisName,
                  uuid: redisUuid,
                  skipped: !withRedis,
                  internal_db_url: redisResource ? pickConnectionUrl(redisResource) : undefined,
                },
                application: {
                  name: appName,
                  uuid: applicationUuid,
                  domain: ensureHttpsDomain(domain),
                },
              },
              environment_variables: {
                updated: envEntries.length > 0,
                count: envEntries.length,
                keys: envEntries.map((entry) => entry.key),
              },
              deployment: {
                triggered: deployNow,
                deployment_uuid: deployInfo
                  ? pickString(asArrayPayload(deployInfo)[0] ?? deployInfo, [
                      "deployment_uuid",
                      "uuid",
                      "id",
                    ])
                  : undefined,
                status: deployInfo
                  ? pickString(asArrayPayload(deployInfo)[0] ?? deployInfo, ["status", "state"])
                  : undefined,
                message: deployInfo
                  ? pickString(asArrayPayload(deployInfo)[0] ?? deployInfo, ["message"])
                  : undefined,
              },
              raw: includeRaw
                ? {
                    project,
                    postgresResource,
                    redisResource,
                    envUpdatePayload,
                    deployInfo,
                  }
                : undefined,
            });
          }

          default:
            return textResult(
              `Unknown action "${action}". Use one of: test_connection, list_servers, list_projects, create_project, create_database, create_application, trigger_deploy, deployment_status, deployment_logs, teardown_project, deploy_project.`,
            );
        }
      } catch (err) {
        return textResult(
          `coolify_deploy error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
