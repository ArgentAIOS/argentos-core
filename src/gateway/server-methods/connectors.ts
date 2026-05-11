import type { GatewayRequestHandlers } from "./types.js";
import {
  discoverConnectorCatalog,
  type ConnectorsCatalogResult,
} from "../../connectors/catalog.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateConnectorsCatalogParams,
} from "../protocol/index.js";

/**
 * Cache TTL for the connectors catalog probe.
 *
 * `discoverConnectorCatalog` spawns one child_process per discovered connector
 * binary on PATH (and per repo scaffold) — see `runConnectorJson` in
 * `src/connectors/catalog.ts`. On macOS each spawn can prompt the operator
 * for TCC permissions ("node would like to access…"), so re-running the
 * probe on every Settings → System tab open generated the popup spam
 * reported in GH #152.
 *
 * A short TTL keeps the catalog feeling fresh (operator-driven refreshes
 * arrive after this window) without forcing a re-spawn on every panel mount.
 */
export const CONNECTORS_CATALOG_CACHE_TTL_MS = 60_000;

type CacheEntry = {
  result: ConnectorsCatalogResult;
  loadedAt: number;
};

const catalogCache = new Map<string, CacheEntry>();

function cacheKey(executeAdapters: boolean | undefined): string {
  // `executeAdapters` defaults to true inside `discoverConnectorCatalog`, so
  // collapse the implicit-true and explicit-true cases onto the same key.
  return executeAdapters === false ? "no-exec" : "default";
}

/**
 * Reset the catalog cache. Exported for tests; production code does not
 * call this — the natural TTL handles invalidation.
 */
export function clearConnectorsCatalogCacheForTests(): void {
  catalogCache.clear();
}

export const connectorsHandlers: GatewayRequestHandlers = {
  "connectors.catalog": async ({ params, respond }) => {
    if (!validateConnectorsCatalogParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.catalog params: ${formatValidationErrors(validateConnectorsCatalogParams.errors)}`,
        ),
      );
      return;
    }

    const key = cacheKey(params.executeAdapters);
    const now = Date.now();
    const cached = catalogCache.get(key);
    if (cached && now - cached.loadedAt < CONNECTORS_CATALOG_CACHE_TTL_MS) {
      respond(true, cached.result, undefined);
      return;
    }

    try {
      const result = await discoverConnectorCatalog({
        executeAdapters: params.executeAdapters,
      });
      catalogCache.set(key, { result, loadedAt: now });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INTERNAL_ERROR,
          error instanceof Error ? error.message : "failed to build connector catalog",
        ),
      );
    }
  },
};
