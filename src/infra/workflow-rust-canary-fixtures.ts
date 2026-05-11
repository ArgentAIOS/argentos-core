import type {
  GateNode,
  OutputNode,
  TriggerNode,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRunStatus,
} from "./workflow-types.js";
import { OWNER_OPERATOR_WORKFLOW_PACKAGES } from "./workflow-owner-operator-templates.js";
import {
  auditWorkflowPackageLiveReadiness,
  type WorkflowPackage,
  type WorkflowPackageLiveReadiness,
  type WorkflowPackageLiveReadinessContext,
} from "./workflow-package.js";

export type WorkflowRustShadowFixtureCaseId =
  | "cron_workflow_run"
  | "waiting_duration"
  | "waiting_event"
  | "waiting_approval"
  | "duplicate_workflow_run_prevention"
  | "stale_cron_cleanup"
  | "rollback_inventory_expectations";

export interface WorkflowRustShadowCronJobFixture {
  id: string;
  enabled: boolean;
  schedule: { kind: "cron"; expr: string; tz?: string };
  payload: { kind: "workflowRun"; workflowId: string };
  state?: Record<string, unknown>;
}

export interface WorkflowRustShadowRunFixture {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  triggerType: string;
  triggerSource: string;
  currentNodeId?: string;
  dedupeKey?: string;
}

export interface WorkflowRustShadowStepFixture {
  id: string;
  runId: string;
  nodeId: string;
  nodeKind: WorkflowNode["kind"];
  status: "running" | "completed" | "failed" | "skipped";
  approvalStatus?: "pending" | "approved" | "denied";
  inputContext?: Record<string, unknown>;
}

export interface WorkflowRustShadowFixtureCase {
  id: WorkflowRustShadowFixtureCaseId;
  label: string;
  contract: string;
  workflow: WorkflowDefinition;
  cronJobs?: WorkflowRustShadowCronJobFixture[];
  runs: WorkflowRustShadowRunFixture[];
  steps: WorkflowRustShadowStepFixture[];
  expected: {
    rustAuthority: "shadow_read_only";
    nodeAuthority: "live";
    allowedRustAction: "compare_only";
    mustNotMutate: string[];
    comparisonKeys: string[];
  };
}

export interface WorkflowRustShadowFixturePack {
  schemaVersion: 1;
  id: "workflows-rust-shadow-canary-fixtures";
  generatedFrom: "synthetic-workflows-owned-contract";
  cases: WorkflowRustShadowFixtureCase[];
}

export interface WorkflowTemplateCanaryProof {
  schemaVersion: 1;
  id: "workflows-template-canary-proof";
  noLiveExternalSideEffects: true;
  families: Array<{
    slug: string;
    familyId: string;
    runPattern: WorkflowPackage["scenario"]["runPattern"];
    appForgeTables: string[];
    dependencyIds: string[];
    dryRunReady: boolean;
    liveReadiness: WorkflowPackageLiveReadiness;
    dryRunToLivePath: Array<{
      stage: "import" | "dry_run" | "canary_required" | "live_ready";
      status: "passed" | "pending" | "blocked";
      evidence: string;
    }>;
  }>;
}

type WorkflowTemplateCanaryStageStatus = "passed" | "pending" | "blocked";

const FIXTURE_NOW = "2026-05-02T10:50:00.000Z";

function trigger(id: string, triggerType: TriggerNode["triggerType"], config = {}): TriggerNode {
  return { kind: "trigger", id, triggerType, config };
}

function waitDurationGate(id: string): GateNode {
  return {
    kind: "gate",
    id,
    label: "Wait duration",
    config: { gateType: "wait_duration", durationMs: 900_000 },
  };
}

function waitEventGate(id: string): GateNode {
  return {
    kind: "gate",
    id,
    label: "Wait for event",
    config: {
      gateType: "wait_event",
      eventType: "forge.record.created",
      eventFilter: { appId: "fixture-app", tableId: "Approvals" },
      timeoutMs: 3_600_000,
      timeoutAction: "fail",
    },
  };
}

function approvalGate(id: string): GateNode {
  return {
    kind: "gate",
    id,
    label: "Operator approval",
    config: {
      gateType: "approval",
      approvers: ["operator"],
      channels: ["dashboard"],
      message: "Approve synthetic Rust shadow fixture.",
      showPreviousOutput: true,
      allowEdit: false,
      timeoutMs: 3_600_000,
      timeoutAction: "deny",
    },
  };
}

function docOutput(id: string): OutputNode {
  return {
    kind: "output",
    id,
    label: "Fixture ledger",
    config: {
      outputType: "docpanel",
      title: "Synthetic fixture ledger",
      format: "markdown",
      contentTemplate: "{{previous.text}}",
    },
  };
}

function workflow(id: string, name: string, nodes: WorkflowNode[]): WorkflowDefinition {
  const edges: WorkflowEdge[] = nodes.slice(0, -1).map((node, index) => ({
    id: `e-${node.id}-${nodes[index + 1].id}`,
    source: node.id,
    target: nodes[index + 1].id,
  }));
  return {
    id,
    name,
    nodes,
    edges,
    defaultOnError: { strategy: "fail", notifyOnError: true },
    deploymentStage: "simulate",
    maxRunDurationMs: 1_800_000,
  };
}

function expected(comparisonKeys: string[]): WorkflowRustShadowFixtureCase["expected"] {
  return {
    rustAuthority: "shadow_read_only",
    nodeAuthority: "live",
    allowedRustAction: "compare_only",
    mustNotMutate: ["workflow_runs", "workflow_step_runs", "cron jobs", "approvals"],
    comparisonKeys,
  };
}

export function buildWorkflowRustShadowFixturePack(): WorkflowRustShadowFixturePack {
  const cronWorkflow = workflow("wf-rust-fixture-cron", "Rust shadow cron workflowRun", [
    trigger("trigger-cron", "schedule", { cronExpr: "*/15 * * * *", timezone: "UTC" }),
    docOutput("out-cron"),
  ]);
  const waitDurationWorkflow = workflow(
    "wf-rust-fixture-wait-duration",
    "Rust shadow wait duration",
    [
      trigger("trigger-duration", "manual"),
      waitDurationGate("wait-duration"),
      docOutput("out-duration"),
    ],
  );
  const waitEventWorkflow = workflow("wf-rust-fixture-wait-event", "Rust shadow wait event", [
    trigger("trigger-event", "manual"),
    waitEventGate("wait-event"),
    docOutput("out-event"),
  ]);
  const approvalWorkflow = workflow("wf-rust-fixture-approval", "Rust shadow approval", [
    trigger("trigger-approval", "manual"),
    approvalGate("approval"),
    docOutput("out-approval"),
  ]);

  return {
    schemaVersion: 1,
    id: "workflows-rust-shadow-canary-fixtures",
    generatedFrom: "synthetic-workflows-owned-contract",
    cases: [
      {
        id: "cron_workflow_run",
        label: "Cron workflowRun dispatch",
        contract: "Cron payloads use isolated workflowRun jobs and compare trigger/run shape only.",
        workflow: cronWorkflow,
        cronJobs: [
          {
            id: "cron-rust-fixture-primary",
            enabled: true,
            schedule: { kind: "cron", expr: "*/15 * * * *", tz: "UTC" },
            payload: { kind: "workflowRun", workflowId: cronWorkflow.id },
            state: { nextRunAtMs: Date.parse(FIXTURE_NOW) },
          },
        ],
        runs: [
          {
            id: "run-rust-fixture-cron",
            workflowId: cronWorkflow.id,
            status: "completed",
            triggerType: "cron",
            triggerSource: "cron:cron-rust-fixture-primary",
            dedupeKey: "workflowRun:cron-rust-fixture-primary:2026-05-02T10:45:00.000Z",
          },
        ],
        steps: [
          {
            id: "step-run-rust-fixture-cron-out-cron",
            runId: "run-rust-fixture-cron",
            nodeId: "out-cron",
            nodeKind: "output",
            status: "completed",
          },
        ],
        expected: expected(["workflowId", "triggerSource", "dedupeKey", "status"]),
      },
      {
        id: "waiting_duration",
        label: "Durable wait_duration pause",
        contract: "A duration wait is represented as a waiting run plus one running gate step.",
        workflow: waitDurationWorkflow,
        runs: [
          {
            id: "run-rust-fixture-wait-duration",
            workflowId: waitDurationWorkflow.id,
            status: "waiting_duration",
            triggerType: "manual",
            triggerSource: "manual:test",
            currentNodeId: "wait-duration",
          },
        ],
        steps: [
          {
            id: "step-run-rust-fixture-wait-duration-wait-duration",
            runId: "run-rust-fixture-wait-duration",
            nodeId: "wait-duration",
            nodeKind: "gate",
            status: "running",
            inputContext: { waitResumeAt: "2026-05-02T11:05:00.000Z", durationMs: 900_000 },
          },
        ],
        expected: expected(["status", "currentNodeId", "inputContext.waitResumeAt"]),
      },
      {
        id: "waiting_event",
        label: "Durable wait_event pause",
        contract:
          "An event wait is represented as waiting_event until Node claims a matching event.",
        workflow: waitEventWorkflow,
        runs: [
          {
            id: "run-rust-fixture-wait-event",
            workflowId: waitEventWorkflow.id,
            status: "waiting_event",
            triggerType: "manual",
            triggerSource: "manual:test",
            currentNodeId: "wait-event",
          },
        ],
        steps: [
          {
            id: "step-run-rust-fixture-wait-event-wait-event",
            runId: "run-rust-fixture-wait-event",
            nodeId: "wait-event",
            nodeKind: "gate",
            status: "running",
            inputContext: { eventType: "forge.record.created", appId: "fixture-app" },
          },
        ],
        expected: expected(["status", "currentNodeId", "inputContext.eventType"]),
      },
      {
        id: "waiting_approval",
        label: "Durable approval pause",
        contract:
          "An approval wait is represented as waiting_approval with pending approval status.",
        workflow: approvalWorkflow,
        runs: [
          {
            id: "run-rust-fixture-approval",
            workflowId: approvalWorkflow.id,
            status: "waiting_approval",
            triggerType: "manual",
            triggerSource: "manual:test",
            currentNodeId: "approval",
          },
        ],
        steps: [
          {
            id: "step-run-rust-fixture-approval-approval",
            runId: "run-rust-fixture-approval",
            nodeId: "approval",
            nodeKind: "gate",
            status: "running",
            approvalStatus: "pending",
          },
        ],
        expected: expected(["status", "currentNodeId", "approvalStatus"]),
      },
      {
        id: "duplicate_workflow_run_prevention",
        label: "Duplicate workflowRun prevention",
        contract: "Same workflowRun dedupe key must compare to one Node-owned run claim.",
        workflow: cronWorkflow,
        cronJobs: [
          {
            id: "cron-rust-fixture-duplicate-a",
            enabled: true,
            schedule: { kind: "cron", expr: "*/15 * * * *", tz: "UTC" },
            payload: { kind: "workflowRun", workflowId: cronWorkflow.id },
          },
          {
            id: "cron-rust-fixture-duplicate-b",
            enabled: true,
            schedule: { kind: "cron", expr: "*/15 * * * *", tz: "UTC" },
            payload: { kind: "workflowRun", workflowId: cronWorkflow.id },
          },
        ],
        runs: [
          {
            id: "run-rust-fixture-duplicate-primary",
            workflowId: cronWorkflow.id,
            status: "running",
            triggerType: "cron",
            triggerSource: "cron:cron-rust-fixture-duplicate-a",
            dedupeKey: "workflowRun:wf-rust-fixture-cron:2026-05-02T10:45:00.000Z",
          },
        ],
        steps: [],
        expected: expected(["workflowId", "dedupeKey", "runs.length"]),
      },
      {
        id: "stale_cron_cleanup",
        label: "Stale cron cleanup",
        contract: "Rust may detect stale/duplicate cron jobs, but Node owns cleanup mutation.",
        workflow: cronWorkflow,
        cronJobs: [
          {
            id: "cron-rust-fixture-current",
            enabled: true,
            schedule: { kind: "cron", expr: "*/15 * * * *", tz: "UTC" },
            payload: { kind: "workflowRun", workflowId: cronWorkflow.id },
          },
          {
            id: "cron-rust-fixture-stale",
            enabled: true,
            schedule: { kind: "cron", expr: "0 0 * * *", tz: "UTC" },
            payload: { kind: "workflowRun", workflowId: cronWorkflow.id },
            state: { staleBecause: "schedule_mismatch" },
          },
        ],
        runs: [],
        steps: [],
        expected: expected(["cronJobs[].payload.workflowId", "cronJobs[].schedule.expr"]),
      },
      {
        id: "rollback_inventory_expectations",
        label: "Rollback inventory expectations",
        contract:
          "Rollback remains read-only inventory until a durable authority record exists for in-flight runs.",
        workflow: waitEventWorkflow,
        runs: [
          {
            id: "run-rust-fixture-rollback-wait",
            workflowId: waitEventWorkflow.id,
            status: "waiting_event",
            triggerType: "manual",
            triggerSource: "manual:test",
            currentNodeId: "wait-event",
          },
          {
            id: "run-rust-fixture-rollback-running",
            workflowId: cronWorkflow.id,
            status: "running",
            triggerType: "cron",
            triggerSource: "cron:cron-rust-fixture-primary",
          },
        ],
        steps: [],
        expected: expected(["runs[].status", "runs[].currentNodeId", "cronJobs[].enabled"]),
      },
    ],
  };
}

export function buildWorkflowTemplateCanaryProof(
  context: WorkflowPackageLiveReadinessContext = {},
): WorkflowTemplateCanaryProof {
  const families = OWNER_OPERATOR_WORKFLOW_PACKAGES.filter(
    (workflowPackage) =>
      workflowPackage.dependencies?.some((dependency) =>
        ["connector", "channel", "appforge_base"].includes(dependency.kind),
      ) === true,
  ).map((workflowPackage) => {
    const liveReadiness = auditWorkflowPackageLiveReadiness(workflowPackage, context);
    const dryRunReady = workflowPackage.testFixtures?.pinnedOutputs !== undefined;
    const importStatus: WorkflowTemplateCanaryStageStatus = dryRunReady ? "passed" : "blocked";
    const canaryStatus: WorkflowTemplateCanaryStageStatus =
      liveReadiness.status === "live_ready"
        ? "passed"
        : liveReadiness.status === "canary_required"
          ? "pending"
          : "blocked";
    const liveStatus: WorkflowTemplateCanaryStageStatus =
      liveReadiness.status === "live_ready" ? "passed" : "blocked";
    return {
      slug: workflowPackage.slug,
      familyId: liveReadiness.canary.familyId,
      runPattern: workflowPackage.scenario.runPattern,
      appForgeTables: workflowPackage.scenario.appForgeTables ?? [],
      dependencyIds: (workflowPackage.dependencies ?? []).map(
        (dependency) => `${dependency.kind}:${dependency.id}`,
      ),
      dryRunReady,
      liveReadiness,
      dryRunToLivePath: [
        {
          stage: "import" as const,
          status: importStatus,
          evidence: dryRunReady
            ? "Package normalizes and includes pinned fixtures for side-effect-free import."
            : "Package is missing pinned fixture coverage.",
        },
        {
          stage: "dry_run" as const,
          status: importStatus,
          evidence: "Pinned fixture execution is the only approved proof before live canary.",
        },
        {
          stage: "canary_required" as const,
          status: canaryStatus,
          evidence: liveReadiness.canary.checklist
            .map((item) => `${item.id}:${item.status}`)
            .join(", "),
        },
        {
          stage: "live_ready" as const,
          status: liveStatus,
          evidence: liveReadiness.okForLive
            ? "All live bindings and family canary proof are present."
            : liveReadiness.reasons.map((reason) => reason.code).join(", "),
        },
      ],
    };
  });
  return {
    schemaVersion: 1,
    id: "workflows-template-canary-proof",
    noLiveExternalSideEffects: true,
    families,
  };
}
