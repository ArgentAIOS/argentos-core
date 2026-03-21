/**
 * Phoenix Backup System
 *
 * Automatic workspace and memory backups for ArgentOS.
 * Supports local, Git, S3, and Cloudflare R2 targets.
 *
 * @example
 * ```typescript
 * import { runBackup, listBackups, runRestore } from "./backup";
 *
 * // Run a backup
 * const result = await runBackup({ verbose: true });
 * if (result.success) {
 *   console.log(`Backup created: ${result.backupPath}`);
 * }
 *
 * // List available backups
 * const backups = listBackups();
 * console.log(backups);
 *
 * // Restore from latest backup
 * await runRestore({ latest: true });
 * ```
 */

// Types
export type {
  PhoenixConfig,
  BackupTargets,
  LocalBackupTarget,
  GitBackupTarget,
  S3BackupTarget,
  R2BackupTarget,
  RetentionPolicy,
  NotificationConfig,
  EncryptionConfig,
  BackupOptions,
  RestoreOptions,
  BackupResult,
  BackupState,
  BackupInfo,
} from "./types.js";

// Configuration
export {
  loadConfig,
  validateConfig,
  findConfigFile,
  createExampleConfig,
  getDefaultConfigPath,
  CONFIG_SEARCH_PATHS,
  DEFAULT_CONFIG,
} from "./config.js";

// Operations
export { runBackup, runRestore, listBackups, getLastBackupState } from "./runner.js";
