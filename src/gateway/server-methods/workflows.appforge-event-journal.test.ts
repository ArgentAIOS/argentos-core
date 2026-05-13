import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestFrame } from "../protocol/index.js";
import type { GatewayRequestContext, GatewayRequestHandlerOptions } from "./types.js";
import {
  createAppForgeEventJournal,
  setAppForgeEventJournalForTest,
  type AppForgeEventJournal,
} from "../../infra/appforge-event-journal.js";
import { workflowsHandlers } from "./workflows.js";

async function makeIsolatedJournal(): Promise<AppForgeEventJournal> {
  const root = await mkdtemp(path.join(os.tmpdir(), "appforge-event-journal-handler-"));
  return createAppForgeEventJournal({ root });
}

function makeResponder() {
  return vi.fn<(ok: boolean, payload?: unknown, error?: unknown) => void>();
}

async function invoke(
  method: string,
  params: Record<string, unknown>,
  overrides: Partial<GatewayRequestHandlerOptions> = {},
) {
  const handler = workflowsHandlers[method];
  if (!handler) {
    throw new Error(`missing handler: ${method}`);
  }
  const respond = makeResponder();
  await handler({
    req:
      overrides.req ??
      ({
        type: "req",
        id: `test-${method}`,
        method,
        params,
      } satisfies RequestFrame),
    params,
    client: overrides.client ?? null,
    context: overrides.context ?? ({} as unknown as GatewayRequestContext),
    isWebchatConnect: overrides.isWebchatConnect ?? (() => false),
    respond,
  } satisfies GatewayRequestHandlerOptions);
  return respond;
}

describe("appforge event journal gateway methods", () => {
  let journal: AppForgeEventJournal;

  beforeEach(async () => {
    journal = await makeIsolatedJournal();
    setAppForgeEventJournalForTest(journal);
  });

  it("lists events with scope + sinceId filters", async () => {
    await journal.append({
      event: {
        eventType: "forge.record.created",
        appId: "app-1",
        capabilityId: undefined,
        workflowRunId: undefined,
        nodeId: undefined,
        payload: {
          source: "appforge",
          eventType: "forge.record.created",
          appId: "app-1",
          baseId: "base-1",
          tableId: "table-1",
          recordId: "rec-1",
          emittedAt: "2026-05-13T12:00:00.000Z",
        },
      },
    });
    await journal.append({
      event: {
        eventType: "forge.record.updated",
        appId: "app-1",
        capabilityId: undefined,
        workflowRunId: undefined,
        nodeId: undefined,
        payload: {
          source: "appforge",
          eventType: "forge.record.updated",
          appId: "app-1",
          baseId: "base-1",
          tableId: "table-2",
          recordId: "rec-2",
          emittedAt: "2026-05-13T12:00:01.000Z",
        },
      },
    });
    await journal.append({
      event: {
        eventType: "forge.record.deleted",
        appId: "app-1",
        capabilityId: undefined,
        workflowRunId: undefined,
        nodeId: undefined,
        payload: {
          source: "appforge",
          eventType: "forge.record.deleted",
          appId: "app-1",
          baseId: "base-1",
          tableId: "table-1",
          recordId: "rec-1",
          emittedAt: "2026-05-13T12:00:02.000Z",
        },
      },
    });

    const respond = await invoke("appforge.events.list", {
      sinceId: 1,
      scope: { tableId: "table-1" },
    });

    expect(respond).toHaveBeenCalledTimes(1);
    const [ok, payload] = respond.mock.calls[0]!;
    expect(ok).toBe(true);
    const events = (payload as { events: Array<{ id: number; kind: string }> }).events;
    expect(events.map((e) => e.id)).toEqual([3]);
    expect(events[0]?.kind).toBe("record.deleted");
    expect((payload as { lastId: number }).lastId).toBe(3);
  });

  it("registers a durable consumer and reports pending events", async () => {
    await journal.append({
      event: {
        eventType: "forge.review.completed",
        appId: "app-1",
        capabilityId: "review",
        workflowRunId: undefined,
        nodeId: undefined,
        payload: {
          source: "appforge",
          eventType: "forge.review.completed",
          appId: "app-1",
          capabilityId: "review",
          emittedAt: "2026-05-13T12:00:00.000Z",
        },
      },
    });

    const respond = await invoke("appforge.events.subscribeConsumer", {
      consumerId: "workflow-engine",
      kinds: ["review.completed"],
      scope: { appId: "app-1" },
    });

    expect(respond).toHaveBeenCalledTimes(1);
    const [ok, payload] = respond.mock.calls[0]!;
    expect(ok).toBe(true);
    expect(payload).toMatchObject({
      consumer: {
        consumerId: "workflow-engine",
        lastDeliveredId: 0,
        filter: { kinds: ["review.completed"], scope: { appId: "app-1" } },
      },
      pendingCount: 1,
      nextEventId: 1,
    });

    // Verify cursor persists by reading from journal directly
    const reloaded = await journal.getConsumer("workflow-engine");
    expect(reloaded?.lastDeliveredId).toBe(0);
  });

  it("advances cursor via acknowledge and skips already-delivered events", async () => {
    await journal.append({
      event: {
        eventType: "forge.record.created",
        appId: "app-1",
        capabilityId: undefined,
        workflowRunId: undefined,
        nodeId: undefined,
        payload: {
          source: "appforge",
          eventType: "forge.record.created",
          appId: "app-1",
          emittedAt: "2026-05-13T12:00:00.000Z",
        },
      },
    });

    await invoke("appforge.events.subscribeConsumer", {
      consumerId: "workflow-engine",
      scope: { appId: "app-1" },
    });
    await invoke("appforge.events.acknowledge", {
      consumerId: "workflow-engine",
      eventId: 1,
    });

    // Re-subscribe — should now report zero pending
    const respond = await invoke("appforge.events.subscribeConsumer", {
      consumerId: "workflow-engine",
      scope: { appId: "app-1" },
    });
    const [ok, payload] = respond.mock.calls[0]!;
    expect(ok).toBe(true);
    expect(payload).toMatchObject({
      consumer: { lastDeliveredId: 1 },
      pendingCount: 0,
      nextEventId: 2,
    });
  });

  it("rejects acknowledge without consumerId", async () => {
    const respond = await invoke("appforge.events.acknowledge", { eventId: 1 });
    const [ok, , error] = respond.mock.calls[0]!;
    expect(ok).toBe(false);
    expect(String((error as { message?: string })?.message ?? error)).toContain("consumerId");
  });

  it("rejects acknowledge without eventId", async () => {
    const respond = await invoke("appforge.events.acknowledge", { consumerId: "wf" });
    const [ok, , error] = respond.mock.calls[0]!;
    expect(ok).toBe(false);
    expect(String((error as { message?: string })?.message ?? error)).toContain("eventId");
  });
});
