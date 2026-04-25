import {
  createExecutiveShadowClient,
  type ExecutiveShadowClientOptions,
} from "../infra/executive-shadow-client.js";

export type ExecutiveShadowSummary = {
  reachable: boolean;
  activeLane: string | null;
  tickCount: number | null;
  bootCount: number | null;
  journalEventCount: number | null;
  nextTickDueAtMs: number | null;
  laneCounts: {
    idle: number;
    pending: number;
    active: number;
  } | null;
  highestPendingPriority: number | null;
  nextLeaseExpiryAtMs: number | null;
  lastEventSummary: string | null;
  lastEventType: string | null;
  stateDir: string | null;
  error: string | null;
};

export async function getExecutiveShadowSummary(
  options: ExecutiveShadowClientOptions = {},
): Promise<ExecutiveShadowSummary> {
  try {
    const client = createExecutiveShadowClient(options);
    const [health, metrics, timeline] = await Promise.all([
      client.getHealth(),
      client.getMetrics(),
      client.getTimeline(5),
    ]);
    const lastEvent = timeline.recentEvents.at(-1) ?? null;
    return {
      reachable: true,
      activeLane: health.activeLane ?? null,
      tickCount: health.tickCount ?? null,
      bootCount: health.bootCount ?? null,
      journalEventCount: health.journalEventCount ?? null,
      nextTickDueAtMs: health.nextTickDueAtMs ?? null,
      laneCounts: metrics.laneCounts,
      highestPendingPriority: metrics.highestPendingPriority ?? null,
      nextLeaseExpiryAtMs: metrics.nextLeaseExpiryAtMs ?? null,
      lastEventSummary: lastEvent?.summary ?? null,
      lastEventType: lastEvent?.type ?? null,
      stateDir: health.stateDir ?? null,
      error: null,
    };
  } catch (error) {
    return {
      reachable: false,
      activeLane: null,
      tickCount: null,
      bootCount: null,
      journalEventCount: null,
      nextTickDueAtMs: null,
      laneCounts: null,
      highestPendingPriority: null,
      nextLeaseExpiryAtMs: null,
      lastEventSummary: null,
      lastEventType: null,
      stateDir: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
