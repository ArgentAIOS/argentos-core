import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const ModelChoiceSchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    provider: NonEmptyString,
    contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
    reasoning: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const AgentSummarySchema = Type.Object(
  {
    id: NonEmptyString,
    name: Type.Optional(NonEmptyString),
    identity: Type.Optional(
      Type.Object(
        {
          name: Type.Optional(NonEmptyString),
          theme: Type.Optional(NonEmptyString),
          emoji: Type.Optional(NonEmptyString),
          avatar: Type.Optional(NonEmptyString),
          avatarUrl: Type.Optional(NonEmptyString),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const AgentsListParamsSchema = Type.Object({}, { additionalProperties: false });

export const AgentsListResultSchema = Type.Object(
  {
    defaultId: NonEmptyString,
    mainKey: NonEmptyString,
    scope: Type.Union([Type.Literal("per-sender"), Type.Literal("global")]),
    agents: Type.Array(AgentSummarySchema),
  },
  { additionalProperties: false },
);

export const AgentsFileEntrySchema = Type.Object(
  {
    name: NonEmptyString,
    path: NonEmptyString,
    missing: Type.Boolean(),
    size: Type.Optional(Type.Integer({ minimum: 0 })),
    updatedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    content: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AgentsFilesListParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AgentsFilesListResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    workspace: NonEmptyString,
    files: Type.Array(AgentsFileEntrySchema),
  },
  { additionalProperties: false },
);

export const AgentsFilesGetParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    name: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AgentsFilesGetResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    workspace: NonEmptyString,
    file: AgentsFileEntrySchema,
  },
  { additionalProperties: false },
);

export const AgentsFilesSetParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    name: NonEmptyString,
    content: Type.String(),
  },
  { additionalProperties: false },
);

export const AgentsFilesSetResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    agentId: NonEmptyString,
    workspace: NonEmptyString,
    file: AgentsFileEntrySchema,
  },
  { additionalProperties: false },
);

export const ModelsListParamsSchema = Type.Object({}, { additionalProperties: false });

export const ModelsListResultSchema = Type.Object(
  {
    models: Type.Array(ModelChoiceSchema),
  },
  { additionalProperties: false },
);

export const SkillsStatusParamsSchema = Type.Object(
  {
    agentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const SkillsBinsParamsSchema = Type.Object({}, { additionalProperties: false });

export const SkillsBinsResultSchema = Type.Object(
  {
    bins: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

export const SkillsInstallParamsSchema = Type.Object(
  {
    name: NonEmptyString,
    installId: NonEmptyString,
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1000 })),
  },
  { additionalProperties: false },
);

export const SkillsUpdateParamsSchema = Type.Object(
  {
    skillKey: NonEmptyString,
    enabled: Type.Optional(Type.Boolean()),
    apiKey: Type.Optional(Type.String()),
    env: Type.Optional(Type.Record(NonEmptyString, Type.String())),
  },
  { additionalProperties: false },
);

export const ToolsStatusParamsSchema = Type.Object(
  {
    agentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const ConnectorsCatalogParamsSchema = Type.Object({}, { additionalProperties: false });

export const ToolStatusEntrySchema = Type.Object(
  {
    name: NonEmptyString,
    label: Type.Optional(NonEmptyString),
    description: Type.Optional(Type.String()),
    source: Type.Union([Type.Literal("core"), Type.Literal("plugin")]),
    pluginId: Type.Optional(NonEmptyString),
    optional: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ToolsStatusResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    sessionKey: NonEmptyString,
    total: Type.Integer({ minimum: 0 }),
    tools: Type.Array(ToolStatusEntrySchema),
  },
  { additionalProperties: false },
);

export const ConnectorCatalogCommandSchema = Type.Object(
  {
    id: NonEmptyString,
    summary: Type.Optional(NonEmptyString),
    requiredMode: Type.Optional(NonEmptyString),
    supportsJson: Type.Optional(Type.Boolean()),
    resource: Type.Optional(NonEmptyString),
    actionClass: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const ConnectorCatalogEntrySchema = Type.Object(
  {
    tool: NonEmptyString,
    label: NonEmptyString,
    description: Type.Optional(Type.String()),
    backend: Type.Optional(NonEmptyString),
    version: Type.Optional(NonEmptyString),
    manifestSchemaVersion: Type.Optional(NonEmptyString),
    category: Type.Optional(NonEmptyString),
    categories: Type.Array(NonEmptyString),
    resources: Type.Array(NonEmptyString),
    modes: Type.Array(NonEmptyString),
    commands: Type.Array(ConnectorCatalogCommandSchema),
    installState: Type.Union([
      Type.Literal("ready"),
      Type.Literal("needs-setup"),
      Type.Literal("repo-only"),
      Type.Literal("error"),
    ]),
    status: Type.Object(
      {
        ok: Type.Boolean(),
        label: NonEmptyString,
        detail: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    discovery: Type.Object(
      {
        binaryPath: Type.Optional(NonEmptyString),
        repoDir: Type.Optional(NonEmptyString),
        harnessDir: Type.Optional(NonEmptyString),
        requiresPython: Type.Optional(NonEmptyString),
        sources: Type.Array(Type.Union([Type.Literal("path"), Type.Literal("repo")])),
      },
      { additionalProperties: false },
    ),
    auth: Type.Optional(
      Type.Object(
        {
          kind: Type.Optional(NonEmptyString),
          required: Type.Optional(Type.Boolean()),
          serviceKeys: Type.Optional(Type.Array(NonEmptyString)),
          interactiveSetup: Type.Optional(Type.Array(NonEmptyString)),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const ConnectorsCatalogResultSchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    connectors: Type.Array(ConnectorCatalogEntrySchema),
  },
  { additionalProperties: false },
);
