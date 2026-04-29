import { describe, expect, it } from "vitest";
import { collectWorkflowSecurityFindings } from "./audit-workflows.js";

describe("workflow security audit collector", () => {
  it("flags embedded secret-like node config keys without exposing values", () => {
    const findings = collectWorkflowSecurityFindings({
      workflows: [
        {
          id: "wf-secret",
          name: "Secret workflow",
          nodes: [
            {
              kind: "action",
              id: "send",
              config: {
                actionType: {
                  type: "api_call",
                  provider: "crm",
                  endpoint: "/contacts",
                  method: "POST",
                  apiKey: "sk_live_do_not_print",
                },
                password: "also-do-not-print",
              },
            },
          ],
        },
      ],
    });

    const finding = findings.find((entry) => entry.checkId === "workflows.secrets.embedded");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("critical");
    expect(finding?.detail).toContain("config.actionType.apiKey");
    expect(finding?.detail).toContain("config.password");
    expect(finding?.detail).not.toContain("sk_live_do_not_print");
    expect(finding?.detail).not.toContain("also-do-not-print");
  });

  it("requires approval metadata or safe mode for detectable live side-effect actions", () => {
    const findings = collectWorkflowSecurityFindings({
      workflows: [
        {
          id: "wf-actions",
          deploymentStage: "live",
          nodes: [
            {
              kind: "action",
              id: "live-email",
              config: {
                actionType: { type: "send_email", to: "ops@example.com", subject: "Hi" },
              },
            },
            {
              kind: "action",
              id: "approved-email",
              config: {
                operatorApprovedLive: true,
                actionType: { type: "send_email", to: "ops@example.com", subject: "Hi" },
              },
            },
            {
              kind: "action",
              id: "dry-run-webhook",
              config: {
                dryRun: true,
                actionType: { type: "webhook_call", url: "https://example.com/hook" },
              },
            },
          ],
        },
      ],
    });

    const liveFindings = findings.filter(
      (entry) => entry.checkId === "workflows.actions.live_requires_approval",
    );
    expect(liveFindings).toHaveLength(1);
    expect(liveFindings[0]?.detail).toContain("live-email");
  });

  it("warns when scheduled workflows lack matching enabled cron evidence", () => {
    const findings = collectWorkflowSecurityFindings({
      workflows: [
        {
          id: "wf-scheduled",
          name: "Scheduled workflow",
          nodes: [
            {
              kind: "trigger",
              id: "schedule",
              triggerType: "schedule",
              config: { cronExpr: "0 9 * * *" },
            },
          ],
        },
        {
          id: "wf-reconciled",
          name: "Reconciled workflow",
          nodes: [
            {
              kind: "trigger",
              id: "schedule",
              triggerType: "schedule",
              config: { cronExpr: "0 10 * * *" },
            },
          ],
        },
      ],
      cronSnapshots: {
        jobs: [
          {
            id: "job-1",
            enabled: true,
            payload: { kind: "workflowRun", workflowId: "wf-reconciled" },
          },
        ],
      },
    });

    const scheduleFindings = findings.filter(
      (entry) => entry.checkId === "workflows.schedule.missing_cron_evidence",
    );
    expect(scheduleFindings).toHaveLength(1);
    expect(scheduleFindings[0]?.detail).toContain("wf-scheduled");
  });

  it("reconciles scheduled workflow rows by cron job ID and detects stale scheduler rows", () => {
    const findings = collectWorkflowSecurityFindings({
      workflowSnapshots: {
        records: [
          {
            id: "wf-cron-id",
            schedule: { cronJobId: "cron-wf-cron-id", cronExpr: "30 6 * * *" },
            nodes: [
              {
                kind: "trigger",
                id: "schedule",
                triggerType: "schedule",
                config: { cronExpr: "30 6 * * *" },
              },
            ],
          },
        ],
      },
      cronSnapshots: {
        jobs: [
          {
            id: "cron-wf-cron-id",
            enabled: true,
            cronExpression: "30 6 * * *",
            payload: { kind: "workflowRun", workflowId: "wf-cron-id" },
          },
          {
            id: "cron-stale",
            enabled: true,
            payload: { kind: "workflowRun", workflowId: "wf-stale" },
          },
        ],
      },
    });

    expect(
      findings.filter((entry) => entry.checkId === "workflows.schedule.missing_cron_evidence"),
    ).toHaveLength(0);
    const orphanFindings = findings.filter(
      (entry) => entry.checkId === "workflows.schedule.orphan_cron_workflow",
    );
    expect(orphanFindings).toHaveLength(1);
  });

  it("warns when workflow and scheduler cron expressions differ", () => {
    const findings = collectWorkflowSecurityFindings({
      workflows: [
        {
          id: "wf-mismatch",
          nodes: [
            {
              kind: "trigger",
              id: "schedule",
              triggerType: "schedule",
              config: { cronExpr: "30 6 * * *" },
            },
          ],
        },
      ],
      cronJobs: [
        {
          id: "cron-wf-mismatch",
          enabled: true,
          cronExpression: "0 9 * * *",
          payload: { workflowId: "wf-mismatch" },
        },
      ],
    });

    const mismatchFindings = findings.filter(
      (entry) => entry.checkId === "workflows.schedule.cron_expression_mismatch",
    );
    expect(mismatchFindings).toHaveLength(1);
    expect(mismatchFindings[0]?.detail).toContain("wf-mismatch");
  });

  it("requires validate, dry-run, and run-now evidence for live side-effect workflows", () => {
    const findings = collectWorkflowSecurityFindings({
      workflows: [
        {
          id: "wf-live-ready",
          deploymentStage: "live",
          readiness: {
            validationResult: { ok: true },
            dryRunResult: { ok: true },
            runNowResult: { ok: true },
          },
          nodes: [
            {
              kind: "action",
              id: "ready-podcast",
              config: {
                operatorApprovedLive: true,
                actionType: { type: "podcast_generate", title: "Brief" },
              },
            },
          ],
          toolsAllow: ["podcast_generate"],
        },
        {
          id: "wf-live-missing",
          deploymentStage: "live",
          readiness: { validationResult: { ok: true } },
          nodes: [
            {
              kind: "action",
              id: "missing-evidence",
              config: {
                operatorApprovedLive: true,
                actionType: { type: "send_email", to: "ops@example.com", subject: "Brief" },
              },
            },
          ],
        },
      ],
    });

    const splitFindings = findings.filter(
      (entry) => entry.checkId === "workflows.actions.missing_execution_split_evidence",
    );
    expect(splitFindings).toHaveLength(1);
    expect(splitFindings[0]?.detail).toContain("wf-live-missing");
    expect(splitFindings[0]?.detail).toContain("dry-run");
    expect(splitFindings[0]?.detail).toContain("run-now");
    expect(splitFindings[0]?.detail).not.toContain("ops@example.com");
  });

  it("requires podcast actions to expose matching capability or tool wiring", () => {
    const findings = collectWorkflowSecurityFindings({
      workflows: [
        {
          id: "wf-podcast-wired",
          nodes: [
            {
              kind: "action",
              id: "wired-generate",
              config: { actionType: { type: "podcast_generate", title: "Brief" } },
            },
            {
              type: "toolGrant",
              id: "tool-podcast-generate",
              data: {
                subPortType: "tool_grant",
                config: { capabilityId: "podcast_generate", toolName: "podcast_generate" },
              },
            },
          ],
        },
        {
          id: "wf-podcast-unwired",
          nodes: [
            {
              kind: "action",
              id: "unwired-plan",
              config: { actionType: { type: "podcast_plan", title: "Brief" } },
            },
          ],
        },
      ],
    });

    const podcastFindings = findings.filter(
      (entry) => entry.checkId === "workflows.podcast.missing_capability_wiring",
    );
    expect(podcastFindings).toHaveLength(1);
    expect(podcastFindings[0]?.detail).toContain("unwired-plan");
    expect(podcastFindings[0]?.detail).toContain("podcast_plan");
  });

  it("requires explicit destinations for delivery and output nodes", () => {
    const findings = collectWorkflowSecurityFindings({
      workflows: [
        {
          id: "wf-output",
          nodes: [
            {
              kind: "output",
              id: "missing-output",
              config: { outputType: "channel", template: "hello" },
            },
            {
              kind: "output",
              id: "present-output",
              config: { outputType: "channel", channelId: "alerts", template: "hello" },
            },
            {
              kind: "action",
              id: "missing-delivery-action",
              config: { actionType: { type: "send_message", template: "hello" } },
            },
          ],
        },
      ],
    });

    const destinationFindings = findings.filter(
      (entry) => entry.checkId === "workflows.output.missing_destination",
    );
    expect(destinationFindings).toHaveLength(2);
    expect(destinationFindings.map((entry) => entry.detail).join("\n")).toContain("missing-output");
    expect(destinationFindings.map((entry) => entry.detail).join("\n")).toContain(
      "missing-delivery-action",
    );
  });
});
