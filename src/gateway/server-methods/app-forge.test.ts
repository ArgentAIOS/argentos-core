import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppForgeBase } from "../../infra/app-forge-model.js";
import type { ConnectParams, RequestFrame } from "../protocol/index.js";
import type { GatewayRequestContext, GatewayRequestHandlerOptions } from "./types.js";
import { listGatewayMethods } from "../server-methods-list.js";
import { coreGatewayHandlers, handleGatewayRequest } from "../server-methods.js";
import { appForgeHandlers, resetAppForgeAdapterForTests } from "./app-forge.js";

function base(overrides: Partial<AppForgeBase> = {}): AppForgeBase {
  return {
    id: "base-1",
    appId: "app-1",
    name: "Campaign Review",
    description: "Review workspace",
    activeTableId: "table-1",
    revision: 1,
    updatedAt: "2026-04-25T20:00:00.000Z",
    tables: [
      {
        id: "table-1",
        name: "Reviews",
        revision: 1,
        fields: [{ id: "name", name: "Name", type: "text", required: true }],
        records: [],
      },
    ],
    ...overrides,
  };
}

function createResponder() {
  return vi.fn<(ok: boolean, payload?: unknown, error?: unknown) => void>();
}

async function invokeAppForgeHandler(method: string, params: Record<string, unknown>) {
  const handler = appForgeHandlers[method];
  if (!handler) {
    throw new Error(`missing handler: ${method}`);
  }
  const respond = createResponder();
  await handler({
    req: { type: "req", id: `test-${method}`, method, params },
    params,
    client: null,
    context: {} as unknown as GatewayRequestContext,
    isWebchatConnect: () => false,
    respond,
  } satisfies GatewayRequestHandlerOptions);
  return respond;
}

function operatorConnect(scopes: string[]): ConnectParams {
  return {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: "test-client",
      version: "1.0.0",
      platform: "test",
      mode: "api",
    },
    caps: [],
    role: "operator",
    scopes,
  };
}

describe("AppForge gateway handlers", () => {
  beforeEach(() => {
    resetAppForgeAdapterForTests([base(), base({ id: "base-2", appId: "app-2", name: "Other" })]);
  });

  it("registers AppForge methods for discovery and dispatch", () => {
    expect(listGatewayMethods()).toEqual(expect.arrayContaining(["appforge.bases.list"]));
    expect(coreGatewayHandlers["appforge.bases.put"]).toBe(appForgeHandlers["appforge.bases.put"]);
  });

  it("lists and fetches bases", async () => {
    const respond = await invokeAppForgeHandler("appforge.bases.list", { appId: "app-1" });
    expect(respond).toHaveBeenCalledWith(
      true,
      { bases: [expect.objectContaining({ id: "base-1", appId: "app-1" })] },
      undefined,
    );

    const getRespond = await invokeAppForgeHandler("appforge.bases.get", { baseId: "base-1" });
    expect(getRespond).toHaveBeenCalledWith(
      true,
      { base: expect.objectContaining({ id: "base-1" }) },
      undefined,
    );
  });

  it("writes bases with revision checks and idempotency", async () => {
    const respond = await invokeAppForgeHandler("appforge.bases.put", {
      base: base({ name: "Updated" }),
      expectedRevision: 1,
      idempotencyKey: "write-1",
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      { base: expect.objectContaining({ revision: 2, name: "Updated" }) },
      undefined,
    );

    const replayRespond = await invokeAppForgeHandler("appforge.bases.put", {
      base: base({ name: "Ignored" }),
      expectedRevision: 1,
      idempotencyKey: "write-1",
    });
    expect(replayRespond).toHaveBeenCalledWith(
      true,
      { base: expect.objectContaining({ revision: 2, name: "Updated" }) },
      undefined,
    );
  });

  it("rejects malformed and stale writes", async () => {
    const invalidRespond = await invokeAppForgeHandler("appforge.bases.put", {
      base: { id: "base-1" },
    });
    expect(invalidRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REQUEST", message: "valid base is required" }),
    );

    const staleRespond = await invokeAppForgeHandler("appforge.bases.put", {
      base: base({ name: "Stale" }),
      expectedRevision: 0,
    });
    expect(staleRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        details: expect.objectContaining({ code: "revision_conflict" }),
      }),
    );
  });

  it("deletes bases with revision checks", async () => {
    const respond = await invokeAppForgeHandler("appforge.bases.delete", {
      baseId: "base-1",
      expectedRevision: 1,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      { base: expect.objectContaining({ id: "base-1", revision: 2 }) },
      undefined,
    );

    const getRespond = await invokeAppForgeHandler("appforge.bases.get", { baseId: "base-1" });
    expect(getRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REQUEST", message: "base not found" }),
    );
  });

  it("authorizes AppForge read and write scopes", async () => {
    const readRespond = createResponder();
    await handleGatewayRequest({
      req: {
        type: "req",
        id: "1",
        method: "appforge.bases.list",
        params: {},
      } satisfies RequestFrame,
      client: { connect: operatorConnect(["operator.read"]) },
      context: {} as unknown as GatewayRequestContext,
      isWebchatConnect: () => false,
      respond: readRespond,
    });
    expect(readRespond).toHaveBeenCalledWith(true, expect.any(Object), undefined);

    const writeRespond = createResponder();
    await handleGatewayRequest({
      req: {
        type: "req",
        id: "2",
        method: "appforge.bases.put",
        params: { base: base(), expectedRevision: 1 },
      } satisfies RequestFrame,
      client: { connect: operatorConnect(["operator.read"]) },
      context: {} as unknown as GatewayRequestContext,
      isWebchatConnect: () => false,
      respond: writeRespond,
    });
    expect(writeRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing scope: operator.write" }),
    );
  });
});
