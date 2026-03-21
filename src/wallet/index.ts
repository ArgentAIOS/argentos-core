/**
 * ArgentOS Wallet - Singleton manager and environment-based config loader
 */

import { AgenticWallet, DEFAULT_SPENDING_POLICY, type AgenticWalletConfig } from "./wallet.js";

let _wallet: AgenticWallet | null = null;

/**
 * Load wallet config from environment variables.
 *
 * Required env vars:
 *   CDP_API_KEY_NAME
 *   CDP_API_KEY_PRIVATE_KEY
 *
 * Optional:
 *   WALLET_NETWORK=base-mainnet|base-sepolia (default: base-sepolia)
 *   WALLET_DAILY_LIMIT_USD (default: 5)
 *   WALLET_PER_TX_LIMIT_USD (default: 0.50)
 *   WALLET_APPROVAL_THRESHOLD_USD (default: 1.00)
 */
export function loadWalletFromEnv(
  approvalHandler?: AgenticWalletConfig["approval_handler"],
): AgenticWallet | null {
  const keyName = process.env.CDP_API_KEY_NAME;
  const privateKey = process.env.CDP_API_KEY_PRIVATE_KEY;

  if (!keyName || !privateKey) {
    console.log(
      "[Wallet] CDP credentials not set — wallet disabled. Set CDP_API_KEY_NAME and CDP_API_KEY_PRIVATE_KEY to enable.",
    );
    return null;
  }

  const network = (process.env.WALLET_NETWORK ?? "base-sepolia") as "base-mainnet" | "base-sepolia";

  const wallet = new AgenticWallet({
    cdp_api_key_name: keyName,
    cdp_api_key_private_key: privateKey,
    network_id: network,
    spending_policy: {
      ...DEFAULT_SPENDING_POLICY,
      daily_limit_usd: parseFloat(process.env.WALLET_DAILY_LIMIT_USD ?? "5"),
      per_transaction_limit_usd: parseFloat(process.env.WALLET_PER_TX_LIMIT_USD ?? "0.50"),
      requires_human_approval_above_usd: parseFloat(
        process.env.WALLET_APPROVAL_THRESHOLD_USD ?? "1.00",
      ),
    },
    approval_handler: approvalHandler,
  });

  wallet.on("transaction:approved", (tx) => {
    console.log(`[Wallet] ✅ Approved: $${tx.amount_usd} to ${tx.recipient} — ${tx.purpose}`);
  });

  wallet.on("transaction:rejected", (tx, reason) => {
    console.log(`[Wallet] ❌ Rejected: $${tx.amount_usd} — ${reason}`);
  });

  wallet.on("transaction:completed", (tx) => {
    console.log(`[Wallet] 💸 Completed: ${tx.tx_hash}`);
  });

  return wallet;
}

/**
 * Get the global singleton wallet instance.
 * Call initWallet() first during app startup.
 */
export function getWallet(): AgenticWallet | null {
  return _wallet;
}

/**
 * Initialize the global wallet singleton.
 * Safe to call at startup — returns null if CDP keys aren't configured.
 */
export async function initWallet(
  approvalHandler?: AgenticWalletConfig["approval_handler"],
): Promise<AgenticWallet | null> {
  _wallet = loadWalletFromEnv(approvalHandler);
  if (_wallet) {
    await _wallet.initialize().catch((err) => {
      console.error("[Wallet] Failed to initialize:", err.message);
      _wallet = null;
    });
  }
  return _wallet;
}

export * from "./wallet.js";
