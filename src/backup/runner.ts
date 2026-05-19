/**
 * Phoenix Backup Runner
 *
 * Core backup and restore operations for ArgentOS.
 */

import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  BackupInfo,
  BackupOptions,
  BackupResult,
  BackupState,
  PhoenixConfig,
  RestoreOptions,
} from "./types.js";
import { resolveUserPath } from "../utils.js";
import { loadConfig, validateConfig } from "./config.js";

const STATE_DIR = "~/.argentos/backup";
const STATE_FILE = "~/.argentos/backup/.last-backup";
const LOG_DIR = "~/.argentos/backup/logs";

/**
 * Generate a timestamp string for backup naming
 */
function generateTimestamp(): string {
  const now = new Date();
  return now.toISOString().slice(0, 16).replace(/[T:]/g, "-");
}

/**
 * Expand tilde and environment variables in path
 */
function expandPath(p: string): string {
  return resolveUserPath(p);
}

/**
 * Check if a command exists
 */
function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely backup SQLite database using .backup command
 */
function backupSqliteDatabase(dbPath: string, destPath: string): boolean {
  const expandedDbPath = expandPath(dbPath);
  if (!fs.existsSync(expandedDbPath)) {
    return false;
  }

  try {
    execSync(`sqlite3 "${expandedDbPath}" ".backup '${destPath}'"`, {
      stdio: "inherit",
    });
    return true;
  } catch (error) {
    console.error(`Failed to backup database ${dbPath}:`, error);
    return false;
  }
}

/**
 * Copy files matching a pattern
 */
function copyPattern(pattern: string, sourceBase: string, destBase: string): number {
  let copied = 0;
  const expandedSource = expandPath(sourceBase);
  const expandedPattern = expandPath(pattern);

  // Handle absolute paths
  let searchPattern: string;
  if (expandedPattern.startsWith("/")) {
    searchPattern = expandedPattern;
  } else {
    searchPattern = path.join(expandedSource, pattern);
  }

  // Use glob to find matching files
  try {
    const { globSync } = require("glob");
    const matches = globSync(searchPattern, { dot: true });

    for (const match of matches) {
      const relPath = match.startsWith(expandedSource)
        ? path.relative(expandedSource, match)
        : path.basename(match);

      const destPath = path.join(destBase, relPath);
      const destDir = path.dirname(destPath);

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const stat = fs.statSync(match);
      if (stat.isDirectory()) {
        fs.cpSync(match, destPath, { recursive: true });
      } else {
        fs.copyFileSync(match, destPath);
      }
      copied++;
    }
  } catch {
    // Fall back to simple file copy if glob not available
    if (fs.existsSync(expandedPattern)) {
      const destPath = path.join(destBase, path.basename(expandedPattern));
      fs.copyFileSync(expandedPattern, destPath);
      copied++;
    }
  }

  return copied;
}

/**
 * Run a backup operation
 */
export async function runBackup(options: BackupOptions = {}): Promise<BackupResult> {
  const config = loadConfig(options.configPath);
  if (!config) {
    return {
      success: false,
      timestamp: generateTimestamp(),
      backupPath: "",
      compression: false,
      targets: {},
      error: "Configuration not found. Run 'argent backup init' to create one.",
    };
  }

  const validation = validateConfig(config);
  if (!validation.valid) {
    return {
      success: false,
      timestamp: generateTimestamp(),
      backupPath: "",
      compression: false,
      targets: {},
      error: `Invalid configuration: ${validation.errors.join(", ")}`,
    };
  }

  const timestamp = generateTimestamp();
  const backupDir = expandPath(config.backupDir);
  const backupPath = path.join(backupDir, timestamp);
  const workspace = expandPath(config.workspace);

  if (options.verbose) {
    console.log(`Starting backup: ${timestamp}`);
    console.log(`Workspace: ${workspace}`);
    console.log(`Backup destination: ${backupPath}`);
  }

  if (options.dryRun) {
    console.log("DRY RUN MODE - No files will be copied");
    return {
      success: true,
      timestamp,
      backupPath,
      compression: config.compression ?? false,
      targets: {
        local: config.targets.local?.enabled,
        git: config.targets.git?.enabled,
        s3: config.targets.s3?.enabled,
        r2: config.targets.r2?.enabled,
      },
    };
  }

  try {
    // Create backup directory
    fs.mkdirSync(backupPath, { recursive: true });

    // Backup SQLite databases first (special handling)
    const dbBackupDir = path.join(backupPath, ".databases");
    fs.mkdirSync(dbBackupDir, { recursive: true });

    // ArgentOS observations database
    const obsDbPath = expandPath("~/.argentos/observations.db");
    if (fs.existsSync(obsDbPath)) {
      backupSqliteDatabase(obsDbPath, path.join(dbBackupDir, "observations.db"));
      if (options.verbose) console.log("  Backed up observations database");
    }

    // Legacy argent-mem database (for migration)
    const legacyDbPath = expandPath("~/.argent-mem/memory.db");
    if (fs.existsSync(legacyDbPath)) {
      backupSqliteDatabase(legacyDbPath, path.join(dbBackupDir, "argent-mem.db"));
      if (options.verbose) console.log("  Backed up legacy memory database");
    }

    // Backup included files
    let totalCopied = 0;
    for (const pattern of config.include) {
      // Skip database files - already handled above
      if (pattern.includes(".db")) {
        continue;
      }

      const copied = copyPattern(pattern, workspace, backupPath);
      totalCopied += copied;
      if (options.verbose && copied > 0) {
        console.log(`  Backed up ${copied} files matching: ${pattern}`);
      }
    }

    // Compress if enabled
    let finalPath = backupPath;
    if (config.compression) {
      const tarPath = `${backupPath}.tar.gz`;
      execSync(`tar -czf "${tarPath}" -C "${backupDir}" "${timestamp}"`, {
        stdio: options.verbose ? "inherit" : "ignore",
      });
      fs.rmSync(backupPath, { recursive: true });
      finalPath = tarPath;
      if (options.verbose) console.log(`  Compressed backup: ${tarPath}`);
    }

    // Upload to cloud targets
    const targetResults: BackupResult["targets"] = {
      local: config.targets.local?.enabled,
    };

    // S3 upload
    if (config.targets.s3?.enabled && commandExists("aws")) {
      try {
        const { bucket, prefix = "" } = config.targets.s3;
        const s3Path = `s3://${bucket}/${prefix}${path.basename(finalPath)}`;
        execSync(`aws s3 cp "${finalPath}" "${s3Path}"`, {
          stdio: options.verbose ? "inherit" : "ignore",
        });
        targetResults.s3 = true;
        if (options.verbose) console.log(`  Uploaded to S3: ${s3Path}`);
      } catch (error) {
        console.error("S3 upload failed:", error);
        targetResults.s3 = false;
      }
    }

    // R2 upload
    if (config.targets.r2?.enabled && commandExists("aws")) {
      try {
        const { accountId, bucket, prefix = "", accessKeyId, secretAccessKey } = config.targets.r2;
        const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
        const r2Path = `s3://${bucket}/${prefix}${path.basename(finalPath)}`;

        const env = {
          ...process.env,
          AWS_ACCESS_KEY_ID: accessKeyId,
          AWS_SECRET_ACCESS_KEY: secretAccessKey,
        };

        execSync(`aws s3 cp "${finalPath}" "${r2Path}" --endpoint-url "${endpoint}"`, {
          stdio: options.verbose ? "inherit" : "ignore",
          env,
        });
        targetResults.r2 = true;
        if (options.verbose) console.log(`  Uploaded to R2: ${r2Path}`);
      } catch (error) {
        console.error("R2 upload failed:", error);
        targetResults.r2 = false;
      }
    }

    // Apply retention policy
    if (config.retention?.daily && config.retention.daily > 0) {
      applyRetention(backupDir, config.retention.daily, config.compression ?? false);
    }

    // Save state
    const stateDir = expandPath(STATE_DIR);
    const stateFile = expandPath(STATE_FILE);
    fs.mkdirSync(stateDir, { recursive: true });

    const state: BackupState = {
      timestamp: Date.now(),
      date: new Date().toISOString(),
      backupPath: finalPath,
      compression: config.compression ?? false,
      success: true,
    };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

    // Calculate size
    const stats = fs.statSync(finalPath);
    const size = formatBytes(stats.size);

    return {
      success: true,
      timestamp,
      backupPath: finalPath,
      size,
      compression: config.compression ?? false,
      targets: targetResults,
    };
  } catch (error) {
    return {
      success: false,
      timestamp,
      backupPath,
      compression: config.compression ?? false,
      targets: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Apply retention policy - keep only last N backups
 */
function applyRetention(backupDir: string, keepCount: number, compressed: boolean): void {
  const pattern = compressed ? "*.tar.gz" : "*/";
  const files = fs.readdirSync(backupDir).sort().reverse();

  let count = 0;
  for (const file of files) {
    const filePath = path.join(backupDir, file);
    const isCompressed = file.endsWith(".tar.gz");
    const isDir = fs.statSync(filePath).isDirectory();

    if ((compressed && isCompressed) || (!compressed && isDir)) {
      count++;
      if (count > keepCount) {
        fs.rmSync(filePath, { recursive: true });
      }
    }
  }
}

/**
 * List available backups
 */
export function listBackups(configPath?: string): BackupInfo[] {
  const config = loadConfig(configPath);
  if (!config) return [];

  const backupDir = expandPath(config.backupDir);
  if (!fs.existsSync(backupDir)) return [];

  const files = fs.readdirSync(backupDir);
  const backups: BackupInfo[] = [];

  for (const file of files) {
    const filePath = path.join(backupDir, file);
    const stat = fs.statSync(filePath);
    const compressed = file.endsWith(".tar.gz");

    if (compressed || stat.isDirectory()) {
      const timestamp = compressed ? file.replace(".tar.gz", "") : file;
      backups.push({
        timestamp,
        path: filePath,
        size: formatBytes(stat.isDirectory() ? getDirSize(filePath) : stat.size),
        compressed,
      });
    }
  }

  return backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Get directory size recursively
 */
function getDirSize(dir: string): number {
  let size = 0;
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      size += getDirSize(filePath);
    } else {
      size += stat.size;
    }
  }

  return size;
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Get last backup state
 */
export function getLastBackupState(): BackupState | null {
  const stateFile = expandPath(STATE_FILE);
  if (!fs.existsSync(stateFile)) return null;

  try {
    const content = fs.readFileSync(stateFile, "utf-8");
    return JSON.parse(content) as BackupState;
  } catch {
    return null;
  }
}

/**
 * Restore from a backup
 */
export async function runRestore(options: RestoreOptions = {}): Promise<BackupResult> {
  const config = loadConfig();
  if (!config) {
    return {
      success: false,
      timestamp: "",
      backupPath: "",
      compression: false,
      targets: {},
      error: "Configuration not found",
    };
  }

  // Find backup to restore
  let backupPath: string;

  if (options.latest) {
    const backups = listBackups();
    if (backups.length === 0) {
      return {
        success: false,
        timestamp: "",
        backupPath: "",
        compression: false,
        targets: {},
        error: "No backups found",
      };
    }
    backupPath = backups[0].path;
  } else if (options.backup) {
    const backupDir = expandPath(config.backupDir);
    backupPath = path.join(backupDir, options.backup);

    // Check for compressed version
    if (!fs.existsSync(backupPath)) {
      backupPath = `${backupPath}.tar.gz`;
    }

    if (!fs.existsSync(backupPath)) {
      return {
        success: false,
        timestamp: options.backup,
        backupPath: "",
        compression: false,
        targets: {},
        error: `Backup not found: ${options.backup}`,
      };
    }
  } else {
    return {
      success: false,
      timestamp: "",
      backupPath: "",
      compression: false,
      targets: {},
      error: "Specify --latest or --backup <timestamp>",
    };
  }

  const compressed = backupPath.endsWith(".tar.gz");
  const timestamp = compressed
    ? path.basename(backupPath).replace(".tar.gz", "")
    : path.basename(backupPath);

  if (options.dryRun) {
    console.log(`DRY RUN: Would restore from ${backupPath}`);
    return {
      success: true,
      timestamp,
      backupPath,
      compression: compressed,
      targets: {},
    };
  }

  try {
    const workspace = expandPath(config.workspace);
    let extractPath = backupPath;

    // Extract if compressed
    if (compressed) {
      const tempDir = path.join(expandPath(config.backupDir), ".restore-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      execSync(`tar -xzf "${backupPath}" -C "${tempDir}"`, { stdio: "ignore" });
      extractPath = path.join(tempDir, timestamp);
    }

    // Restore databases
    const dbBackupDir = path.join(extractPath, ".databases");
    if (fs.existsSync(dbBackupDir)) {
      // Observations database
      const obsBackup = path.join(dbBackupDir, "observations.db");
      if (fs.existsSync(obsBackup)) {
        const obsTarget = expandPath("~/.argentos/observations.db");
        fs.mkdirSync(path.dirname(obsTarget), { recursive: true });
        fs.copyFileSync(obsBackup, obsTarget);
      }
    }

    // Restore files
    const files = fs.readdirSync(extractPath);
    for (const file of files) {
      if (file === ".databases") continue;

      const src = path.join(extractPath, file);
      const dest = path.join(workspace, file);

      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }

    // Cleanup temp directory
    if (compressed) {
      const tempDir = path.join(expandPath(config.backupDir), ".restore-temp");
      fs.rmSync(tempDir, { recursive: true });
    }

    return {
      success: true,
      timestamp,
      backupPath,
      compression: compressed,
      targets: {},
    };
  } catch (error) {
    return {
      success: false,
      timestamp,
      backupPath,
      compression: compressed,
      targets: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
