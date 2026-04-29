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
