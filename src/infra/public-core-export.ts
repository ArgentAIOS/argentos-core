import path from "node:path";
import { fileURLToPath } from "node:url";

export function repoRootFromModule(moduleUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "../..");
}

export function defaultPublicCoreManifestPath(repoRoot: string): string {
  return path.join(repoRoot, "docs", "argent", "public-core.manifest.example.json");
}

export function resolveManifestEntryPath(manifestPath: string, entry: string): string {
  if (path.isAbsolute(entry)) {
    return entry;
  }
  return path.resolve(path.dirname(manifestPath), entry);
}

export function resolvePublicCoreRepoRoot(
  manifestPath: string,
  configuredRoot: string,
  overrideRoot?: string | null,
): string {
  if (overrideRoot && overrideRoot.trim()) {
    return path.resolve(overrideRoot.trim());
  }
  return resolveManifestEntryPath(manifestPath, configuredRoot);
}
