import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppForgeBase, AppForgeRecord, AppForgeTable } from "../../infra/app-forge-model.js";
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

function table(overrides: Partial<AppForgeTable> = {}): AppForgeTable {
  return {
    id: "table-2",
    name: "Approvals",
    revision: 1,
    fields: [{ id: "status", name: "Status", type: "text" }],
    records: [],
    ...overrides,
  };
}

function record(overrides: Partial<AppForgeRecord> = {}): AppForgeRecord {
  return {
    id: "record-1",
    revision: 1,
    values: { status: "Ready" },
    createdAt: "2026-04-25T21:00:00.000Z",
    updatedAt: "2026-04-25T21:00:00.000Z",
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
    expect(listGatewayMethods()).toEqual(
      expect.arrayContaining([
        "appforge.bases.list",
        "appforge.tables.list",
        "appforge.records.put",
      ]),
    );
    expect(coreGatewayHandlers["appforge.bases.put"]).toBe(appForgeHandlers["appforge.bases.put"]);
    expect(coreGatewayHandlers["appforge.records.put"]).toBe(
      appForgeHandlers["appforge.records.put"],
    );
  });

  it("lists and fetches bases", async () => {
    const respond = await invokeAppForgeHandler("appforge.bases.list", { appId: "app-1" });
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        bases: [
          expect.objectContaining({
            id: "base-1",
            name: "Campaign Review",
            appId: "app-1",
            revision: 1,
            description: "Review workspace",
            activeTableId: "table-1",
            updatedAt: "2026-04-25T20:00:00.000Z",
            tableCount: 1,
          }),
        ],
      },
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

  it("creates a base when expectedRevision is 0", async () => {
    const created = base({ id: "base-new", appId: "app-new", revision: 0 });
    const respond = await invokeAppForgeHandler("appforge.bases.put", {
      base: created,
      expectedRevision: 0,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      { base: expect.objectContaining({ id: "base-new", revision: 1 }) },
      undefined,
    );

    const getRespond = await invokeAppForgeHandler("appforge.bases.get", { baseId: "base-new" });
    expect(getRespond).toHaveBeenCalledWith(
      true,
      { base: expect.objectContaining({ id: "base-new", appId: "app-new", revision: 1 }) },
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

  it("returns revision conflict details when deleting a missing base", async () => {
    const respond = await invokeAppForgeHandler("appforge.bases.delete", {
      baseId: "missing",
      expectedRevision: 3,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "Base missing does not exist.",
        details: expect.objectContaining({
          code: "revision_conflict",
          expectedRevision: 3,
          actualRevision: 0,
        }),
      }),
    );
  });

  it("lists, fetches, writes, and deletes tables", async () => {
    const listRespond = await invokeAppForgeHandler("appforge.tables.list", { baseId: "base-1" });
    expect(listRespond).toHaveBeenCalledWith(
      true,
      {
        tables: [
          expect.objectContaining({
            id: "table-1",
            name: "Reviews",
            fields: [{ id: "name", name: "Name", type: "text", required: true }],
            revision: 1,
            fieldCount: 1,
            recordCount: 0,
          }),
        ],
      },
      undefined,
    );

    const putRespond = await invokeAppForgeHandler("appforge.tables.put", {
      baseId: "base-1",
      table: table(),
      expectedBaseRevision: 1,
      expectedTableRevision: 0,
      idempotencyKey: "table-write-1",
    });
    expect(putRespond).toHaveBeenCalledWith(
      true,
      {
        base: expect.objectContaining({ revision: 2 }),
        table: expect.objectContaining({ id: "table-2", revision: 1 }),
      },
      undefined,
    );

    const replayRespond = await invokeAppForgeHandler("appforge.tables.put", {
      baseId: "base-1",
      table: table({ name: "Ignored" }),
      expectedBaseRevision: 1,
      expectedTableRevision: 0,
      idempotencyKey: "table-write-1",
    });
    expect(replayRespond).toHaveBeenCalledWith(
      true,
      {
        base: expect.objectContaining({ revision: 2 }),
        table: expect.objectContaining({ id: "table-2", name: "Approvals" }),
      },
      undefined,
    );

    const getRespond = await invokeAppForgeHandler("appforge.tables.get", {
      baseId: "base-1",
      tableId: "table-2",
    });
    expect(getRespond).toHaveBeenCalledWith(
      true,
      { table: expect.objectContaining({ id: "table-2" }) },
      undefined,
    );

    const deleteRespond = await invokeAppForgeHandler("appforge.tables.delete", {
      baseId: "base-1",
      tableId: "table-2",
      expectedBaseRevision: 2,
      expectedTableRevision: 1,
    });
    expect(deleteRespond).toHaveBeenCalledWith(
      true,
      {
        base: expect.objectContaining({ revision: 3 }),
        table: expect.objectContaining({ id: "table-2", revision: 2 }),
      },
      undefined,
    );
  });

  it("exposes durable store-backed base and table picker data after writes", async () => {
    const baseWrite = await invokeAppForgeHandler("appforge.bases.put", {
      base: base({
        id: "base-picker",
        appId: "app-picker",
        name: "Workflow Picker Base",
        description: "Base selected by a workflow binding wizard",
        activeTableId: "table-picker",
        revision: 0,
        tables: [
          {
            id: "table-picker",
            name: "Picker Table",
            revision: 0,
            fields: [
              { id: "title", name: "Title", type: "text", required: true },
              {
                id: "status",
                name: "Status",
                type: "single_select",
                options: ["Open", "Closed"],
              },
            ],
            records: [record({ id: "record-picker", values: { title: "Asset", status: "Open" } })],
          },
        ],
      }),
      expectedRevision: 0,
    });
    expect(baseWrite).toHaveBeenCalledWith(
      true,
      { base: expect.objectContaining({ id: "base-picker", revision: 1 }) },
      undefined,
    );

    const basesRespond = await invokeAppForgeHandler("appforge.bases.list", {
      appId: "app-picker",
    });
    expect(basesRespond).toHaveBeenCalledWith(
      true,
      {
        bases: [
          expect.objectContaining({
            id: "base-picker",
            name: "Workflow Picker Base",
            appId: "app-picker",
            revision: 1,
            description: "Base selected by a workflow binding wizard",
            activeTableId: "table-picker",
            tableCount: 1,
          }),
        ],
      },
      undefined,
    );

    const tablesRespond = await invokeAppForgeHandler("appforge.tables.list", {
      baseId: "base-picker",
    });
    expect(tablesRespond).toHaveBeenCalledWith(
      true,
      {
        tables: [
          expect.objectContaining({
            id: "table-picker",
            name: "Picker Table",
            fields: [
              expect.objectContaining({ id: "title", name: "Title", type: "text", required: true }),
              expect.objectContaining({
                id: "status",
                name: "Status",
                type: "single_select",
                options: ["Open", "Closed"],
              }),
            ],
            revision: 0,
            fieldCount: 2,
            recordCount: 1,
          }),
        ],
      },
      undefined,
    );
  });

  it("lists, fetches, writes, and deletes records", async () => {
    const putRespond = await invokeAppForgeHandler("appforge.records.put", {
      baseId: "base-1",
      tableId: "table-1",
      record: record(),
      expectedBaseRevision: 1,
      expectedTableRevision: 1,
      expectedRecordRevision: 0,
      idempotencyKey: "record-write-1",
    });
    expect(putRespond).toHaveBeenCalledWith(
      true,
      {
        base: expect.objectContaining({ revision: 2 }),
        table: expect.objectContaining({ id: "table-1", revision: 2 }),
        record: expect.objectContaining({ id: "record-1", revision: 1 }),
      },
      undefined,
    );

    const replayRespond = await invokeAppForgeHandler("appforge.records.put", {
      baseId: "base-1",
      tableId: "table-1",
      record: record({ values: { status: "Ignored" } }),
      expectedBaseRevision: 1,
      expectedTableRevision: 1,
      expectedRecordRevision: 0,
      idempotencyKey: "record-write-1",
    });
    expect(replayRespond).toHaveBeenCalledWith(
      true,
      {
        base: expect.objectContaining({ revision: 2 }),
        table: expect.objectContaining({ id: "table-1", revision: 2 }),
        record: expect.objectContaining({ id: "record-1", values: { status: "Ready" } }),
      },
      undefined,
    );

    const listRespond = await invokeAppForgeHandler("appforge.records.list", {
      baseId: "base-1",
      tableId: "table-1",
    });
    expect(listRespond).toHaveBeenCalledWith(
      true,
      { records: [expect.objectContaining({ id: "record-1" })] },
      undefined,
    );

    const getRespond = await invokeAppForgeHandler("appforge.records.get", {
      baseId: "base-1",
      tableId: "table-1",
      recordId: "record-1",
    });
    expect(getRespond).toHaveBeenCalledWith(
      true,
      { record: expect.objectContaining({ id: "record-1" }) },
      undefined,
    );

    const deleteRespond = await invokeAppForgeHandler("appforge.records.delete", {
      baseId: "base-1",
      tableId: "table-1",
      recordId: "record-1",
      expectedBaseRevision: 2,
      expectedTableRevision: 2,
      expectedRecordRevision: 1,
    });
    expect(deleteRespond).toHaveBeenCalledWith(
      true,
      {
        base: expect.objectContaining({ revision: 3 }),
        table: expect.objectContaining({ revision: 3 }),
        record: expect.objectContaining({ id: "record-1", revision: 2 }),
      },
      undefined,
    );
  });

  it("rejects malformed table and record writes", async () => {
    const tableRespond = await invokeAppForgeHandler("appforge.tables.put", {
      baseId: "base-1",
      table: { id: "table-1" },
    });
    expect(tableRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "baseId and valid table are required",
      }),
    );

    const recordRespond = await invokeAppForgeHandler("appforge.records.put", {
      baseId: "base-1",
      tableId: "table-1",
      record: { id: "record-1" },
    });
    expect(recordRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "baseId, tableId, and valid record are required",
      }),
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
        method: "appforge.records.put",
        params: {
          baseId: "base-1",
          tableId: "table-1",
          record: record(),
          expectedBaseRevision: 1,
          expectedTableRevision: 1,
          expectedRecordRevision: 0,
        },
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
