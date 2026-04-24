import path from "node:path";

export function resolveHostedGitDirOverride(): string | null {
  const override = process.env.ARGENT_GIT_DIR?.trim() || process.env.ARGENTOS_GIT_DIR?.trim();
  return override ? path.resolve(override) : null;
}
