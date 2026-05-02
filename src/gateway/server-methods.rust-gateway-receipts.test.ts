import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./server-methods/types.js";
import { handleGatewayRequest } from "./server-methods.js";

const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.restoreAllMocks();
});

describe("Rust gateway pre-mutation denial receipts", () => {
  it.each([
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
  ])(
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
});
