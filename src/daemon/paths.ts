import path from "node:path";
import { resolveConfigPath, resolveStateDir } from "../config/paths.js";
import { resolveGatewayProfileSuffix } from "./constants.js";

const windowsAbsolutePath = /^[a-zA-Z]:[\\/]/;
const windowsUncPath = /^\\\\/;

export function resolveHomeDir(env: Record<string, string | undefined>): string {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (!home) {
    throw new Error("Missing HOME");
  }
  return home;
}

export function resolveUserPathWithHome(input: string, home?: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("~")) {
    if (!home) {
      throw new Error("Missing HOME");
    }
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, home);
    return path.resolve(expanded);
  }
  if (windowsAbsolutePath.test(trimmed) || windowsUncPath.test(trimmed)) {
    return trimmed;
  }
  return path.resolve(trimmed);
}

export function resolveGatewayStateDir(env: Record<string, string | undefined>): string {
  const override = env.ARGENT_STATE_DIR?.trim();
  if (override) {
    const home = override.startsWith("~") ? resolveHomeDir(env) : undefined;
    return resolveUserPathWithHome(override, home);
  }
  const homedir = () => resolveHomeDir(env);
  const suffix = resolveGatewayProfileSuffix(env.ARGENT_PROFILE);
  if (suffix) {
    return path.join(homedir(), `.argentos${suffix}`);
  }
  return resolveStateDir(env as NodeJS.ProcessEnv, homedir);
}

export function resolveGatewayConfigPath(env: Record<string, string | undefined>): string {
  const override = env.ARGENT_CONFIG_PATH?.trim();
  if (override) {
    const home = override.startsWith("~") ? resolveHomeDir(env) : undefined;
    return resolveUserPathWithHome(override, home);
  }
  const homedir = () => resolveHomeDir(env);
  return resolveConfigPath(env as NodeJS.ProcessEnv, resolveGatewayStateDir(env), homedir);
}
