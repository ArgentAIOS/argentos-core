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

export type ExecutiveShadowReadiness = {
  mode: "shadow-readiness";
  authoritySwitchAllowed: false;
  promotionStatus: "blocked";
  kernelShadow: {
    reachable: boolean;
    status: "fail-closed";
    authority: "shadow";
    wakefulness: "active" | "attentive" | "watching";
    agenda: {
      activeLane: string | null;
      pendingLanes: string[];
      focus: string | null;
    };
    focus: string | null;
    ticks: {
      count: number;
      lastTickAtMs: number | null;
      nextTickDueAtMs: number;
      intervalMs: number;
    };
    reflectionQueue: {
      status: "shadow-only";
      depth: number;
      items: Array<{
        lane: string;
        priority: number;
        reason: string | null;
        requestedAtMs: number | null;
      }>;
    };
    persistedAt: number;
    restartRecovery: {
      model: "snapshot-plus-journal-replay";
      status: "booted" | "recovered";
      bootCount: number;
      lastRecoveredAtMs: number | null;
      journalEventCount: number;
      snapshotFile: string;
      journalFile: string;
    };
  };
  currentAuthority: {
    gateway: string;
    scheduler: string;
    workflows: string;
    channels: string;
    sessions: string;
    executive: string;
  };
  nodeResponsibilities: string[];
  rustResponsibilities: string[];
  persistenceModel: {
    snapshotFile: string;
    journalFile: string;
    restartRecovery: string;
    leaseRecovery: string;
  };
  promotionGates: Array<{
    id: string;
    status: "blocked" | "proven";
    owner: string;
    requiredProof: string[];
  }>;
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

export const executiveShadowReadinessSchema = z
  .object({
    mode: z.literal("shadow-readiness"),
    authoritySwitchAllowed: z.literal(false),
    promotionStatus: z.literal("blocked"),
    kernelShadow: z
      .object({
        reachable: z.boolean(),
        status: z.literal("fail-closed"),
        authority: z.literal("shadow"),
        wakefulness: z.enum(["active", "attentive", "watching"]),
        agenda: z.object({
          activeLane: z.string().nullable(),
          pendingLanes: z.array(z.string()),
          focus: z.string().nullable(),
        }),
        focus: z.string().nullable(),
        ticks: z.object({
          count: z.number(),
          lastTickAtMs: z.number().nullable(),
          nextTickDueAtMs: z.number(),
          intervalMs: z.number(),
        }),
        reflectionQueue: z.object({
          status: z.literal("shadow-only"),
          depth: z.number(),
          items: z.array(
            z.object({
              lane: z.string(),
              priority: z.number(),
              reason: z.string().nullable(),
              requestedAtMs: z.number().nullable(),
            }),
          ),
        }),
        persistedAt: z.number(),
        restartRecovery: z
          .object({
            model: z.literal("snapshot-plus-journal-replay"),
            status: z.enum(["booted", "recovered"]),
            bootCount: z.number(),
            lastRecoveredAtMs: z.number().nullable(),
            journalEventCount: z.number(),
            snapshotFile: z.string(),
            journalFile: z.string(),
          })
          .strict(),
      })
      .strict(),
    currentAuthority: z
      .object({
        gateway: z.string(),
        scheduler: z.string(),
        workflows: z.string(),
        channels: z.string(),
        sessions: z.string(),
        executive: z.string(),
      })
      .strict(),
    nodeResponsibilities: z.array(z.string()),
    rustResponsibilities: z.array(z.string()),
    persistenceModel: z
      .object({
        snapshotFile: z.string(),
        journalFile: z.string(),
        restartRecovery: z.string(),
        leaseRecovery: z.string(),
      })
      .strict(),
    promotionGates: z.array(
      z
        .object({
          id: z.string(),
          status: z.enum(["blocked", "proven"]),
          owner: z.string(),
          requiredProof: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

export function executiveShadowReadinessFailsClosed(readiness: ExecutiveShadowReadiness): boolean {
  return (
    readiness.authoritySwitchAllowed === false &&
    readiness.promotionStatus === "blocked" &&
    readiness.currentAuthority.gateway === "node" &&
    readiness.currentAuthority.scheduler === "node" &&
    readiness.currentAuthority.workflows === "node" &&
    readiness.currentAuthority.channels === "node" &&
    readiness.currentAuthority.sessions === "node" &&
    readiness.currentAuthority.executive === "shadow-only" &&
    readiness.kernelShadow.reachable === true &&
    readiness.kernelShadow.status === "fail-closed" &&
    readiness.kernelShadow.authority === "shadow" &&
    readiness.kernelShadow.reflectionQueue.status === "shadow-only" &&
    readiness.kernelShadow.restartRecovery.model === "snapshot-plus-journal-replay" &&
    executiveShadowReadinessSemanticIssues(readiness).length === 0 &&
    readiness.promotionGates.length > 0 &&
    readiness.promotionGates.every((gate) => gate.status === "blocked" || gate.status === "proven")
  );
}

export function executiveShadowReadinessSemanticIssues(
  readiness: ExecutiveShadowReadiness,
): string[] {
  const issues: string[] = [];
  const shadow = readiness.kernelShadow;
  const pendingLanes = shadow.reflectionQueue.items.map((item) => item.lane);

  if (shadow.agenda.pendingLanes.length !== pendingLanes.length) {
    issues.push("kernelShadow agenda pending lane count must match reflectionQueue depth");
  }
  if (shadow.reflectionQueue.depth !== shadow.reflectionQueue.items.length) {
    issues.push("kernelShadow reflectionQueue depth must match item count");
  }
  if (shadow.agenda.pendingLanes.some((lane, index) => lane !== pendingLanes[index])) {
    issues.push("kernelShadow agenda pending lanes must mirror reflectionQueue lanes");
  }
  if (shadow.focus !== shadow.agenda.focus) {
    issues.push("kernelShadow focus must mirror agenda.focus");
  }
  if (shadow.ticks.lastTickAtMs !== null && shadow.persistedAt < shadow.ticks.lastTickAtMs) {
    issues.push("kernelShadow persistedAt must not be older than lastTickAtMs");
  }
  if (
    shadow.restartRecovery.lastRecoveredAtMs !== null &&
    shadow.persistedAt < shadow.restartRecovery.lastRecoveredAtMs
  ) {
    issues.push("kernelShadow persistedAt must not be older than restart recovery");
  }
  if (
    shadow.restartRecovery.status === "recovered" &&
    (shadow.restartRecovery.lastRecoveredAtMs === null ||
      shadow.restartRecovery.journalEventCount < 2)
  ) {
    issues.push("kernelShadow recovered status requires recoveredAt and replayed journal evidence");
  }
  if (
    shadow.restartRecovery.status === "booted" &&
    shadow.restartRecovery.lastRecoveredAtMs !== null
  ) {
    issues.push("kernelShadow booted status must not include recoveredAt evidence");
  }
  if (shadow.wakefulness === "active" && shadow.agenda.activeLane === null) {
    issues.push("kernelShadow active wakefulness requires active agenda lane");
  }
  if (
    shadow.wakefulness === "attentive" &&
    (shadow.agenda.activeLane !== null || shadow.reflectionQueue.depth === 0)
  ) {
    issues.push("kernelShadow attentive wakefulness requires pending shadow work only");
  }
  if (
    shadow.wakefulness === "watching" &&
    (shadow.agenda.activeLane !== null || shadow.reflectionQueue.depth !== 0)
  ) {
    issues.push("kernelShadow watching wakefulness requires no active or pending shadow work");
  }

  return issues;
}

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
    ExecutiveShadowReadiness: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", const: "shadow-readiness" },
        authoritySwitchAllowed: { type: "boolean", const: false },
        promotionStatus: { type: "string", const: "blocked" },
        kernelShadow: {
          type: "object",
          additionalProperties: false,
          properties: {
            reachable: { type: "boolean" },
            status: { type: "string", const: "fail-closed" },
            authority: { type: "string", const: "shadow" },
            wakefulness: { type: "string", enum: ["active", "attentive", "watching"] },
            agenda: {
              type: "object",
              additionalProperties: false,
              properties: {
                activeLane: { type: ["string", "null"] },
                pendingLanes: { type: "array", items: { type: "string" } },
                focus: { type: ["string", "null"] },
              },
              required: ["activeLane", "pendingLanes", "focus"],
            },
            focus: { type: ["string", "null"] },
            ticks: {
              type: "object",
              additionalProperties: false,
              properties: {
                count: { type: "number" },
                lastTickAtMs: { type: ["number", "null"] },
                nextTickDueAtMs: { type: "number" },
                intervalMs: { type: "number" },
              },
              required: ["count", "lastTickAtMs", "nextTickDueAtMs", "intervalMs"],
            },
            reflectionQueue: {
              type: "object",
              additionalProperties: false,
              properties: {
                status: { type: "string", const: "shadow-only" },
                depth: { type: "number" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      lane: { type: "string" },
                      priority: { type: "number" },
                      reason: { type: ["string", "null"] },
                      requestedAtMs: { type: ["number", "null"] },
                    },
                    required: ["lane", "priority", "reason", "requestedAtMs"],
                  },
                },
              },
              required: ["status", "depth", "items"],
            },
            persistedAt: { type: "number" },
            restartRecovery: {
              type: "object",
              additionalProperties: false,
              properties: {
                model: { type: "string", const: "snapshot-plus-journal-replay" },
                status: { type: "string", enum: ["booted", "recovered"] },
                bootCount: { type: "number" },
                lastRecoveredAtMs: { type: ["number", "null"] },
                journalEventCount: { type: "number" },
                snapshotFile: { type: "string" },
                journalFile: { type: "string" },
              },
              required: [
                "model",
                "status",
                "bootCount",
                "lastRecoveredAtMs",
                "journalEventCount",
                "snapshotFile",
                "journalFile",
              ],
            },
          },
          required: [
            "reachable",
            "status",
            "authority",
            "wakefulness",
            "agenda",
            "focus",
            "ticks",
            "reflectionQueue",
            "persistedAt",
            "restartRecovery",
          ],
        },
        currentAuthority: {
          type: "object",
          additionalProperties: false,
          properties: {
            gateway: { type: "string" },
            scheduler: { type: "string" },
            workflows: { type: "string" },
            channels: { type: "string" },
            sessions: { type: "string" },
            executive: { type: "string" },
          },
          required: ["gateway", "scheduler", "workflows", "channels", "sessions", "executive"],
        },
        nodeResponsibilities: {
          type: "array",
          items: { type: "string" },
        },
        rustResponsibilities: {
          type: "array",
          items: { type: "string" },
        },
        persistenceModel: {
          type: "object",
          additionalProperties: false,
          properties: {
            snapshotFile: { type: "string" },
            journalFile: { type: "string" },
            restartRecovery: { type: "string" },
            leaseRecovery: { type: "string" },
          },
          required: ["snapshotFile", "journalFile", "restartRecovery", "leaseRecovery"],
        },
        promotionGates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              status: { type: "string", enum: ["blocked", "proven"] },
              owner: { type: "string" },
              requiredProof: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["id", "status", "owner", "requiredProof"],
          },
        },
      },
      required: [
        "mode",
        "authoritySwitchAllowed",
        "promotionStatus",
        "kernelShadow",
        "currentAuthority",
        "nodeResponsibilities",
        "rustResponsibilities",
        "persistenceModel",
        "promotionGates",
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
