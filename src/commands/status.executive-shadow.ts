import { ZodError } from "zod";
import {
  createExecutiveShadowClient,
  type ExecutiveShadowClientOptions,
  type ExecutiveShadowReadiness,
} from "../infra/executive-shadow-client.js";
import { executiveShadowReadinessFailsClosed } from "../infra/executive-shadow-contract.js";

export type ExecutiveShadowReadinessSummary = {
  status: "fail-closed" | "unsafe" | "unavailable";
  mode: "shadow-readiness";
  promotionStatus: "blocked";
  authoritySwitchAllowed: false;
  failClosed: boolean;
  currentAuthority: ExecutiveShadowReadiness["currentAuthority"];
  persistenceModel: ExecutiveShadowReadiness["persistenceModel"];
  promotionGates: ExecutiveShadowReadiness["promotionGates"];
  gateCounts: {
    blocked: number;
    proven: number;
  };
  nodeResponsibilities: string[];
  rustResponsibilities: string[];
  error: string | null;
};

export type ExecutiveShadowSummary = {
  reachable: boolean;
  kernelStatus: "fail-closed" | "unsafe" | "unavailable";
  productionDaemon: ExecutiveShadowProductionDaemonStatus;
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
  readiness: ExecutiveShadowReadinessSummary | null;
  error: string | null;
};

export type ExecutiveShadowProductionDaemonStatus = {
  binary: "argent-execd";
  status: "fail-closed" | "unsafe" | "unavailable";
  checkedEndpoint: "/v1/executive/readiness";
  readOnly: true;
  authoritySwitchAllowed: false;
  destructiveProcessControlUsed: false;
  productionRolloutAttempted: false;
  detail: string;
};

export async function getExecutiveShadowSummary(
  options: ExecutiveShadowClientOptions = {},
): Promise<ExecutiveShadowSummary> {
  try {
    const client = createExecutiveShadowClient(options);
    const [health, metrics, timeline, readinessResult] = await Promise.all([
      client.getHealth(),
      client.getMetrics(),
      client.getTimeline(5),
      client.getReadiness().then(
        (readiness) => ({ ok: true as const, readiness }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    ]);
    const lastEvent = timeline.recentEvents.at(-1) ?? null;
    const readiness =
      readinessResult.ok === true
        ? buildReadinessSummary(readinessResult.readiness)
        : buildReadinessError(readinessResult.error);
    return {
      reachable: true,
      kernelStatus: readiness.status,
      productionDaemon: buildProductionDaemonStatus(readiness),
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
      readiness,
      error: null,
    };
  } catch (error) {
    return {
      reachable: false,
      kernelStatus: "unavailable",
      productionDaemon: buildProductionDaemonStatus(buildReadinessError(error)),
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
      readiness: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildProductionDaemonStatus(
  readiness: ExecutiveShadowReadinessSummary,
): ExecutiveShadowProductionDaemonStatus {
  const detail =
    readiness.status === "fail-closed"
      ? "argent-execd reachable; readiness is fail-closed and authoritySwitchAllowed=false"
      : readiness.status === "unsafe"
        ? `argent-execd reachable; readiness payload is unsafe${readiness.error ? ` (${readiness.error})` : ""}`
        : `argent-execd readiness unavailable${readiness.error ? ` (${readiness.error})` : ""}`;
  return {
    binary: "argent-execd",
    status: readiness.status,
    checkedEndpoint: "/v1/executive/readiness",
    readOnly: true,
    authoritySwitchAllowed: false,
    destructiveProcessControlUsed: false,
    productionRolloutAttempted: false,
    detail,
  };
}

function buildReadinessSummary(
  readiness: ExecutiveShadowReadiness,
): ExecutiveShadowReadinessSummary {
  const gateCounts = readiness.promotionGates.reduce(
    (acc, gate) => {
      acc[gate.status] += 1;
      return acc;
    },
    { blocked: 0, proven: 0 },
  );
  return {
    status: "fail-closed",
    mode: readiness.mode,
    promotionStatus: readiness.promotionStatus,
    authoritySwitchAllowed: readiness.authoritySwitchAllowed,
    failClosed: executiveShadowReadinessFailsClosed(readiness),
    currentAuthority: readiness.currentAuthority,
    persistenceModel: readiness.persistenceModel,
    promotionGates: readiness.promotionGates,
    gateCounts,
    nodeResponsibilities: readiness.nodeResponsibilities,
    rustResponsibilities: readiness.rustResponsibilities,
    error: null,
  };
}

function buildReadinessError(error: unknown): ExecutiveShadowReadinessSummary {
  const message = error instanceof Error ? error.message : String(error);
  const status = isUnsafeReadinessError(error) ? "unsafe" : "unavailable";
  return {
    status,
    mode: "shadow-readiness",
    promotionStatus: "blocked",
    authoritySwitchAllowed: false,
    failClosed: false,
    currentAuthority: {
      gateway: "unknown",
      scheduler: "unknown",
      workflows: "unknown",
      channels: "unknown",
      sessions: "unknown",
      executive: "unknown",
    },
    persistenceModel: {
      snapshotFile: "unknown",
      journalFile: "unknown",
      restartRecovery: "unknown",
      leaseRecovery: "unknown",
    },
    promotionGates: [],
    gateCounts: { blocked: 0, proven: 0 },
    nodeResponsibilities: [],
    rustResponsibilities: [],
    error: message,
  };
}

function isUnsafeReadinessError(error: unknown): boolean {
  if (error instanceof ZodError) {
    return true;
  }
  if (error instanceof Error && error.name === "ExecutiveShadowClientError") {
    return false;
  }
  return error instanceof Error && error.message.includes("not fail-closed");
}
