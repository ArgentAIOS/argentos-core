import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

import { createScheduledTasksTool } from "./scheduled-tasks-tool.js";

describe("scheduled_tasks tool", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    callGatewayMock.mockResolvedValue({ ok: true });
  });

  it("creates a managed daily scheduled workflow with artifact contracts", async () => {
    const tool = createScheduledTasksTool();
    await tool.execute("call-1", {
      action: "create",
      name: "Morning Brief",
      workflowPrompt: "Research and draft the morning brief, then create handoff artifacts.",
      recurrence: "daily",
      hour: 7,
      minute: 30,
      timeZone: "America/Chicago",
      deliveryChannel: "slack",
      deliveryTo: "channel:C123",
      requireDocPanelDraftTitle: "Morning Brief",
      requireHandoffTaskTitle: "Polish Morning Brief",
      requireDeliveryTaskTitle: "Deliver Morning Brief",
      watchdogAfterMinutes: 10,
    });

    expect(callGatewayMock).toHaveBeenCalledTimes(1);
    const call = callGatewayMock.mock.calls[0]?.[0] as {
      method?: string;
      params?: Record<string, unknown>;
    };
    expect(call.method).toBe("cron.add");
    expect(call.params).toMatchObject({
      name: "Morning Brief",
      description: "[scheduled_tasks]",
      enabled: true,
      deleteAfterRun: false,
      schedule: {
        kind: "cron",
        expr: "30 7 * * *",
        tz: "America/Chicago",
      },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      delivery: {
        mode: "announce",
        channel: "slack",
        to: "channel:C123",
      },
      payload: {
        kind: "agentTurn",
        message: "Research and draft the morning brief, then create handoff artifacts.",
        artifactContract: {
          required: {
            docPanelDraft: { titleIncludes: "Morning Brief" },
            handoffTask: { titleIncludes: "Polish Morning Brief" },
          },
          watchdog: {
            afterMs: 600000,
            announceOnFailure: true,
            required: {
              deliveryTask: { titleIncludes: "Deliver Morning Brief" },
            },
          },
        },
      },
    });
  });

  it("lists only managed scheduled tasks", async () => {
    callGatewayMock.mockResolvedValueOnce({
      jobs: [
        {
          id: "job-managed",
          name: "Morning Brief",
          description: "[scheduled_tasks]\nCreate the brief",
          enabled: true,
          schedule: { kind: "cron", expr: "0 7 * * *", tz: "America/Chicago" },
          wakeMode: "next-heartbeat",
          payload: { kind: "agentTurn", message: "Create the brief" },
          delivery: { mode: "announce" },
        },
        {
          id: "job-raw",
          name: "Raw Cron",
          description: "plain cron",
          enabled: true,
          schedule: { kind: "cron", expr: "*/5 * * * *" },
          wakeMode: "next-heartbeat",
          payload: { kind: "systemEvent", text: "ping" },
        },
      ],
    });

    const tool = createScheduledTasksTool();
    const res = await tool.execute("call-2", { action: "list" });

    expect(callGatewayMock).toHaveBeenCalledTimes(1);
    const text = res.content?.[0];
    expect(text && "text" in text ? text.text : "").toContain("Morning Brief");
    expect(text && "text" in text ? text.text : "").not.toContain("Raw Cron");
  });

  it("updates managed jobs through cron.update", async () => {
    const tool = createScheduledTasksTool();
    await tool.execute("call-3", {
      action: "update",
      jobId: "job-123",
      recurrence: "weekly",
      weekdays: ["mon", "wed", "fri"],
      hour: 8,
      minute: 15,
      workflowPrompt: "Refresh the report and prepare delivery artifacts.",
    });

    const call = callGatewayMock.mock.calls[0]?.[0] as {
      method?: string;
      params?: Record<string, unknown>;
    };
    expect(call.method).toBe("cron.update");
    expect(call.params).toEqual({
      id: "job-123",
      patch: {
        schedule: {
          kind: "cron",
          expr: "15 8 * * MON,WED,FRI",
        },
        payload: {
          kind: "agentTurn",
          message: "Refresh the report and prepare delivery artifacts.",
        },
      },
    });
  });

  it("pauses and resumes jobs by toggling enabled", async () => {
    const tool = createScheduledTasksTool();
    await tool.execute("call-4", { action: "pause", id: "job-1" });
    await tool.execute("call-5", { action: "resume", id: "job-1" });

    expect(callGatewayMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "cron.update",
        params: { id: "job-1", patch: { enabled: false } },
      }),
    );
    expect(callGatewayMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "cron.update",
        params: { id: "job-1", patch: { enabled: true } },
      }),
    );
  });
});
