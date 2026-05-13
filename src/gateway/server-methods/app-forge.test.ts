import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppForgeBase, AppForgeRecord, AppForgeTable } from "../../infra/app-forge-model.js";
import type { ConnectParams, RequestFrame } from "../protocol/index.js";
import type { GatewayRequestContext, GatewayRequestHandlerOptions } from "./types.js";
import { createAppForgePermissions } from "../../infra/app-forge-permissions.js";

const { emitAppForgeEventHandlerMock } = vi.hoisted(() => ({
  emitAppForgeEventHandlerMock: vi.fn(),
}));

vi.mock("./workflows.js", () => ({
  workflowsHandlers: {
    "workflows.emitAppForgeEvent": emitAppForgeEventHandlerMock,
  },
}));

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

function permissions(
  overrides: Parameters<typeof createAppForgePermissions>[0] = { creator: "owner-1" },
) {
  return createAppForgePermissions(overrides);
}

async function invokeAppForgeHandler(
  method: string,
  params: Record<string, unknown>,
  overrides: Partial<GatewayRequestHandlerOptions> = {},
) {
  const handler = appForgeHandlers[method];
  if (!handler) {
    throw new Error(`missing handler: ${method}`);
  }
  const respond = createResponder();
  await handler({
    req:
      overrides.req ??
      ({
        type: "req",
        id: `test-${method}`,
        method,
        params,
      } satisfies RequestFrame),
    params,
    client: overrides.client ?? null,
    context: overrides.context ?? ({} as unknown as GatewayRequestContext),
    isWebchatConnect: overrides.isWebchatConnect ?? (() => false),
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
    emitAppForgeEventHandlerMock.mockReset();
    emitAppForgeEventHandlerMock.mockImplementation(async ({ respond }) => {
      respond(true, { ok: true }, undefined);
    });
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

  it("enforces AppForge ACL claims on base writes when multi-user params are provided", async () => {
    const deniedRespond = await invokeAppForgeHandler("appforge.bases.put", {
      base: base({ name: "Denied" }),
      expectedRevision: 1,
      actor: { actorId: "viewer-1", actorType: "operator", sessionKey: "agent:viewer-1:main" },
      permissions: permissions({
        creator: { actorId: "owner-1", actorType: "operator" },
        viewers: ["viewer-1"],
      }),
    });
    expect(deniedRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "unauthorized appforge write",
        audit: expect.objectContaining({
          eventType: "forge.permissions.checked",
          appId: "app-1",
          allowed: false,
          aclRole: "viewer",
        }),
      }),
    );

    const allowedRespond = await invokeAppForgeHandler("appforge.bases.put", {
      base: base({ name: "Allowed" }),
      expectedRevision: 1,
      actor: { actorId: "editor-1", actorType: "operator" },
      permissions: permissions({
        creator: { actorId: "owner-1", actorType: "operator" },
        editors: ["editor-1"],
        viewers: ["viewer-1"],
      }),
    });
    expect(allowedRespond).toHaveBeenCalledWith(
      true,
      { base: expect.objectContaining({ revision: 2, name: "Allowed" }) },
      undefined,
    );
  });

  it("rejects partial AppForge multi-user claims on writes", async () => {
    const respond = await invokeAppForgeHandler("appforge.bases.put", {
      base: base({ name: "Updated" }),
      expectedRevision: 1,
      permissions: permissions(),
    });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "actor and permissions are required together for AppForge multi-user writes",
      }),
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

  it("enforces AppForge ACL claims on deletes when multi-user params are provided", async () => {
    const deniedRespond = await invokeAppForgeHandler("appforge.bases.delete", {
      baseId: "base-1",
      expectedRevision: 1,
      actor: "viewer-1",
      permissions: permissions({
        creator: "owner-1",
        viewers: ["viewer-1"],
      }),
    });
    expect(deniedRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "unauthorized appforge write",
      }),
    );

    const allowedRespond = await invokeAppForgeHandler("appforge.bases.delete", {
      baseId: "base-1",
      expectedRevision: 1,
      actor: "owner-1",
      permissions: permissions(),
    });
    expect(allowedRespond).toHaveBeenCalledWith(
      true,
      { base: expect.objectContaining({ id: "base-1", revision: 2 }) },
      undefined,
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

  it("emits canonical table mutation events for non-webchat gateway writers", async () => {
    await invokeAppForgeHandler(
      "appforge.tables.put",
      {
        baseId: "base-1",
        table: table(),
        expectedBaseRevision: 1,
        expectedTableRevision: 0,
      },
      {
        client: { connect: operatorConnect(["operator.write"]) },
      },
    );

    expect(emitAppForgeEventHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          eventType: "forge.table.created",
          appId: "app-1",
          baseId: "base-1",
          tableId: "table-2",
          payload: {
            baseId: "base-1",
            baseRevision: 2,
            tableId: "table-2",
            tableName: "Approvals",
            tableRevision: 1,
            fieldIds: ["status"],
            recordCount: 0,
            changeType: "table.created",
          },
        },
      }),
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

  it("emits canonical record mutation events for updates and deletes", async () => {
    await invokeAppForgeHandler(
      "appforge.records.put",
      {
        baseId: "base-1",
        tableId: "table-1",
        record: record(),
        expectedBaseRevision: 1,
        expectedTableRevision: 1,
        expectedRecordRevision: 0,
      },
      {
        client: { connect: operatorConnect(["operator.write"]) },
      },
    );
    emitAppForgeEventHandlerMock.mockClear();

    await invokeAppForgeHandler(
      "appforge.records.put",
      {
        baseId: "base-1",
        tableId: "table-1",
        record: record({ revision: 1, values: { status: "Approved" } }),
        expectedBaseRevision: 2,
        expectedTableRevision: 2,
        expectedRecordRevision: 1,
      },
      {
        client: { connect: operatorConnect(["operator.write"]) },
      },
    );

    expect(emitAppForgeEventHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          eventType: "forge.record.updated",
          appId: "app-1",
          baseId: "base-1",
          tableId: "table-1",
          recordId: "record-1",
          payload: {
            baseId: "base-1",
            baseRevision: 3,
            tableId: "table-1",
            tableName: "Reviews",
            tableRevision: 3,
            recordId: "record-1",
            recordRevision: 2,
            values: { status: "Approved" },
            changeType: "record.updated",
          },
        },
      }),
    );

    emitAppForgeEventHandlerMock.mockClear();

    await invokeAppForgeHandler(
      "appforge.records.delete",
      {
        baseId: "base-1",
        tableId: "table-1",
        recordId: "record-1",
        expectedBaseRevision: 3,
        expectedTableRevision: 3,
        expectedRecordRevision: 2,
      },
      {
        client: { connect: operatorConnect(["operator.write"]) },
      },
    );

    expect(emitAppForgeEventHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          eventType: "forge.record.deleted",
          appId: "app-1",
          baseId: "base-1",
          tableId: "table-1",
          recordId: "record-1",
          payload: {
            baseId: "base-1",
            baseRevision: 4,
            tableId: "table-1",
            tableName: "Reviews",
            tableRevision: 4,
            recordId: "record-1",
            recordRevision: 3,
            values: { status: "Approved" },
            changeType: "record.deleted",
          },
        },
      }),
    );
  });

  it("suppresses automatic mutation emission for the webchat dashboard client", async () => {
    await invokeAppForgeHandler(
      "appforge.records.put",
      {
        baseId: "base-1",
        tableId: "table-1",
        record: record(),
        expectedBaseRevision: 1,
        expectedTableRevision: 1,
        expectedRecordRevision: 0,
      },
      {
        client: {
          connect: {
            ...operatorConnect(["operator.write"]),
            client: {
              id: "webchat",
              version: "1.0.0",
              platform: "web",
              mode: "webchat",
            },
          },
        },
      },
    );

    expect(emitAppForgeEventHandlerMock).not.toHaveBeenCalled();
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

  it("lists app-forge templates from the substrate registry", async () => {
    const respond = await invokeAppForgeHandler("appforge.templates.list", {});
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        templates: expect.arrayContaining([
          expect.objectContaining({
            id: "airtable-crm",
            name: "Airtable CRM",
            tables: expect.arrayContaining([expect.objectContaining({ id: "contacts" })]),
          }),
        ]),
      },
      undefined,
    );
  });

  it("fetches a single template by id and returns 400 when missing", async () => {
    const ok = await invokeAppForgeHandler("appforge.templates.get", {
      templateId: "airtable-crm",
    });
    expect(ok).toHaveBeenCalledWith(
      true,
      { template: expect.objectContaining({ id: "airtable-crm" }) },
      undefined,
    );

    const missing = await invokeAppForgeHandler("appforge.templates.get", {
      templateId: "no-such",
    });
    expect(missing).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "template not found" }),
    );

    const empty = await invokeAppForgeHandler("appforge.templates.get", {});
    expect(empty).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "templateId is required" }),
    );
  });

  it("builds a CSV import preview through the gateway", async () => {
    const csv = "Name,Email,Status\nAlice,alice@example.com,New\nBob,bob@example.com,Contacted\n";
    const respond = await invokeAppForgeHandler("appforge.import.preview", {
      csv,
      tableName: "Imported Leads",
      maxRows: 10,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        preview: expect.objectContaining({
          tableName: "Imported Leads",
          columns: expect.arrayContaining([
            expect.objectContaining({ header: "Email", type: "email" }),
            expect.objectContaining({ header: "Status", type: "single_select" }),
          ]),
          rows: expect.any(Array),
          totalRows: 2,
        }),
      },
      undefined,
    );

    const missing = await invokeAppForgeHandler("appforge.import.preview", {});
    expect(missing).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "csv is required" }),
    );
  });

  it("commits CSV rows into an existing base/table in batches and reports per-row outcomes", async () => {
    const csv = [
      "Name,Score",
      "Asset A,1",
      "Asset B,2",
      "Asset C,3",
      ",4", // invalid: empty Name (required)
    ].join("\n");

    const respond = await invokeAppForgeHandler("appforge.import.commit", {
      csv,
      baseId: "base-1",
      tableId: "table-1",
      batchSize: 2,
      recordIdPrefix: "csv",
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        report: expect.objectContaining({
          tableName: "Reviews",
          totalRows: 4,
          attempted: 3,
          committed: 3,
          failed: 0,
          skippedInvalid: 1,
          batchSize: 2,
          batchCount: 2,
        }),
      }),
      undefined,
    );

    // Confirm rows actually landed in the adapter.
    const listed = await invokeAppForgeHandler("appforge.records.list", {
      baseId: "base-1",
      tableId: "table-1",
    });
    const listedCall = listed.mock.calls[0];
    expect(listedCall?.[0]).toBe(true);
    const records = (listedCall?.[1] as { records: Array<{ values: Record<string, unknown> }> })
      .records;
    expect(records).toHaveLength(3);
    expect(records.map((record) => record.values.name)).toEqual(["Asset A", "Asset B", "Asset C"]);
  });

  it("rejects appforge.import.commit when csv/baseId/tableId are missing or base not found", async () => {
    const missingCsv = await invokeAppForgeHandler("appforge.import.commit", {
      baseId: "base-1",
      tableId: "table-1",
    });
    expect(missingCsv).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "csv is required" }),
    );

    const missingIds = await invokeAppForgeHandler("appforge.import.commit", {
      csv: "Name\nAsset A",
    });
    expect(missingIds).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "baseId and tableId are required" }),
    );

    const unknownBase = await invokeAppForgeHandler("appforge.import.commit", {
      csv: "Name\nAsset A",
      baseId: "missing-base",
      tableId: "table-1",
    });
    expect(unknownBase).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "base not found" }),
    );

    const unknownTable = await invokeAppForgeHandler("appforge.import.commit", {
      csv: "Name\nAsset A",
      baseId: "base-1",
      tableId: "no-such",
    });
    expect(unknownTable).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "table not found" }),
    );
  });

  // ------------------------------------------------------------------------
  // Saved views (Phase 4 gap #1). These verify that the durable view CRUD
  // path is wired through the gateway, returns typed payloads, enforces
  // table-level permissions, and rejects malformed shapes.
  // ------------------------------------------------------------------------

  it("registers appforge.views.* methods for discovery", () => {
    expect(listGatewayMethods()).toEqual(
      expect.arrayContaining([
        "appforge.views.list",
        "appforge.views.put",
        "appforge.views.delete",
      ]),
    );
    expect(coreGatewayHandlers["appforge.views.put"]).toBe(appForgeHandlers["appforge.views.put"]);
  });

  it("lists, upserts, and deletes durable saved views through the gateway", async () => {
    // Empty list before any view exists.
    const initial = await invokeAppForgeHandler("appforge.views.list", {
      baseId: "base-1",
      tableId: "table-1",
    });
    expect(initial).toHaveBeenCalledWith(true, { views: [] }, undefined);

    // Create a view.
    const created = await invokeAppForgeHandler("appforge.views.put", {
      baseId: "base-1",
      tableId: "table-1",
      view: {
        id: "view-pipeline",
        name: "Pipeline",
        type: "kanban",
        groupFieldId: "name",
        visibleFieldIds: ["name"],
      },
      idempotencyKey: "gw-view-1",
    });
    expect(created).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        view: expect.objectContaining({
          id: "view-pipeline",
          name: "Pipeline",
          type: "kanban",
        }),
        table: expect.objectContaining({ id: "table-1" }),
        base: expect.objectContaining({ id: "base-1" }),
      }),
      undefined,
    );

    // Replaying the idempotency key returns the same payload.
    const replay = await invokeAppForgeHandler("appforge.views.put", {
      baseId: "base-1",
      tableId: "table-1",
      view: { id: "view-pipeline", name: "Should be ignored", type: "grid" },
      idempotencyKey: "gw-view-1",
    });
    const firstCall = (created as ReturnType<typeof createResponder>).mock.calls[0];
    const replayCall = (replay as ReturnType<typeof createResponder>).mock.calls[0];
    expect(replayCall?.[1]).toEqual(firstCall?.[1]);

    // List now reflects the new view.
    const listed = await invokeAppForgeHandler("appforge.views.list", {
      baseId: "base-1",
      tableId: "table-1",
    });
    expect(listed).toHaveBeenCalledWith(
      true,
      { views: [expect.objectContaining({ id: "view-pipeline", name: "Pipeline" })] },
      undefined,
    );

    // Delete and confirm.
    const deleted = await invokeAppForgeHandler("appforge.views.delete", {
      baseId: "base-1",
      tableId: "table-1",
      viewId: "view-pipeline",
    });
    expect(deleted).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        view: expect.objectContaining({ id: "view-pipeline" }),
      }),
      undefined,
    );
    const afterDelete = await invokeAppForgeHandler("appforge.views.list", {
      baseId: "base-1",
      tableId: "table-1",
    });
    expect(afterDelete).toHaveBeenCalledWith(true, { views: [] }, undefined);
  });

  it("rejects malformed view writes and missing identifiers", async () => {
    const missingTable = await invokeAppForgeHandler("appforge.views.put", {
      baseId: "base-1",
      view: { id: "v", name: "x", type: "grid" },
    });
    expect(missingTable).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "baseId, tableId, and a valid view (id+name+type) are required",
      }),
    );

    const invalidView = await invokeAppForgeHandler("appforge.views.put", {
      baseId: "base-1",
      tableId: "table-1",
      view: { id: "v" /* no name */ },
    });
    expect(invalidView).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "baseId, tableId, and a valid view (id+name+type) are required",
      }),
    );

    const missingViewId = await invokeAppForgeHandler("appforge.views.delete", {
      baseId: "base-1",
      tableId: "table-1",
    });
    expect(missingViewId).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "baseId, tableId, and viewId are required",
      }),
    );
  });

  it("rejects view writes from actors without table-write access", async () => {
    // Same permission model as appforge.tables.put: views inherit table-level
    // permissions, so a non-editor actor must not be able to upsert views.
    const respond = await invokeAppForgeHandler("appforge.views.put", {
      baseId: "base-1",
      tableId: "table-1",
      view: { id: "v-1", name: "Visitor", type: "grid" },
      actor: { actorId: "viewer-1", actorType: "operator", sessionKey: "agent:viewer-1:main" },
      permissions: permissions({ creator: "owner-1" }),
    });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "unauthorized appforge write" }),
    );
  });
});
