import fs from "node:fs";
import path from "node:path";
import { resolveArgentPackageRoot } from "../infra/argent-root.js";

const DOCS_PATH_CACHE_TTL_MS = 60_000;
const docsPathCache = new Map<
  string,
  {
    cachedAt: number;
    value: Promise<string | null>;
  }
>();

function buildDocsPathCacheKey(params: {
  workspaceDir?: string;
  argv1?: string;
  cwd?: string;
  moduleUrl?: string;
}): string {
  return JSON.stringify({
    workspaceDir: params.workspaceDir?.trim() || null,
    argv1: params.argv1 ?? null,
    cwd: params.cwd ?? null,
    moduleUrl: params.moduleUrl ?? null,
  });
}

export function clearArgentDocsPathCache(): void {
  docsPathCache.clear();
}

export async function resolveArgentDocsPath(params: {
  workspaceDir?: string;
  argv1?: string;
  cwd?: string;
  moduleUrl?: string;
}): Promise<string | null> {
  const cacheKey = buildDocsPathCacheKey(params);
  const cached = docsPathCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < DOCS_PATH_CACHE_TTL_MS) {
    return cached.value;
  }

  const value = (async () => {
    const workspaceDir = params.workspaceDir?.trim();
    if (workspaceDir) {
      const workspaceDocs = path.join(workspaceDir, "docs");
      if (fs.existsSync(workspaceDocs)) {
        return workspaceDocs;
      }
    }

    const packageRoot = await resolveArgentPackageRoot({
      cwd: params.cwd,
      argv1: params.argv1,
      moduleUrl: params.moduleUrl,
    });
    if (!packageRoot) {
      return null;
    }

    const packageDocs = path.join(packageRoot, "docs");
    return fs.existsSync(packageDocs) ? packageDocs : null;
  })();

  docsPathCache.set(cacheKey, {
    cachedAt: Date.now(),
    value,
  });
  return value;
}
