import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discoverConnectorCatalog: vi.fn(),
}));

vi.mock("../../connectors/catalog.js", () => ({
  discoverConnectorCatalog: mocks.discoverConnectorCatalog,
}));

import { ErrorCodes } from "../protocol/index.js";
import {
  CONNECTORS_CATALOG_CACHE_TTL_MS,
  clearConnectorsCatalogCacheForTests,
  connectorsHandlers,
} from "./connectors.js";

const noop = () => false;

function makeHandlerArgs(
  params: Record<string, unknown>,
  reqId: string,
): Parameters<(typeof connectorsHandlers)["connectors.catalog"]>[0] {
  return {
    params,
    respond: vi.fn(),
    context: {} as Parameters<(typeof connectorsHandlers)["connectors.catalog"]>[0]["context"],
    client: null,
    req: { id: reqId, type: "req", method: "connectors.catalog" },
    isWebchatConnect: noop,
  };
}

describe("connectorsHandlers", () => {
  beforeEach(() => {
    clearConnectorsCatalogCacheForTests();
    mocks.discoverConnectorCatalog.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the connector catalog", async () => {
    const respond = vi.fn();
    mocks.discoverConnectorCatalog.mockResolvedValue({
      total: 1,
      connectors: [{ tool: "aos-demo", label: "Demo Queue" }],
    });

    await connectorsHandlers["connectors.catalog"]({
      ...makeHandlerArgs({}, "req-1"),
      respond,
    });

    expect(mocks.discoverConnectorCatalog).toHaveBeenCalledWith({
      executeAdapters: undefined,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        total: 1,
      }),
      undefined,
    );
  });

  it("passes explicit no-exec catalog requests through to discovery", async () => {
    const respond = vi.fn();
    mocks.discoverConnectorCatalog.mockResolvedValue({
      total: 0,
      connectors: [],
    });

    await connectorsHandlers["connectors.catalog"]({
      ...makeHandlerArgs({ executeAdapters: false }, "req-2"),
      respond,
    });

    expect(mocks.discoverConnectorCatalog).toHaveBeenCalledWith({
      executeAdapters: false,
    });
    expect(respond).toHaveBeenCalledWith(true, { total: 0, connectors: [] }, undefined);
  });

  it("rejects unexpected params", async () => {
    const respond = vi.fn();

    await connectorsHandlers["connectors.catalog"]({
      ...makeHandlerArgs({ nope: true }, "req-3"),
      respond,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST }),
    );
  });

  // GH #152 — Settings → System tab triggered the connector-binary spawn
  // probe on every panel mount, producing a macOS TCC permission popup
  // ("node would like to access…") on every visit. The handler now caches
  // the discovery result so subsequent calls within the TTL re-use it
  // without re-spawning child processes.
  describe("caches the connector catalog probe (GH #152)", () => {
    it("invokes the probe once and serves the cached snapshot for repeat calls", async () => {
      mocks.discoverConnectorCatalog.mockResolvedValue({
        total: 1,
        connectors: [{ tool: "aos-demo", label: "Demo Queue" }],
      });

      const respondA = vi.fn();
      await connectorsHandlers["connectors.catalog"]({
        ...makeHandlerArgs({}, "req-cache-1a"),
        respond: respondA,
      });

      const respondB = vi.fn();
      await connectorsHandlers["connectors.catalog"]({
        ...makeHandlerArgs({}, "req-cache-1b"),
        respond: respondB,
      });

      const respondC = vi.fn();
      await connectorsHandlers["connectors.catalog"]({
        ...makeHandlerArgs({}, "req-cache-1c"),
        respond: respondC,
      });

      // The probe spawns child_processes — assert it ran exactly once even
      // though the handler was invoked three times.
      expect(mocks.discoverConnectorCatalog).toHaveBeenCalledTimes(1);
      const payload = expect.objectContaining({ total: 1 });
      expect(respondA).toHaveBeenCalledWith(true, payload, undefined);
      expect(respondB).toHaveBeenCalledWith(true, payload, undefined);
      expect(respondC).toHaveBeenCalledWith(true, payload, undefined);
    });

    it("re-runs the probe once the TTL window expires", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 4, 11, 12, 0, 0));

      mocks.discoverConnectorCatalog
        .mockResolvedValueOnce({
          total: 1,
          connectors: [{ tool: "aos-demo", label: "Demo Queue" }],
        })
        .mockResolvedValueOnce({
          total: 2,
          connectors: [
            { tool: "aos-demo", label: "Demo Queue" },
            { tool: "aos-google", label: "Google Workspace" },
          ],
        });

      const respondA = vi.fn();
      await connectorsHandlers["connectors.catalog"]({
        ...makeHandlerArgs({}, "req-ttl-1a"),
        respond: respondA,
      });

      // Inside the TTL — still cached.
      vi.advanceTimersByTime(CONNECTORS_CATALOG_CACHE_TTL_MS - 1);
      const respondCached = vi.fn();
      await connectorsHandlers["connectors.catalog"]({
        ...makeHandlerArgs({}, "req-ttl-1b"),
        respond: respondCached,
      });
      expect(mocks.discoverConnectorCatalog).toHaveBeenCalledTimes(1);
      expect(respondCached).toHaveBeenCalledWith(
        true,
        expect.objectContaining({ total: 1 }),
        undefined,
      );

      // Cross the TTL boundary — the cached entry expires and the probe
      // runs again, returning the second (fresh) snapshot.
      vi.advanceTimersByTime(2);
      const respondRefreshed = vi.fn();
      await connectorsHandlers["connectors.catalog"]({
        ...makeHandlerArgs({}, "req-ttl-1c"),
        respond: respondRefreshed,
      });
      expect(mocks.discoverConnectorCatalog).toHaveBeenCalledTimes(2);
      expect(respondRefreshed).toHaveBeenCalledWith(
        true,
        expect.objectContaining({ total: 2 }),
        undefined,
      );
    });

    it("caches no-exec and full catalog requests under separate keys", async () => {
      mocks.discoverConnectorCatalog.mockImplementation(
        async (options: { executeAdapters?: boolean } = {}) => ({
          total: 0,
          connectors: [],
          // Echo the executeAdapters flag back so the test can verify the
          // handler did not collapse the two cases onto the same cache key.
          mode: options.executeAdapters === false ? "no-exec" : "default",
        }),
      );

      await connectorsHandlers["connectors.catalog"](makeHandlerArgs({}, "req-key-default-a"));
      await connectorsHandlers["connectors.catalog"](makeHandlerArgs({}, "req-key-default-b"));
      await connectorsHandlers["connectors.catalog"](
        makeHandlerArgs({ executeAdapters: false }, "req-key-no-exec-a"),
      );
      await connectorsHandlers["connectors.catalog"](
        makeHandlerArgs({ executeAdapters: false }, "req-key-no-exec-b"),
      );

      // Two cache buckets → exactly two probe spawns.
      expect(mocks.discoverConnectorCatalog).toHaveBeenCalledTimes(2);
      expect(mocks.discoverConnectorCatalog).toHaveBeenNthCalledWith(1, {
        executeAdapters: undefined,
      });
      expect(mocks.discoverConnectorCatalog).toHaveBeenNthCalledWith(2, {
        executeAdapters: false,
      });
    });

    it("does not cache failed probes (so the operator can retry without waiting out the TTL)", async () => {
      mocks.discoverConnectorCatalog
        .mockRejectedValueOnce(new Error("transient disk hiccup"))
        .mockResolvedValueOnce({ total: 0, connectors: [] });

      const respondFail = vi.fn();
      await connectorsHandlers["connectors.catalog"]({
        ...makeHandlerArgs({}, "req-fail-1"),
        respond: respondFail,
      });
      expect(respondFail).toHaveBeenCalledWith(
        false,
        undefined,
        expect.objectContaining({ code: ErrorCodes.INTERNAL_ERROR }),
      );

      const respondRetry = vi.fn();
      await connectorsHandlers["connectors.catalog"]({
        ...makeHandlerArgs({}, "req-fail-2"),
        respond: respondRetry,
      });
      // Probe should re-run on the retry — failed results must not poison
      // the cache.
      expect(mocks.discoverConnectorCatalog).toHaveBeenCalledTimes(2);
      expect(respondRetry).toHaveBeenCalledWith(true, { total: 0, connectors: [] }, undefined);
    });
  });
});
