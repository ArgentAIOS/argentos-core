/**
 * Dangerous command detection for bash/terminal tool execution.
 *
 * Ported from Hermes Agent (tools/approval.py) — adapted for TypeScript.
 *
 * Checks commands against a pattern catalog before execution. If a match
 * is found, returns the threat description so the caller can block or
 * prompt for approval.
 *
 * This does NOT handle approval flow — that's the caller's responsibility.
 * This module is pure detection.
 */

export interface DangerousCommandMatch {
  pattern: string;
  description: string;
}

/**
 * Pattern catalog: [regex, human-readable description].
 *
 * These patterns are case-insensitive and run against the normalized command.
 * Keep sorted by category for maintainability.
 */
const DANGEROUS_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Filesystem destruction
  [/\brm\s+(-[^\s]*\s+)*\//i, "delete in root path"],
  [/\brm\s+-[^\s]*r/i, "recursive delete"],
  [/\brm\s+--recursive\b/i, "recursive delete (long flag)"],
  [/\bxargs\s+.*\brm\b/i, "xargs with rm"],
  [/\bfind\b.*-exec\s+(\/\S*\/)?rm\b/i, "find -exec rm"],
  [/\bfind\b.*-delete\b/i, "find -delete"],

  // Permissions
  [/\bchmod\s+(-[^\s]*\s+)*777\b/i, "world-writable permissions"],
  [/\bchmod\s+--recursive\b.*777/i, "recursive world-writable (long flag)"],
  [/\bchown\s+(-[^\s]*)?R\s+root/i, "recursive chown to root"],
  [/\bchown\s+--recursive\b.*root/i, "recursive chown to root (long flag)"],

  // Disk/filesystem
  [/\bmkfs\b/i, "format filesystem"],
  [/\bdd\s+.*if=/i, "disk copy"],
  [/>\s*\/dev\/sd/i, "write to block device"],

  // SQL destruction
  [/\bDROP\s+(TABLE|DATABASE)\b/i, "SQL DROP"],
  [/\bDELETE\s+FROM\b(?!.*\bWHERE\b)/i, "SQL DELETE without WHERE"],
  [/\bTRUNCATE\s+(TABLE)?\s*\w/i, "SQL TRUNCATE"],

  // System config
  [/>\s*\/etc\//i, "overwrite system config"],
  [/\btee\b.*(?:\/etc\/|\/dev\/sd|\.ssh\/|\.argentos\/\.env)/i, "overwrite system file via tee"],

  // Process killing
  [/\bsystemctl\s+(stop|disable|mask)\b/i, "stop/disable system service"],
  [/\bkill\s+-9\s+-1\b/i, "kill all processes"],
  [/\bpkill\s+-9\b/i, "force kill processes"],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/i, "fork bomb"],

  // Remote code execution
  [/\b(curl|wget)\b.*\|\s*(ba)?sh\b/i, "pipe remote content to shell"],
  [
    /\b(bash|sh|zsh|ksh)\s+<\s*<?\s*\(\s*(curl|wget)\b/i,
    "execute remote script via process substitution",
  ],

  // Script execution via flag
  [/\b(python[23]?|perl|ruby|node)\s+-[ec]\s+/i, "script execution via -e/-c flag"],

  // Self-termination protection
  [/\b(pkill|killall)\b.*\b(argent|gateway)\b/i, "kill argent/gateway process"],

  // ArgentOS-specific: protect drizzle push
  [/drizzle-kit\s+push\s+--force/i, "drizzle-kit push --force (destructive schema change)"],
  [/\bgit\s+push\s+.*--force\b.*\bmain\b/i, "force push to main"],
  [/\bgit\s+reset\s+--hard\b/i, "git reset --hard (data loss risk)"],
];

/**
 * Normalize a command string before pattern matching.
 *
 * Strips ANSI escape sequences and null bytes so obfuscation can't bypass detection.
 */
function normalizeCommand(command: string): string {
  // Strip ANSI escape sequences (CSI, OSC, etc.)
  // eslint-disable-next-line no-control-regex
  let result = command.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  // Strip null bytes
  result = result.replace(/\x00/g, "");
  return result;
}

/**
 * Check if a command matches any dangerous patterns.
 *
 * Returns the first match, or null if the command is safe.
 */
export function detectDangerousCommand(command: string): DangerousCommandMatch | null {
  const normalized = normalizeCommand(command);
  for (const [pattern, description] of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      return { pattern: pattern.source, description };
    }
  }
  return null;
}

/**
 * Get all matches (for reporting multiple issues in one command).
 */
export function detectAllDangerousPatterns(command: string): DangerousCommandMatch[] {
  const normalized = normalizeCommand(command);
  const matches: DangerousCommandMatch[] = [];
  for (const [pattern, description] of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      matches.push({ pattern: pattern.source, description });
    }
  }
  return matches;
}
