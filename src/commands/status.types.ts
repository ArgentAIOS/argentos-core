import type { ChannelId } from "../channels/plugins/types.js";

export type SessionStatus = {
  agentId?: string;
  key: string;
  kind: "direct" | "group" | "global" | "unknown";
  sessionId?: string;
  updatedAt: number | null;
  age: number | null;
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens: number | null;
  remainingTokens: number | null;
  percentUsed: number | null;
  model: string | null;
  contextTokens: number | null;
  flags: string[];
};

export type HeartbeatStatus = {
  agentId: string;
  enabled: boolean;
  every: string;
  everyMs: number | null;
};

export type ExecutiveShadowStatus = {
  reachable: boolean;
  activeLane: string | null;
  tickCount: number | null;
  bootCount: number | null;
  journalEventCount: number | null;
  nextTickDueAtMs: number | null;
  laneCounts: { idle: number; pending: number; active: number } | null;
  highestPendingPriority: number | null;
  nextLeaseExpiryAtMs: number | null;
  lastEventSummary: string | null;
  lastEventType: string | null;
  stateDir: string | null;
  error: string | null;
};

export type ExecutiveShadowKernelInspectionStatus = {
  kernelAvailable: boolean;
  executiveReachable: boolean;
  comparable: boolean;
  laneMatch: boolean | null;
  kernelActiveLane: string | null;
  executiveActiveLane: string | null;
  kernelFocus: string | null;
  executiveLastEventSummary: string | null;
  notes: string[];
};

export type RustGatewayShadowStatus = {
  reachable: boolean;
  status: string | null;
  version: string | null;
  uptimeSeconds: number | null;
  component: string | null;
  mode: string | null;
  protocolVersion: number | null;
  liveAuthority: string | null;
  gatewayAuthority: string | null;
  promotionReady: boolean | null;
  readinessReason: string | null;
  statePersistence: string | null;
  baseUrl: string;
  error: string | null;
};

export type RustGatewayParityReportStatus = {
  path: string;
  freshness: "missing" | "fresh" | "stale" | "invalid";
  generatedAtMs: number | null;
  ageMs: number | null;
  totals: {
    passed: number;
    failed: number;
    skipped: number;
  } | null;
  promotionReady: boolean | null;
  blockers: number | null;
  warnings: number | null;
  error: string | null;
};

export type RustGatewaySchedulerAuthorityStatus = {
  schedulerAuthority: "node";
  rustSchedulerAuthority: "shadow-only";
  authorityRecord: "missing";
  cronEnabled: boolean;
  cronStorePath: string;
  cronJobs: number;
  enabledCronJobs: number;
  workflowRunCronJobs: number;
  nextWakeAtMs: number | null;
  notes: string[];
};

export type StatusSummary = {
  shadowReplay?: {
    enabled: boolean;
    connected: boolean;
    queued: number;
    replayed: number;
    replayErrors: number;
  };
  linkChannel?: {
    id: ChannelId;
    label: string;
    linked: boolean;
    authAgeMs: number | null;
  };
  heartbeat: {
    defaultAgentId: string;
    agents: HeartbeatStatus[];
  };
  rustGatewayShadow?: RustGatewayShadowStatus;
  rustGatewayParityReport?: RustGatewayParityReportStatus;
  rustGatewaySchedulerAuthority?: RustGatewaySchedulerAuthorityStatus;
  executiveShadow?: ExecutiveShadowStatus;
  executiveShadowKernelInspection?: ExecutiveShadowKernelInspectionStatus;
  channelSummary: string[];
  queuedSystemEvents: string[];
  sessions: {
    paths: string[];
    count: number;
    defaults: { model: string | null; contextTokens: number | null };
    recent: SessionStatus[];
    byAgent: Array<{
      agentId: string;
      path: string;
      count: number;
      recent: SessionStatus[];
    }>;
  };
};
