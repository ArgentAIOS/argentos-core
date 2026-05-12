import fs from "node:fs/promises";
import path from "node:path";

/**
 * Env-var keys we strip from gateway LaunchAgent plists when they reference
 * a legacy install path. See GH #169.
 *
 * The gateway runtime does not need these — they only steer `argent update`
 * toward the hosted source checkout from the operator's interactive shell.
 * Older installs baked them into the LaunchAgent plist, which means a stale
 * path (e.g. `$HOME/argentos`) survives long after the source checkout has
 * moved. We remove them on `argent update` so the plist never references a
 * directory that has migrated out from under it.
 */
const LEGACY_GIT_DIR_KEYS = ["ARGENT_GIT_DIR", "ARGENTOS_GIT_DIR"] as const;
export type LegacyGitDirKey = (typeof LEGACY_GIT_DIR_KEYS)[number];

export type StripLegacyGitDirOptions = {
  /**
   * The user's home directory, used to identify legacy install paths.
   * Defaults to the current `HOME` env var. Pass explicitly in tests.
   */
  home?: string;
};

export type StripLegacyGitDirResult = {
  /** The plist content. Equal to the input when nothing changed. */
  plist: string;
  /** Whether the plist was modified. */
  changed: boolean;
  /** Names of env vars that were removed. */
  removedKeys: LegacyGitDirKey[];
};

/**
 * True if `value` resolves to the legacy `<home>/argentos` install location
 * (with or without trailing slash, with or without trailing whitespace).
 *
 * The legacy path is the default that `install-hosted.sh` historically wrote
 * (`GIT_DIR="${ARGENTOS_GIT_DIR:-$HOME/argentos}"`) and is what got captured
 * into Jason's plist per the GH #169 report. We deliberately do NOT strip
 * values that point at a custom override (e.g. a developer pointing at a
 * sibling checkout) — those may be load-bearing for their workflow.
 */
function isLegacyGitDirValue(value: string, home: string): boolean {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return false;
  }
  const trimmedHome = home.trim();
  if (!trimmedHome) {
    return false;
  }
  // Resolve away `..`, repeated slashes, and trailing slashes for both sides.
  const resolved = path.resolve(trimmedValue);
  const legacy = path.resolve(trimmedHome, "argentos");
  return resolved === legacy;
}

const ENV_DICT_RE = /(<key>EnvironmentVariables<\/key>\s*<dict>)([\s\S]*?)(<\/dict>)/i;

/**
 * Strip legacy ARGENT_GIT_DIR / ARGENTOS_GIT_DIR env-var entries from a
 * gateway LaunchAgent plist when they reference the legacy `$HOME/argentos`
 * path. Idempotent: passing an already-clean plist returns it unchanged with
 * `changed: false`.
 *
 * If removing the env vars leaves the `EnvironmentVariables` dict empty, the
 * dict itself is dropped — matches what `buildLaunchAgentPlist` would emit
 * when given an empty environment.
 */
export function stripLegacyGitDirEnvVars(
  plist: string,
  options: StripLegacyGitDirOptions = {},
): StripLegacyGitDirResult {
  const home = options.home ?? process.env.HOME ?? "";
  if (!home) {
    return { plist, changed: false, removedKeys: [] };
  }

  const match = plist.match(ENV_DICT_RE);
  if (!match) {
    return { plist, changed: false, removedKeys: [] };
  }

  const dictPrefix = match[1] ?? "";
  const dictBody = match[2] ?? "";
  const dictSuffix = match[3] ?? "";
  const removedKeys: LegacyGitDirKey[] = [];

  let newBody = dictBody;
  for (const key of LEGACY_GIT_DIR_KEYS) {
    // Match <key>KEY</key>\s*<string>VALUE</string> as a single block, plus
    // any whitespace before it so we don't leave a dangling blank line.
    const entryRe = new RegExp(
      `\\s*<key>\\s*${key}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`,
      "i",
    );
    const entryMatch = newBody.match(entryRe);
    if (!entryMatch) {
      continue;
    }
    const value = entryMatch[1] ?? "";
    if (!isLegacyGitDirValue(value, home)) {
      continue;
    }
    newBody = newBody.replace(entryRe, "");
    removedKeys.push(key);
  }

  if (removedKeys.length === 0) {
    return { plist, changed: false, removedKeys: [] };
  }

  // If the env dict is now effectively empty, drop the whole block. Otherwise
  // splice the trimmed body back in.
  const bodyHasEntries = /<key>/i.test(newBody);
  let nextPlist: string;
  if (bodyHasEntries) {
    nextPlist = plist.replace(ENV_DICT_RE, `${dictPrefix}${newBody}${dictSuffix}`);
  } else {
    // Strip the entire `<key>EnvironmentVariables</key>...</dict>` block,
    // including any leading whitespace, so we don't leave a hanging blank
    // line in the rendered plist.
    nextPlist = plist.replace(/\s*<key>EnvironmentVariables<\/key>\s*<dict>[\s\S]*?<\/dict>/i, "");
  }

  return { plist: nextPlist, changed: true, removedKeys };
}

/**
 * Read a gateway LaunchAgent plist at `plistPath`, strip any legacy GIT_DIR
 * env-var entries, and write the result back if anything changed. Idempotent
 * and safe to call when the plist does not exist (returns a no-op result).
 *
 * Returns `{ changed: false }` when there was nothing to do — callers can use
 * this to silence "cleaned up" logging on the common path.
 */
export async function cleanLegacyGitDirEnvFromPlistFile(
  plistPath: string,
  options: StripLegacyGitDirOptions = {},
): Promise<{ changed: boolean; removedKeys: LegacyGitDirKey[]; plistPath: string }> {
  let original: string;
  try {
    original = await fs.readFile(plistPath, "utf8");
  } catch {
    return { changed: false, removedKeys: [], plistPath };
  }

  const result = stripLegacyGitDirEnvVars(original, options);
  if (!result.changed) {
    return { changed: false, removedKeys: [], plistPath };
  }

  await fs.writeFile(plistPath, result.plist, "utf8");
  return { changed: true, removedKeys: result.removedKeys, plistPath };
}
