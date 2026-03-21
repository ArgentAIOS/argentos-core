/**
 * Phoenix Backup System Types
 *
 * Type definitions for ArgentOS backup configuration and operations.
 */

/** Backup target configuration for local filesystem */
export interface LocalBackupTarget {
  enabled: boolean;
  path: string;
}

/** Backup target configuration for Git repository */
export interface GitBackupTarget {
  enabled: boolean;
  repo: string;
  branch: string;
  autoCommit?: boolean;
}

/** Backup target configuration for Amazon S3 */
export interface S3BackupTarget {
  enabled: boolean;
  bucket: string;
  prefix?: string;
  storageClass?: "STANDARD" | "STANDARD_IA" | "GLACIER" | "DEEP_ARCHIVE";
}

/** Backup target configuration for Cloudflare R2 */
export interface R2BackupTarget {
  enabled: boolean;
  accountId: string;
  bucket: string;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** All backup targets */
export interface BackupTargets {
  local?: LocalBackupTarget;
  git?: GitBackupTarget;
  s3?: S3BackupTarget;
  r2?: R2BackupTarget;
}

/** Retention policy for backups */
export interface RetentionPolicy {
  /** Number of daily backups to keep (-1 for unlimited) */
  daily: number;
  /** Number of weekly backups to keep (-1 for unlimited) */
  weekly?: number;
  /** Number of monthly backups to keep (-1 for unlimited) */
  monthly?: number;
}

/** Notification configuration */
export interface NotificationConfig {
  enabled: boolean;
  onSuccess?: "silent" | "notify" | "alert";
  onFailure?: "silent" | "notify" | "alert";
}

/** Encryption configuration */
export interface EncryptionConfig {
  enabled: boolean;
  method?: "gpg" | "age";
  keyId?: string;
}

/** Phoenix backup configuration */
export interface PhoenixConfig {
  /** Root directory of the workspace to back up */
  workspace: string;
  /** Directory to store backups */
  backupDir: string;
  /** Backup targets (local, git, s3, r2) */
  targets: BackupTargets;
  /** File patterns to include in backup */
  include: string[];
  /** File patterns to exclude from backup */
  exclude?: string[];
  /** Whether to compress backups */
  compression?: boolean;
  /** Retention policy */
  retention?: RetentionPolicy;
  /** Notification settings */
  notifications?: NotificationConfig;
  /** Encryption settings */
  encryption?: EncryptionConfig;
}

/** Backup operation options */
export interface BackupOptions {
  /** Dry run mode - preview without executing */
  dryRun?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Custom config file path */
  configPath?: string;
  /** Only backup memory files */
  memoryOnly?: boolean;
  /** Only backup databases */
  databasesOnly?: boolean;
}

/** Restore operation options */
export interface RestoreOptions {
  /** Specific backup timestamp to restore */
  backup?: string;
  /** Restore from latest backup */
  latest?: boolean;
  /** Only restore memory files */
  memoryOnly?: boolean;
  /** Only restore databases */
  databasesOnly?: boolean;
  /** Only restore identity files */
  identityOnly?: boolean;
  /** Dry run mode */
  dryRun?: boolean;
}

/** Backup result */
export interface BackupResult {
  success: boolean;
  timestamp: string;
  backupPath: string;
  size?: string;
  compression: boolean;
  targets: {
    local?: boolean;
    git?: boolean;
    s3?: boolean;
    r2?: boolean;
  };
  error?: string;
}

/** Backup metadata stored in state file */
export interface BackupState {
  timestamp: number;
  date: string;
  backupPath: string;
  compression: boolean;
  success: boolean;
}

/** Available backup info */
export interface BackupInfo {
  timestamp: string;
  path: string;
  size: string;
  compressed: boolean;
}
