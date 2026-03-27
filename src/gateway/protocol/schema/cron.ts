import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const CronScheduleSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("at"),
      at: NonEmptyString,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("every"),
      everyMs: Type.Integer({ minimum: 1 }),
      anchorMs: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("cron"),
      expr: NonEmptyString,
      tz: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
]);

const CronTaskStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("blocked"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

const CronTaskSourceSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("agent"),
  Type.Literal("heartbeat"),
  Type.Literal("schedule"),
  Type.Literal("channel"),
  Type.Literal("job"),
]);

const NonEmptyStringListSchema = Type.Array(NonEmptyString, { minItems: 1 });

const CronDocPanelArtifactRequirementSchema = Type.Object(
  {
    documentId: Type.Optional(NonEmptyString),
    titleIncludes: Type.Optional(NonEmptyString),
    collection: Type.Optional(Type.Union([NonEmptyString, NonEmptyStringListSchema])),
    sourceFileIncludes: Type.Optional(NonEmptyString),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
  },
  { additionalProperties: false },
);

const CronTaskArtifactRequirementSchema = Type.Object(
  {
    taskId: Type.Optional(NonEmptyString),
    titleIncludes: Type.Optional(NonEmptyString),
    assignee: Type.Optional(NonEmptyString),
    status: Type.Optional(Type.Union([CronTaskStatusSchema, Type.Array(CronTaskStatusSchema)])),
    source: Type.Optional(Type.Union([CronTaskSourceSchema, Type.Array(CronTaskSourceSchema)])),
    tags: Type.Optional(NonEmptyStringListSchema),
    parentTaskId: Type.Optional(NonEmptyString),
    agentId: Type.Optional(NonEmptyString),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
  },
  { additionalProperties: false },
);

const CronArtifactContractSchema = Type.Object(
  {
    docPanelDraft: Type.Optional(CronDocPanelArtifactRequirementSchema),
    handoffTask: Type.Optional(CronTaskArtifactRequirementSchema),
    deliveryTask: Type.Optional(CronTaskArtifactRequirementSchema),
  },
  { additionalProperties: false },
);

const CronArtifactWatchdogSchema = Type.Object(
  {
    afterMs: Type.Optional(Type.Integer({ minimum: 1000 })),
    announceOnFailure: Type.Optional(Type.Boolean()),
    required: Type.Optional(CronArtifactContractSchema),
  },
  { additionalProperties: false },
);

const CronAgentTurnArtifactContractSchema = Type.Object(
  {
    required: Type.Optional(CronArtifactContractSchema),
    watchdog: Type.Optional(CronArtifactWatchdogSchema),
  },
  { additionalProperties: false },
);

export const CronPayloadSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("systemEvent"),
      text: NonEmptyString,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("audioAlert"),
      message: NonEmptyString,
      title: Type.Optional(Type.String()),
      voice: Type.Optional(Type.String()),
      mood: Type.Optional(Type.String()),
      urgency: Type.Optional(
        Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("urgent")]),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("agentTurn"),
      message: NonEmptyString,
      model: Type.Optional(Type.String()),
      thinking: Type.Optional(Type.String()),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
      artifactContract: Type.Optional(CronAgentTurnArtifactContractSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("vipEmailScan"),
      emitAlerts: Type.Optional(Type.Boolean()),
      maxResults: Type.Optional(Type.Integer({ minimum: 1 })),
      lookbackDays: Type.Optional(Type.Integer({ minimum: 1 })),
      accounts: Type.Optional(Type.Array(NonEmptyString)),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("slackSignalScan"),
      emitAlerts: Type.Optional(Type.Boolean()),
      createTasks: Type.Optional(Type.Boolean()),
      accountId: Type.Optional(NonEmptyString),
    },
    { additionalProperties: false },
  ),
]);

export const CronPayloadPatchSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("systemEvent"),
      text: Type.Optional(NonEmptyString),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("audioAlert"),
      message: Type.Optional(NonEmptyString),
      title: Type.Optional(Type.String()),
      voice: Type.Optional(Type.String()),
      mood: Type.Optional(Type.String()),
      urgency: Type.Optional(
        Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("urgent")]),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("agentTurn"),
      message: Type.Optional(NonEmptyString),
      model: Type.Optional(Type.String()),
      thinking: Type.Optional(Type.String()),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
      artifactContract: Type.Optional(CronAgentTurnArtifactContractSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("vipEmailScan"),
      emitAlerts: Type.Optional(Type.Boolean()),
      maxResults: Type.Optional(Type.Integer({ minimum: 1 })),
      lookbackDays: Type.Optional(Type.Integer({ minimum: 1 })),
      accounts: Type.Optional(Type.Array(NonEmptyString)),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("slackSignalScan"),
      emitAlerts: Type.Optional(Type.Boolean()),
      createTasks: Type.Optional(Type.Boolean()),
      accountId: Type.Optional(NonEmptyString),
    },
    { additionalProperties: false },
  ),
]);

export const CronDeliverySchema = Type.Object(
  {
    mode: Type.Union([Type.Literal("none"), Type.Literal("announce")]),
    channel: Type.Optional(Type.Union([Type.Literal("last"), NonEmptyString])),
    to: Type.Optional(Type.String()),
    bestEffort: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const CronDeliveryPatchSchema = Type.Object(
  {
    mode: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("announce")])),
    channel: Type.Optional(Type.Union([Type.Literal("last"), NonEmptyString])),
    to: Type.Optional(Type.String()),
    bestEffort: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const CronJobStateSchema = Type.Object(
  {
    nextRunAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    runningAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    lastRunAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    lastStatus: Type.Optional(
      Type.Union([Type.Literal("ok"), Type.Literal("error"), Type.Literal("skipped")]),
    ),
    lastError: Type.Optional(Type.String()),
    lastDurationMs: Type.Optional(Type.Integer({ minimum: 0 })),
    lastExecutionMode: Type.Optional(
      Type.Union([Type.Literal("live"), Type.Literal("paper_trade")]),
    ),
    lastGateDecision: Type.Optional(
      Type.Union([Type.Literal("allow_live"), Type.Literal("simulated_paper_trade")]),
    ),
    lastGateReason: Type.Optional(Type.String()),
    lastSimulationEvidence: Type.Optional(
      Type.Object(
        {
          mode: Type.Literal("paper_trade"),
          policy: Type.Literal("external_side_effect_gate"),
          simulatedAtMs: Type.Integer({ minimum: 0 }),
          payloadKind: Type.Union([
            Type.Literal("systemEvent"),
            Type.Literal("audioAlert"),
            Type.Literal("agentTurn"),
            Type.Literal("nudge"),
            Type.Literal("vipEmailScan"),
            Type.Literal("slackSignalScan"),
          ]),
          action: NonEmptyString,
          reason: NonEmptyString,
        },
        { additionalProperties: false },
      ),
    ),
    watchdog: Type.Optional(
      Type.Object(
        {
          status: Type.Union([Type.Literal("pending"), Type.Literal("ok"), Type.Literal("error")]),
          dueAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
          lastCheckedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
          verifiedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
          error: Type.Optional(Type.String()),
          summary: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const CronJobSchema = Type.Object(
  {
    id: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    name: NonEmptyString,
    description: Type.Optional(Type.String()),
    enabled: Type.Boolean(),
    deleteAfterRun: Type.Optional(Type.Boolean()),
    createdAtMs: Type.Integer({ minimum: 0 }),
    updatedAtMs: Type.Integer({ minimum: 0 }),
    schedule: CronScheduleSchema,
    sessionTarget: Type.Union([Type.Literal("main"), Type.Literal("isolated")]),
    executionMode: Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("paper_trade")])),
    wakeMode: Type.Union([Type.Literal("next-heartbeat"), Type.Literal("now")]),
    payload: CronPayloadSchema,
    delivery: Type.Optional(CronDeliverySchema),
    state: CronJobStateSchema,
  },
  { additionalProperties: false },
);

export const CronListParamsSchema = Type.Object(
  {
    includeDisabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const CronStatusParamsSchema = Type.Object({}, { additionalProperties: false });

export const CronAddParamsSchema = Type.Object(
  {
    name: NonEmptyString,
    agentId: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    description: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    deleteAfterRun: Type.Optional(Type.Boolean()),
    schedule: CronScheduleSchema,
    sessionTarget: Type.Union([Type.Literal("main"), Type.Literal("isolated")]),
    executionMode: Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("paper_trade")])),
    wakeMode: Type.Union([Type.Literal("next-heartbeat"), Type.Literal("now")]),
    payload: CronPayloadSchema,
    delivery: Type.Optional(CronDeliverySchema),
  },
  { additionalProperties: false },
);

export const CronJobPatchSchema = Type.Object(
  {
    name: Type.Optional(NonEmptyString),
    agentId: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    description: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    deleteAfterRun: Type.Optional(Type.Boolean()),
    schedule: Type.Optional(CronScheduleSchema),
    sessionTarget: Type.Optional(Type.Union([Type.Literal("main"), Type.Literal("isolated")])),
    executionMode: Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("paper_trade")])),
    wakeMode: Type.Optional(Type.Union([Type.Literal("next-heartbeat"), Type.Literal("now")])),
    payload: Type.Optional(CronPayloadPatchSchema),
    delivery: Type.Optional(CronDeliveryPatchSchema),
    state: Type.Optional(Type.Partial(CronJobStateSchema)),
  },
  { additionalProperties: false },
);

export const CronUpdateParamsSchema = Type.Union([
  Type.Object(
    {
      id: NonEmptyString,
      patch: CronJobPatchSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      jobId: NonEmptyString,
      patch: CronJobPatchSchema,
    },
    { additionalProperties: false },
  ),
]);

export const CronRemoveParamsSchema = Type.Union([
  Type.Object(
    {
      id: NonEmptyString,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      jobId: NonEmptyString,
    },
    { additionalProperties: false },
  ),
]);

export const CronRunParamsSchema = Type.Union([
  Type.Object(
    {
      id: NonEmptyString,
      mode: Type.Optional(Type.Union([Type.Literal("due"), Type.Literal("force")])),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      jobId: NonEmptyString,
      mode: Type.Optional(Type.Union([Type.Literal("due"), Type.Literal("force")])),
    },
    { additionalProperties: false },
  ),
]);

export const CronRunsParamsSchema = Type.Union([
  Type.Object(
    {
      id: NonEmptyString,
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      jobId: NonEmptyString,
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    },
    { additionalProperties: false },
  ),
]);

export const CronRunLogEntrySchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    jobId: NonEmptyString,
    action: Type.Literal("finished"),
    status: Type.Optional(
      Type.Union([Type.Literal("ok"), Type.Literal("error"), Type.Literal("skipped")]),
    ),
    error: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    runAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
    nextRunAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    executionMode: Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("paper_trade")])),
    gateDecision: Type.Optional(
      Type.Union([Type.Literal("allow_live"), Type.Literal("simulated_paper_trade")]),
    ),
    gateReason: Type.Optional(Type.String()),
    simulationEvidence: Type.Optional(
      Type.Object(
        {
          mode: Type.Literal("paper_trade"),
          policy: Type.Literal("external_side_effect_gate"),
          simulatedAtMs: Type.Integer({ minimum: 0 }),
          payloadKind: Type.Union([
            Type.Literal("systemEvent"),
            Type.Literal("agentTurn"),
            Type.Literal("nudge"),
            Type.Literal("vipEmailScan"),
            Type.Literal("slackSignalScan"),
          ]),
          action: NonEmptyString,
          reason: NonEmptyString,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
