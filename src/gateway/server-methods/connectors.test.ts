import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discoverConnectorCatalog: vi.fn(),
}));

vi.mock("../../connectors/catalog.js", () => ({
  discoverConnectorCatalog: mocks.discoverConnectorCatalog,
}));

import { ErrorCodes } from "../protocol/index.js";
import { connectorsHandlers } from "./connectors.js";

const noop = () => false;

describe("connectorsHandlers", () => {
  it("returns the connector catalog", async () => {
    const respond = vi.fn();
    mocks.discoverConnectorCatalog.mockResolvedValue({
      total: 1,
      connectors: [{ tool: "aos-demo", label: "Demo Queue" }],
    });

    await connectorsHandlers["connectors.catalog"]({
      params: {},
      respond,
      context: {} as Parameters<(typeof connectorsHandlers)["connectors.catalog"]>[0]["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "connectors.catalog" },
      isWebchatConnect: noop,
    });

    expect(mocks.discoverConnectorCatalog).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        total: 1,
      }),
      undefined,
    );
  });

  it("rejects unexpected params", async () => {
    const respond = vi.fn();

    await connectorsHandlers["connectors.catalog"]({
      params: { nope: true },
      respond,
      context: {} as Parameters<(typeof connectorsHandlers)["connectors.catalog"]>[0]["context"],
      client: null,
      req: { id: "req-2", type: "req", method: "connectors.catalog" },
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST }),
    );
  });
});
