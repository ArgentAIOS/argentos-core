import { z } from "zod";

export const EXECUTIVE_SHADOW_DEFAULT_BASE_URL = "http://127.0.0.1:18809";
export const EXECUTIVE_SHADOW_DEFAULT_TIMEOUT_MS = 5_000;

export type ExecutiveLaneStatus = "idle" | "pending" | "active";

export type ExecutiveShadowLaneState = {
  name: string;
  status: ExecutiveLaneStatus;
  priority: number;
  reason: string | null;
  requested_at_ms: number | null;
  started_at_ms: number | null;
  completed_at_ms: number | null;
  lease_expires_at_ms: number | null;
  last_outcome: string | null;
};

export type ExecutiveShadowState = {
  schema_version: number;
  boot_count: number;
  last_seq: number;
  tick_count: number;
  active_lane: string | null;
  last_started_at_ms: number;
  last_recovered_at_ms: number | null;
  last_tick_at_ms: number | null;
  next_tick_due_at_ms: number;
  tick_interval_ms: number;
  default_lease_ms: number;
  lanes: Record<string, ExecutiveShadowLaneState>;
};

export type ExecutiveShadowStateEnvelope = {
  config: {
    bindAddr: string;
    stateDir: string;
  };
  state: ExecutiveShadowState;
};

export type ExecutiveShadowHealth = {
  status: string;
  uptimeSeconds: number;
  bootCount: number;
  tickCount: number;
  activeLane: string | null;
  journalEventCount: number;
  stateDir: string;
  nextTickDueAtMs: number;
};

export type ExecutiveShadowMetrics = {
  activeLane: string | null;
  laneCounts: {
    idle: number;
    pending: number;
    active: number;
  };
  bootCount: number;
  tickCount: number;
  journalEventCount: number;
  nextTickDueAtMs: number;
  lastTickAtMs: number | null;
  lastRecoveredAtMs: number | null;
  nextLeaseExpiryAtMs: number | null;
  highestPendingPriority: number | null;
};

export type ExecutiveShadowJournalRecord = {
  seq: number;
  at_ms: number;
  event:
    | { type: "booted"; boot_count: number }
    | { type: "recovered"; boot_count: number; recovered_at_ms: number }
    | { type: "tick"; tick_count: number }
    | {
        type: "lane_requested";
        lane: string;
        priority: number;
        reason: string | null;
        lease_ms: number;
      }
    | { type: "lane_activated"; lane: string; lease_expires_at_ms: number }
    | { type: "lane_released"; lane: string; outcome: string };
};

export type ExecutiveShadowLaneRequest = {
  lane: string;
  priority?: number;
  reason?: string;
  leaseMs?: number;
};

export type ExecutiveShadowLaneRelease = {
  lane: string;
  outcome?: string;
};

export type ExecutiveShadowTickRequest = {
  count?: number;
};

export type ExecutiveShadowShutdownRequest = {
  reason?: string;
};

export type ExecutiveShadowTimelineEvent = {
  seq: number;
  atMs: number;
  type: "booted" | "recovered" | "tick" | "lane_requested" | "lane_activated" | "lane_released";
  lane: string | null;
  summary: string;
};

export type ExecutiveShadowTimelineSummary = {
  activeLane: string | null;
  journalEventCount: number;
  recentEvents: ExecutiveShadowTimelineEvent[];
  counts: {
    booted: number;
    recovered: number;
    tick: number;
    lane_requested: number;
    lane_activated: number;
    lane_released: number;
  };
  lastRequestAtMs: number | null;
  lastActivationAtMs: number | null;
  lastReleaseAtMs: number | null;
  lastReleaseOutcome: string | null;
};

export const executiveLaneStatusSchema = z.enum(["idle", "pending", "active"]);

export const executiveShadowLaneStateSchema = z.object({
  name: z.string(),
  status: executiveLaneStatusSchema,
  priority: z.number(),
  reason: z.string().nullable(),
  requested_at_ms: z.number().nullable(),
  started_at_ms: z.number().nullable(),
  completed_at_ms: z.number().nullable(),
  lease_expires_at_ms: z.number().nullable(),
  last_outcome: z.string().nullable(),
});

export const executiveShadowStateSchema = z.object({
  schema_version: z.number(),
  boot_count: z.number(),
  last_seq: z.number(),
  tick_count: z.number(),
  active_lane: z.string().nullable(),
  last_started_at_ms: z.number(),
  last_recovered_at_ms: z.number().nullable(),
  last_tick_at_ms: z.number().nullable(),
  next_tick_due_at_ms: z.number(),
  tick_interval_ms: z.number(),
  default_lease_ms: z.number(),
  lanes: z.record(z.string(), executiveShadowLaneStateSchema),
});

export const executiveShadowStateEnvelopeSchema = z.object({
  config: z.object({
    bindAddr: z.string(),
    stateDir: z.string(),
  }),
  state: executiveShadowStateSchema,
});

export const executiveShadowHealthSchema = z.object({
  status: z.string(),
  uptimeSeconds: z.number(),
  bootCount: z.number(),
  tickCount: z.number(),
  activeLane: z.string().nullable(),
  journalEventCount: z.number(),
  stateDir: z.string(),
  nextTickDueAtMs: z.number(),
});

export const executiveShadowMetricsSchema = z.object({
  activeLane: z.string().nullable(),
  laneCounts: z.object({
    idle: z.number(),
    pending: z.number(),
    active: z.number(),
  }),
  bootCount: z.number(),
  tickCount: z.number(),
  journalEventCount: z.number(),
  nextTickDueAtMs: z.number(),
  lastTickAtMs: z.number().nullable(),
  lastRecoveredAtMs: z.number().nullable(),
  nextLeaseExpiryAtMs: z.number().nullable(),
  highestPendingPriority: z.number().nullable(),
});

export const executiveShadowTimelineEventSchema = z.object({
  seq: z.number(),
  atMs: z.number(),
  type: z.enum([
    "booted",
    "recovered",
    "tick",
    "lane_requested",
    "lane_activated",
    "lane_released",
  ]),
  lane: z.string().nullable(),
  summary: z.string(),
});

export const executiveShadowTimelineSummarySchema = z.object({
  activeLane: z.string().nullable(),
  journalEventCount: z.number(),
  recentEvents: z.array(executiveShadowTimelineEventSchema),
  counts: z.object({
    booted: z.number(),
    recovered: z.number(),
    tick: z.number(),
    lane_requested: z.number(),
    lane_activated: z.number(),
    lane_released: z.number(),
  }),
  lastRequestAtMs: z.number().nullable(),
  lastActivationAtMs: z.number().nullable(),
  lastReleaseAtMs: z.number().nullable(),
  lastReleaseOutcome: z.string().nullable(),
});

export const executiveShadowJournalRecordSchema = z.object({
  seq: z.number(),
  at_ms: z.number(),
  event: z.discriminatedUnion("type", [
    z.object({ type: z.literal("booted"), boot_count: z.number() }),
    z.object({
      type: z.literal("recovered"),
      boot_count: z.number(),
      recovered_at_ms: z.number(),
    }),
    z.object({ type: z.literal("tick"), tick_count: z.number() }),
    z.object({
      type: z.literal("lane_requested"),
      lane: z.string(),
      priority: z.number(),
      reason: z.string().nullable(),
      lease_ms: z.number(),
    }),
    z.object({
      type: z.literal("lane_activated"),
      lane: z.string(),
      lease_expires_at_ms: z.number(),
    }),
    z.object({
      type: z.literal("lane_released"),
      lane: z.string(),
      outcome: z.string(),
    }),
  ]),
});

export const executiveShadowJournalSchema = z.array(executiveShadowJournalRecordSchema);
export const executiveShadowOkSchema = z.object({ ok: z.literal(true) });

export const executiveShadowLaneRequestSchema = z.object({
  lane: z.string(),
  priority: z.number().optional(),
  reason: z.string().optional(),
  leaseMs: z.number().optional(),
});

export const executiveShadowLaneReleaseSchema = z.object({
  lane: z.string(),
  outcome: z.string().optional(),
});

export const executiveShadowTickRequestSchema = z.object({
  count: z.number().optional(),
});

export const executiveShadowShutdownRequestSchema = z.object({
  reason: z.string().optional(),
});

export const executiveShadowProtocolJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://argentos.ai/executive-shadow.protocol.schema.json",
  title: "ArgentOS Executive Shadow Protocol",
  description: "HTTP payloads for the rust/argent-execd shadow control surface.",
  definitions: {
    ExecutiveShadowHealth: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string" },
        uptimeSeconds: { type: "number" },
        bootCount: { type: "number" },
        tickCount: { type: "number" },
        activeLane: { type: ["string", "null"] },
        journalEventCount: { type: "number" },
        stateDir: { type: "string" },
        nextTickDueAtMs: { type: "number" },
      },
      required: [
        "status",
        "uptimeSeconds",
        "bootCount",
        "tickCount",
        "activeLane",
        "journalEventCount",
        "stateDir",
        "nextTickDueAtMs",
      ],
    },
    ExecutiveShadowMetrics: {
      type: "object",
      additionalProperties: false,
      properties: {
        activeLane: { type: ["string", "null"] },
        laneCounts: {
          type: "object",
          additionalProperties: false,
          properties: {
            idle: { type: "number" },
            pending: { type: "number" },
            active: { type: "number" },
          },
          required: ["idle", "pending", "active"],
        },
        bootCount: { type: "number" },
        tickCount: { type: "number" },
        journalEventCount: { type: "number" },
        nextTickDueAtMs: { type: "number" },
        lastTickAtMs: { type: ["number", "null"] },
        lastRecoveredAtMs: { type: ["number", "null"] },
        nextLeaseExpiryAtMs: { type: ["number", "null"] },
        highestPendingPriority: { type: ["number", "null"] },
      },
      required: [
        "activeLane",
        "laneCounts",
        "bootCount",
        "tickCount",
        "journalEventCount",
        "nextTickDueAtMs",
        "lastTickAtMs",
        "lastRecoveredAtMs",
        "nextLeaseExpiryAtMs",
        "highestPendingPriority",
      ],
    },
    ExecutiveShadowTimelineSummary: {
      type: "object",
      additionalProperties: false,
      properties: {
        activeLane: { type: ["string", "null"] },
        journalEventCount: { type: "number" },
        recentEvents: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              seq: { type: "number" },
              atMs: { type: "number" },
              type: {
                type: "string",
                enum: [
                  "booted",
                  "recovered",
                  "tick",
                  "lane_requested",
                  "lane_activated",
                  "lane_released",
                ],
              },
              lane: { type: ["string", "null"] },
              summary: { type: "string" },
            },
            required: ["seq", "atMs", "type", "lane", "summary"],
          },
        },
        counts: {
          type: "object",
          additionalProperties: false,
          properties: {
            booted: { type: "number" },
            recovered: { type: "number" },
            tick: { type: "number" },
            lane_requested: { type: "number" },
            lane_activated: { type: "number" },
            lane_released: { type: "number" },
          },
          required: [
            "booted",
            "recovered",
            "tick",
            "lane_requested",
            "lane_activated",
            "lane_released",
          ],
        },
        lastRequestAtMs: { type: ["number", "null"] },
        lastActivationAtMs: { type: ["number", "null"] },
        lastReleaseAtMs: { type: ["number", "null"] },
        lastReleaseOutcome: { type: ["string", "null"] },
      },
      required: [
        "activeLane",
        "journalEventCount",
        "recentEvents",
        "counts",
        "lastRequestAtMs",
        "lastActivationAtMs",
        "lastReleaseAtMs",
        "lastReleaseOutcome",
      ],
    },
    ExecutiveShadowStateEnvelope: {
      type: "object",
      additionalProperties: false,
      properties: {
        config: {
          type: "object",
          additionalProperties: false,
          properties: {
            bindAddr: { type: "string" },
            stateDir: { type: "string" },
          },
          required: ["bindAddr", "stateDir"],
        },
        state: {
          type: "object",
        },
      },
      required: ["config", "state"],
    },
    ExecutiveShadowOk: {
      type: "object",
      additionalProperties: false,
      properties: {
        ok: { type: "boolean", const: true },
      },
      required: ["ok"],
    },
  },
} as const;
