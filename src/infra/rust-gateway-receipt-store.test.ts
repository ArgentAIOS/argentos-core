import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRustGatewayReceiptStore,
  resolveRustGatewayReceiptStorePath,
} from "./rust-gateway-receipt-store.js";

describe("rust gateway receipt store", () => {
  it("stores redacted pre-mutation denial receipts outside bus logs", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rust-gateway-receipts-"));
    const storePath = path.join(dir, "receipts.jsonl");
    const store = createRustGatewayReceiptStore(storePath);

    const receipt = await store.append({
      surface: "chat.send",
      receiptCode: "RUST_CANARY_DENIED",
      sourceFixtureId: "rust-shadow-gate-chat-send",
      requestId: "req-1",
      duplicateKey: "chat:idem-1",
      reason: "canary denied before mutation token=super-secret-token-value",
      params: {
        message: "hello",
        token: "super-secret-token-value",
      },
      createdAtMs: 1777777777000,
    });

    expect(receipt).toMatchObject({
      surface: "chat.send",
      receiptCode: "RUST_CANARY_DENIED",
      nodeAuthority: "live",
      rustAuthority: "shadow-only",
      tokenMaterialRedacted: true,
      authoritySwitchAllowed: false,
      mutationBlockedBeforeHandler: true,
      duplicateKey: "chat:idem-1",
    });
    expect(receipt.reason).not.toContain("super-secret-token-value");
    expect(receipt.redactedParams).not.toContain("super-secret-token-value");

    const raw = await readFile(storePath, "utf8");
    expect(raw).toContain("rust-gateway-receipt-store-v1");
    expect(raw).not.toContain("super-secret-token-value");
  });

  it("retrieves receipts by surface and duplicate-prevention key", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rust-gateway-receipts-"));
    const store = createRustGatewayReceiptStore(path.join(dir, "receipts.jsonl"));

    await store.append({
      surface: "cron.add",
      receiptCode: "RUST_CANARY_DENIED",
      sourceFixtureId: "rust-shadow-gate-cron-add",
      duplicateKey: "cron:daily-brief",
      reason: "first denied canary timer",
      createdAtMs: 1777777777000,
    });
    const duplicate = await store.append({
      surface: "cron.add",
      receiptCode: "RUST_CANARY_DENIED",
      sourceFixtureId: "rust-shadow-gate-cron-add",
      duplicateKey: "cron:daily-brief",
      reason: "second denied canary timer",
      createdAtMs: 1777777778000,
    });

    expect(duplicate.receiptCode).toBe("RUST_CANARY_DUPLICATE_PREVENTED");
    await expect(store.hasDuplicate("cron.add", "cron:daily-brief")).resolves.toBe(true);
    await expect(
      store.list({ surface: "cron.add", duplicateKey: "cron:daily-brief" }),
    ).resolves.toHaveLength(2);
    await expect(store.list({ surface: "workflows.run" })).resolves.toEqual([]);
  });

  it("defaults to the operator home state directory", () => {
    expect(resolveRustGatewayReceiptStorePath({ HOME: "/tmp/argent-home" })).toBe(
      "/tmp/argent-home/.argentos/rust-gateway/receipts.jsonl",
    );
    expect(
      resolveRustGatewayReceiptStorePath({
        HOME: "/tmp/argent-home",
        ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH: "/tmp/custom/receipts.jsonl",
      }),
    ).toBe("/tmp/custom/receipts.jsonl");
  });
});
