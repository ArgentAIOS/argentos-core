/**
 * Doctor check: warn when `~/Library/LaunchAgents/ai.argent.*.plist` files
 * reference a non-canonical install (e.g. a legacy `/Users/sem/argentos/`
 * clone). See `src/daemon/launchagent-plist-validate.ts` for the underlying
 * helper.
 *
 * Catches:
 *  - Drift after `npm i -g argentos` reinstalls
 *  - Manually edited plists
 *  - Surviving legacy installs (#172, the "rogue Telegram poller" incident)
 */

import {
  formatLaunchAgentInstallIssues,
  resolveCanonicalInstallPackageDir,
  resolveCanonicalInstallScope,
  validateLaunchAgentInstallPaths,
  type ListLaunchAgentPlistsFn,
  type ReadProgramArgumentsFn,
} from "../daemon/launchagent-plist-validate.js";
import { note } from "../terminal/note.js";

export async function noteLaunchAgentInstallPathDrift(deps?: {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  launchAgentsDir?: string;
  listPlists?: ListLaunchAgentPlistsFn;
  readProgramArguments?: ReadProgramArgumentsFn;
  noteFn?: typeof note;
}): Promise<void> {
  const platform = deps?.platform ?? process.platform;
  if (platform !== "darwin") {
    return;
  }
  const env = deps?.env ?? (process.env as Record<string, string | undefined>);
  const canonical = resolveCanonicalInstallPackageDir(env);
  if (!canonical) {
    return;
  }

  const issues = await validateLaunchAgentInstallPaths({
    env,
    launchAgentsDir: deps?.launchAgentsDir,
    listPlists: deps?.listPlists,
    readProgramArguments: deps?.readProgramArguments,
    canonicalInstallPackageDir: canonical,
  });

  const message = formatLaunchAgentInstallIssues(issues, {
    canonicalInstallPackageDir: canonical,
    canonicalInstallScope: resolveCanonicalInstallScope(canonical),
  });
  if (!message) {
    return;
  }
  (deps?.noteFn ?? note)(message, "Argent LaunchAgents (macOS)");
}
