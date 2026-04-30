import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import { browserHandlers } from "./browser.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({ gateway: { nodes: { browser: { mode: "auto" } } } })),
  startBrowserControlServiceFromConfig: vi.fn(async () => false),
  createBrowserControlContext: vi.fn(() => ({})),
  createBrowserRouteDispatcher: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../../browser/control-service.js", () => ({
  createBrowserControlContext: mocks.createBrowserControlContext,
  startBrowserControlServiceFromConfig: mocks.startBrowserControlServiceFromConfig,
}));

vi.mock("../../browser/routes/dispatcher.js", () => ({
  createBrowserRouteDispatcher: mocks.createBrowserRouteDispatcher,
}));

const noop = () => false;

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    nodeRegistry: {
      listConnected: vi.fn(() => []),
      invoke: vi.fn(),
    },
    ...overrides,
  } as Parameters<(typeof browserHandlers)["browser.request"]>[0]["context"];
}

async function callBrowserRequest(params: Record<string, unknown>, context = baseContext()) {
  const respond = vi.fn();
  await browserHandlers["browser.request"]({
    params,
    respond,
    context,
    client: null,
    req: { id: "req-1", type: "req", method: "browser.request" },
    isWebchatConnect: noop,
  });
  return respond;
}

describe("browser request diagnostics", () => {
  beforeEach(() => {
    mocks.loadConfig.mockReturnValue({ gateway: { nodes: { browser: { mode: "auto" } } } });
    mocks.startBrowserControlServiceFromConfig.mockResolvedValue(false);
    mocks.createBrowserRouteDispatcher.mockReset();
  });

  it("labels local browser-control disabled failures with request details", async () => {
    const respond = await callBrowserRequest({
      method: "GET",
      path: "/",
      query: { profile: "chrome" },
      timeoutMs: 1500,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.UNAVAILABLE,
        message: "browser control is disabled",
        details: expect.objectContaining({
          surface: "browser.request",
          method: "GET",
          path: "/",
          profile: "chrome",
          route: "local-control",
          timeoutMs: 1500,
        }),
      }),
    );
  });

  it("labels node proxy invoke failures with node and request details", async () => {
    const context = baseContext({
      nodeRegistry: {
        listConnected: vi.fn(() => [
          {
            nodeId: "node-1",
            displayName: "Studio Mac",
            remoteIp: "127.0.0.1",
            caps: ["browser"],
            commands: ["browser.proxy"],
            platform: "macos",
          },
        ]),
        invoke: vi.fn(async () => ({
          ok: false,
          error: { code: "UNAVAILABLE", message: "gateway closed 1006" },
        })),
      },
    });

    const respond = await callBrowserRequest(
      {
        method: "GET",
        path: "/tabs",
        query: { profile: "chrome" },
        timeoutMs: 1500,
      },
      context,
    );

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.UNAVAILABLE,
        message: "gateway closed 1006",
        details: expect.objectContaining({
          surface: "browser.request",
          method: "GET",
          path: "/tabs",
          profile: "chrome",
          route: "node-proxy",
          node: expect.objectContaining({
            nodeId: "node-1",
            displayName: "Studio Mac",
          }),
          nodeError: { code: "UNAVAILABLE", message: "gateway closed 1006" },
        }),
      }),
    );
  });
});
