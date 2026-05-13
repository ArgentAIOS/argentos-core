import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAppForgeEventJournal,
  kindFromAppForgeEventType,
  matchesAppForgeEventFilter,
  resolveAppForgeEventJournalPaths,
  scopeFromAppForgeEvent,
  type AppForgeJournalEvent,
} from "./appforge-event-journal.js";
import { normalizeAppForgeWorkflowEvent } from "./appforge-workflow-events.js";

async function makeJournalDir(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "appforge-event-journal-"));
}

function makeNormalized(overrides: Record<string, unknown> = {}) {
  return normalizeAppForgeWorkflowEvent({
    eventType: "forge.record.created",
    appId: "forge-app-1",
    baseId: "base-1",
    tableId: "table-1",
    recordId: "rec-1",
    payload: { values: { name: "Alice" } },
    ...overrides,
  });
}

describe("appforge event journal", () => {
  describe("scope + kind extraction", () => {
    it("maps forge.* eventTypes to canonical short kinds", () => {
      expect(kindFromAppForgeEventType("forge.record.created")).toBe("record.created");
      expect(kindFromAppForgeEventType("forge.table.updated")).toBe("table.updated");
      expect(kindFromAppForgeEventType("forge.capability.completed")).toBe("capability.completed");
    });

    it("falls back to verbatim for unknown event types", () => {
      expect(kindFromAppForgeEventType("custom.kind")).toBe("custom.kind");
      expect(kindFromAppForgeEventType("forge.future.thing")).toBe("future.thing");
    });

    it("derives scope from the normalized event payload", () => {
      const scope = scopeFromAppForgeEvent(makeNormalized());
      expect(scope).toEqual({
        appId: "forge-app-1",
        baseId: "base-1",
        tableId: "table-1",
        recordId: "rec-1",
      });
    });

    it("includes capabilityId when present", () => {
      const event = normalizeAppForgeWorkflowEvent({
        eventType: "forge.capability.completed",
        appId: "app-1",
        capabilityId: "review",
      });
      expect(scopeFromAppForgeEvent(event)).toEqual({
        appId: "app-1",
        capabilityId: "review",
      });
    });
  });

  describe("filter matching", () => {
    const event: AppForgeJournalEvent = {
      id: 1,
      eventType: "forge.record.created",
      kind: "record.created",
      scope: { appId: "app-1", baseId: "base-1", tableId: "table-1", recordId: "rec-1" },
      actor: null,
      before: null,
      after: null,
      payload: {},
      timestamp: "2026-05-13T12:00:00.000Z",
      recordedAtMs: 1,
    };

    it("accepts everything when no filter", () => {
      expect(matchesAppForgeEventFilter(event, undefined)).toBe(true);
      expect(matchesAppForgeEventFilter(event, {})).toBe(true);
    });

    it("filters by kind", () => {
      expect(matchesAppForgeEventFilter(event, { kinds: ["record.created"] })).toBe(true);
      expect(matchesAppForgeEventFilter(event, { kinds: ["record.deleted"] })).toBe(false);
    });

    it("filters by partial scope (AND semantics across keys)", () => {
      expect(matchesAppForgeEventFilter(event, { scope: { appId: "app-1" } })).toBe(true);
      expect(
        matchesAppForgeEventFilter(event, { scope: { appId: "app-1", tableId: "table-1" } }),
      ).toBe(true);
      expect(matchesAppForgeEventFilter(event, { scope: { appId: "app-2" } })).toBe(false);
      expect(matchesAppForgeEventFilter(event, { scope: { tableId: "table-other" } })).toBe(false);
    });

    it("ignores empty-string scope fields", () => {
      expect(matchesAppForgeEventFilter(event, { scope: { appId: "" } })).toBe(true);
    });
  });

  describe("durable producer + consumer", () => {
    it("appends events with monotonic ids and persists them to disk", async () => {
      const root = await makeJournalDir();
      const journal = createAppForgeEventJournal({ root });

      const first = await journal.append({ event: makeNormalized() });
      const second = await journal.append({
        event: makeNormalized({ recordId: "rec-2", eventType: "forge.record.updated" }),
      });

      expect(first.id).toBe(1);
      expect(second.id).toBe(2);
      expect(second.kind).toBe("record.updated");

      const raw = await readFile(path.join(root, "events.jsonl"), "utf8");
      expect(raw.split("\n").filter(Boolean)).toHaveLength(2);
      expect(raw).toContain("appforge-event-journal-v1");
    });

    it("supports tail-based catch-up via sinceId and scope filter", async () => {
      const root = await makeJournalDir();
      const journal = createAppForgeEventJournal({ root });

      await journal.append({ event: makeNormalized() });
      await journal.append({ event: makeNormalized({ tableId: "table-2", recordId: "rec-2" }) });
      await journal.append({ event: makeNormalized({ recordId: "rec-3" }) });

      const tail = await journal.list({ sinceId: 1, scope: { tableId: "table-1" } });
      expect(tail.map((e) => e.id)).toEqual([3]);
      expect(tail[0]?.scope.tableId).toBe("table-1");
    });

    it("resumes id sequence after restart by reading existing journal", async () => {
      const root = await makeJournalDir();
      const journalA = createAppForgeEventJournal({ root });
      await journalA.append({ event: makeNormalized() });
      await journalA.append({ event: makeNormalized({ recordId: "rec-2" }) });

      // Simulate process restart — fresh journal instance over the same files.
      const journalB = createAppForgeEventJournal({ root });
      expect(await journalB.getLastId()).toBe(2);
      const third = await journalB.append({
        event: makeNormalized({ recordId: "rec-3" }),
      });
      expect(third.id).toBe(3);

      const all = await journalB.list();
      expect(all.map((e) => e.id)).toEqual([1, 2, 3]);
    });

    it("delivers live in-memory events to scoped subscribers", async () => {
      const root = await makeJournalDir();
      const journal = createAppForgeEventJournal({ root });

      const received: AppForgeJournalEvent[] = [];
      const sub = journal.subscribe({ scope: { tableId: "table-1" } }, (evt) => {
        received.push(evt);
      });

      await journal.append({ event: makeNormalized() });
      await journal.append({ event: makeNormalized({ tableId: "table-2", recordId: "rec-2" }) });
      await journal.append({ event: makeNormalized({ recordId: "rec-3" }) });

      sub.unsubscribe();
      expect(received.map((e) => e.scope.recordId)).toEqual(["rec-1", "rec-3"]);
    });

    it("persists consumer registration + cursor across restart", async () => {
      const root = await makeJournalDir();
      const journalA = createAppForgeEventJournal({ root });

      await journalA.append({ event: makeNormalized() });
      await journalA.append({ event: makeNormalized({ recordId: "rec-2" }) });

      const consumer = await journalA.registerConsumer("workflow-engine", {
        kinds: ["record.created"],
      });
      expect(consumer.lastDeliveredId).toBe(0);

      await journalA.acknowledge("workflow-engine", 2);

      // Fresh instance — must observe the persisted cursor.
      const journalB = createAppForgeEventJournal({ root });
      const reloaded = await journalB.getConsumer("workflow-engine");
      expect(reloaded?.lastDeliveredId).toBe(2);
      expect(reloaded?.filter).toEqual({ kinds: ["record.created"] });

      // Now produce a new event after "restart" — consumer can catch up from cursor.
      await journalB.append({ event: makeNormalized({ recordId: "rec-3" }) });
      const tail = await journalB.list({ sinceId: reloaded?.lastDeliveredId ?? 0 });
      expect(tail.map((e) => e.scope.recordId)).toEqual(["rec-3"]);
    });

    it("acknowledge never moves the cursor backwards", async () => {
      const root = await makeJournalDir();
      const journal = createAppForgeEventJournal({ root });
      await journal.registerConsumer("c1", {});
      await journal.acknowledge("c1", 5);
      await journal.acknowledge("c1", 2); // out-of-order ack must be ignored
      const state = await journal.getConsumer("c1");
      expect(state?.lastDeliveredId).toBe(5);
    });

    it("registerConsumer is idempotent — repeated calls preserve the cursor", async () => {
      const root = await makeJournalDir();
      const journal = createAppForgeEventJournal({ root });
      await journal.registerConsumer("c1", { kinds: ["record.created"] });
      await journal.acknowledge("c1", 3);
      const updated = await journal.registerConsumer("c1", { kinds: ["record.updated"] });
      expect(updated.lastDeliveredId).toBe(3);
      expect(updated.filter).toEqual({ kinds: ["record.updated"] });
    });
  });

  describe("path resolution", () => {
    it("uses ARGENT_APPFORGE_EVENT_JOURNAL_DIR when set", () => {
      const paths = resolveAppForgeEventJournalPaths({
        ARGENT_APPFORGE_EVENT_JOURNAL_DIR: "/tmp/journal-dir-1",
        HOME: "/tmp/home",
      });
      expect(paths.root).toBe("/tmp/journal-dir-1");
      expect(paths.eventsPath).toBe("/tmp/journal-dir-1/events.jsonl");
      expect(paths.consumersPath).toBe("/tmp/journal-dir-1/consumers.json");
    });

    it("falls back to ARGENT_STATE_DIR/appforge/events", () => {
      const paths = resolveAppForgeEventJournalPaths({
        ARGENT_STATE_DIR: "/tmp/state-2",
        HOME: "/tmp/home",
      });
      expect(paths.root).toBe("/tmp/state-2/appforge/events");
    });

    it("falls back to ~/.argentos/appforge/events", () => {
      const paths = resolveAppForgeEventJournalPaths({ HOME: "/tmp/home-3" });
      expect(paths.root).toBe("/tmp/home-3/.argentos/appforge/events");
    });
  });
});
