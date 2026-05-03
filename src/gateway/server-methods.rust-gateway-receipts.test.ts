import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./server-methods/types.js";
import { createRustGatewayReceiptStore } from "../infra/rust-gateway-receipt-store.js";
import { handleGatewayRequest } from "./server-methods.js";

const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.restoreAllMocks();
});

describe("Rust gateway pre-mutation denial receipts", () => {
  const rollbackFixtures: Array<{
    method: "chat.send" | "cron.add" | "workflows.run";
    scopes: string[];
    params: Record<string, unknown>;
    expectedDuplicateKey: string;
  }> = [
    {
      method: "chat.send",
      scopes: ["operator.write"],
      params: {
        sessionKey: "main",
        idempotencyKey: "idem-1",
        message: "hello",
        token: "super-secret-token-value",
      },
      expectedDuplicateKey: "chat.send:idem-1",
    },
    {
      method: "cron.add",
      scopes: ["operator.admin"],
      params: {
        name: "daily-brief",
        schedule: { kind: "every", everyMs: 60000 },
        payload: { text: "hello", token: "super-secret-token-value" },
      },
      expectedDuplicateKey: "cron.add:daily-brief",
    },
    {
      method: "workflows.run",
      scopes: ["operator.write"],
      params: {
        workflowId: "wf-daily-brief",
        runId: "run-1",
        input: { token: "super-secret-token-value" },
      },
      expectedDuplicateKey: "workflows.run:run-1",
    },
  ];

  it.each(rollbackFixtures)(
    "stores a redacted $method receipt and does not call the mutating handler",
    async (fixture) => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "rust-gateway-handler-receipts-"));
      process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS = "1";
      process.env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH = path.join(dir, "receipts.jsonl");
      const handler = vi.fn();
      const responses: unknown[] = [];

      await handleGatewayRequest({
        req: {
          type: "req",
          id: `${fixture.method}-deny-1`,
          method: fixture.method,
          params: fixture.params,
        },
        client: {
          connect: {
            client: { id: "test-client", version: "1", platform: "test", mode: "local" },
            auth: {},
            role: "operator",
            scopes: fixture.scopes,
          },
        },
        isWebchatConnect: () => false,
        respond: (ok, payload, error) => responses.push({ ok, payload, error }),
        context: {} as GatewayRequestContext,
        extraHandlers: {
          [fixture.method]: handler,
        },
      });

      expect(handler).not.toHaveBeenCalled();
      expect(responses).toEqual([
        {
          ok: false,
          payload: undefined,
          error: expect.objectContaining({
            code: "INVALID_REQUEST",
            message: "Rust canary denied before mutation",
            details: expect.objectContaining({
              receiptCode: "RUST_CANARY_DENIED",
              surface: fixture.method,
              nodeAuthority: "live",
              rustAuthority: "shadow-only",
              authoritySwitchAllowed: false,
              mutationBlockedBeforeHandler: true,
            }),
          }),
        },
      ]);
      const raw = await readFile(process.env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH, "utf8");
      expect(raw).toContain(fixture.method);
      expect(raw).toContain(fixture.expectedDuplicateKey);
      expect(raw).not.toContain("super-secret-token-value");
    },
  );

  it("marks the second matching canary denial as duplicate-prevented before mutation", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rust-gateway-handler-receipts-"));
    process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS = "1";
    process.env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH = path.join(dir, "receipts.jsonl");
    const handler = vi.fn();
    const responses: Array<{ ok: boolean; payload: unknown; error: unknown }> = [];

    for (const id of ["workflow-deny-1", "workflow-deny-2"]) {
      await handleGatewayRequest({
        req: {
          type: "req",
          id,
          method: "workflows.run",
          params: { workflowId: "wf-daily-brief", runId: "run-duplicate" },
        },
        client: {
          connect: {
            client: { id: "test-client", version: "1", platform: "test", mode: "local" },
            auth: {},
            role: "operator",
            scopes: ["operator.write"],
          },
        },
        isWebchatConnect: () => false,
        respond: (ok, payload, error) => responses.push({ ok, payload, error }),
        context: {} as GatewayRequestContext,
        extraHandlers: {
          "workflows.run": handler,
        },
      });
    }

    expect(handler).not.toHaveBeenCalled();
    expect(
      responses.map(
        (response) =>
          (response.error as { details?: { receiptCode?: string } } | undefined)?.details
            ?.receiptCode,
      ),
    ).toEqual(["RUST_CANARY_DENIED", "RUST_CANARY_DUPLICATE_PREVENTED"]);
    const raw = await readFile(process.env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH, "utf8");
    expect(raw.match(/workflows\.run:run-duplicate/g)).toHaveLength(2);
  });

  it("surfaces redacted canary receipts through an operator-read dashboard status method", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rust-gateway-dashboard-receipts-"));
    const storePath = path.join(dir, "receipts.jsonl");
    process.env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH = storePath;
    process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS = "1";
    const store = createRustGatewayReceiptStore(storePath);
    await store.append({
      surface: "chat.send",
      receiptCode: "RUST_CANARY_DENIED",
      sourceFixtureId: "rust-shadow-gate-chat-send",
      requestId: "chat-dashboard-1",
      duplicateKey: "chat.send:dashboard",
      reason: "chat.send denied before mutation token=super-secret-token-value",
      params: { token: "super-secret-token-value" },
    });
    await store.append({
      surface: "chat.send",
      receiptCode: "RUST_CANARY_DENIED",
      sourceFixtureId: "rust-shadow-gate-chat-send",
      requestId: "chat-dashboard-2",
      duplicateKey: "chat.send:dashboard",
      reason: "chat.send denied before mutation token=super-secret-token-value",
      params: { token: "super-secret-token-value" },
    });
    const responses: Array<{ ok: boolean; payload: unknown; error: unknown }> = [];

    await handleGatewayRequest({
      req: {
        type: "req",
        id: "dashboard-status-1",
        method: "rustGateway.canaryReceipts.status",
        params: { limit: 5 },
      },
      client: {
        connect: {
          client: { id: "dashboard-client", version: "1", platform: "test", mode: "local" },
          auth: {},
          role: "operator",
          scopes: ["operator.read"],
        },
      },
      isWebchatConnect: () => false,
      respond: (ok, payload, error) => responses.push({ ok, payload, error }),
      context: {} as GatewayRequestContext,
    });

    expect(responses).toHaveLength(1);
    expect(responses[0]?.ok).toBe(true);
    expect(JSON.stringify(responses[0]?.payload)).not.toContain("super-secret-token-value");
    expect(responses[0]?.payload).toMatchObject({
      status: "ok",
      dashboardVisible: true,
      productionTrafficUsed: false,
      canaryFlagEnabled: true,
      policy: {
        path: storePath,
        containsSecrets: false,
        liveAuthoritySwitchAllowed: false,
      },
      authority: {
        nodeAuthority: "live",
        rustAuthority: "shadow-only",
        authoritySwitchAllowed: false,
      },
      surfaces: expect.arrayContaining([
        {
          surface: "chat.send",
          denied: true,
          duplicatePrevented: true,
          receiptCount: 2,
          latestReceiptCode: "RUST_CANARY_DUPLICATE_PREVENTED",
        },
      ]),
      receipts: expect.arrayContaining([
        expect.objectContaining({
          surface: "chat.send",
          receiptCode: "RUST_CANARY_DENIED",
          tokenMaterialRedacted: true,
          authoritySwitchAllowed: false,
          mutationBlockedBeforeHandler: true,
        }),
        expect.objectContaining({
          surface: "chat.send",
          receiptCode: "RUST_CANARY_DUPLICATE_PREVENTED",
          tokenMaterialRedacted: true,
          authoritySwitchAllowed: false,
          mutationBlockedBeforeHandler: true,
        }),
      ]),
    });
  });

  it("generates local-only installed daemon receipt proof behind explicit confirmation", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rust-gateway-local-proof-"));
    const storePath = path.join(dir, "receipts.jsonl");
    process.env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH = storePath;
    const deniedResponses: Array<{ ok: boolean; error?: { message?: string } }> = [];

    await handleGatewayRequest({
      req: {
        type: "req",
        id: "local-proof-missing-confirm",
        method: "rustGateway.canaryReceipts.generateLocalProof",
        params: { reason: "missing confirm" },
      },
      client: {
        connect: {
          client: { id: "test-client", version: "1", platform: "test", mode: "local" },
          auth: {},
          role: "operator",
          scopes: ["operator.admin"],
        },
      },
      isWebchatConnect: () => false,
      respond: (ok, _payload, error) => deniedResponses.push({ ok, error }),
      context: {} as GatewayRequestContext,
      extraHandlers: {},
    });

    expect(deniedResponses).toMatchObject([
      {
        ok: false,
        error: {
          message: "confirmLocalOnly=true is required for local canary receipt proof generation",
        },
      },
    ]);

    const responses: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
    await handleGatewayRequest({
      req: {
        type: "req",
        id: "local-proof",
        method: "rustGateway.canaryReceipts.generateLocalProof",
        params: {
          confirmLocalOnly: true,
          reason: "installed daemon local proof",
          proofRunId: "proof-run-1",
        },
      },
      client: {
        connect: {
          client: { id: "test-client", version: "1", platform: "test", mode: "local" },
          auth: {},
          role: "operator",
          scopes: ["operator.admin"],
        },
      },
      isWebchatConnect: () => false,
      respond: (ok, payload, error) => responses.push({ ok, payload, error }),
      context: {} as GatewayRequestContext,
      extraHandlers: {},
    });

    expect(responses[0]).toMatchObject({
      ok: true,
      payload: {
        status: "ok",
        proofRunId: "proof-run-1",
        productionTrafficUsed: false,
        authority: {
          nodeAuthority: "live",
          rustAuthority: "shadow-only",
          authoritySwitchAllowed: false,
        },
        generatedSurfaces: ["chat.send", "cron.add", "workflows.run"],
        receiptCount: 6,
      },
    });

    const store = createRustGatewayReceiptStore(storePath);
    for (const fixture of [
      { surface: "chat.send", duplicateKey: "chat.send:idem-proof-run-1" },
      { surface: "cron.add", duplicateKey: "cron.add:cron-proof-run-1" },
      { surface: "workflows.run", duplicateKey: "workflows.run:run-proof-run-1" },
    ] as const) {
      await expect(
        store.list({ duplicateKey: fixture.duplicateKey, limit: 2 }),
      ).resolves.toMatchObject([
        {
          surface: fixture.surface,
          receiptCode: "RUST_CANARY_DENIED",
          tokenMaterialRedacted: true,
          authoritySwitchAllowed: false,
        },
        {
          surface: fixture.surface,
          receiptCode: "RUST_CANARY_DUPLICATE_PREVENTED",
          tokenMaterialRedacted: true,
          authoritySwitchAllowed: false,
        },
      ]);
    }

    const raw = await readFile(storePath, "utf8");
    expect(raw).not.toContain("super-secret-token-value");
  });

  it("leaves Node live handlers untouched by default", async () => {
    const handler = vi.fn(({ respond }) => respond(true, { status: "started" }));
    const responses: unknown[] = [];

    await handleGatewayRequest({
      req: {
        type: "req",
        id: "chat-live-1",
        method: "chat.send",
        params: { sessionKey: "main", idempotencyKey: "idem-1", message: "hello" },
      },
      client: null,
      isWebchatConnect: () => false,
      respond: (ok, payload, error) => responses.push({ ok, payload, error }),
      context: {} as GatewayRequestContext,
      extraHandlers: {
        "chat.send": handler,
      },
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(responses).toEqual([{ ok: true, payload: { status: "started" }, error: undefined }]);
  });

  it("rehearses rollback by recording receipts without partial mutation state", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rust-gateway-rollback-rehearsal-"));
    const storePath = path.join(dir, "receipts.jsonl");
    process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS = "1";
    process.env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH = storePath;
    const mutationLedger = new Map<string, unknown[]>();
    const handlers = Object.fromEntries(
      rollbackFixtures.map((fixture) => [
        fixture.method,
        vi.fn(({ params, respond }) => {
          mutationLedger.set(fixture.method, [
            ...(mutationLedger.get(fixture.method) ?? []),
            params,
          ]);
          respond(true, { status: "node-live-handler-ran" });
        }),
      ]),
    );
    const responses: Array<{ ok: boolean; error?: { details?: { receiptCode?: string } } }> = [];

    for (const fixture of rollbackFixtures) {
      for (const attempt of ["first", "second"]) {
        await handleGatewayRequest({
          req: {
            type: "req",
            id: `${fixture.method}-${attempt}`,
            method: fixture.method,
            params: fixture.params,
          },
          client: {
            connect: {
              client: { id: "test-client", version: "1", platform: "test", mode: "local" },
              auth: {},
              role: "operator",
              scopes: fixture.scopes,
            },
          },
          isWebchatConnect: () => false,
          respond: (ok, payload, error) => responses.push({ ok, error }),
          context: {} as GatewayRequestContext,
          extraHandlers: handlers,
        });
      }
    }

    expect(mutationLedger.size).toBe(0);
    expect(responses.every((response) => !response.ok)).toBe(true);
    const store = createRustGatewayReceiptStore(storePath);
    for (const fixture of rollbackFixtures) {
      await expect(
        store.list({ duplicateKey: fixture.expectedDuplicateKey, limit: 2 }),
      ).resolves.toMatchObject([
        {
          receiptCode: "RUST_CANARY_DENIED",
          mutationBlockedBeforeHandler: true,
          authoritySwitchAllowed: false,
        },
        {
          receiptCode: "RUST_CANARY_DUPLICATE_PREVENTED",
          mutationBlockedBeforeHandler: true,
          authoritySwitchAllowed: false,
        },
      ]);
    }
    const raw = await readFile(storePath, "utf8");
    expect(raw).not.toContain("super-secret-token-value");

    process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS = "0";
    await handleGatewayRequest({
      req: {
        type: "req",
        id: "chat-default-authority",
        method: "chat.send",
        params: rollbackFixtures[0].params,
      },
      client: null,
      isWebchatConnect: () => false,
      respond: () => undefined,
      context: {} as GatewayRequestContext,
      extraHandlers: handlers,
    });

    expect(mutationLedger.get("chat.send")).toHaveLength(1);
  });
});
