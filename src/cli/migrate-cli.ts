/**
 * Migrate CLI — Export / Import operator install bundles.
 *
 * Commands:
 *   argent migrate export --out <path>     Produce an encrypted migration bundle
 *   argent migrate import <bundle> [...]   Decrypt + restore into a target state dir
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
 */

import { spawn } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
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
    workspaceFiles: number; // shared workspace/
    perAgentWorkspaceFiles: number; // workspace-<id>/ total
    perAgentWorkspaces: number; // number of workspace-<id> dirs
    modelsJsonFiles: number;
    devicesFiles: number;
    identityFiles: number;
    topLevelFiles: number; // nudges.json etc.
    topLevelDirFiles: number; // cron/, connectors/, widgets/ totals
  };
  /**
   * Directories that the import side MUST mkdir even if they contain no
   * files (e.g. operator has no cron jobs yet). Keeps the state-dir schema
   * intact across a round trip.
   */
  ensureDirs: string[];
  files: ManifestFile[];
  notes: string[];
}

interface ExportOptions {
  out: string;
  includeSessions: boolean;
  passphraseEnv?: string;
  dryRun: boolean;
}

interface ImportOptions {
  bundle: string;
  targetStateDir?: string;
  passphraseEnv?: string;
  skipPgRestore: boolean;
  skipIdentity: boolean;
  dryRun: boolean;
  force: boolean;
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

  migrate
    .command("import")
    .description("Decrypt and restore an Argent install from a migration bundle")
    .argument("<bundle>", "Path to .tar.gz.enc bundle produced by `migrate export`")
    .option(
      "--target-state-dir <path>",
      "Override ~/.argentos/ (default: $ARGENT_STATE_DIR or ~/.argentos)",
    )
    .option(
      "--passphrase-env <var>",
      "Read passphrase from this environment variable instead of prompting",
    )
    .option("--skip-pg-restore", "Do not run pg_restore (state files only)", false)
    .option(
      "--skip-identity",
      "Do not restore identity/ (for cross-machine cloning)",
      false,
    )
    .option("--dry-run", "Decrypt + verify checksums; do not write to target", false)
    .option(
      "--force",
      "Overwrite an existing non-empty target state dir (DESTRUCTIVE)",
      false,
    )
    .action(async (bundle: string, opts: Omit<ImportOptions, "bundle">) => {
      await runImport({ ...opts, bundle });
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
      perAgentWorkspaceFiles: 0,
      perAgentWorkspaces: 0,
      modelsJsonFiles: 0,
      devicesFiles: 0,
      identityFiles: 0,
      topLevelFiles: 0,
      topLevelDirFiles: 0,
    },
    ensureDirs: [],
    files: [],
    notes: [],
  };

  try {
    stageTopLevelSecrets(bundleDir, manifest);
    stageTopLevelFiles(bundleDir, manifest);
    stageIdentityAndDevices(bundleDir, manifest);
    stageTopLevelDirs(bundleDir, manifest);
    stageAgents(bundleDir, manifest, opts.includeSessions);
    stageWorkspace(bundleDir, manifest);
    stagePerAgentWorkspaces(bundleDir, manifest);
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
    console.log(`  File:         ${outPath}`);
    console.log(`  Size:         ${(size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Agents:       ${manifest.counts.agents}`);
    console.log(`  Per-agent workspaces: ${manifest.counts.perAgentWorkspaces} (${manifest.counts.perAgentWorkspaceFiles} files)`);
    console.log(`  models.json:  ${manifest.counts.modelsJsonFiles}`);
    console.log(`  Top-level files: ${manifest.counts.topLevelFiles}`);
    console.log(`  Top-level dirs:  ${TOP_LEVEL_DIRS.length} tracked, ${manifest.counts.topLevelDirFiles} files`);
    console.log(`  Total files:  ${manifest.files.length}`);
    console.log(`  Hostname:     ${manifest.sourceHostname}`);
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

// ---------- import ----------

const PG_RESTORE_BIN = "/opt/homebrew/opt/postgresql@17/bin/pg_restore";

/**
 * Run the import pipeline end-to-end.
 *
 * 1. Open bundle, parse header, derive key, decrypt to temp tar.gz.
 * 2. Extract tar.gz to temp/bundle/.
 * 3. Read manifest.json and verify SHA-256 of every referenced file BEFORE
 *    touching the target state dir. A single mismatch is fatal unless
 *    --dry-run (in which case we report and bail).
 * 4. Refuse to write into a non-empty target unless --force.
 * 5. Copy files into target state dir. --skip-identity skips identity/.
 * 6. pg_restore --clean --if-exists --no-owner unless --skip-pg-restore.
 */
async function runImport(opts: ImportOptions): Promise<void> {
  const bundlePath = path.resolve(opts.bundle);
  if (!existsSync(bundlePath)) {
    console.error(`[migrate] bundle not found: ${bundlePath}`);
    process.exitCode = 1;
    return;
  }

  const target = path.resolve(
    opts.targetStateDir ?? process.env.ARGENT_STATE_DIR ?? ARGENTOS_DIR,
  );

  // Guardrail: don't let a stray import clobber the operator's live install.
  if (target === ARGENTOS_DIR && !opts.force && !opts.dryRun) {
    console.warn(
      `[migrate] Target is the live state dir (${target}). Pass --force if this is really what you want.`,
    );
  }

  const passphrase = await resolvePassphrase(opts.passphraseEnv);
  if (!passphrase) {
    console.error("[migrate] No passphrase provided; aborting.");
    process.exitCode = 1;
    return;
  }

  const stageRoot = mkdtempSync(path.join(tmpdir(), "argent-import-"));
  const tarPath = path.join(stageRoot, "bundle.tar.gz");
  const extractRoot = path.join(stageRoot, "extract");
  mkdirSync(extractRoot, { recursive: true });

  try {
    console.log(`[migrate] Decrypting ${bundlePath} ...`);
    await decryptStream(bundlePath, tarPath, passphrase);

    console.log(`[migrate] Extracting tarball ...`);
    await untarBundle(tarPath, extractRoot);

    const bundleDir = path.join(extractRoot, "bundle");
    if (!existsSync(bundleDir)) {
      throw new Error("bundle/ directory missing from extracted archive");
    }

    const manifestPath = path.join(bundleDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error("manifest.json missing from bundle");
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

    console.log(
      `[migrate] Bundle source: ${manifest.sourceHostname} (${manifest.createdAt}) — ${manifest.files.length} files`,
    );

    const mismatches = verifyManifest(bundleDir, manifest);
    if (mismatches.length > 0) {
      console.error(`[migrate] Checksum mismatches (${mismatches.length}):`);
      for (const m of mismatches.slice(0, 10)) {
        console.error(`  - ${m}`);
      }
      if (mismatches.length > 10) {
        console.error(`  ... and ${mismatches.length - 10} more`);
      }
      process.exitCode = 1;
      return;
    }
    console.log(`[migrate] Checksums OK — all ${manifest.files.length} files verified.`);

    if (opts.dryRun) {
      console.log(`[migrate] DRY RUN — target unchanged. Target would be: ${target}`);
      printImportPlan(bundleDir, manifest, opts, target);
      return;
    }

    // Pre-flight: refuse to clobber a populated target unless --force.
    if (!opts.force && targetNonEmpty(target)) {
      console.error(
        `[migrate] Target ${target} is not empty. Pass --force to overwrite.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(`[migrate] Restoring to ${target} ...`);
    const restored = copyBundleToTarget(bundleDir, target, opts);

    let pgMessage = "skipped";
    if (!opts.skipPgRestore) {
      const dumpPath = path.join(bundleDir, "pg-dump.sql");
      if (!existsSync(dumpPath)) {
        pgMessage = "no pg-dump.sql in bundle";
      } else {
        await runPgRestore(dumpPath);
        pgMessage = "restored";
      }
    }

    console.log(`\n[migrate] Import complete:`);
    console.log(`  Target:          ${target}`);
    console.log(`  Files written:   ${restored.filesWritten}`);
    console.log(`  Bytes written:   ${restored.bytesWritten}`);
    console.log(`  Skipped (identity): ${restored.skippedIdentity}`);
    console.log(`  PG restore:      ${pgMessage}`);
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

function printImportPlan(
  bundleDir: string,
  manifest: Manifest,
  opts: ImportOptions,
  target: string,
): void {
  console.log(`  Target:             ${target}`);
  console.log(`  Skip pg restore:    ${opts.skipPgRestore}`);
  console.log(`  Skip identity:      ${opts.skipIdentity}`);
  console.log(`  Force overwrite:    ${opts.force}`);
  console.log(`  Bundle agents:      ${manifest.counts.agents}`);
  console.log(`  Bundle files:       ${manifest.files.length}`);
  const pgDump = path.join(bundleDir, "pg-dump.sql");
  console.log(`  pg-dump.sql size:   ${existsSync(pgDump) ? `${statSync(pgDump).size} bytes` : "missing"}`);
}

/**
 * For each manifest entry, recompute SHA-256 of the extracted file and compare
 * against the claimed hash. Returns human-readable mismatch descriptions.
 */
function verifyManifest(bundleDir: string, manifest: Manifest): string[] {
  const bad: string[] = [];
  for (const entry of manifest.files) {
    const onDisk = path.join(bundleDir, entry.path);
    if (!existsSync(onDisk)) {
      bad.push(`${entry.path}: missing from archive`);
      continue;
    }
    const actual = createHash("sha256").update(readFileSync(onDisk)).digest("hex");
    if (actual !== entry.sha256) {
      bad.push(`${entry.path}: sha256 mismatch (expected ${entry.sha256.slice(0, 12)}..., got ${actual.slice(0, 12)}...)`);
    }
  }
  return bad;
}

interface RestoreStats {
  filesWritten: number;
  bytesWritten: number;
  skippedIdentity: number;
}

/**
 * Copy every non-manifest file from the extracted bundle into the target
 * state dir. The bundle layout is already the target layout modulo one
 * rename: `bundle/master-key` → `<target>/.master-key`. --skip-identity
 * drops the identity/ subtree.
 *
 * argent.json.sanitized is restored as argent.json (the REDACTED tokens are
 * expected to be replaced post-restore by the operator or a provision script).
 */
function copyBundleToTarget(
  bundleDir: string,
  target: string,
  opts: ImportOptions,
): RestoreStats {
  mkdirSync(target, { recursive: true });
  const stats: RestoreStats = { filesWritten: 0, bytesWritten: 0, skippedIdentity: 0 };

  // Read the manifest to learn about directories that must exist even if empty
  // (cron/, connectors/, widgets/ on a fresh install).
  const manifestPath = path.join(bundleDir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
      if (Array.isArray(manifest.ensureDirs)) {
        for (const dirRel of manifest.ensureDirs) {
          mkdirSync(path.join(target, dirRel), { recursive: true });
        }
      }
    } catch {
      // already-verified manifest — corruption at this point is unexpected but non-fatal
    }
  }

  for (const src of walkFiles(bundleDir, { skipGitObjects: false })) {
    const rel = path.relative(bundleDir, src);
    if (rel === "manifest.json") continue;

    // Map bundle-layout paths to target-layout paths.
    let dstRel = rel;
    if (rel === "master-key") dstRel = ".master-key";
    if (rel === "argent.json.sanitized") dstRel = "argent.json";

    if (opts.skipIdentity && dstRel.startsWith(`identity${path.sep}`)) {
      stats.skippedIdentity += 1;
      continue;
    }
    // pg-dump.sql doesn't belong in the state dir — it's consumed separately.
    if (dstRel === "pg-dump.sql") continue;

    const dst = path.join(target, dstRel);
    mkdirSync(path.dirname(dst), { recursive: true });
    copyFileSync(src, dst);

    // Preserve sensitive-file permissions. The master key is mode 0600 on
    // the source; force it here in case the FS copy dropped bits.
    if (dstRel === ".master-key") {
      chmodSync(dst, 0o600);
    }

    stats.filesWritten += 1;
    stats.bytesWritten += statSync(dst).size;
  }
  return stats;
}

function targetNonEmpty(target: string): boolean {
  if (!existsSync(target)) return false;
  try {
    const entries = readdirSync(target);
    // A lone .DS_Store or empty dir doesn't count.
    return entries.filter((e) => e !== ".DS_Store").length > 0;
  } catch {
    return false;
  }
}

async function untarBundle(tarPath: string, extractRoot: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("tar", ["-xzf", tarPath, "-C", extractRoot], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    proc.once("error", reject);
    proc.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar extract exited with code ${code}`));
    });
  });
}

async function runPgRestore(dumpPath: string): Promise<void> {
  if (!existsSync(PG_RESTORE_BIN)) {
    throw new Error(`pg_restore not found at ${PG_RESTORE_BIN}`);
  }
  console.log(`[migrate] Running pg_restore from ${dumpPath} ...`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      PG_RESTORE_BIN,
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "-h",
        PG_HOST,
        "-p",
        PG_PORT,
        "-U",
        PG_USER,
        "-d",
        PG_DB,
        dumpPath,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    proc.once("error", reject);
    proc.once("close", (code) => {
      // pg_restore returns nonzero on recoverable warnings (missing roles, etc.)
      // We still treat code 0 as success; warn on nonzero but don't hard fail
      // unless the dump clearly couldn't be read.
      if (code === 0) resolve();
      else {
        console.warn(
          `[migrate] pg_restore exited with code ${code} — check output above for errors vs. warnings.`,
        );
        resolve();
      }
    });
  });
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

/**
 * Top-level user-state files that live at the state-dir root alongside
 * service-keys.json. These are small (KBs) but real operator data and must
 * survive a migration.
 */
const TOP_LEVEL_FILES = [
  "nudges.json",
  "license.json",
  "dashboard-calendar.json",
  "first-run-complete",
  "provider-registry.json",
] as const;

function stageTopLevelFiles(bundleDir: string, manifest: Manifest): void {
  for (const name of TOP_LEVEL_FILES) {
    if (
      copyIfExists(
        path.join(ARGENTOS_DIR, name),
        path.join(bundleDir, name),
        manifest,
        name,
      )
    ) {
      manifest.counts.topLevelFiles += 1;
    }
  }
}

/**
 * Top-level user-state directories that always round-trip, even if empty.
 * cron/ holds user-defined schedules. connectors/ and widgets/ are populated
 * by the dashboard over time. If we didn't explicitly recreate these on
 * import, walk-based file copy would silently omit them (no files → no dir).
 */
const TOP_LEVEL_DIRS = ["cron", "connectors", "widgets"] as const;

function stageTopLevelDirs(bundleDir: string, manifest: Manifest): void {
  for (const name of TOP_LEVEL_DIRS) {
    const srcDir = path.join(ARGENTOS_DIR, name);
    if (!existsSync(srcDir)) continue;
    const dstDir = path.join(bundleDir, name);
    mkdirSync(dstDir, { recursive: true });
    manifest.ensureDirs.push(name);

    for (const entry of walkFiles(srcDir, { skipGitObjects: true })) {
      const rel = path.relative(srcDir, entry);
      const out = path.join(dstDir, rel);
      mkdirSync(path.dirname(out), { recursive: true });
      copyFileSync(entry, out);
      recordFile(out, manifest, `${name}/${rel}`);
      manifest.counts.topLevelDirFiles += 1;
    }
  }
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

    // agent/ subdirectory — auth-profiles.json + models.json + alignment .md + kernel/
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

      if (
        copyIfExists(
          path.join(srcAgent, "models.json"),
          path.join(dstAgent, "models.json"),
          manifest,
          `agents/${agentId}/agent/models.json`,
        )
      ) {
        manifest.counts.modelsJsonFiles += 1;
      }

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

/**
 * Per-agent workspaces live at ~/.argentos/workspace-<id>/ (sibling to the
 * shared workspace/). Detected dynamically: any top-level dir named
 * "workspace-*" except "workspace" itself. Same exclusions as the shared
 * workspace (no .git/objects, no node_modules, no sessions).
 */
function stagePerAgentWorkspaces(bundleDir: string, manifest: Manifest): void {
  if (!existsSync(ARGENTOS_DIR)) return;
  const candidates = readdirSync(ARGENTOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("workspace-") && d.name !== "workspace")
    .map((d) => d.name)
    .sort();

  for (const name of candidates) {
    const src = path.join(ARGENTOS_DIR, name);
    const dst = path.join(bundleDir, name);
    mkdirSync(dst, { recursive: true });
    manifest.counts.perAgentWorkspaces += 1;

    for (const entry of walkFiles(src, { skipGitObjects: true })) {
      // Also skip sessions/ inside per-agent workspaces (same policy as
      // agents/<id>/sessions/).
      const rel = path.relative(src, entry);
      if (rel.startsWith(`sessions${path.sep}`)) continue;
      const out = path.join(dst, rel);
      mkdirSync(path.dirname(out), { recursive: true });
      copyFileSync(entry, out);
      recordFile(out, manifest, `${name}/${rel}`);
      manifest.counts.perAgentWorkspaceFiles += 1;
    }
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

/**
 * Stream-decrypt `srcPath` into `dstPath`. Throws on magic/version mismatch
 * or GCM authTag failure (bad passphrase / tampered bundle).
 */
async function decryptStream(srcPath: string, dstPath: string, passphrase: string): Promise<void> {
  const fd = openSync(srcPath, "r");
  const header = Buffer.alloc(HEADER_LEN);
  try {
    readSync(fd, header, 0, HEADER_LEN, 0);
  } finally {
    closeSync(fd);
  }

  if (!header.slice(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Magic mismatch — not an Argent migration bundle.");
  }
  let off = MAGIC.length;
  const version = header.readUInt8(off);
  off += 1;
  if (version !== VERSION) {
    throw new Error(`Unsupported bundle version: ${version}`);
  }
  const salt = header.slice(off, off + SALT_LEN);
  off += SALT_LEN;
  const iv = header.slice(off, off + IV_LEN);
  off += IV_LEN;
  const authTag = header.slice(off, off + TAG_LEN);

  const key = scryptSync(passphrase, salt, KEY_LEN, SCRYPT_OPTS);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const input = createReadStream(srcPath, { start: HEADER_LEN });
  const output = createWriteStream(dstPath);
  try {
    await pipeline(input, decipher, output);
  } catch (err) {
    // GCM authTag failures surface as "Unsupported state or unable to authenticate data".
    throw new Error(`Decrypt failed: ${(err as Error).message}. Wrong passphrase or corrupted bundle?`);
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
  if (subcmd === "export") {
    const opts: ExportOptions = parseExportArgs(rest);
    await runExport(opts);
    return;
  }
  if (subcmd === "import") {
    const opts: ImportOptions = parseImportArgs(rest);
    await runImport(opts);
    return;
  }
  printUsage();
  process.exitCode = subcmd ? 1 : 0;
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  argent migrate export --out <path> [options]");
  console.log("  argent migrate import <bundle> [options]");
  console.log("");
  console.log("Export options:");
  console.log("  --out <path>            Output path (should end in .tar.gz.enc) [required]");
  console.log("  --include-sessions      Include per-agent session history (large)");
  console.log("  --passphrase-env <var>  Read passphrase from this env var");
  console.log("  --dry-run               Print the plan; don't write anything");
  console.log("");
  console.log("Import options:");
  console.log("  --target-state-dir <p>  Target state dir (default: $ARGENT_STATE_DIR or ~/.argentos)");
  console.log("  --passphrase-env <var>  Read passphrase from this env var");
  console.log("  --skip-pg-restore       Do not run pg_restore");
  console.log("  --skip-identity         Do not restore identity/");
  console.log("  --dry-run               Decrypt + verify; do not write");
  console.log("  --force                 Overwrite non-empty target (DESTRUCTIVE)");
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

function parseImportArgs(args: string[]): ImportOptions {
  let bundle: string | undefined;
  let targetStateDir: string | undefined;
  let passphraseEnv: string | undefined;
  let skipPgRestore = false;
  let skipIdentity = false;
  let dryRun = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--target-state-dir":
        targetStateDir = args[++i];
        break;
      case "--passphrase-env":
        passphraseEnv = args[++i];
        break;
      case "--skip-pg-restore":
        skipPgRestore = true;
        break;
      case "--skip-identity":
        skipIdentity = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--force":
        force = true;
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
        // first non-flag positional is the bundle path
        if (!bundle && arg !== undefined) bundle = arg;
    }
  }
  if (!bundle) {
    console.error("[migrate] bundle path is required");
    process.exit(2);
  }
  return { bundle, targetStateDir, passphraseEnv, skipPgRestore, skipIdentity, dryRun, force };
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
