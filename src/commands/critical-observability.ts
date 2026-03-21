export type CriticalAlertSeverity = "critical" | "warning";

export type CriticalServiceName = "postgres" | "gateway-auth-config" | "heartbeat-runner";

export type CriticalServiceStatus = "down" | "invalid_config" | "stale";

export type CriticalServiceSignal = {
  service: CriticalServiceName;
  healthy: boolean;
  severity: CriticalAlertSeverity;
  statusWhenFailing: CriticalServiceStatus;
  messageWhenFailing: string;
  operatorCommand: string;
  detail?: string;
  staleThresholdHours?: number;
  observedAtIso: string;
};

export type CriticalServiceAlert = {
  id: string;
  service: CriticalServiceName;
  severity: CriticalAlertSeverity;
  status: CriticalServiceStatus;
  message: string;
  detail?: string;
  operatorCommand: string;
  lastSeenAt: string;
  lastSuccessAt: string | null;
  staleThresholdHours?: number;
};

export type HeartbeatStaleness = {
  stale: boolean;
  staleHours: number | null;
  staleThresholdHours: number;
};

type ServiceTrackerState = {
  lastSuccessAt: string | null;
};

type TrackerMap = Partial<Record<CriticalServiceName, ServiceTrackerState>>;

const serviceTracker: TrackerMap = {};

function upsertTracker(service: CriticalServiceName): ServiceTrackerState {
  const existing = serviceTracker[service];
  if (existing) return existing;
  const created: ServiceTrackerState = { lastSuccessAt: null };
  serviceTracker[service] = created;
  return created;
}

export function resetCriticalServiceTrackerForTest() {
  for (const key of Object.keys(serviceTracker) as CriticalServiceName[]) {
    delete serviceTracker[key];
  }
}

export function evaluateCriticalServiceSignals(
  signals: CriticalServiceSignal[],
): CriticalServiceAlert[] {
  const alerts: CriticalServiceAlert[] = [];

  for (const signal of signals) {
    const tracked = upsertTracker(signal.service);
    if (signal.healthy) {
      tracked.lastSuccessAt = signal.observedAtIso;
      continue;
    }

    alerts.push({
      id: `${signal.service}:${signal.statusWhenFailing}`,
      service: signal.service,
      severity: signal.severity,
      status: signal.statusWhenFailing,
      message: signal.messageWhenFailing,
      detail: signal.detail,
      operatorCommand: signal.operatorCommand,
      lastSeenAt: signal.observedAtIso,
      lastSuccessAt: tracked.lastSuccessAt,
      staleThresholdHours: signal.staleThresholdHours,
    });
  }

  return alerts;
}

export function detectHeartbeatStaleness(params: {
  lastCycleAtMs: number | null;
  nowMs: number;
  staleThresholdMs?: number;
}): HeartbeatStaleness {
  const thresholdMs = params.staleThresholdMs ?? 24 * 60 * 60 * 1000;
  const staleThresholdHours = Math.floor(thresholdMs / (60 * 60 * 1000));
  if (!params.lastCycleAtMs || params.lastCycleAtMs <= 0) {
    return {
      stale: false,
      staleHours: null,
      staleThresholdHours,
    };
  }
  const staleMs = Math.max(0, params.nowMs - params.lastCycleAtMs);
  return {
    stale: staleMs > thresholdMs,
    staleHours: Math.floor(staleMs / (60 * 60 * 1000)),
    staleThresholdHours,
  };
}
