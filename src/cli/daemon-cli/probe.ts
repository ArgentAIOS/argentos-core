import { callGateway } from "../../gateway/call.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";
import { withProgress } from "../progress.js";

export type GatewayStatusChannelRuntime = {
  accountId: string;
  running: boolean;
  state?: string;
  lastError?: string | null;
  nextRetryAt?: number | null;
};

export async function probeGatewayStatus(opts: {
  url: string;
  token?: string;
  password?: string;
  timeoutMs: number;
  json?: boolean;
  configPath?: string;
}) {
  try {
    const payload = await withProgress(
      {
        label: "Checking gateway status...",
        indeterminate: true,
        enabled: opts.json !== true,
      },
      async () =>
        await callGateway({
          url: opts.url,
          token: opts.token,
          password: opts.password,
          method: "status",
          timeoutMs: opts.timeoutMs,
          clientName: GATEWAY_CLIENT_NAMES.CLI,
          mode: GATEWAY_CLIENT_MODES.CLI,
          ...(opts.configPath ? { configPath: opts.configPath } : {}),
        }),
    );
    // Pull channelRuntime off the status payload so the daemon-cli
    // status renderer can surface per-channel lifecycle state without
    // a second RPC round trip. Defensive parsing — older gateways
    // won't include the field.
    const channelRuntime: Record<string, GatewayStatusChannelRuntime> = {};
    const raw =
      payload && typeof payload === "object"
        ? (payload as { channelRuntime?: unknown }).channelRuntime
        : undefined;
    if (raw && typeof raw === "object") {
      for (const [channelId, value] of Object.entries(raw)) {
        if (!value || typeof value !== "object") {
          continue;
        }
        const v = value as {
          accountId?: unknown;
          running?: unknown;
          state?: unknown;
          lastError?: unknown;
          nextRetryAt?: unknown;
        };
        channelRuntime[channelId] = {
          accountId: typeof v.accountId === "string" ? v.accountId : "default",
          running: v.running === true,
          state: typeof v.state === "string" ? v.state : undefined,
          lastError: typeof v.lastError === "string" ? v.lastError : null,
          nextRetryAt: typeof v.nextRetryAt === "number" ? v.nextRetryAt : null,
        };
      }
    }
    return { ok: true, channelRuntime } as const;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } as const;
  }
}
