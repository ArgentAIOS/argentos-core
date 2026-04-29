import JSON5 from "json5";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";

export type SecurityAuditFinding = {
  checkId: string;
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string;
  remediation?: string;
};

export type SecretAuditObjectInput = {
  source: string;
  value: unknown;
};

export type SecretAuditFileInput =
  | string
  | {
      path: string;
      source?: string;
      maxBytes?: number;
    };

export type SecretExposureAuditOptions = {
  objects?: SecretAuditObjectInput[];
  filePaths?: SecretAuditFileInput[];
  maxFileBytes?: number;
  maxDepth?: number;
  maxEntries?: number;
};

type ScanContext = {
  source: string;
  findings: SecurityAuditFinding[];
  seen: WeakSet<object>;
  visitedEntries: number;
  maxDepth: number;
  maxEntries: number;
};

type SecretPattern = {
  checkId: string;
  className: string;
  title: string;
};

const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_DEPTH = 16;
const DEFAULT_MAX_ENTRIES = 25_000;

const ENV_REF_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}$/;
const JWT_RE = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const BEARER_TOKEN_RE = /^Bearer\s+[A-Za-z0-9._~+/=-]{20,}$/i;
const KNOWN_TOKEN_RE =
  /^(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[opsu]_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})$/;

export async function collectLocalSecretExposureFindings(
  options: SecretExposureAuditOptions = {},
): Promise<SecurityAuditFinding[]> {
  const findings: SecurityAuditFinding[] = [];
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  for (const input of options.objects ?? []) {
    scanValue({
      source: input.source,
      value: input.value,
      findings,
      maxDepth,
      maxEntries,
    });
  }

  for (const input of options.filePaths ?? []) {
    const file = normalizeFileInput(input, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
    const parsed = await readConfigLikeFile(file.path, file.maxBytes);
    if (parsed === undefined) {
      continue;
    }
    scanValue({
      source: file.source,
      value: parsed,
      findings,
      maxDepth,
      maxEntries,
    });
  }

  return findings;
}

export const collectSecretExposureFindings = collectLocalSecretExposureFindings;

function scanValue(input: {
  source: string;
  value: unknown;
  findings: SecurityAuditFinding[];
  maxDepth: number;
  maxEntries: number;
}): void {
  const context: ScanContext = {
    source: input.source,
    findings: input.findings,
    seen: new WeakSet<object>(),
    visitedEntries: 0,
    maxDepth: input.maxDepth,
    maxEntries: input.maxEntries,
  };
  walk(input.value, [], context, 0);
}

function walk(value: unknown, keyPath: string[], context: ScanContext, depth: number): void {
  if (context.visitedEntries >= context.maxEntries || depth > context.maxDepth) {
    return;
  }
  context.visitedEntries += 1;

  if (typeof value === "string") {
    const pattern = classifySecretValue(keyPath, value);
    if (pattern) {
      context.findings.push(buildFinding(context.source, keyPath, value, pattern));
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }
  if (context.seen.has(value)) {
    return;
  }
  context.seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walk(value[i], [...keyPath, String(i)], context, depth + 1);
    }
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    walk(child, [...keyPath, key], context, depth + 1);
  }
}

function classifySecretValue(keyPath: string[], rawValue: string): SecretPattern | null {
  const value = rawValue.trim();
  if (!value || looksLikeEnvReference(value) || isPlaceholderSecret(value)) {
    return null;
  }

  const keyPattern = classifySecretKey(keyPath);
  if (keyPattern && hasSecretLikeValue(value)) {
    return keyPattern;
  }

  if (PRIVATE_KEY_RE.test(value)) {
    return pattern("private_key", "Inline private key");
  }
  if (JWT_RE.test(value)) {
    return pattern("jwt", "Inline JWT-like token");
  }
  if (BEARER_TOKEN_RE.test(value)) {
    return pattern("bearer_token", "Inline bearer token");
  }
  if (KNOWN_TOKEN_RE.test(value)) {
    return pattern("api_key", "Inline API key-like token");
  }

  return null;
}

function classifySecretKey(keyPath: string[]): SecretPattern | null {
  const last = normalizeKey(keyPath.at(-1) ?? "");
  const joined = normalizeKey(keyPath.join("."));

  if (!last || isKnownNonSecretKey(last)) {
    return null;
  }
  if (last.includes("privatekey") || joined.includes("privatekey")) {
    return pattern("private_key", "Private key stored in config");
  }
  if (last.includes("password") || last.includes("passwd") || last === "pwd") {
    return pattern("password", "Password stored in config");
  }
  if (
    last.includes("clientsecret") ||
    last.includes("webhooksecret") ||
    last.includes("signingsecret")
  ) {
    return pattern("secret", "Secret stored in config");
  }
  if (last === "secret" || last.endsWith("secret") || last.includes("secretkey")) {
    return pattern("secret", "Secret stored in config");
  }
  if (last.includes("apikey") || last.includes("apiaccesskey")) {
    return pattern("api_key", "API key stored in config");
  }
  if (
    last === "token" ||
    last === "authorization" ||
    last.includes("accesstoken") ||
    last.includes("refreshtoken") ||
    last.includes("authtoken") ||
    last.includes("bearertoken") ||
    last.includes("sessiontoken")
  ) {
    return pattern("token", "Token stored in config");
  }
  if (last.includes("databaseurl") || last.includes("connectionstring")) {
    return pattern("connection_string", "Connection string stored in config");
  }

  return null;
}

function buildFinding(
  source: string,
  keyPath: string[],
  value: string,
  secretPattern: SecretPattern,
): SecurityAuditFinding {
  const key = keyPath.length > 0 ? keyPath.join(".") : "(root)";
  const fingerprint = createHash("sha256").update(value.trim(), "utf8").digest("hex").slice(0, 16);
  return {
    checkId: secretPattern.checkId,
    severity: "warn",
    title: secretPattern.title,
    detail:
      `source=${source}\n` +
      `key=${key}\n` +
      `pattern=${secretPattern.className}\n` +
      `fingerprint=sha256:${fingerprint}`,
    remediation:
      "Move the secret into the OS keychain, a credential store, or an environment reference, then rotate the exposed value.",
  };
}

function pattern(className: string, title: string): SecretPattern {
  return {
    checkId: `secrets.${className}`,
    className,
    title,
  };
}

function normalizeFileInput(
  input: SecretAuditFileInput,
  defaultMaxBytes: number,
): { path: string; source: string; maxBytes: number } {
  if (typeof input === "string") {
    return { path: input, source: input, maxBytes: defaultMaxBytes };
  }
  return {
    path: input.path,
    source: input.source ?? input.path,
    maxBytes: input.maxBytes ?? defaultMaxBytes,
  };
}

async function readConfigLikeFile(
  filePath: string,
  maxBytes: number,
): Promise<unknown | undefined> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > maxBytes) {
      return undefined;
    }
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON5.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function looksLikeEnvReference(value: string): boolean {
  return ENV_REF_RE.test(value);
}

function isPlaceholderSecret(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized === "changeme" ||
    normalized === "change-me" ||
    normalized === "redacted" ||
    normalized === "<redacted>" ||
    normalized === "placeholder" ||
    normalized.includes("example") ||
    normalized.includes("your-token") ||
    normalized.includes("your_api_key")
  );
}

function isKnownNonSecretKey(normalizedKey: string): boolean {
  return (
    normalizedKey === "publickey" ||
    normalizedKey === "keyid" ||
    normalizedKey === "apikeyname" ||
    normalizedKey === "tokenizer" ||
    normalizedKey === "tokensused"
  );
}

function hasSecretLikeValue(value: string): boolean {
  if (value.length < 8) {
    return false;
  }
  if (/^(?:true|false|null|undefined)$/i.test(value)) {
    return false;
  }
  return true;
}
