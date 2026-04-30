import type {
  ActionNode,
  AgentPreset,
  GateNode,
  OutputNode,
  TriggerNode,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from "./workflow-types.js";
import {
  pinnedItem,
  workflowDefinitionToPackage,
  type WorkflowPackage,
  type WorkflowPackageDependency,
  type WorkflowPackageScenario,
} from "./workflow-package.js";

type TemplateBuildParams = {
  slug: string;
  name: string;
  description: string;
  scenario: WorkflowPackageScenario;
  trigger: TriggerNode;
  nodes: WorkflowNode[];
  dependencies?: WorkflowPackageDependency[];
  credentialIds?: Array<{ id: string; label: string; provider: string; purpose: string }>;
  pinnedOutputs?: Record<string, unknown>;
  notes?: string[];
};

const DEFAULT_ERROR = { strategy: "fail" as const, notifyOnError: true };
const OPERATOR_EMAIL = "{{operator.email}}";

function trigger(id: string, triggerType: TriggerNode["triggerType"], config = {}): TriggerNode {
  return { kind: "trigger", id, triggerType, config };
}

function agent(id: string, label: string, preset: AgentPreset, rolePrompt: string): WorkflowNode {
  return {
    kind: "agent",
    id,
    label,
    config: {
      agentId: "argent",
      preset,
      rolePrompt,
      timeoutMs: 300_000,
      evidenceRequired: false,
    },
  };
}

function approval(id: string, message: string): GateNode {
  return {
    kind: "gate",
    id,
    label: "Operator approval",
    config: {
      gateType: "approval",
      approvers: ["operator"],
      channels: ["dashboard"],
      message,
      showPreviousOutput: true,
      allowEdit: true,
      timeoutMs: 86_400_000,
      timeoutAction: "deny",
    },
  };
}

function connectorAction(
  id: string,
  label: string,
  connectorId: string,
  resource: string,
  operation: string,
  parameters: Record<string, unknown>,
  credentialId = `{{credentials.${connectorId}.primary}}`,
): ActionNode {
  return {
    kind: "action",
    id,
    label,
    config: {
      actionType: {
        type: "connector_action",
        connectorId,
        credentialId,
        resource,
        operation,
        parameters,
      },
    },
  };
}

function action(
  id: string,
  label: string,
  actionType: ActionNode["config"]["actionType"],
): ActionNode {
  return {
    kind: "action",
    id,
    label,
    config: { actionType },
  };
}

function docOutput(id: string, title: string, contentTemplate = "{{previous.text}}"): OutputNode {
  return {
    kind: "output",
    id,
    label: title,
    config: {
      outputType: "docpanel",
      title,
      format: "markdown",
      contentTemplate,
    },
  };
}

function emailOutput(
  id: string,
  subject: string,
  to = OPERATOR_EMAIL,
  bodyTemplate = "{{previous.text}}",
): OutputNode {
  return {
    kind: "output",
    id,
    label: "Email output",
    config: {
      outputType: "email",
      to,
      subject,
      bodyTemplate,
    },
  };
}

function connectorOutput(
  id: string,
  label: string,
  connectorId: string,
  resource: string,
  operation: string,
  parameters: Record<string, unknown>,
): OutputNode {
  return {
    kind: "output",
    id,
    label,
    config: {
      outputType: "connector_action",
      connectorId,
      credentialId: `{{credentials.${connectorId}.primary}}`,
      resource,
      operation,
      parameters,
    },
  };
}

function edges(nodes: WorkflowNode[]): WorkflowEdge[] {
  return nodes.slice(0, -1).map((node, index) => ({
    id: `e-${node.id}-${nodes[index + 1].id}`,
    source: node.id,
    target: nodes[index + 1].id,
  }));
}

function makePackage(params: TemplateBuildParams): WorkflowPackage {
  const nodes = [params.trigger, ...params.nodes];
  const workflow: WorkflowDefinition = {
    id: `wf-${params.slug}`,
    name: params.name,
    description: params.description,
    nodes,
    edges: edges(nodes),
    defaultOnError: DEFAULT_ERROR,
    maxRunDurationMs: 1_800_000,
    maxRunCostUsd: 2,
    deploymentStage: "simulate",
  };
  return workflowDefinitionToPackage({
    id: `pkg-${params.slug}`,
    slug: params.slug,
    name: params.name,
    description: params.description,
    scenario: params.scenario,
    workflow,
    credentials: params.credentialIds?.length
      ? {
          required: params.credentialIds.map((credential) => ({
            ...credential,
            requiredForLive: true,
          })),
        }
      : undefined,
    dependencies: params.dependencies,
    testFixtures: {
      triggerPayload: { fixture: params.slug, source: "owner-operator-template-suite" },
      pinnedOutputs: {
        [params.trigger.id]: pinnedItem(`Triggered ${params.name}`, { slug: params.slug }),
        ...Object.fromEntries(
          params.nodes
            .filter((node) => node.kind === "agent")
            .map((node) => [
              node.id,
              pinnedItem(`${node.label}: fixture result`, {
                nodeId: node.id,
                summary: `${params.name} fixture output`,
                score: 82,
              }),
            ]),
        ),
        ...Object.fromEntries(
          params.nodes
            .filter((node) => node.kind === "gate")
            .map((node) => [
              node.id,
              pinnedItem("Approval granted in fixture mode", { approved: true }),
            ]),
        ),
        ...Object.fromEntries(
          params.nodes
            .filter((node) => node.kind === "action")
            .map((node) => [
              node.id,
              pinnedItem(`${node.label}: fixture action result`, {
                delivered: false,
                fixture: true,
              }),
            ]),
        ),
        ...Object.fromEntries(
          params.nodes
            .filter(
              (node) =>
                node.kind === "output" &&
                !["docpanel", "knowledge"].includes(node.config.outputType),
            )
            .map((node) => [
              node.id,
              pinnedItem(`${(node as OutputNode).label}: fixture output result`, {
                delivered: false,
                fixture: true,
              }),
            ]),
        ),
        ...params.pinnedOutputs,
      },
    },
    notes: params.notes,
  });
}

function scenario(
  department: WorkflowPackageScenario["department"],
  runPattern: WorkflowPackageScenario["runPattern"],
  summary: string,
  appForgeTables?: string[],
): WorkflowPackageScenario {
  return { audience: "both", department, runPattern, summary, appForgeTables };
}

export const OWNER_OPERATOR_WORKFLOW_PACKAGES: WorkflowPackage[] = [
  makePackage({
    slug: "ai-morning-brief-podcast",
    name: "AI Morning Brief Podcast",
    description:
      "Daily AI web research brief with scout lanes, cited DocPanel brief, podcast planning, audio generation, and delivery status.",
    scenario: scenario(
      "operations",
      "schedule",
      "AI trend research, cited brief, and podcast production template",
    ),
    trigger: trigger("trigger", "schedule", {
      cronExpr: "30 6 * * *",
      timezone: "America/Chicago",
    }),
    credentialIds: [
      {
        id: "elevenlabs.primary",
        label: "ElevenLabs API Key",
        provider: "elevenlabs",
        purpose: "Render the Morning Brief podcast with podcast_generate.",
      },
      {
        id: "telegram.workflow",
        label: "Telegram Delivery Target",
        provider: "telegram",
        purpose: "Deliver the Morning Brief podcast status to the operator.",
      },
    ],
    nodes: [
      agent(
        "github-scout",
        "GitHub / Open Source Scout",
        "research",
        "Research trending GitHub and open-source AI projects. Return candidates with URLs, recent activity, confidence, and why Jason should care.",
      ),
      agent(
        "frontier-scout",
        "Frontier AI Scout",
        "research",
        "Research frontier AI movers from official sources first. Return only items that affect agent infrastructure, model choice, workflow reliability, or ArgentOS direction.",
      ),
      agent(
        "thought-scout",
        "Thought Leader / Infrastructure Scout",
        "research",
        "Research high-signal thought leaders, agent infrastructure, memory, workflow, eval, and model economics updates. Include source links and include/skip recommendations.",
      ),
      agent(
        "synthesize-brief",
        "Synthesis Agent",
        "write",
        "Synthesize scout outputs into a cited AI Morning Brief with clickable links, top stories, one deep dive, one project to inspect, and an ArgentOS implication section.",
      ),
      docOutput("brief-doc", "AI Morning Brief — {{context.runId}}"),
      agent(
        "podcast-script",
        "Podcast Script Agent",
        "write",
        "Convert the written brief into SPEAKER: text podcast lines for ARGENT, using ElevenLabs v3 performance tags such as [warm], [curious], [beat], and [dramatic pause].",
      ),
      action("podcast-plan", "Podcast Plan", {
        type: "podcast_plan",
        title: "AI Morning Brief — {{context.runId}}",
        script: "{{previous.text}}",
        personas: [
          {
            id: "argent",
            aliases: ["ARGENT", "HOST"],
            voice_id: "21m00Tcm4TlvDq8ikWAM",
          },
        ],
        timezone: "America/Chicago",
        publishTimeLocal: "08:00",
        publish: { spotify: false, youtube: false, heygen: false },
      }),
      approval(
        "approve-podcast-render",
        "Approve live podcast generation and delivery for today's AI Morning Brief.",
      ),
      action("podcast-generate", "Podcast Generate", {
        type: "podcast_generate",
        title: "AI Morning Brief — {{context.runId}}",
        payloadTemplate: "{{steps.podcast-plan.output.json.podcast_generate}}",
      }),
      action("delivery-status", "Delivery Status", {
        type: "send_message",
        channelType: "telegram",
        channelId: "{{operator.phone.telegramChatId}}",
        template: "AI Morning Brief podcast finished: {{previous.text}}",
      }),
      docOutput(
        "run-ledger",
        "AI Morning Brief Run Ledger — {{context.runId}}",
        "{{previous.text}}",
      ),
    ],
    notes: [
      "Use Validate and Dry Run before live execution. podcast_generate and delivery require operator approval.",
      "The template is intentionally capability-backed: podcast_plan normalizes the script before podcast_generate renders audio.",
    ],
  }),
  makePackage({
    slug: "daily-marketing-brief",
    name: "Daily Marketing Brief",
    description: "Summarize active campaigns, overdue assets, and today's marketing priorities.",
    scenario: scenario("marketing", "schedule", "Morning campaign planning brief", [
      "Campaigns",
      "Content Calendar",
    ]),
    trigger: trigger("trigger", "schedule", {
      cronExpr: "0 8 * * 1-5",
      timezone: "America/Chicago",
    }),
    nodes: [
      connectorAction(
        "read-campaigns",
        "Read campaign rows",
        "appforge-core",
        "records",
        "records.query",
        {
          base: "Marketing Ops",
          table: "Campaigns",
          filter: "status != archived",
        },
      ),
      connectorAction(
        "read-calendar",
        "Read content calendar",
        "appforge-core",
        "records",
        "records.query",
        {
          base: "Marketing Ops",
          table: "Content Calendar",
          filter: "publish_date <= +7d AND status != published",
        },
      ),
      agent(
        "summarize",
        "Summarize priorities",
        "summarize",
        "Turn campaign rows and content calendar items into a concise owner brief with blockers, due assets, and next best actions.",
      ),
      approval(
        "approve-priorities",
        "Approve today's generated marketing task list and operator alert.",
      ),
      connectorAction(
        "create-priority-tasks",
        "Create priority tasks",
        "appforge-core",
        "records",
        "records.create_many",
        {
          base: "Marketing Ops",
          table: "Tasks",
          source: "Daily Marketing Brief",
          tasks: "{{steps.summarize.output.json.tasks}}",
        },
      ),
      docOutput(
        "brief-doc",
        "Daily Marketing Brief",
        "## Daily marketing brief\n{{steps.summarize.output.text}}\n\n## Created task batch\n{{steps.create-priority-tasks.output.text}}",
      ),
      connectorOutput(
        "notify-slack",
        "Notify marketing channel",
        "aos-slack",
        "message",
        "message.send",
        {
          channel_id: "{{channels.slack.marketing}}",
          text: "{{steps.summarize.output.text}}",
        },
      ),
    ],
    dependencies: [
      { kind: "appforge_base", id: "marketing-ops", label: "Marketing Ops" },
      { kind: "channel", id: "slack.marketing", label: "Marketing Slack channel" },
      { kind: "connector", id: "aos-slack", label: "Slack" },
    ],
    credentialIds: [
      {
        id: "slack.primary",
        label: "Slack workspace",
        provider: "slack",
        purpose: "Post the approved daily marketing brief",
      },
    ],
  }),
  makePackage({
    slug: "social-post-generator",
    name: "Social Post Generator",
    description: "Draft platform-specific social posts from an approved campaign row.",
    scenario: scenario(
      "marketing",
      "appforge_event",
      "Campaign row becomes ready for social drafting",
      ["Campaigns", "Social Posts"],
    ),
    trigger: trigger("trigger", "appforge_event", {
      eventType: "forge.record.updated",
      appId: "marketing-ops",
      eventFilter: { table: "Campaigns", status: "Ready for Social" },
    }),
    nodes: [
      connectorAction(
        "read-campaign",
        "Read approved campaign",
        "appforge-core",
        "records",
        "records.get",
        {
          base: "Marketing Ops",
          table: "Campaigns",
          record_id: "{{trigger.payload.recordId}}",
        },
      ),
      agent(
        "draft-posts",
        "Draft social variants",
        "write",
        "Create LinkedIn, X, and Facebook variants from the campaign row.",
      ),
      connectorAction(
        "create-social-rows",
        "Create social draft rows",
        "appforge-core",
        "records",
        "records.create_many",
        {
          base: "Marketing Ops",
          table: "Social Posts",
          campaign_id: "{{trigger.payload.recordId}}",
          drafts: "{{steps.draft-posts.output.json.posts}}",
        },
      ),
      approval("approve-posts", "Review generated social posts before scheduling."),
      connectorAction(
        "schedule-buffer",
        "Schedule social drafts",
        "aos-buffer",
        "post",
        "post.schedule",
        {
          text: "{{previous.text}}",
          profile_ids: "{{credentials.buffer.profileIds}}",
        },
      ),
      connectorAction(
        "mark-scheduled",
        "Mark campaign scheduled",
        "appforge-core",
        "records",
        "records.update",
        {
          base: "Marketing Ops",
          table: "Campaigns",
          record_id: "{{trigger.payload.recordId}}",
          status: "Social Scheduled",
          scheduling_summary: "{{steps.schedule-buffer.output.text}}",
        },
      ),
      docOutput(
        "social-run-log",
        "Social Scheduling Run",
        "## Social variants\n{{steps.draft-posts.output.text}}\n\n## Scheduling result\n{{steps.schedule-buffer.output.text}}",
      ),
    ],
    dependencies: [
      { kind: "appforge_base", id: "marketing-ops", label: "Marketing Ops" },
      { kind: "connector", id: "aos-buffer", label: "Buffer" },
    ],
    credentialIds: [
      {
        id: "buffer.primary",
        label: "Buffer account",
        provider: "buffer",
        purpose: "Schedule posts",
      },
    ],
  }),
  makePackage({
    slug: "newsletter-builder",
    name: "Newsletter Builder",
    description: "Collect approved content items, draft a newsletter, and create an email draft.",
    scenario: scenario("marketing", "schedule", "Weekly newsletter drafting", ["Content Calendar"]),
    trigger: trigger("trigger", "schedule", {
      cronExpr: "0 10 * * 2",
      timezone: "America/Chicago",
    }),
    nodes: [
      connectorAction(
        "read-approved-content",
        "Read approved content",
        "appforge-core",
        "records",
        "records.query",
        {
          base: "Marketing Ops",
          table: "Content Calendar",
          filter: "newsletter_ready = true AND status = approved",
        },
      ),
      agent(
        "draft-newsletter",
        "Draft newsletter",
        "write",
        "Build a newsletter from this week's approved items.",
      ),
      docOutput(
        "newsletter-preview",
        "Newsletter Preview",
        "## Newsletter draft\n{{steps.draft-newsletter.output.text}}",
      ),
      approval("approve-newsletter", "Review newsletter before creating the email draft."),
      connectorAction(
        "resend-draft",
        "Create Resend email draft",
        "aos-resend",
        "email",
        "email.create_draft",
        {
          to: "{{operator.email}}",
          subject: "Weekly Newsletter Draft",
          html: "{{steps.draft-newsletter.output.text}}",
        },
      ),
      connectorAction(
        "record-newsletter",
        "Record newsletter send plan",
        "appforge-core",
        "records",
        "records.create",
        {
          base: "Marketing Ops",
          table: "Email Campaigns",
          subject: "Weekly Newsletter Draft",
          draft_result: "{{steps.resend-draft.output.text}}",
        },
      ),
      docOutput(
        "newsletter-run-log",
        "Newsletter Run Log",
        "## Draft\n{{steps.draft-newsletter.output.text}}\n\n## Resend draft\n{{steps.resend-draft.output.text}}",
      ),
    ],
    dependencies: [
      { kind: "appforge_base", id: "marketing-ops", label: "Marketing Ops" },
      { kind: "connector", id: "aos-resend", label: "Resend" },
    ],
    credentialIds: [
      {
        id: "resend.primary",
        label: "Resend domain",
        provider: "resend",
        purpose: "Email draft creation",
      },
    ],
  }),
  makePackage({
    slug: "lead-magnet-follow-up",
    name: "Lead Magnet Follow-Up",
    description: "Convert form submissions into CRM leads and an approved welcome email.",
    scenario: scenario("sales", "webhook", "Lead magnet form submitted", ["Leads"]),
    trigger: trigger("trigger", "webhook", { webhookPath: "/workflows/lead-magnet" }),
    nodes: [
      connectorAction(
        "create-lead",
        "Create lead row",
        "appforge-core",
        "records",
        "records.create",
        {
          base: "Marketing Ops",
          table: "Leads",
          fields: "{{trigger.payload}}",
        },
      ),
      agent(
        "write-welcome",
        "Write welcome email",
        "write",
        "Write a warm, specific welcome email for the new lead.",
      ),
      approval("approve-email", "Approve welcome email before sending."),
      emailOutput(
        "send-welcome",
        "Welcome to Argent",
        OPERATOR_EMAIL,
        "{{steps.write-welcome.output.text}}",
      ),
    ],
    dependencies: [{ kind: "appforge_base", id: "marketing-ops", label: "Marketing Ops" }],
  }),
  makePackage({
    slug: "vip-email-alert",
    name: "VIP Email Alert",
    description:
      "Classify inbound email and notify the operator when a VIP message needs attention.",
    scenario: scenario("operations", "message_event", "Inbound VIP email classification"),
    trigger: trigger("trigger", "email_received", { senderFilter: "{{vip.senders}}" }),
    nodes: [
      agent(
        "classify",
        "Classify urgency",
        "analyze",
        "Decide whether this inbound email is VIP, urgent, and actionable.",
      ),
      connectorOutput(
        "notify-telegram",
        "Notify operator",
        "aos-telegram",
        "message",
        "message.send",
        {
          chat_id: "{{channels.telegram.operator}}",
          text: "{{previous.text}}",
        },
      ),
    ],
    dependencies: [{ kind: "connector", id: "aos-telegram", label: "Telegram" }],
    credentialIds: [
      {
        id: "telegram.primary",
        label: "Telegram bot",
        provider: "telegram",
        purpose: "Operator alert",
      },
    ],
  }),
  makePackage({
    slug: "content-repurposing",
    name: "Content Repurposing",
    description:
      "Turn a long article into short posts, an email teaser, and a reusable content brief.",
    scenario: scenario("marketing", "appforge_event", "Blog post marked ready for repurposing", [
      "Content Calendar",
    ]),
    trigger: trigger("trigger", "appforge_event", {
      eventType: "forge.record.updated",
      eventFilter: { table: "Content Calendar", status: "Approved" },
    }),
    nodes: [
      agent(
        "repurpose",
        "Repurpose content",
        "write",
        "Create social snippets, newsletter teaser, and a short abstract.",
      ),
      approval("approve-assets", "Approve repurposed content package."),
      docOutput("package-doc", "Repurposed Content Package"),
    ],
  }),
  makePackage({
    slug: "crm-lead-scoring",
    name: "CRM Lead Scoring",
    description: "Score new leads and update their priority for owner follow-up.",
    scenario: scenario("sales", "appforge_event", "Lead row created", ["Leads"]),
    trigger: trigger("trigger", "appforge_event", {
      eventType: "forge.record.created",
      eventFilter: { table: "Leads" },
    }),
    nodes: [
      agent(
        "score-lead",
        "Score lead",
        "analyze",
        "Score the lead from 0-100 and explain recommended next action.",
      ),
      connectorAction(
        "update-lead",
        "Update lead score",
        "appforge-core",
        "records",
        "records.update",
        {
          base: "Marketing Ops",
          table: "Leads",
          record_id: "{{trigger.payload.recordId}}",
          score: "{{previous.json.score}}",
        },
      ),
      docOutput("lead-brief", "Lead Scoring Brief"),
    ],
  }),
  makePackage({
    slug: "sales-follow-up-reminder",
    name: "Sales Follow-Up Reminder",
    description: "Draft a follow-up when a warm lead has gone quiet.",
    scenario: scenario("sales", "schedule", "Daily stale lead follow-up pass", ["Leads"]),
    trigger: trigger("trigger", "schedule", {
      cronExpr: "0 15 * * 1-5",
      timezone: "America/Chicago",
    }),
    nodes: [
      agent(
        "draft-follow-up",
        "Draft follow-up",
        "write",
        "Draft a short follow-up for stale warm leads.",
      ),
      approval("approve-follow-up", "Approve follow-up before sending."),
      emailOutput(
        "send-follow-up",
        "Quick follow-up",
        OPERATOR_EMAIL,
        "{{steps.draft-follow-up.output.text}}",
      ),
    ],
  }),
  makePackage({
    slug: "invoice-follow-up",
    name: "Invoice Follow-Up",
    description: "Detect overdue invoices and draft a polite payment reminder.",
    scenario: scenario("finance", "schedule", "Overdue invoice reminder", ["Invoices"]),
    trigger: trigger("trigger", "schedule", { cronExpr: "0 9 * * 1", timezone: "America/Chicago" }),
    nodes: [
      connectorAction(
        "read-invoices",
        "Read overdue invoices",
        "aos-quickbooks",
        "invoice",
        "invoice.list_overdue",
        {
          days_overdue: 7,
        },
      ),
      agent(
        "draft-reminder",
        "Draft payment reminder",
        "write",
        "Draft a polite, firm invoice reminder.",
      ),
      approval("approve-reminder", "Approve payment reminder before sending."),
      emailOutput(
        "send-reminder",
        "Invoice reminder",
        OPERATOR_EMAIL,
        "{{steps.draft-reminder.output.text}}",
      ),
    ],
    dependencies: [{ kind: "connector", id: "aos-quickbooks", label: "QuickBooks" }],
    credentialIds: [
      {
        id: "quickbooks.primary",
        label: "QuickBooks",
        provider: "quickbooks",
        purpose: "Read invoice status",
      },
    ],
  }),
  makePackage({
    slug: "client-onboarding",
    name: "Client Onboarding",
    description: "Create onboarding tasks, draft welcome materials, and notify the operator.",
    scenario: scenario("operations", "webhook", "New client form submitted", [
      "Clients",
      "Projects",
      "Tasks",
    ]),
    trigger: trigger("trigger", "webhook", { webhookPath: "/workflows/client-onboarding" }),
    nodes: [
      connectorAction(
        "create-project",
        "Create onboarding project",
        "appforge-core",
        "records",
        "records.create",
        {
          base: "Client Ops",
          table: "Projects",
          fields: "{{trigger.payload}}",
        },
      ),
      connectorAction(
        "create-task-list",
        "Create onboarding task list",
        "appforge-core",
        "records",
        "records.create_many",
        {
          base: "Client Ops",
          table: "Tasks",
          project_id: "{{steps.create-project.output.json.id}}",
          tasks: [
            "Schedule kickoff",
            "Collect brand assets",
            "Confirm billing contact",
            "Prepare shared workspace",
          ],
        },
      ),
      agent(
        "draft-welcome",
        "Draft welcome packet",
        "write",
        "Create a welcome packet and onboarding checklist.",
      ),
      docOutput(
        "welcome-preview",
        "Client Welcome Preview",
        "## Welcome packet\n{{steps.draft-welcome.output.text}}\n\n## Tasks created\n{{steps.create-task-list.output.text}}",
      ),
      approval("approve-welcome", "Approve client welcome packet."),
      emailOutput(
        "send-welcome",
        "Welcome aboard",
        OPERATOR_EMAIL,
        "{{steps.draft-welcome.output.text}}",
      ),
      connectorOutput(
        "notify-operator",
        "Notify operator",
        "aos-telegram",
        "message",
        "message.send",
        {
          chat_id: "{{channels.telegram.operator}}",
          text: "Client onboarding started: {{steps.create-project.output.text}}",
        },
      ),
    ],
    dependencies: [
      { kind: "appforge_base", id: "client-ops", label: "Client Ops" },
      { kind: "connector", id: "aos-telegram", label: "Telegram" },
      { kind: "channel", id: "telegram.operator", label: "Operator Telegram" },
    ],
    credentialIds: [
      {
        id: "telegram.primary",
        label: "Telegram bot",
        provider: "telegram",
        purpose: "Notify the operator after onboarding starts",
      },
    ],
  }),
  makePackage({
    slug: "candidate-intake",
    name: "Candidate Intake",
    description: "Summarize incoming candidate applications and rank fit for review.",
    scenario: scenario("hr", "webhook", "Candidate application submitted", ["Candidates"]),
    trigger: trigger("trigger", "webhook", { webhookPath: "/workflows/candidate-intake" }),
    nodes: [
      agent(
        "summarize-candidate",
        "Summarize candidate",
        "analyze",
        "Summarize resume, strengths, concerns, and fit score.",
      ),
      connectorAction(
        "create-candidate",
        "Create candidate row",
        "appforge-core",
        "records",
        "records.create",
        {
          base: "HR Ops",
          table: "Candidates",
          summary: "{{previous.text}}",
        },
      ),
      docOutput("candidate-doc", "Candidate Intake Summary"),
    ],
  }),
  makePackage({
    slug: "interview-prep",
    name: "Interview Prep",
    description: "Generate interview questions when a candidate moves to interview stage.",
    scenario: scenario("hr", "appforge_event", "Candidate moved to interview", ["Candidates"]),
    trigger: trigger("trigger", "appforge_event", {
      eventType: "forge.record.updated",
      eventFilter: { table: "Candidates", status: "Interview" },
    }),
    nodes: [
      agent(
        "prep",
        "Prepare interview kit",
        "write",
        "Generate role-specific questions and risk checks.",
      ),
      docOutput("prep-doc", "Interview Prep Kit"),
    ],
  }),
  makePackage({
    slug: "employee-onboarding",
    name: "Employee Onboarding",
    description: "Create new-hire tasks and draft first-day instructions.",
    scenario: scenario("hr", "appforge_event", "New hire row approved", [
      "Employees",
      "Onboarding Tasks",
    ]),
    trigger: trigger("trigger", "appforge_event", {
      eventType: "forge.record.updated",
      eventFilter: { table: "Employees", status: "Approved" },
    }),
    nodes: [
      connectorAction(
        "create-tasks",
        "Create onboarding tasks",
        "appforge-core",
        "records",
        "records.create_many",
        {
          base: "HR Ops",
          table: "Onboarding Tasks",
          employee: "{{trigger.payload.recordId}}",
        },
      ),
      agent(
        "first-day",
        "Draft first-day message",
        "write",
        "Draft a clear first-day welcome and checklist.",
      ),
      approval("approve-first-day", "Approve first-day message."),
      emailOutput(
        "send-first-day",
        "Your first day",
        OPERATOR_EMAIL,
        "{{steps.first-day.output.text}}",
      ),
    ],
  }),
  makePackage({
    slug: "support-triage",
    name: "Support Triage",
    description: "Classify inbound support and create the right owner task.",
    scenario: scenario("support", "message_event", "Support email received", ["Support Tickets"]),
    trigger: trigger("trigger", "email_received", { subjectFilter: "support" }),
    nodes: [
      agent(
        "triage",
        "Triage support request",
        "analyze",
        "Classify severity, product area, and next action.",
      ),
      connectorAction(
        "create-ticket",
        "Create support ticket",
        "appforge-core",
        "records",
        "records.create",
        {
          base: "Support Ops",
          table: "Support Tickets",
          summary: "{{previous.text}}",
        },
      ),
      docOutput("triage-doc", "Support Triage Summary"),
    ],
  }),
  makePackage({
    slug: "review-request",
    name: "Review Request",
    description: "After fulfillment, wait and draft a review request to the customer.",
    scenario: scenario("marketing", "appforge_event", "Order or project completed", [
      "Customers",
      "Orders",
    ]),
    trigger: trigger("trigger", "appforge_event", {
      eventType: "forge.record.updated",
      eventFilter: { status: "Completed" },
    }),
    nodes: [
      {
        kind: "gate",
        id: "wait-three-days",
        label: "Wait three days",
        config: { gateType: "wait_duration", durationMs: 259_200_000 },
      },
      agent(
        "draft-review-request",
        "Draft review request",
        "write",
        "Draft a short review request based on the completed work.",
      ),
      approval("approve-review-request", "Approve review request before sending."),
      emailOutput(
        "send-review-request",
        "Could you share a quick review?",
        OPERATOR_EMAIL,
        "{{steps.draft-review-request.output.text}}",
      ),
    ],
  }),
  makePackage({
    slug: "monthly-owner-report",
    name: "Monthly Owner Report",
    description:
      "Compile sales, marketing, HR, and operations metrics into a monthly owner report.",
    scenario: scenario("operations", "schedule", "Monthly business operating report", [
      "Campaigns",
      "Leads",
      "Support Tickets",
      "Employees",
    ]),
    trigger: trigger("trigger", "schedule", { cronExpr: "0 8 1 * *", timezone: "America/Chicago" }),
    nodes: [
      connectorAction(
        "read-campaign-metrics",
        "Read campaign metrics",
        "appforge-core",
        "records",
        "records.query",
        {
          base: "Business Ops",
          table: "Campaigns",
          filter: "month = current",
        },
      ),
      connectorAction(
        "read-sales-metrics",
        "Read sales metrics",
        "appforge-core",
        "records",
        "records.query",
        {
          base: "Business Ops",
          table: "Leads",
          filter: "month = current",
        },
      ),
      connectorAction(
        "read-support-metrics",
        "Read support metrics",
        "appforge-core",
        "records",
        "records.query",
        {
          base: "Business Ops",
          table: "Support Tickets",
          filter: "month = current",
        },
      ),
      agent(
        "compile-report",
        "Compile owner report",
        "summarize",
        "Create an executive monthly operating report from available tables.",
      ),
      approval(
        "approve-owner-report",
        "Approve the monthly owner report before notifying the team.",
      ),
      docOutput(
        "owner-report",
        "Monthly Owner Report",
        "## Monthly owner report\n{{steps.compile-report.output.text}}\n\n## Source summaries\n- Campaigns: {{steps.read-campaign-metrics.output.text}}\n- Sales: {{steps.read-sales-metrics.output.text}}\n- Support: {{steps.read-support-metrics.output.text}}",
      ),
      connectorOutput("notify-owner", "Notify owner", "aos-slack", "message", "message.send", {
        channel_id: "{{channels.slack.owner}}",
        text: "Monthly owner report is ready: {{steps.compile-report.output.text}}",
      }),
    ],
    dependencies: [
      { kind: "appforge_base", id: "business-ops", label: "Business Ops" },
      { kind: "connector", id: "aos-slack", label: "Slack" },
      { kind: "channel", id: "slack.owner", label: "Owner Slack channel" },
    ],
  }),
  makePackage({
    slug: "operations-cleanup",
    name: "Operations Cleanup",
    description: "Find stale tasks and propose an archive/update batch for operator approval.",
    scenario: scenario("operations", "schedule", "Weekly stale record cleanup", [
      "Tasks",
      "Projects",
    ]),
    trigger: trigger("trigger", "schedule", {
      cronExpr: "0 16 * * 5",
      timezone: "America/Chicago",
    }),
    nodes: [
      connectorAction(
        "read-stale-records",
        "Read stale records",
        "appforge-core",
        "records",
        "records.query",
        {
          base: "Operations",
          table: "Tasks",
          filter: "status != done AND updated_at < -14d",
        },
      ),
      agent(
        "find-stale",
        "Find stale work",
        "analyze",
        "Identify stale records and propose safe cleanup actions.",
      ),
      approval("approve-cleanup", "Approve cleanup before mutating records."),
      connectorAction(
        "update-stale",
        "Update stale records",
        "appforge-core",
        "records",
        "records.update_many",
        {
          base: "Operations",
          table: "Tasks",
          updates: "{{steps.find-stale.output.json.updates}}",
        },
      ),
      docOutput(
        "cleanup-log",
        "Operations Cleanup Log",
        "## Proposed cleanup\n{{steps.find-stale.output.text}}\n\n## Update result\n{{steps.update-stale.output.text}}",
      ),
    ],
    dependencies: [{ kind: "appforge_base", id: "operations", label: "Operations" }],
  }),
  makePackage({
    slug: "abandoned-cart-recovery",
    name: "Abandoned Cart Recovery",
    description: "Recover abandoned carts with a personalized draft and CRM update.",
    scenario: scenario("sales", "webhook", "Commerce cart abandoned", ["Customers", "Orders"]),
    trigger: trigger("trigger", "webhook", { webhookPath: "/workflows/abandoned-cart" }),
    nodes: [
      connectorAction(
        "read-cart-context",
        "Read cart context",
        "appforge-core",
        "records",
        "records.get",
        {
          base: "Commerce Ops",
          table: "Orders",
          record_id: "{{trigger.payload.cartId}}",
        },
      ),
      agent(
        "draft-cart-email",
        "Draft cart recovery",
        "write",
        "Draft a helpful abandoned-cart recovery email.",
      ),
      approval("approve-cart-email", "Approve cart recovery email."),
      connectorAction(
        "record-recovery-attempt",
        "Record recovery attempt",
        "appforge-core",
        "records",
        "records.update",
        {
          base: "Commerce Ops",
          table: "Orders",
          record_id: "{{trigger.payload.cartId}}",
          recovery_status: "Drafted",
          recovery_summary: "{{steps.draft-cart-email.output.text}}",
        },
      ),
      emailOutput(
        "send-cart-email",
        "Still interested?",
        OPERATOR_EMAIL,
        "{{steps.draft-cart-email.output.text}}",
      ),
      docOutput(
        "cart-run-log",
        "Abandoned Cart Recovery Log",
        "## Draft\n{{steps.draft-cart-email.output.text}}\n\n## CRM update\n{{steps.record-recovery-attempt.output.text}}",
      ),
    ],
    dependencies: [{ kind: "appforge_base", id: "commerce-ops", label: "Commerce Ops" }],
    notes: ["Variation: ecommerce owner-operator sales recovery."],
  }),
  makePackage({
    slug: "job-offer-draft",
    name: "Job Offer Draft",
    description: "Draft an offer packet when a candidate is marked selected.",
    scenario: scenario("hr", "appforge_event", "Candidate selected", ["Candidates"]),
    trigger: trigger("trigger", "appforge_event", {
      eventType: "forge.record.updated",
      eventFilter: { table: "Candidates", status: "Selected" },
    }),
    nodes: [
      connectorAction(
        "read-candidate",
        "Read candidate record",
        "appforge-core",
        "records",
        "records.get",
        {
          base: "HR Ops",
          table: "Candidates",
          record_id: "{{trigger.payload.recordId}}",
        },
      ),
      agent(
        "draft-offer",
        "Draft offer packet",
        "write",
        "Draft offer email, start date checklist, and compensation summary.",
      ),
      approval("approve-offer", "Approve job offer before sending."),
      connectorAction(
        "create-offer-record",
        "Create offer record",
        "appforge-core",
        "records",
        "records.create",
        {
          base: "HR Ops",
          table: "Offers",
          candidate_id: "{{trigger.payload.recordId}}",
          packet: "{{steps.draft-offer.output.text}}",
        },
      ),
      emailOutput(
        "send-offer",
        "Offer details",
        OPERATOR_EMAIL,
        "{{steps.draft-offer.output.text}}",
      ),
      docOutput(
        "offer-run-log",
        "Offer Draft Log",
        "## Offer packet\n{{steps.draft-offer.output.text}}\n\n## Offer record\n{{steps.create-offer-record.output.text}}",
      ),
    ],
    dependencies: [{ kind: "appforge_base", id: "hr-ops", label: "HR Ops" }],
    notes: ["Variation: HR hiring workflow for small teams."],
  }),
  makePackage({
    slug: "webinar-follow-up",
    name: "Webinar Follow-Up",
    description: "Segment webinar attendees and draft appropriate follow-up messages.",
    scenario: scenario("marketing", "webhook", "Webinar attendance imported", ["Events", "Leads"]),
    trigger: trigger("trigger", "webhook", { webhookPath: "/workflows/webinar-follow-up" }),
    nodes: [
      connectorAction(
        "create-attendee-rows",
        "Create attendee rows",
        "appforge-core",
        "records",
        "records.create_many",
        {
          base: "Marketing Ops",
          table: "Event Attendees",
          attendees: "{{trigger.payload.attendees}}",
        },
      ),
      agent(
        "segment-attendees",
        "Segment attendees",
        "analyze",
        "Segment attendees by engagement and draft follow-up categories.",
      ),
      connectorAction(
        "create-follow-up-tasks",
        "Create follow-up tasks",
        "appforge-core",
        "records",
        "records.create_many",
        {
          base: "Marketing Ops",
          table: "Tasks",
          tasks: "{{steps.segment-attendees.output.json.tasks}}",
        },
      ),
      approval("approve-segments", "Approve follow-up segment copy."),
      emailOutput(
        "send-webinar-follow-up",
        "Thanks for joining",
        OPERATOR_EMAIL,
        "{{steps.segment-attendees.output.text}}",
      ),
      docOutput(
        "webinar-run-log",
        "Webinar Follow-Up Log",
        "## Segments\n{{steps.segment-attendees.output.text}}\n\n## Task creation\n{{steps.create-follow-up-tasks.output.text}}",
      ),
    ],
    dependencies: [{ kind: "appforge_base", id: "marketing-ops", label: "Marketing Ops" }],
    notes: ["Variation: event marketing and lead nurture."],
  }),
];

export const OWNER_OPERATOR_WORKFLOW_VARIATION_SLUGS = [
  "abandoned-cart-recovery",
  "job-offer-draft",
  "webinar-follow-up",
  "operations-cleanup",
  "monthly-owner-report",
];
