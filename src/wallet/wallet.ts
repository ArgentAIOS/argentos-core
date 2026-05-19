/**
 * ArgentOS Agentic Wallet
 *
 * Provides Argent with economic agency via Coinbase AgentKit + X402 protocol.
 * Keys are non-custodial — Argent can initiate payments but cannot access private keys.
 *
 * Install: pnpm add @coinbase/agentkit @coinbase/agentkit-core viem
 */

import { EventEmitter } from "events";

export interface SpendingPolicy {
  /** Max USD per single transaction before human approval required */
  per_transaction_limit_usd: number;
  /** Max USD per 24h rolling window */
  daily_limit_usd: number;
  /** Require explicit human approval for transactions above this amount */
  requires_human_approval_above_usd: number;
  /** Allowlist of recipient addresses/domains. Empty = allow all */
  allowed_recipients: string[];
  /** Categories of spend that are auto-approved */
  auto_approved_categories: SpendCategory[];
}

export type SpendCategory =
  | "api-call"
  | "search"
  | "compute"
  | "storage"
  | "content-access"
  | "tool-use";

export interface WalletTransaction {
  id: string;
  timestamp: Date;
  amount_usd: number;
  recipient: string;
  category: SpendCategory;
  purpose: string;
  status: "pending" | "approved" | "rejected" | "completed" | "failed";
  tx_hash?: string;
}

export interface WalletBalance {
  eth_balance: string;
  usdc_balance: string;
  estimated_usd: number;
  last_updated: Date;
}

export interface AgenticWalletConfig {
  cdp_api_key_name: string;
  cdp_api_key_private_key: string;
  network_id?: "base-mainnet" | "base-sepolia";
  spending_policy: SpendingPolicy;
  /** Called when a transaction needs human approval */
  approval_handler?: (tx: WalletTransaction) => Promise<boolean>;
}

/**
 * Default conservative spending policy for Argent.
 * Start small — build trust, then expand limits.
 */
export const DEFAULT_SPENDING_POLICY: SpendingPolicy = {
  per_transaction_limit_usd: 0.5,
  daily_limit_usd: 5.0,
  requires_human_approval_above_usd: 1.0,
  allowed_recipients: [],
  auto_approved_categories: ["api-call", "search", "content-access"],
};

export class AgenticWallet extends EventEmitter {
  private config: AgenticWalletConfig;
  private dailySpend = 0;
  private dailySpendResetAt: Date;
  private transactions: WalletTransaction[] = [];
  private walletAddress: string | null = null;
  private initialized = false;

  constructor(config: AgenticWalletConfig) {
    super();
    this.config = config;
    this.dailySpendResetAt = this.nextMidnight();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import so AgentKit is optional — ArgentOS works without wallet
      const { AgentKit } = await import("@coinbase/agentkit").catch(() => {
        throw new Error("Coinbase AgentKit not installed. Run: pnpm add @coinbase/agentkit");
      });

      const agentKit = await AgentKit.from({
        cdpApiKeyName: this.config.cdp_api_key_name,
        cdpApiKeyPrivateKey: this.config.cdp_api_key_private_key,
        networkId: this.config.network_id ?? "base-sepolia",
      });

      const address = await agentKit.wallet.getDefaultAddress();
      this.walletAddress = address.getId();
      this.initialized = true;

      this.emit("initialized", { address: this.walletAddress });
      console.log(`[Wallet] Argent wallet ready: ${this.walletAddress}`);
    } catch (err) {
      this.emit("error", err);
      throw err;
    }
  }

  /**
   * Request to spend funds. Enforces spending policy and logs all transactions.
   */
  async requestSpend(params: {
    amount_usd: number;
    recipient: string;
    category: SpendCategory;
    purpose: string;
  }): Promise<{ approved: boolean; tx?: WalletTransaction }> {
    this.resetDailySpendIfNeeded();

    const policy = this.config.spending_policy;
    const tx: WalletTransaction = {
      id: `tx_${Date.now()}`,
      timestamp: new Date(),
      amount_usd: params.amount_usd,
      recipient: params.recipient,
      category: params.category,
      purpose: params.purpose,
      status: "pending",
    };

    // Check per-transaction limit
    if (params.amount_usd > policy.per_transaction_limit_usd) {
      tx.status = "rejected";
      this.transactions.push(tx);
      this.emit("transaction:rejected", tx, "exceeds_per_transaction_limit");
      return { approved: false };
    }

    // Check daily limit
    if (this.dailySpend + params.amount_usd > policy.daily_limit_usd) {
      tx.status = "rejected";
      this.transactions.push(tx);
      this.emit("transaction:rejected", tx, "daily_limit_exceeded");
      return { approved: false };
    }

    // Check recipient allowlist
    if (
      policy.allowed_recipients.length > 0 &&
      !policy.allowed_recipients.includes(params.recipient)
    ) {
      tx.status = "rejected";
      this.transactions.push(tx);
      this.emit("transaction:rejected", tx, "recipient_not_allowed");
      return { approved: false };
    }

    // Check if category is auto-approved
    const isAutoApproved = policy.auto_approved_categories.includes(params.category);
    const needsHumanApproval =
      params.amount_usd >= policy.requires_human_approval_above_usd || !isAutoApproved;

    if (needsHumanApproval && this.config.approval_handler) {
      this.emit("transaction:awaiting_approval", tx);
      const approved = await this.config.approval_handler(tx);
      if (!approved) {
        tx.status = "rejected";
        this.transactions.push(tx);
        this.emit("transaction:rejected", tx, "human_rejected");
        return { approved: false };
      }
    }

    tx.status = "approved";
    this.dailySpend += params.amount_usd;
    this.transactions.push(tx);
    this.emit("transaction:approved", tx);

    return { approved: true, tx };
  }

  /**
   * Pay for an X402-protected resource.
   * Handles the HTTP 402 → payment → retry flow automatically.
   */
  async fetchWithPayment(
    url: string,
    options: RequestInit & { maxPaymentUsd?: number } = {},
  ): Promise<Response> {
    const maxPayment = options.maxPaymentUsd ?? 0.1;

    // First try without payment
    const initial = await fetch(url, options);

    if (initial.status !== 402) {
      return initial;
    }

    // Parse X402 payment requirement
    const paymentRequired = initial.headers.get("X-Payment-Required");
    if (!paymentRequired) {
      throw new Error("Got 402 but no X-Payment-Required header");
    }

    const requirement = JSON.parse(paymentRequired) as {
      amount_usd: number;
      recipient: string;
      protocol: string;
    };

    if (requirement.amount_usd > maxPayment) {
      throw new Error(
        `Payment required ($${requirement.amount_usd}) exceeds max allowed ($${maxPayment})`,
      );
    }

    // Request spend approval
    const { approved, tx } = await this.requestSpend({
      amount_usd: requirement.amount_usd,
      recipient: requirement.recipient,
      category: "content-access",
      purpose: `X402 payment for ${url}`,
    });

    if (!approved) {
      throw new Error(`Payment not approved for ${url}`);
    }

    // TODO: Execute actual on-chain payment via AgentKit
    // const paymentToken = await this.executePayment(requirement);
    const paymentToken = `payment_${tx?.id}_${Date.now()}`;

    // Retry with payment token
    const paid = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers as Record<string, string>),
        "X-Payment-Token": paymentToken,
      },
    });

    if (tx) {
      tx.status = "completed";
      tx.tx_hash = paymentToken;
      this.emit("transaction:completed", tx);
    }

    return paid;
  }

  getBalance(): WalletBalance {
    return {
      eth_balance: "0",
      usdc_balance: "0",
      estimated_usd: 0,
      last_updated: new Date(),
    };
  }

  getDailySpend(): number {
    this.resetDailySpendIfNeeded();
    return this.dailySpend;
  }

  getTransactionHistory(limit = 50): WalletTransaction[] {
    return this.transactions.slice(-limit);
  }

  getWalletAddress(): string | null {
    return this.walletAddress;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private resetDailySpendIfNeeded(): void {
    if (new Date() > this.dailySpendResetAt) {
      this.dailySpend = 0;
      this.dailySpendResetAt = this.nextMidnight();
      this.emit("daily_spend_reset");
    }
  }

  private nextMidnight(): Date {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
