/**
 * engagement.record — gateway method for recording operator engagement
 * outcomes against kernel surfaces (notifications + artifacts).
 *
 * Phase 3b.4 of HANDOFF-kernel-fitness.md. The dashboard UI integration is
 * deferred (separate feature: rendering kernel surfaces in the dashboard
 * doesn't exist yet — notifications go out via Telegram/Slack/etc, artifacts
 * are markdown files). This handler is the right abstraction regardless:
 *   - Future dashboard ack/dismiss buttons call it.
 *   - Telegram bots with inline-keyboard buttons can post directly to it.
 *   - CLI tooling or external scripts can use it.
 *
 * Per HANDOFF Section 4.1 outcomes:
 *   acted / acked / ignored / system_unavailable
 *
 * Per Section 13 locked decision #2 — `system_unavailable` is tracked
 * separately and not folded into the engagement_rate denominator. This
 * handler accepts it but it's normally only written by the gateway's own
 * shutdown / startup recovery path; external callers should prefer
 * `acted` / `acked` / `ignored`.
 */

import type { GatewayRequestHandlers } from "./types.js";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { resolveConsciousnessKernelPaths } from "../../infra/consciousness-kernel-state.js";
import {
  type EngagementOutcome,
  type EngagementSource,
  recordEngagement,
} from "../../infra/engagement-tracker.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

const ALLOWED_OUTCOMES: ReadonlySet<EngagementOutcome> = new Set([
  "acted",
  "acked",
  "ignored",
  "system_unavailable",
]);

const ALLOWED_SOURCES: ReadonlySet<EngagementSource> = new Set([
  "dashboard_click",
  "artifact_file_open",
  "reply_in_conversation",
  "timeout",
  "gateway_shutdown",
]);

type EngagementRecordParams = {
  surfaceId?: unknown;
  outcome?: unknown;
  source?: unknown;
  /** Optional override; defaults to now() so callers don't have to compute it. */
  ts?: unknown;
  /** Optional override; defaults to the default kernel agent's path. */
  agentId?: unknown;
};

export const engagementHandlers: GatewayRequestHandlers = {
  "engagement.record": ({ params, respond }) => {
    const raw = (params ?? {}) as EngagementRecordParams;

    const surfaceId = typeof raw.surfaceId === "string" ? raw.surfaceId.trim() : "";
    if (!surfaceId) {
      respond(false, errorShape(ErrorCodes.INVALID_REQUEST, "surfaceId required"));
      return;
    }

    const outcomeRaw = typeof raw.outcome === "string" ? raw.outcome.trim() : "";
    if (!ALLOWED_OUTCOMES.has(outcomeRaw as EngagementOutcome)) {
      respond(
        false,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `outcome must be one of: ${[...ALLOWED_OUTCOMES].join(", ")}`,
        ),
      );
      return;
    }
    const outcome = outcomeRaw as EngagementOutcome;

    const sourceRaw = typeof raw.source === "string" ? raw.source.trim() : "";
    if (!ALLOWED_SOURCES.has(sourceRaw as EngagementSource)) {
      respond(
        false,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `source must be one of: ${[...ALLOWED_SOURCES].join(", ")}`,
        ),
      );
      return;
    }
    const source = sourceRaw as EngagementSource;

    const tsValue = typeof raw.ts === "string" && raw.ts.trim() ? raw.ts.trim() : null;
    const ts = tsValue ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(ts))) {
      respond(false, errorShape(ErrorCodes.INVALID_REQUEST, "ts must be ISO timestamp"));
      return;
    }

    let cfg: ReturnType<typeof loadConfig>;
    try {
      cfg = loadConfig();
    } catch (err) {
      respond(false, errorShape(ErrorCodes.UNAVAILABLE, `failed to load config: ${String(err)}`));
      return;
    }

    const explicitAgent = typeof raw.agentId === "string" ? raw.agentId.trim() : "";
    const agentId = explicitAgent || resolveDefaultAgentId(cfg);
    if (!agentId) {
      respond(
        false,
        errorShape(ErrorCodes.INVALID_REQUEST, "agentId required (no default agent configured)"),
      );
      return;
    }

    let ledgerPath: string;
    try {
      ledgerPath = resolveConsciousnessKernelPaths(cfg, agentId).engagementLedgerPath;
    } catch (err) {
      respond(
        false,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to resolve kernel paths: ${String(err)}`),
      );
      return;
    }

    try {
      recordEngagement({ ledgerPath, surfaceId, outcome, source, ts });
    } catch (err) {
      respond(
        false,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to write engagement entry: ${String(err)}`),
      );
      return;
    }

    respond(true, { ok: true, surfaceId, outcome, source, ts, agentId });
  },
};
