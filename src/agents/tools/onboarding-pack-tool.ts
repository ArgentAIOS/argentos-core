import { Type } from "@sinclair/typebox";
import crypto from "node:crypto";
import { dashboardApiHeaders } from "../../utils/dashboard-api.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

type UnknownRecord = Record<string, unknown>;

type NormalizedContact = {
  name: string;
  role: string;
  email?: string;
};

type NormalizedIntake = {
  companyName: string;
  industry: string;
  headcount?: number;
  contacts: NormalizedContact[];
  painPoints: string[];
  integrations: string[];
  stack: Record<string, string>;
  guardrails: {
    neverDo: string[];
    requiresApprovalFor: string[];
  };
  outcomes: {
    dayOneAnchor: string;
    success30d?: string;
    success90d?: string;
  };
};

type Archetype = {
  name: string;
  responsibility: string;
  triggers: string;
  approvalBoundary: string;
  phase: string;
};

type Artifact = {
  key: "strategy" | "technical" | "bootstrap" | "skillsGap";
  title: string;
  content: string;
};

const DASHBOARD_API = process.env.ARGENT_DASHBOARD_API || "http://localhost:9242";

const OnboardingPackSchema = Type.Object({
  action: Type.Optional(Type.Literal("generate")),
  intake: Type.Optional(
    Type.Object(
      {},
      { additionalProperties: true, description: "Intake envelope or payload object." },
    ),
  ),
  intakeJson: Type.Optional(
    Type.String({
      description: "Intake envelope JSON string. Use this when passing the payload as JSON text.",
    }),
  ),
  saveToDocPanel: Type.Optional(
    Type.Boolean({
      description: "When true (default), save each generated artifact to DocPanel.",
    }),
  ),
  knowledgeCollection: Type.Optional(
    Type.String({
      description: 'Knowledge collection for saved docs. Default: "onboarding".',
    }),
  ),
  includeArtifactContent: Type.Optional(
    Type.Boolean({
      description:
        "When true, include full markdown content for each artifact in tool output details.",
    }),
  ),
});

const ARCHETYPE_LIBRARY: Record<string, Archetype> = {
  "IT Monitor": {
    name: "IT Monitor",
    responsibility:
      "Monitor infrastructure and incident signals, classify severity, and trigger escalation.",
    triggers: "System alerts, downtime signals, threshold breaches.",
    approvalBoundary: "Requires human approval for production-affecting remediation.",
    phase: "1",
  },
  "Dispatch Coordinator": {
    name: "Dispatch Coordinator",
    responsibility: "Triages inbound work and routes incidents/tasks to the right owner.",
    triggers: "New ticket/message/task events.",
    approvalBoundary: "Requires human approval for customer-impacting reroutes.",
    phase: "1",
  },
  "Compliance Guardian": {
    name: "Compliance Guardian",
    responsibility: "Apply policy controls, evidence capture, and audit-ready action logs.",
    triggers: "Sensitive workflows and policy-bound actions.",
    approvalBoundary: "Blocks execution until required compliance conditions are met.",
    phase: "2",
  },
  "Customer Communications": {
    name: "Customer Communications",
    responsibility: "Draft and route consistent customer-facing updates and status messaging.",
    triggers: "Incident milestones and customer SLA update windows.",
    approvalBoundary: "Requires approval for externally visible legal/commercial statements.",
    phase: "1",
  },
  "Executive Intelligence": {
    name: "Executive Intelligence",
    responsibility: "Generate leadership summaries, KPI snapshots, and escalation briefs.",
    triggers: "Daily/weekly reporting windows and major incident events.",
    approvalBoundary: "Requires approval for board/external distribution.",
    phase: "2",
  },
  "Vendor Monitor": {
    name: "Vendor Monitor",
    responsibility:
      "Track third-party dependency risks, SLA drift, and renewal/contract milestones.",
    triggers: "Vendor alerts, SLA misses, renewal date windows.",
    approvalBoundary: "Requires approval before external vendor commitments.",
    phase: "2",
  },
  Orchestrator: {
    name: "Orchestrator",
    responsibility: "Coordinate cross-agent handoffs and enforce workflow state integrity.",
    triggers: "Multi-agent workflows and cross-team state transitions.",
    approvalBoundary: "Requires approval for fallback and rollback execution in production.",
    phase: "1",
  },
};

const ARCHETYPE_RULES: Array<{ archetype: keyof typeof ARCHETYPE_LIBRARY; patterns: RegExp[] }> = [
  {
    archetype: "IT Monitor",
    patterns: [/\balert\b/i, /\bincident\b/i, /\boutage\b/i, /\bmonitor/i, /\bdowntime\b/i],
  },
  {
    archetype: "Dispatch Coordinator",
    patterns: [/\bqueue\b/i, /\bticket\b/i, /\bdispatch\b/i, /\btriage\b/i, /\brouting\b/i],
  },
  {
    archetype: "Compliance Guardian",
    patterns: [/\bcompliance\b/i, /\baudit\b/i, /\blegal\b/i, /\bpolicy\b/i, /\bpii\b/i],
  },
  {
    archetype: "Customer Communications",
    patterns: [/\bcustomer\b/i, /\bclient\b/i, /\bstatus update\b/i, /\breply\b/i, /\bemail\b/i],
  },
  {
    archetype: "Executive Intelligence",
    patterns: [/\bexecutive\b/i, /\bleadership\b/i, /\breport\b/i, /\bkpi\b/i, /\bdashboard\b/i],
  },
  {
    archetype: "Vendor Monitor",
    patterns: [/\bvendor\b/i, /\bthird[- ]party\b/i, /\brenewal\b/i, /\bsla\b/i],
  },
];

const KNOWN_INTEGRATIONS = new Set([
  "gmail",
  "google workspace",
  "google",
  "calendar",
  "discord",
  "slack",
  "telegram",
  "whatsapp",
  "twilio",
  "namecheap",
  "coolify",
  "railway",
  "vercel",
  "mailgun",
  "sendgrid",
  "resend",
  "easydmarc",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function parseIntakeInput(raw: unknown): UnknownRecord {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error("intake JSON string is empty");
    }
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("intake JSON must be an object");
    }
    return parsed;
  }
  if (isRecord(raw)) {
    return raw;
  }
  throw new Error("intake input must be an object or JSON string");
}

function normalizeIntake(raw: unknown): NormalizedIntake {
  const parsed = parseIntakeInput(raw);
  const payload = isRecord(parsed.payload) ? parsed.payload : parsed;

  const company = isRecord(payload.company) ? payload.company : {};
  const outcomes = isRecord(payload.outcomes) ? payload.outcomes : {};
  const guardrails = isRecord(payload.guardrails) ? payload.guardrails : {};
  const stack = isRecord(payload.stack) ? payload.stack : {};

  const companyName =
    toTrimmedString(company.name) ??
    toTrimmedString(payload.companyName) ??
    toTrimmedString(parsed.companyName);
  const industry =
    toTrimmedString(company.industry) ??
    toTrimmedString(payload.industry) ??
    toTrimmedString(parsed.industry);

  const contactsRaw = Array.isArray(payload.contacts) ? payload.contacts : [];
  const contacts: NormalizedContact[] = contactsRaw
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      name: toTrimmedString(entry.name) ?? "",
      role: toTrimmedString(entry.role) ?? "",
      email: toTrimmedString(entry.email),
    }))
    .filter((entry) => entry.name && entry.role);

  const painPointsRaw = Array.isArray(payload.painPoints) ? payload.painPoints : [];
  const painPoints = uniqueStrings(
    painPointsRaw.flatMap((entry) => {
      if (typeof entry === "string") {
        return [entry];
      }
      if (isRecord(entry) && toTrimmedString(entry.statement)) {
        return [toTrimmedString(entry.statement)!];
      }
      return [];
    }),
  );

  const integrations = uniqueStrings(
    (Array.isArray(payload.integrations) ? payload.integrations : []).flatMap((entry) =>
      typeof entry === "string" ? [entry] : [],
    ),
  );

  const dayOneAnchor =
    toTrimmedString(outcomes.dayOneAnchor) ??
    toTrimmedString(payload.dayOneAnchor) ??
    toTrimmedString(parsed.dayOneAnchor);

  const neverDo = uniqueStrings(
    (Array.isArray(guardrails.neverDo) ? guardrails.neverDo : []).flatMap((entry) =>
      typeof entry === "string" ? [entry] : [],
    ),
  );
  const requiresApprovalFor = uniqueStrings(
    (Array.isArray(guardrails.requiresApprovalFor) ? guardrails.requiresApprovalFor : []).flatMap(
      (entry) => (typeof entry === "string" ? [entry] : []),
    ),
  );

  const errors: string[] = [];
  if (!companyName) {
    errors.push("missing company name");
  }
  if (!industry) {
    errors.push("missing industry");
  }
  if (contacts.length === 0) {
    errors.push("missing at least one contact with name and role");
  }
  if (painPoints.length === 0) {
    errors.push("missing at least one pain point");
  }
  if (!dayOneAnchor) {
    errors.push("missing outcomes.dayOneAnchor");
  }
  if (errors.length > 0) {
    throw new Error(`invalid intake payload: ${errors.join("; ")}`);
  }

  const stackOut: Record<string, string> = {};
  for (const [key, value] of Object.entries(stack)) {
    const normalized = toTrimmedString(value);
    if (!normalized) {
      continue;
    }
    stackOut[key] = normalized;
  }

  return {
    companyName: companyName!,
    industry: industry!,
    headcount:
      typeof company.headcount === "number" && Number.isFinite(company.headcount)
        ? Math.max(1, Math.floor(company.headcount))
        : undefined,
    contacts,
    painPoints,
    integrations,
    stack: stackOut,
    guardrails: {
      neverDo,
      requiresApprovalFor,
    },
    outcomes: {
      dayOneAnchor: dayOneAnchor!,
      success30d: toTrimmedString(outcomes.success30d),
      success90d: toTrimmedString(outcomes.success90d),
    },
  };
}

function inferArchetypes(painPoints: string[]): Archetype[] {
  const matched = new Set<keyof typeof ARCHETYPE_LIBRARY>();
  const merged = painPoints.join("\n");
  for (const rule of ARCHETYPE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(merged))) {
      matched.add(rule.archetype);
    }
  }

  if (matched.size === 0) {
    matched.add("Dispatch Coordinator");
    matched.add("Executive Intelligence");
  }
  matched.add("Orchestrator");

  return Array.from(matched).map((key) => ARCHETYPE_LIBRARY[key]);
}

function buildStrategyArtifact(intake: NormalizedIntake, roster: Archetype[]): Artifact {
  const pains = intake.painPoints.map((pain, index) => `${index + 1}. ${pain}`).join("\n");
  const rosterLines = roster.map((role) => `- ${role.name}: ${role.responsibility}`).join("\n");
  const success30 = intake.outcomes.success30d ?? "Reduce manual coordination overhead.";
  const success90 = intake.outcomes.success90d ?? "Establish reliable autonomous operations loop.";
  const headcountLine = intake.headcount ? `- Headcount: ${intake.headcount}` : "";

  return {
    key: "strategy",
    title: `${intake.companyName} - Customer Strategy`,
    content: `# ${intake.companyName} - ArgentOS Strategy

## Executive Summary
- Industry: ${intake.industry}
${headcountLine}
- Day-one automation anchor: ${intake.outcomes.dayOneAnchor}
- Primary objective: convert operational drag into deterministic agent workflows.

## Validated Pain Points
${pains}

## Proposed Agent Model
${rosterLines}

## Phase Roadmap
### Phase 1 (Week 1-2)
- Deploy core routing and alert handling around "${intake.outcomes.dayOneAnchor}".
- Target outcome: immediate reduction in manual triage and response latency.

### Phase 2 (Week 3-5)
- Expand compliance and executive reporting surfaces.
- Target outcome: auditable operations and leadership visibility.

### Phase 3 (Week 6+)
- Broaden orchestration and secondary automation opportunities.
- Target outcome: scalable, low-friction operating model.

## Success Metrics
- 30-day: ${success30}
- 90-day: ${success90}

## Risks And Mitigations
- Risk: incomplete integration access delays execution.
  - Mitigation: secure API credentials and approval scope before phase 1 kickoff.
- Risk: over-scoping phase 1.
  - Mitigation: enforce day-one anchor priority and defer non-critical capabilities.
`,
  };
}

function buildTechnicalArtifact(intake: NormalizedIntake, roster: Archetype[]): Artifact {
  const contactLines = intake.contacts
    .map(
      (contact) =>
        `- ${contact.name} (${contact.role}${contact.email ? `, ${contact.email}` : ""})`,
    )
    .join("\n");
  const stackLines =
    Object.keys(intake.stack).length > 0
      ? Object.entries(intake.stack)
          .map(([key, value]) => `- ${key}: ${value}`)
          .join("\n")
      : "- (none provided)";
  const integrationLines =
    intake.integrations.length > 0
      ? intake.integrations.map((item) => `- ${item}`).join("\n")
      : "- (none provided)";

  const rosterSections = roster
    .map(
      (role) => `### ${role.name}
- Responsibility: ${role.responsibility}
- Triggers: ${role.triggers}
- Approval boundary: ${role.approvalBoundary}
- Target phase: ${role.phase}
`,
    )
    .join("\n");

  return {
    key: "technical",
    title: `${intake.companyName} - Technical Implementation Spec`,
    content: `# ${intake.companyName} - Technical Implementation Spec

## Stakeholders
${contactLines}

## Architecture Baseline
- Runtime: ArgentOS gateway + dashboard.
- Storage: PostgreSQL-backed memory and knowledge services.
- Control plane: Gateway RPC with session-scoped tool execution.

## Agent Roster
${rosterSections}

## Integration Inventory
### Existing Stack
${stackLines}

### Requested Integrations
${integrationLines}

## Event And Data Flow
1. Capture operational signal from channels, queues, and monitoring.
2. Route through triage and policy gates.
3. Generate actions, approvals, and communications with traceable evidence.

## Guardrails
- Never-do constraints:
${intake.guardrails.neverDo.length > 0 ? intake.guardrails.neverDo.map((entry) => `  - ${entry}`).join("\n") : "  - (none provided)"}
- Human approval required for:
${intake.guardrails.requiresApprovalFor.length > 0 ? intake.guardrails.requiresApprovalFor.map((entry) => `  - ${entry}`).join("\n") : "  - (none provided)"}

## Rollout Contract
- Phase 1 anchor: ${intake.outcomes.dayOneAnchor}
- Validate integrations and permissions before production execution.
- Define rollback owner and incident fallback path before go-live.
`,
  };
}

function buildBootstrapArtifact(intake: NormalizedIntake, roster: Archetype[]): Artifact {
  const rosterNames = roster.map((role) => role.name).join(", ");
  return {
    key: "bootstrap",
    title: `${intake.companyName} - Bootstrap Prompt`,
    content: `# Bootstrap Prompt - ${intake.companyName}

## Objective
Operate as ${intake.companyName}'s AI operations layer. Optimize for reliability, safety, and measurable execution outcomes.

## Primary Anchor
${intake.outcomes.dayOneAnchor}

## Operating Priorities
1. Resolve validated pain points before speculative improvements.
2. Enforce approval and compliance boundaries on sensitive actions.
3. Keep communications concise, actionable, and auditable.

## Active Agent Roles
${rosterNames}

## Guardrails
Never do:
${intake.guardrails.neverDo.length > 0 ? intake.guardrails.neverDo.map((entry) => `- ${entry}`).join("\n") : "- Execute destructive actions without explicit authorization."}

Require human approval for:
${intake.guardrails.requiresApprovalFor.length > 0 ? intake.guardrails.requiresApprovalFor.map((entry) => `- ${entry}`).join("\n") : "- External commitments and production-impacting changes."}

## First-Run Checklist
- Confirm integration access and credential validity.
- Confirm alert routing and communication channels.
- Confirm task/approval workflow integrity.
- Confirm rollback and escalation path ownership.
`,
  };
}

function buildSkillsGapArtifact(intake: NormalizedIntake, roster: Archetype[]): Artifact {
  const capabilityRows: Array<{
    capability: string;
    state: "ready" | "partial" | "missing";
    impact: "high" | "medium";
    complexity: "low" | "medium" | "high";
    phase: string;
    notes: string;
  }> = [
    {
      capability: "Incident detection and triage",
      state: "ready",
      impact: "high",
      complexity: "low",
      phase: "1",
      notes: "Covered by core routing + roster roles.",
    },
    {
      capability: "Cross-channel operational notifications",
      state: "ready",
      impact: "high",
      complexity: "low",
      phase: "1",
      notes: "Supported by shared payload routing and channel adapters.",
    },
    {
      capability: "Compliance evidence and approval workflows",
      state: "partial",
      impact: "high",
      complexity: "medium",
      phase: "2",
      notes: "Available baseline controls; refine per customer policy.",
    },
    {
      capability: "Executive reporting automation",
      state: "partial",
      impact: "medium",
      complexity: "medium",
      phase: "2",
      notes: "Requires KPI-specific reporting definitions.",
    },
  ];

  for (const integration of intake.integrations) {
    const key = integration.trim().toLowerCase();
    const ready = Array.from(KNOWN_INTEGRATIONS).some((known) => key.includes(known));
    capabilityRows.push({
      capability: `Integration: ${integration}`,
      state: ready ? "ready" : "missing",
      impact: "high",
      complexity: ready ? "low" : "high",
      phase: ready ? "1" : "2",
      notes: ready
        ? "Supported through existing tool/skill surfaces."
        : "Requires new connector or custom integration path.",
    });
  }

  const tableRows = capabilityRows
    .map(
      (row) =>
        `| ${row.capability} | ${row.state} | ${row.impact} | ${row.complexity} | ${row.phase} | ${row.notes} |`,
    )
    .join("\n");

  const readyCount = capabilityRows.filter((row) => row.state === "ready").length;
  const missingCount = capabilityRows.filter((row) => row.state === "missing").length;

  return {
    key: "skillsGap",
    title: `${intake.companyName} - Skills Gap Report`,
    content: `# ${intake.companyName} - Skills Gap Report

## Summary
- Agent roles proposed: ${roster.length}
- Capabilities reviewed: ${capabilityRows.length}
- Ready now: ${readyCount}
- Missing: ${missingCount}

## Capability Matrix
| Capability | Current State | Impact | Complexity | Recommended Phase | Notes |
|---|---|---|---|---|---|
${tableRows}

## Build Order Recommendation
1. Deliver phase-1 anchor with ready capabilities and no high-risk dependencies.
2. Implement high-impact partial capabilities in phase 2 with explicit policy review.
3. Address missing integrations after phase-1 stabilization.
`,
  };
}

function buildArtifacts(intake: NormalizedIntake, roster: Archetype[]): Artifact[] {
  return [
    buildStrategyArtifact(intake, roster),
    buildTechnicalArtifact(intake, roster),
    buildBootstrapArtifact(intake, roster),
    buildSkillsGapArtifact(intake, roster),
  ];
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

async function saveDocPanelArtifact(params: {
  title: string;
  content: string;
  sessionKey?: string;
  knowledgeCollection: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const docId = crypto.randomUUID();
  try {
    const res = await fetch(`${DASHBOARD_API}/api/canvas/save`, {
      method: "POST",
      headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        doc: {
          id: docId,
          title: params.title,
          content: params.content,
          type: "markdown",
          autoRouted: true,
          saveToKnowledge: true,
          knowledgeCollection: params.knowledgeCollection,
        },
        sessionKey: params.sessionKey,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      const error =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : res.statusText;
      return { ok: false, error };
    }
    const data = (await res.json()) as { id?: unknown };
    const savedId = typeof data?.id === "string" && data.id.trim() ? data.id : docId;
    return { ok: true, id: savedId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const __testing = {
  normalizeIntake,
  inferArchetypes,
  buildArtifacts,
};

export function createOnboardingPackTool(options?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Onboarding Pack",
    name: "onboarding_pack",
    description: `Generate complete customer onboarding artifacts from one intake payload.

Outputs:
- Customer strategy document
- Technical implementation spec
- Bootstrap prompt
- Skills gap report

Input can be a raw payload object or a full intake envelope (with \`payload\` key).
Use this for deterministic onboarding artifact generation from structured discovery intake.`,
    parameters: OnboardingPackSchema,
    execute: async (_toolCallId, args) => {
      const params = (args as UnknownRecord) ?? {};
      const action = readStringParam(params, "action");
      if (action && action !== "generate") {
        throw new Error(`Unsupported action: ${action}`);
      }

      const intakeRaw = typeof params.intakeJson === "string" ? params.intakeJson : params.intake;
      if (!intakeRaw) {
        throw new Error('Missing intake payload. Provide "intake" object or "intakeJson" string.');
      }

      const intake = normalizeIntake(intakeRaw);
      const roster = inferArchetypes(intake.painPoints);
      const artifacts = buildArtifacts(intake, roster);

      const saveToDocPanel =
        typeof params.saveToDocPanel === "boolean" ? params.saveToDocPanel : true;
      const includeArtifactContent = params.includeArtifactContent === true;
      const knowledgeCollection =
        readStringParam(params, "knowledgeCollection")?.trim() || "onboarding";

      const saved: Array<{ key: Artifact["key"]; id: string; title: string }> = [];
      const failed: Array<{ key: Artifact["key"]; title: string; error: string }> = [];

      if (saveToDocPanel) {
        for (const artifact of artifacts) {
          const savedResult = await saveDocPanelArtifact({
            title: artifact.title,
            content: artifact.content,
            sessionKey: options?.agentSessionKey,
            knowledgeCollection,
          });
          if (savedResult.ok) {
            saved.push({ key: artifact.key, id: savedResult.id, title: artifact.title });
          } else {
            failed.push({ key: artifact.key, title: artifact.title, error: savedResult.error });
          }
        }
      }

      const artifactSummaries = Object.fromEntries(
        artifacts.map((artifact) => [
          artifact.key,
          {
            title: artifact.title,
            words: wordCount(artifact.content),
            ...(includeArtifactContent ? { content: artifact.content } : {}),
          },
        ]),
      );

      return jsonResult({
        ok: failed.length === 0,
        company: intake.companyName,
        generatedAt: new Date().toISOString(),
        summary: {
          painPoints: intake.painPoints.length,
          archetypes: roster.map((role) => role.name),
          dayOneAnchor: intake.outcomes.dayOneAnchor,
        },
        artifacts: artifactSummaries,
        docPanel: {
          attempted: saveToDocPanel ? artifacts.length : 0,
          saved,
          failed,
          knowledgeCollection: saveToDocPanel ? knowledgeCollection : undefined,
        },
      });
    },
  };
}
