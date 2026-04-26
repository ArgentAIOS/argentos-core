import { describe, expect, it } from "vitest";
import {
  appForgeEventMatchesTriggerConfig,
  normalizeAppForgeWorkflowEvent,
} from "./appforge-workflow-events.js";

describe("AppForge workflow events", () => {
  it.each([
    ["table_created", "forge.table.created"],
    ["table.updated", "forge.table.updated"],
    ["forge.table.deleted", "forge.table.deleted"],
    ["created", "forge.record.created"],
    ["record_updated", "forge.record.updated"],
    ["record.deleted", "forge.record.deleted"],
    ["review_requested", "forge.review.requested"],
    ["review.completed", "forge.review.completed"],
    ["capability_completed", "forge.capability.completed"],
  ])("normalizes %s to %s", (alias, eventType) => {
    const event = normalizeAppForgeWorkflowEvent({
      eventType: alias,
      appId: "app-1",
    });

    expect(event.eventType).toBe(eventType);
    expect(event.payload.eventType).toBe(eventType);
  });

  it("normalizes record aliases into canonical workflow events", () => {
    const event = normalizeAppForgeWorkflowEvent({
      action: "record_updated",
      appId: "app-1",
      tableId: "table-1",
      recordId: "record-1",
      payload: { status: "ready" },
    });

    expect(event).toMatchObject({
      eventType: "forge.record.updated",
      appId: "app-1",
      payload: {
        source: "appforge",
        eventType: "forge.record.updated",
        appId: "app-1",
        tableId: "table-1",
        recordId: "record-1",
        status: "ready",
      },
    });
    expect(typeof event.payload.emittedAt).toBe("string");
  });

  it("normalizes table events for workflow triggers and waits", () => {
    const event = normalizeAppForgeWorkflowEvent({
      action: "table_updated",
      appId: "app-1",
      tableId: "table-1",
      payload: {
        changeType: "field.updated",
        tableName: "Campaign Review",
      },
    });

    expect(event).toMatchObject({
      eventType: "forge.table.updated",
      appId: "app-1",
      payload: {
        source: "appforge",
        eventType: "forge.table.updated",
        appId: "app-1",
        tableId: "table-1",
        changeType: "field.updated",
        tableName: "Campaign Review",
      },
    });
  });

  it("preserves custom capability event types and workflow resume targeting", () => {
    const event = normalizeAppForgeWorkflowEvent({
      eventType: "app.asset.approved",
      appId: "app-1",
      capabilityId: "campaign_review",
      workflowRunId: "run-1",
      nodeId: "wait-review",
      decision: "approved",
      emittedAt: "2026-04-25T20:00:00.000Z",
    });

    expect(event).toEqual({
      eventType: "app.asset.approved",
      appId: "app-1",
      capabilityId: "campaign_review",
      workflowRunId: "run-1",
      nodeId: "wait-review",
      payload: {
        source: "appforge",
        eventType: "app.asset.approved",
        appId: "app-1",
        capabilityId: "campaign_review",
        workflowRunId: "run-1",
        nodeId: "wait-review",
        decision: "approved",
        emittedAt: "2026-04-25T20:00:00.000Z",
      },
    });
  });

  it("requires an app id and event type", () => {
    expect(() => normalizeAppForgeWorkflowEvent({ appId: "app-1" })).toThrow(
      "eventType is required",
    );
    expect(() => normalizeAppForgeWorkflowEvent({ eventType: "forge.record.created" })).toThrow(
      "appId is required",
    );
  });

  it("matches AppForge trigger configs by app, capability, event, and payload filter", () => {
    const event = normalizeAppForgeWorkflowEvent({
      eventType: "forge.review.completed",
      appId: "app-1",
      capabilityId: "campaign_review",
      decision: "approved",
      payload: { record: { status: "ready" } },
    });

    expect(
      appForgeEventMatchesTriggerConfig(event, {
        appId: "app-1",
        capabilityId: "campaign_review",
        eventType: "forge.review.completed",
        eventFilter: { decision: "approved", record: { status: "ready" } },
      }),
    ).toBe(true);
    expect(appForgeEventMatchesTriggerConfig(event, { appId: "other-app" })).toBe(false);
    expect(appForgeEventMatchesTriggerConfig(event, { eventType: "forge.record.updated" })).toBe(
      false,
    );
    expect(appForgeEventMatchesTriggerConfig(event, { eventFilter: { decision: "denied" } })).toBe(
      false,
    );
  });
});
