import { describe, expect, it, vi } from "vitest";
import type { OperatorAlertEvent } from "./operator-alerts.js";
import {
  __operatorAlertRouterTesting,
  createOperatorAlertRouter,
  listOperatorAlertSinkIds,
  registerOperatorAlertSink,
  routeOperatorAlertEvent,
} from "./operator-alert-router.js";

function alertEvent(overrides: Partial<OperatorAlertEvent> = {}): OperatorAlertEvent {
  return {
    schemaVersion: 1,
    id: "alert-1",
    type: "workflow.approval.requested",
    source: "workflows",
    createdAt: "2026-04-27T00:00:00.000Z",
    severity: "action_required",
    privacy: "private",
    title: "Approve deploy",
    summary: "Deploy workflow is waiting.",
    body: "Approve the deployment after review.",
    actions: [],
    audit: {
      requestedAt: "2026-04-27T00:00:00.000Z",
      requestedBy: "workflow",
      requiresOperatorDecision: true,
    },
    ...overrides,
  };
}

describe("operator alert router", () => {
  it("routes with an empty summary when no sinks are registered", async () => {
    const router = createOperatorAlertRouter();

    await expect(router.route(alertEvent())).resolves.toEqual({
      alertId: "alert-1",
      total: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      results: [],
    });
  });

  it("routes to sinks and summarizes sent skipped and failed outcomes", async () => {
    const router = createOperatorAlertRouter();
    const sent = vi.fn(() => ({ status: "sent" as const, message: "spoken" }));
    const skipped = vi.fn(() => ({ status: "skipped" as const, message: "disabled" }));
    const failed = vi.fn(() => {
      throw new Error("speaker failed");
    });

    router.register({ id: "voice", route: sent });
    router.register({ id: "desktop", route: skipped });
    router.register({ id: "bad", route: failed });

    const summary = await router.route(alertEvent(), { source: "test" });

    expect(summary).toMatchObject({
      alertId: "alert-1",
      total: 3,
      sent: 1,
      skipped: 1,
      failed: 1,
    });
    expect(summary.results).toEqual([
      { sinkId: "voice", status: "sent", message: "spoken" },
      { sinkId: "desktop", status: "skipped", message: "disabled" },
      { sinkId: "bad", status: "failed", message: "speaker failed" },
    ]);
    expect(sent).toHaveBeenCalledWith(alertEvent(), { source: "test" });
  });

  it("unregisters only the sink registration it created", async () => {
    const router = createOperatorAlertRouter();
    const first = router.register({ id: "voice", route: () => ({ status: "sent" }) });
    router.register({ id: "voice", route: () => ({ status: "skipped" }) });

    expect(first()).toBe(false);
    expect(router.listSinkIds()).toEqual(["voice"]);
    await expect(router.route(alertEvent())).resolves.toMatchObject({
      sent: 0,
      skipped: 1,
      failed: 0,
    });
  });

  it("supports default module-level registration for gateway wiring", async () => {
    __operatorAlertRouterTesting.clear();
    const unregister = registerOperatorAlertSink({
      id: "voice",
      route: () => ({ status: "sent", details: { mode: "dry-run" } }),
    });

    expect(listOperatorAlertSinkIds()).toEqual(["voice"]);
    await expect(routeOperatorAlertEvent(alertEvent())).resolves.toMatchObject({
      alertId: "alert-1",
      total: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
      results: [{ sinkId: "voice", status: "sent", details: { mode: "dry-run" } }],
    });

    expect(unregister()).toBe(true);
    expect(listOperatorAlertSinkIds()).toEqual([]);
  });
});
