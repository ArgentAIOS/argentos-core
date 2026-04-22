/**
 * Migrate CLI — Export / Import operator install bundles.
 *
 * Commands:
 *   argent migrate export --out <path>   Produce an encrypted migration bundle
 *
 * The export bundle captures everything needed to restore an Argent install
 * on a fresh machine: service keys, master key, identity, pairings, per-agent
 * auth + alignment docs + kernel state, workspace, and a custom-format pg_dump
 * of the argentos database.
 *
 * Encryption:
 *   AES-256-GCM, scrypt(passphrase, salt) → 32 byte key.
 *   File format (big header + ciphertext stream):
 *     magic    (14 bytes)  "ARGENT-MIG-V1\0"
 *     version  (1 byte)    0x01
 *     salt     (16 bytes)  random
 *     iv       (12 bytes)  random
 *     authTag  (16 bytes)  written after encryption completes
 *     reserved (5 bytes)   zero
 *     body     (N bytes)   AES-256-GCM(tar.gz)
 *
 * Day 2 `argent migrate import` will consume this file.
 */

import { spawn } from "node:child_process";
import {
  createCipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import type { Command } from "commander";

const MAGIC = Buffer.from("ARGENT-MIG-V1\0", "utf8"); // 14 bytes
const VERSION = 0x01;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const RESERVED_LEN = 5;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN + RESERVED_LEN; // 64
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;

const PG_DUMP_BIN = "/opt/homebrew/opt/postgresql@17/bin/pg_dump";
const PG_HOST = "localhost";
const PG_PORT = "5433";
const PG_USER = "sem";
const PG_DB = "argentos";

const ARGENTOS_DIR = path.join(homedir(), ".argentos");

/** Agents to skip — ephemeral/test/joke agents flagged by the operator. */
const SKIP_AGENT_PREFIXES = ["agent-main-subagent-"] as const;
const SKIP_AGENT_EXACT = new Set(["beta", "test", "dumbo"]);

/** Alignment document filenames at the agent root (agent/<id>/agent/*.md). */
const ALIGNMENT_DOCS = [
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "CONTEMPLATION.md",
  "AGENTS.md",
  "BOOTSTRAP.md",
  "WORKFLOWS.md",
  "MEMORY.md",
  "SECURITY.md",
] as const;

interface ManifestFile {
  path: string; // path inside bundle
  size: number;
  sha256: string;
}

interface Manifest {
  version: 1;
  createdAt: string;
  sourceHostname: string;
  argentCoreVersion: string;
  counts: {
    agents: number;
    alignmentDocs: number;
    kernelFiles: number;
    workspaceFiles: number;
    devicesFiles: number;
    identityFiles: number;
  };
  files: ManifestFile[];
  notes: string[];
}

interface ExportOptions {
  out: string;
  includeSessions: boolean;
  passphraseEnv?: string;
  dryRun: boolean;
}

// ---------- registration ----------

/**
 * Register the `migrate` top-level subcommand on the program.
 * Mirrors the pattern used by secrets-cli / intent-cli.
 */
export function registerMigrateCli(program: Command): void {
  const migrate = program
    .command("migrate")
    .description("Export or import an Argent install bundle");

  migrate
    .command("export")
    .description("Export an encrypted migration bundle")
    .requiredOption("--out <path>", "Output path (should end in .tar.gz.enc)")
    .option(
      "--include-sessions",
      "Include per-agent session history (large; off by default)",
      false,
    )
    .option(
      "--passphrase-env <var>",
      "Read passphrase from this environment variable instead of prompting",
    )
    .option("--dry-run", "Print the plan and exit without writing files", false)
    .action(async (opts: ExportOptions) => {
      await runExport(opts);
    });
}

// ---------- export ----------

/**
 * Run the export pipeline end-to-end.
 *
 * 1. Resolve a passphrase (flag env var → ARGENT_MIGRATION_PASSPHRASE env → prompt).
 * 2. Stage files into a temp bundle dir (cp sources, skip git objects / sessions).
 * 3. pg_dump --format=custom into bundle/pg-dump.sql.
 * 4. Compute SHA-256 per-file, write manifest.json.
 * 5. tar -czf the staging dir → tmp/.tar.gz.
 * 6. Stream AES-256-GCM encrypt the tarball to the target .tar.gz.enc.
 * 7. Clean up temp.
 */
async function runExport(opts: ExportOptions): Promise<void> {
  const outPath = path.resolve(opts.out);
  if (!outPath.endsWith(".tar.gz.enc")) {
    console.warn(`[migrate] WARNING: output path "${outPath}" does not end with .tar.gz.enc`);
  }

  if (opts.dryRun) {
    await printDryRunPlan(outPath, opts);
    return;
  }

  const passphrase = await resolvePassphrase(opts.passphraseEnv);
  if (!passphrase) {
    console.error("[migrate] No passphrase provided; aborting.");
    process.exitCode = 1;
    return;
  }

  ensureOutDir(outPath);

  const stageRoot = mkdtempSync(path.join(tmpdir(), "argent-migrate-"));
  const bundleDir = path.join(stageRoot, "bundle");
  mkdirSync(bundleDir, { recursive: true });

  const manifest: Manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceHostname: hostname(),
    argentCoreVersion: readArgentCoreVersion(),
    counts: {
      agents: 0,
      alignmentDocs: 0,
      kernelFiles: 0,
      workspaceFiles: 0,
      devicesFiles: 0,
      identityFiles: 0,
    },
    files: [],
    notes: [],
  };

  try {
    stageTopLevelSecrets(bundleDir, manifest);
    stageIdentityAndDevices(bundleDir, manifest);
    stageAgents(bundleDir, manifest, opts.includeSessions);
    stageWorkspace(bundleDir, manifest);
    stageSanitizedConfig(bundleDir, manifest);
    await stagePgDump(bundleDir, manifest);

    // Manifest last — after every other file is in place.
    writeManifest(bundleDir, manifest);

    // tar.gz the staging dir
    const tarPath = path.join(stageRoot, "bundle.tar.gz");
    await tarBundle(stageRoot, tarPath);

    // encrypt tar.gz → outPath
    await encryptStream(tarPath, outPath, passphrase);

    const size = statSync(outPath).size;
    console.log(`\n[migrate] Export complete:`);
    console.log(`  File:    ${outPath}`);
    console.log(`  Size:    ${(size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Agents:  ${manifest.counts.agents}`);
    console.log(`  Files:   ${manifest.files.length}`);
    console.log(`  Hostname:${manifest.sourceHostname}`);
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

async function printDryRunPlan(outPath: string, opts: ExportOptions): Promise<void> {
  console.log(`[migrate] DRY RUN — no files will be written.`);
  console.log(`  Output:           ${outPath}`);
  console.log(`  Include sessions: ${opts.includeSessions}`);
  console.log(`  Passphrase env:   ${opts.passphraseEnv ?? "ARGENT_MIGRATION_PASSPHRASE (or prompt)"}`);
  console.log(`  Source:           ${ARGENTOS_DIR}`);

  const agents = listAgents();
  console.log(`  Agents to include (${agents.length}):`);
  for (const a of agents) console.log(`    - ${a}`);

  const skipped = listAgentsRaw().filter((a) => !agents.includes(a));
  if (skipped.length) {
    console.log(`  Agents skipped (${skipped.length}):`);
    for (const a of skipped) console.log(`    - ${a}`);
  }

  console.log(`  pg_dump:          ${PG_DUMP_BIN} -Fc -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${PG_DB}`);
}

// ---------- staging helpers ----------

function stageTopLevelSecrets(bundleDir: string, manifest: Manifest): void {
  copyIfExists(
    path.join(ARGENTOS_DIR, "service-keys.json"),
    path.join(bundleDir, "service-keys.json"),
    manifest,
    "service-keys.json",
  );
  copyIfExists(
    path.join(ARGENTOS_DIR, ".master-key"),
    path.join(bundleDir, "master-key"),
    manifest,
    "master-key",
  );
}

function stageIdentityAndDevices(bundleDir: string, manifest: Manifest): void {
  const identityDir = path.join(ARGENTOS_DIR, "identity");
  if (existsSync(identityDir)) {
    const dst = path.join(bundleDir, "identity");
    mkdirSync(dst, { recursive: true });
    for (const name of ["device.json", "device-auth.json"]) {
      if (copyIfExists(path.join(identityDir, name), path.join(dst, name), manifest, `identity/${name}`)) {
        manifest.counts.identityFiles += 1;
      }
    }
  }

  const devicesDir = path.join(ARGENTOS_DIR, "devices");
  if (existsSync(devicesDir)) {
    const dst = path.join(bundleDir, "devices");
    mkdirSync(dst, { recursive: true });
    for (const name of ["paired.json", "pending.json"]) {
      if (copyIfExists(path.join(devicesDir, name), path.join(dst, name), manifest, `devices/${name}`)) {
        manifest.counts.devicesFiles += 1;
      }
    }
  }
}

function stageAgents(bundleDir: string, manifest: Manifest, includeSessions: boolean): void {
  const agents = listAgents();
  manifest.counts.agents = agents.length;

  for (const agentId of agents) {
    const src = path.join(ARGENTOS_DIR, "agents", agentId);
    const dst = path.join(bundleDir, "agents", agentId);
    mkdirSync(dst, { recursive: true });

    // agent/ subdirectory — auth-profiles.json + alignment .md + kernel/
    const srcAgent = path.join(src, "agent");
    const dstAgent = path.join(dst, "agent");
    if (existsSync(srcAgent)) {
      mkdirSync(dstAgent, { recursive: true });

      copyIfExists(
        path.join(srcAgent, "auth-profiles.json"),
        path.join(dstAgent, "auth-profiles.json"),
        manifest,
        `agents/${agentId}/agent/auth-profiles.json`,
      );

      for (const docName of ALIGNMENT_DOCS) {
        if (
          copyIfExists(
            path.join(srcAgent, docName),
            path.join(dstAgent, docName),
            manifest,
            `agents/${agentId}/agent/${docName}`,
          )
        ) {
          manifest.counts.alignmentDocs += 1;
        }
      }

      const kernelSrc = path.join(srcAgent, "kernel");
      if (existsSync(kernelSrc) && statSync(kernelSrc).isDirectory()) {
        const kernelDst = path.join(dstAgent, "kernel");
        mkdirSync(kernelDst, { recursive: true });
        for (const entry of walkFiles(kernelSrc, { skipGitObjects: true })) {
          const rel = path.relative(kernelSrc, entry);
          const out = path.join(kernelDst, rel);
          mkdirSync(path.dirname(out), { recursive: true });
          copyFileSync(entry, out);
          recordFile(out, manifest, `agents/${agentId}/agent/kernel/${rel}`);
          manifest.counts.kernelFiles += 1;
        }
      }
    }

    // Agent root — identity.json + alignment-integrity
    copyIfExists(
      path.join(src, "identity.json"),
      path.join(dst, "identity.json"),
      manifest,
      `agents/${agentId}/identity.json`,
    );
    copyIfExists(
      path.join(src, ".argent-alignment-integrity.json"),
      path.join(dst, ".argent-alignment-integrity.json"),
      manifest,
      `agents/${agentId}/.argent-alignment-integrity.json`,
    );

    if (includeSessions) {
      const sessionsSrc = path.join(src, "sessions");
      if (existsSync(sessionsSrc) && statSync(sessionsSrc).isDirectory()) {
        const sessionsDst = path.join(dst, "sessions");
        mkdirSync(sessionsDst, { recursive: true });
        for (const entry of walkFiles(sessionsSrc, { skipGitObjects: true })) {
          const rel = path.relative(sessionsSrc, entry);
          const out = path.join(sessionsDst, rel);
          mkdirSync(path.dirname(out), { recursive: true });
          copyFileSync(entry, out);
          recordFile(out, manifest, `agents/${agentId}/sessions/${rel}`);
        }
      }
    }
  }
}

function stageWorkspace(bundleDir: string, manifest: Manifest): void {
  const workspaceSrc = path.join(ARGENTOS_DIR, "workspace");
  if (!existsSync(workspaceSrc)) return;
  const workspaceDst = path.join(bundleDir, "workspace");
  mkdirSync(workspaceDst, { recursive: true });

  for (const entry of walkFiles(workspaceSrc, { skipGitObjects: true })) {
    const rel = path.relative(workspaceSrc, entry);
    const out = path.join(workspaceDst, rel);
    mkdirSync(path.dirname(out), { recursive: true });
    copyFileSync(entry, out);
    recordFile(out, manifest, `workspace/${rel}`);
    manifest.counts.workspaceFiles += 1;
  }
}

function stageSanitizedConfig(bundleDir: string, manifest: Manifest): void {
  const src = path.join(ARGENTOS_DIR, "argent.json");
  if (!existsSync(src)) return;
  const raw = readFileSync(src, "utf8");
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    manifest.notes.push(`argent.json parse failed: ${(err as Error).message}; including raw.`);
    const dst = path.join(bundleDir, "argent.json.sanitized");
    writeFileSync(dst, raw);
    recordFile(dst, manifest, "argent.json.sanitized");
    return;
  }

  // Redact gateway.auth.token (and any nearby token-ish fields) — never include plaintext
  // gateway tokens in a bundle that may be shared across machines.
  const redacted = redactTokens(parsed);
  const dst = path.join(bundleDir, "argent.json.sanitized");
  writeFileSync(dst, `${JSON.stringify(redacted, null, 2)}\n`, "utf8");
  recordFile(dst, manifest, "argent.json.sanitized");
}

async function stagePgDump(bundleDir: string, manifest: Manifest): Promise<void> {
  const dumpPath = path.join(bundleDir, "pg-dump.sql");
  if (!existsSync(PG_DUMP_BIN)) {
    manifest.notes.push(`pg_dump binary missing at ${PG_DUMP_BIN}; pg-dump.sql not produced.`);
    console.warn(`[migrate] pg_dump not found at ${PG_DUMP_BIN} — skipping PG dump.`);
    return;
  }

  console.log(`[migrate] Running pg_dump → ${dumpPath} ...`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      PG_DUMP_BIN,
      ["-Fc", "-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DB, "-f", dumpPath],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    proc.once("error", reject);
    proc.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}`));
    });
  });

  recordFile(dumpPath, manifest, "pg-dump.sql");
}

function writeManifest(bundleDir: string, manifest: Manifest): void {
  const dst = path.join(bundleDir, "manifest.json");
  writeFileSync(dst, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  // Note: manifest itself is not inside manifest.files (chicken-and-egg).
}

// ---------- tar ----------

async function tarBundle(stageRoot: string, tarPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "tar",
      ["-czf", tarPath, "-C", stageRoot, "bundle"],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    proc.once("error", reject);
    proc.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}`));
    });
  });
}

// ---------- crypto ----------

/**
 * Stream-encrypt `srcPath` into `dstPath` using AES-256-GCM with a scrypt-derived key.
 *
 * Header is written up front with an empty 16-byte authTag slot. After the cipher
 * is finalized we get the real authTag and patch it into the header in place —
 * this avoids materializing the ciphertext in memory or on disk twice.
 */
async function encryptStream(srcPath: string, dstPath: string, passphrase: string): Promise<void> {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(passphrase, salt, KEY_LEN, SCRYPT_OPTS);

  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const header = Buffer.alloc(HEADER_LEN, 0);
  let offset = 0;
  MAGIC.copy(header, offset); offset += MAGIC.length;
  header.writeUInt8(VERSION, offset); offset += 1;
  salt.copy(header, offset); offset += SALT_LEN;
  iv.copy(header, offset); offset += IV_LEN;
  // authTag slot left zero for now; patched post-encrypt.
  const tagOffset = offset;
  offset += TAG_LEN;
  // reserved bytes left zero

  const readable = createReadStream(srcPath);
  const writable = createWriteStream(dstPath, { flags: "w" });
  writable.write(header);

  await pipeline(readable, cipher, writable);
  const tag = cipher.getAuthTag();

  // Patch the real authTag into the header. Re-open the file with r+ and seek to tagOffset.
  const { open } = await import("node:fs/promises");
  const fh = await open(dstPath, "r+");
  try {
    await fh.write(tag, 0, tag.length, tagOffset);
  } finally {
    await fh.close();
  }
}

// ---------- passphrase ----------

async function resolvePassphrase(envVarName?: string): Promise<string | null> {
  if (envVarName && process.env[envVarName]) {
    return process.env[envVarName] ?? null;
  }
  if (process.env.ARGENT_MIGRATION_PASSPHRASE) {
    return process.env.ARGENT_MIGRATION_PASSPHRASE;
  }
  if (!process.stdin.isTTY) {
    console.error("[migrate] No TTY; set ARGENT_MIGRATION_PASSPHRASE or --passphrase-env.");
    return null;
  }
  return promptPassphraseTTY();
}

function promptPassphraseTTY(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Mute stdout while the user types so the passphrase is not echoed to the terminal.
    const stdout = process.stdout as NodeJS.WriteStream & { _writeRaw?: Function };
    let muted = false;
    const originalWrite = stdout.write.bind(stdout);
    stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (muted) {
        return originalWrite("", ...(rest as [])) as boolean;
      }
      return originalWrite(chunk as string, ...(rest as [])) as boolean;
    }) as typeof stdout.write;
    process.stdout.write("Passphrase: ");
    muted = true;
    rl.question("", (answer) => {
      muted = false;
      stdout.write = originalWrite;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

// ---------- agent enumeration ----------

function listAgentsRaw(): string[] {
  const agentsDir = path.join(ARGENTOS_DIR, "agents");
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function listAgents(): string[] {
  return listAgentsRaw().filter(shouldIncludeAgent);
}

function shouldIncludeAgent(id: string): boolean {
  if (SKIP_AGENT_EXACT.has(id)) return false;
  for (const prefix of SKIP_AGENT_PREFIXES) {
    if (id.startsWith(prefix)) return false;
  }
  return true;
}

// ---------- file walking ----------

interface WalkOpts {
  skipGitObjects: boolean;
}

function* walkFiles(root: string, opts: WalkOpts): Generator<string> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        if (opts.skipGitObjects && isGitObjectsDir(full)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        yield full;
      }
    }
  }
}

function isGitObjectsDir(full: string): boolean {
  // Matches any path ending in .git/objects or .git/objects/<anything>
  return (
    full.endsWith(`${path.sep}.git${path.sep}objects`) ||
    full.includes(`${path.sep}.git${path.sep}objects${path.sep}`)
  );
}

// ---------- io + manifest helpers ----------

function ensureOutDir(outPath: string): void {
  const dir = path.dirname(outPath);
  mkdirSync(dir, { recursive: true });
}

/**
 * Copy src→dst if src exists. Records file in manifest with given bundle-relative path.
 * Returns true if the copy happened.
 */
function copyIfExists(
  src: string,
  dst: string,
  manifest: Manifest,
  manifestPath: string,
): boolean {
  if (!existsSync(src)) return false;
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  recordFile(dst, manifest, manifestPath);
  return true;
}

function recordFile(diskPath: string, manifest: Manifest, manifestPath: string): void {
  const stat = statSync(diskPath);
  const sha = createHash("sha256").update(readFileSync(diskPath)).digest("hex");
  manifest.files.push({ path: manifestPath, size: stat.size, sha256: sha });
}

function readArgentCoreVersion(): string {
  // Best-effort: walk up from this file until we find a package.json named "argentos".
  let cur = path.resolve(new URL(import.meta.url).pathname);
  for (let i = 0; i < 10; i++) {
    cur = path.dirname(cur);
    const pkgPath = path.join(cur, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string; name?: string };
        if (pkg.name === "argentos" && pkg.version) return pkg.version;
      } catch {
        // fall through
      }
    }
  }
  return "unknown";
}

/**
 * Redact gateway.auth.token and obvious token-y fields so the bundle never
 * carries a plaintext gateway auth token.
 */
function redactTokens(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redactTokens);
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (k === "token" || k === "authToken") {
        out[k] = "REDACTED_PER_INSTALL";
      } else {
        out[k] = redactTokens(v);
      }
    }
    return out;
  }
  return input;
}

// ---------- standalone entrypoint ----------

/**
 * When invoked directly via `bun src/cli/migrate-cli.ts export ...` or
 * `node --import tsx src/cli/migrate-cli.ts export ...`, parse argv with a
 * tiny hand-rolled parser so we don't depend on commander being installed
 * yet. Once Day 2 wires up registerMigrateCli(), the real CLI will route
 * through commander.
 */
async function main(argv: string[]): Promise<void> {
  const [subcmd, ...rest] = argv;
  if (subcmd !== "export") {
    printUsage();
    process.exitCode = subcmd ? 1 : 0;
    return;
  }
  const opts: ExportOptions = parseExportArgs(rest);
  await runExport(opts);
}

function printUsage(): void {
  console.log("Usage: argent migrate export --out <path> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --out <path>            Output path (should end in .tar.gz.enc) [required]");
  console.log("  --include-sessions      Include per-agent session history (large)");
  console.log("  --passphrase-env <var>  Read passphrase from this env var");
  console.log("  --dry-run               Print the plan; don't write anything");
}

function parseExportArgs(args: string[]): ExportOptions {
  let out: string | undefined;
  let includeSessions = false;
  let passphraseEnv: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--out":
        out = args[++i];
        break;
      case "--include-sessions":
        includeSessions = true;
        break;
      case "--passphrase-env":
        passphraseEnv = args[++i];
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
      default:
        if (arg !== undefined && arg.startsWith("--")) {
          console.error(`[migrate] unknown option: ${arg}`);
          process.exit(2);
        }
    }
  }
  if (!out) {
    console.error("[migrate] --out is required");
    process.exit(2);
  }
  return { out, includeSessions, passphraseEnv, dryRun };
}

// Detect "ran directly" by comparing argv[1] resolved path to this file.
// `import.meta.url` → file:// path; argv[1] may be absolute or relative.
const thisFile = path.resolve(new URL(import.meta.url).pathname);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && invoked === thisFile) {
  void main(process.argv.slice(2)).catch((err) => {
    console.error(`[migrate] fatal: ${(err as Error).stack ?? err}`);
    process.exitCode = 1;
  });
}
