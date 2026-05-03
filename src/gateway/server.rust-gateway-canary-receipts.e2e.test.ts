import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRustGatewayReceiptStore } from "../infra/rust-gateway-receipt-store.js";
import { startGatewayServer } from "./server.js";
import { connectGatewayClient, getFreeGatewayPort } from "./test-helpers.e2e.js";

const CANARY_SURFACES: Array<{
  method: "chat.send" | "cron.add" | "workflows.run";
  params: Record<string, unknown>;
  duplicateKey: string;
}> = [
  {
    method: "chat.send",
    params: {
      sessionKey: "main",
      idempotencyKey: "idem-live-daemon-canary",
      message: "local canary",
      token: "super-secret-token-value",
    },
    duplicateKey: "chat.send:idem-live-daemon-canary",
  },
  {
    method: "cron.add",
    params: {
      name: "live-daemon-canary",
      schedule: { kind: "every", everyMs: 60000 },
      payload: { token: "super-secret-token-value" },
    },
    duplicateKey: "cron.add:live-daemon-canary",
  },
  {
    method: "workflows.run",
    params: {
      workflowId: "wf-live-daemon-canary",
      runId: "run-live-daemon-canary",
      input: { token: "super-secret-token-value" },
    },
    duplicateKey: "workflows.run:run-live-daemon-canary",
  },
];

describe("gateway local-daemon Rust canary receipt smoke", () => {
  it(
    "emits, retrieves, and redacts canary receipts without switching authority",
    { timeout: 90_000 },
    async () => {
      const previousEnv = {
        home: process.env.HOME,
        stateDir: process.env.ARGENT_STATE_DIR,
        configPath: process.env.ARGENT_CONFIG_PATH,
        token: process.env.ARGENT_GATEWAY_TOKEN,
        skipChannels: process.env.ARGENT_SKIP_CHANNELS,
        skipGmail: process.env.ARGENT_SKIP_GMAIL_WATCHER,
        skipCron: process.env.ARGENT_SKIP_CRON,
        skipCanvas: process.env.ARGENT_SKIP_CANVAS_HOST,
        skipBrowser: process.env.ARGENT_SKIP_BROWSER_CONTROL_SERVER,
        skipDashboardApi: process.env.ARGENT_SKIP_DASHBOARD_API,
        receiptFlag: process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS,
        receiptStorePath: process.env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH,
      };

      const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "rust-gateway-canary-home-"));
      const storePath = path.join(tempHome, ".argentos", "rust-gateway", "receipts.jsonl");
      const token = `canary-${randomUUID()}`;
      process.env.HOME = tempHome;
      process.env.ARGENT_STATE_DIR = path.join(tempHome, ".argent");
      delete process.env.ARGENT_CONFIG_PATH;
      process.env.ARGENT_GATEWAY_TOKEN = token;
      process.env.ARGENT_SKIP_CHANNELS = "1";
      process.env.ARGENT_SKIP_GMAIL_WATCHER = "1";
      process.env.ARGENT_SKIP_CRON = "1";
      process.env.ARGENT_SKIP_CANVAS_HOST = "1";
      process.env.ARGENT_SKIP_BROWSER_CONTROL_SERVER = "1";
      process.env.ARGENT_SKIP_DASHBOARD_API = "1";
      process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS = "1";
      process.env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH = storePath;

      const port = await getFreeGatewayPort();
      const server = await startGatewayServer(port, {
        bind: "loopback",
        auth: { mode: "token", token },
        controlUiEnabled: false,
      });
      const client = await connectGatewayClient({
        url: `ws://127.0.0.1:${port}`,
        token,
        clientDisplayName: "vitest-rust-canary-smoke",
      });

      try {
        for (const surface of CANARY_SURFACES) {
          await expect(client.request(surface.method, surface.params)).rejects.toThrow(
            "Rust canary denied before mutation",
          );
          await expect(client.request(surface.method, surface.params)).rejects.toThrow(
            "Rust canary denied before mutation",
          );
        }

        const store = createRustGatewayReceiptStore(storePath);
        for (const surface of CANARY_SURFACES) {
          await expect(
            store.list({ duplicateKey: surface.duplicateKey, limit: 2 }),
          ).resolves.toMatchObject([
            {
              surface: surface.method,
              receiptCode: "RUST_CANARY_DENIED",
              nodeAuthority: "live",
              rustAuthority: "shadow-only",
              authoritySwitchAllowed: false,
              mutationBlockedBeforeHandler: true,
            },
            {
              surface: surface.method,
              receiptCode: "RUST_CANARY_DUPLICATE_PREVENTED",
              nodeAuthority: "live",
              rustAuthority: "shadow-only",
              authoritySwitchAllowed: false,
              mutationBlockedBeforeHandler: true,
            },
          ]);
        }

        const raw = await fs.readFile(storePath, "utf8");
        expect(raw).toContain("rust-gateway-receipt-store-v1");
        expect(raw).not.toContain("super-secret-token-value");

        process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS = "0";
        await expect(client.request("health")).resolves.toMatchObject({ ok: true });
      } finally {
        client.stop();
        await server.close({ reason: "rust canary receipt smoke complete" });
        await fs.rm(tempHome, { recursive: true, force: true });
        restoreEnv(previousEnv);
      }
    },
  );
});

function restoreEnv(previousEnv: {
  home: string | undefined;
  stateDir: string | undefined;
  configPath: string | undefined;
  token: string | undefined;
  skipChannels: string | undefined;
  skipGmail: string | undefined;
  skipCron: string | undefined;
  skipCanvas: string | undefined;
  skipBrowser: string | undefined;
  skipDashboardApi: string | undefined;
  receiptFlag: string | undefined;
  receiptStorePath: string | undefined;
}) {
  setOrDeleteEnv("HOME", previousEnv.home);
  setOrDeleteEnv("ARGENT_STATE_DIR", previousEnv.stateDir);
  setOrDeleteEnv("ARGENT_CONFIG_PATH", previousEnv.configPath);
  setOrDeleteEnv("ARGENT_GATEWAY_TOKEN", previousEnv.token);
  setOrDeleteEnv("ARGENT_SKIP_CHANNELS", previousEnv.skipChannels);
  setOrDeleteEnv("ARGENT_SKIP_GMAIL_WATCHER", previousEnv.skipGmail);
  setOrDeleteEnv("ARGENT_SKIP_CRON", previousEnv.skipCron);
  setOrDeleteEnv("ARGENT_SKIP_CANVAS_HOST", previousEnv.skipCanvas);
  setOrDeleteEnv("ARGENT_SKIP_BROWSER_CONTROL_SERVER", previousEnv.skipBrowser);
  setOrDeleteEnv("ARGENT_SKIP_DASHBOARD_API", previousEnv.skipDashboardApi);
  setOrDeleteEnv("ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS", previousEnv.receiptFlag);
  setOrDeleteEnv("ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH", previousEnv.receiptStorePath);
}

function setOrDeleteEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
