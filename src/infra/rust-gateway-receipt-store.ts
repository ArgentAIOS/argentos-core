import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactSensitiveText } from "../logging/redact.js";

export type RustGatewayReceiptSurface = "chat.send" | "cron.add" | "workflows.run";

export type RustGatewayReceiptCode =
  | "RUST_CANARY_DENIED"
  | "RUST_CANARY_SCOPE_DENIED"
  | "RUST_CANARY_ROLLBACK_REQUIRED"
  | "RUST_CANARY_DUPLICATE_PREVENTED";

export type RustGatewayPromotionReceipt = {
  auditRecordId: string;
  receiptId: string;
  sourceFixtureId: string;
  surface: RustGatewayReceiptSurface;
  method: RustGatewayReceiptSurface | string;
  receiptCode: RustGatewayReceiptCode;
  nodeAuthority: "live";
  rustAuthority: "shadow-only";
  tokenMaterialRedacted: true;
  authoritySwitchAllowed: false;
  mutationBlockedBeforeHandler: true;
  duplicateKey: string | null;
  requestId: string | null;
  createdAtMs: number;
  reason: string;
  redactedParams: string;
};

export type RustGatewayPromotionReceiptInput = {
  surface: RustGatewayReceiptSurface;
  method?: string;
  receiptCode: RustGatewayReceiptCode;
  sourceFixtureId: string;
  requestId?: string | null;
  duplicateKey?: string | null;
  reason: string;
  params?: unknown;
  createdAtMs?: number;
};

export type RustGatewayReceiptStore = {
  append: (input: RustGatewayPromotionReceiptInput) => Promise<RustGatewayPromotionReceipt>;
  list: (filter?: {
    surface?: RustGatewayReceiptSurface;
    receiptCode?: RustGatewayReceiptCode;
    duplicateKey?: string;
    limit?: number;
  }) => Promise<RustGatewayPromotionReceipt[]>;
  hasDuplicate: (surface: RustGatewayReceiptSurface, duplicateKey: string) => Promise<boolean>;
};

export type RustGatewayReceiptStorePolicy = {
  path: string;
  source: "env" | "operator-home";
  directoryMode: "0700";
  fileMode: "0600";
  containsSecrets: false;
  liveAuthoritySwitchAllowed: false;
};

const RECEIPT_STORE_VERSION = "rust-gateway-receipt-store-v1";

export function resolveRustGatewayReceiptStorePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  const home = env.HOME?.trim() || process.cwd();
  return path.join(home, ".argentos", "rust-gateway", "receipts.jsonl");
}

export function describeRustGatewayReceiptStorePolicy(
  env: NodeJS.ProcessEnv = process.env,
): RustGatewayReceiptStorePolicy {
  return {
    path: resolveRustGatewayReceiptStorePath(env),
    source: env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH?.trim() ? "env" : "operator-home",
    directoryMode: "0700",
    fileMode: "0600",
    containsSecrets: false,
    liveAuthoritySwitchAllowed: false,
  };
}

export function createRustGatewayReceiptStore(
  storePath = resolveRustGatewayReceiptStorePath(),
): RustGatewayReceiptStore {
  return {
    async append(input) {
      const existing = input.duplicateKey ? await readReceipts(storePath) : [];
      const receiptCode =
        input.duplicateKey &&
        existing.some(
          (receipt) =>
            receipt.surface === input.surface && receipt.duplicateKey === input.duplicateKey,
        )
          ? "RUST_CANARY_DUPLICATE_PREVENTED"
          : input.receiptCode;
      const createdAtMs = input.createdAtMs ?? Date.now();
      const receipt: RustGatewayPromotionReceipt = {
        auditRecordId: stableReceiptId(
          "audit",
          input.surface,
          input.requestId,
          input.duplicateKey,
          createdAtMs,
        ),
        receiptId: stableReceiptId(
          "receipt",
          input.surface,
          input.requestId,
          input.duplicateKey,
          createdAtMs,
        ),
        sourceFixtureId: input.sourceFixtureId,
        surface: input.surface,
        method: input.method ?? input.surface,
        receiptCode,
        nodeAuthority: "live",
        rustAuthority: "shadow-only",
        tokenMaterialRedacted: true,
        authoritySwitchAllowed: false,
        mutationBlockedBeforeHandler: true,
        duplicateKey: input.duplicateKey ?? null,
        requestId: input.requestId ?? null,
        createdAtMs,
        reason: redactSensitiveText(input.reason),
        redactedParams: redactSensitiveText(JSON.stringify(input.params ?? {})),
      };
      await appendReceipt(storePath, receipt);
      return receipt;
    },
    async list(filter = {}) {
      let receipts = await readReceipts(storePath);
      if (filter.surface) {
        receipts = receipts.filter((receipt) => receipt.surface === filter.surface);
      }
      if (filter.receiptCode) {
        receipts = receipts.filter((receipt) => receipt.receiptCode === filter.receiptCode);
      }
      if (filter.duplicateKey) {
        receipts = receipts.filter((receipt) => receipt.duplicateKey === filter.duplicateKey);
      }
      const limit = Math.max(0, filter.limit ?? receipts.length);
      return receipts.slice(-limit);
    },
    async hasDuplicate(surface, duplicateKey) {
      return (await this.list({ surface, duplicateKey, limit: 1 })).length > 0;
    },
  };
}

function stableReceiptId(
  prefix: "audit" | "receipt",
  surface: RustGatewayReceiptSurface,
  requestId: string | null | undefined,
  duplicateKey: string | null | undefined,
  createdAtMs: number,
): string {
  const safeSurface = surface.replace(/[^a-z0-9]+/gi, "-");
  const basis = requestId || duplicateKey || "no-key";
  const safeBasis = basis.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 48);
  return `${prefix}-${safeSurface}-${safeBasis}-${createdAtMs}`;
}

async function appendReceipt(
  storePath: string,
  receipt: RustGatewayPromotionReceipt,
): Promise<void> {
  await mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const existing = await readTextIfExists(storePath);
  const line = JSON.stringify({ version: RECEIPT_STORE_VERSION, receipt });
  await writeFile(storePath, existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`, {
    mode: 0o600,
  });
}

async function readReceipts(storePath: string): Promise<RustGatewayPromotionReceipt[]> {
  const raw = await readTextIfExists(storePath);
  if (!raw.trim()) {
    return [];
  }
  const receipts: RustGatewayPromotionReceipt[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const parsed = JSON.parse(line) as {
      version?: string;
      receipt?: RustGatewayPromotionReceipt;
    };
    if (parsed.version === RECEIPT_STORE_VERSION && parsed.receipt) {
      receipts.push(parsed.receipt);
    }
  }
  return receipts;
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
