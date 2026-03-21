/**
 * Phoenix Configuration Loading
 *
 * Handles loading and validating backup configuration.
 */

import fs from "node:fs";
import path from "node:path";
import type { PhoenixConfig } from "./types.js";
import { resolveUserPath } from "../utils.js";

/** Default config file locations (searched in order) */
export const CONFIG_SEARCH_PATHS = [
  "~/.argentos/backup.json",
  "~/.argentos/phoenix.json",
  "~/.config/argentos/backup.json",
];

/** Default configuration values */
export const DEFAULT_CONFIG: Partial<PhoenixConfig> = {
  compression: true,
  retention: {
    daily: 7,
    weekly: 4,
    monthly: 12,
  },
  exclude: ["*.log", "node_modules/", ".git/", "*.tmp", ".DS_Store"],
};

/**
 * Find the config file in standard locations
 */
export function findConfigFile(): string | null {
  for (const searchPath of CONFIG_SEARCH_PATHS) {
    const resolved = resolveUserPath(searchPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

/**
 * Load Phoenix configuration from file
 */
export function loadConfig(configPath?: string): PhoenixConfig | null {
  const filePath = configPath ? resolveUserPath(configPath) : findConfigFile();

  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const config = JSON.parse(content) as Partial<PhoenixConfig>;

    // Merge with defaults
    return {
      ...DEFAULT_CONFIG,
      ...config,
      retention: {
        ...DEFAULT_CONFIG.retention,
        ...config.retention,
      },
      exclude: config.exclude ?? DEFAULT_CONFIG.exclude,
    } as PhoenixConfig;
  } catch (error) {
    console.error(`Failed to load config from ${filePath}:`, error);
    return null;
  }
}

/**
 * Validate Phoenix configuration
 */
export function validateConfig(config: PhoenixConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.workspace) {
    errors.push("workspace is required");
  } else if (!fs.existsSync(resolveUserPath(config.workspace))) {
    errors.push(`workspace directory not found: ${config.workspace}`);
  }

  if (!config.backupDir) {
    errors.push("backupDir is required");
  }

  if (!config.targets) {
    errors.push("at least one backup target is required");
  } else {
    const hasEnabledTarget = Object.values(config.targets).some(
      (target) => target && typeof target === "object" && target.enabled,
    );
    if (!hasEnabledTarget) {
      errors.push("at least one backup target must be enabled");
    }
  }

  if (!config.include || config.include.length === 0) {
    errors.push("include patterns are required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get default config path for creating new config
 */
export function getDefaultConfigPath(): string {
  return resolveUserPath("~/.argentos/backup.json");
}

/**
 * Create example config file
 */
export function createExampleConfig(configPath?: string): string {
  const filePath = configPath ? resolveUserPath(configPath) : getDefaultConfigPath();
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const exampleConfig: PhoenixConfig = {
    workspace: "~/argent",
    backupDir: "~/backups/argent",
    targets: {
      local: {
        enabled: true,
        path: "~/backups/argent",
      },
      git: {
        enabled: false,
        repo: "git@github.com:yourusername/agent-backup.git",
        branch: "main",
        autoCommit: true,
      },
      s3: {
        enabled: false,
        bucket: "my-agent-backups",
        prefix: "argent/",
        storageClass: "STANDARD_IA",
      },
      r2: {
        enabled: false,
        accountId: "YOUR_CLOUDFLARE_ACCOUNT_ID",
        bucket: "agent-backups",
        prefix: "argent/",
      },
    },
    include: [
      "MEMORY.md",
      "SOUL.md",
      "USER.md",
      "AGENTS.md",
      "IDENTITY.md",
      "memory/*.md",
      "scripts/",
      "config/",
      "~/.argentos/observations.db",
    ],
    exclude: ["*.log", "node_modules/", ".git/", "*.tmp", ".DS_Store"],
    compression: true,
    retention: {
      daily: 7,
      weekly: 4,
      monthly: 12,
    },
    notifications: {
      enabled: false,
      onSuccess: "silent",
      onFailure: "alert",
    },
    encryption: {
      enabled: false,
      method: "gpg",
    },
  };

  fs.writeFileSync(filePath, JSON.stringify(exampleConfig, null, 2));
  return filePath;
}
