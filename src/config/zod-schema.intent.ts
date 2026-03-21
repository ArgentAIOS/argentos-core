import { z } from "zod";

const StringListSchema = z.array(z.string()).optional();

export const IntentEscalationSchema = z
  .object({
    sentimentThreshold: z.number().min(-1).max(1).optional(),
    maxAttemptsBeforeEscalation: z.number().int().positive().optional(),
    timeInConversationMinutes: z.number().positive().optional(),
    customerTiersAlwaysEscalate: StringListSchema,
  })
  .strict()
  .optional();

export const IntentPolicySchema = z
  .object({
    objective: z.string().optional(),
    tradeoffHierarchy: StringListSchema,
    neverDo: StringListSchema,
    allowedActions: StringListSchema,
    requiresHumanApproval: StringListSchema,
    requireAcknowledgmentBeforeClose: z.boolean().optional(),
    usePersistentHistory: z.boolean().optional(),
    weightPreviousEscalations: z.boolean().optional(),
    escalation: IntentEscalationSchema,
  })
  .strict();

export const IntentGlobalSchema = IntentPolicySchema.extend({
  version: z.string().optional(),
  owner: z.string().optional(),
  coreValues: StringListSchema,
})
  .strict()
  .optional();

export const IntentDepartmentSchema = IntentPolicySchema.extend({
  version: z.string().optional(),
  owner: z.string().optional(),
  parentGlobalVersion: z.string().optional(),
}).strict();

export const IntentSimulationGateSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.union([z.literal("warn"), z.literal("enforce")]).optional(),
    suites: StringListSchema,
    minPassRate: z.number().min(0).max(1).optional(),
    minComponentScores: z
      .object({
        objectiveAdherence: z.number().min(0).max(1).optional(),
        boundaryCompliance: z.number().min(0).max(1).optional(),
        escalationCorrectness: z.number().min(0).max(1).optional(),
        outcomeQuality: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    reportPath: z.string().optional(),
  })
  .strict()
  .optional();

export const IntentAgentSchema = IntentPolicySchema.extend({
  version: z.string().optional(),
  owner: z.string().optional(),
  departmentId: z.string().optional(),
  role: z.string().optional(),
  parentGlobalVersion: z.string().optional(),
  parentDepartmentVersion: z.string().optional(),
  simulationGate: IntentSimulationGateSchema,
}).strict();

export const IntentSchema = z
  .object({
    enabled: z.boolean().optional(),
    validationMode: z.union([z.literal("off"), z.literal("warn"), z.literal("enforce")]).optional(),
    runtimeMode: z
      .union([z.literal("off"), z.literal("advisory"), z.literal("enforce")])
      .optional(),
    global: IntentGlobalSchema,
    departments: z.record(z.string(), IntentDepartmentSchema).optional(),
    agents: z.record(z.string(), IntentAgentSchema).optional(),
    simulationGate: IntentSimulationGateSchema,
  })
  .strict()
  .optional();
