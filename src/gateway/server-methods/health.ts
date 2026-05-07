import type { GatewayRequestHandlers } from "./types.js";
import { getStatusSummary } from "../../commands/status.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { HEALTH_REFRESH_INTERVAL_MS } from "../server-constants.js";
import { formatError } from "../server-utils.js";
import { formatForLog } from "../ws-log.js";

export const healthHandlers: GatewayRequestHandlers = {
  health: async ({ respond, context, params }) => {
    const { getHealthCache, refreshHealthSnapshot, logHealth } = context;
    const wantsProbe = params?.probe === true;
    const now = Date.now();
    const cached = getHealthCache();
    if (!wantsProbe && cached && now - cached.ts < HEALTH_REFRESH_INTERVAL_MS) {
      respond(true, cached, undefined, { cached: true });
      void refreshHealthSnapshot({ probe: false }).catch((err) =>
        logHealth.error(`background health refresh failed: ${formatError(err)}`),
      );
      return;
    }
    try {
      const snap = await refreshHealthSnapshot({ probe: wantsProbe });
      respond(true, snap, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  status: async ({ respond, context }) => {
    const status = await getStatusSummary();
    // Augment with channel runtime state so `argent gateway status`
    // (which calls this method) can surface, for example, that
    // Telegram polling is in exponential backoff after a 409 collision
    // — without operators having to also run `argent channels status`.
    const runtime = context.getRuntimeSnapshot();
    const channelRuntime: Record<
      string,
      {
        accountId: string;
        running: boolean;
        state?: string;
        lastError?: string | null;
        nextRetryAt?: number | null;
      }
    > = {};
    for (const [channelId, snapshot] of Object.entries(runtime.channels)) {
      if (!snapshot) {
        continue;
      }
      channelRuntime[channelId] = {
        accountId: snapshot.accountId,
        running: snapshot.running ?? false,
        state: snapshot.state,
        lastError: snapshot.lastError ?? null,
        nextRetryAt: snapshot.nextRetryAt ?? null,
      };
    }
    respond(true, { ...status, channelRuntime }, undefined);
  },
};
