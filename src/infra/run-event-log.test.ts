import { describe, expect, it } from "vitest";
import type { RunEvent } from "../data/types.js";
import {
  appendRunEvent,
  makeRunEvent,
  readRunEventsFromMetadata,
  writeRunEventsToMetadata,
} from "./run-event-log.js";

describe("run-event-log (D7)", () => {
  it("makeRunEvent stamps ts and omits empty detail", () => {
    expect(makeRunEvent("claimed", undefined, 1000)).toEqual({ ts: 1000, type: "claimed" });
    expect(makeRunEvent("tool_call", {}, 1000)).toEqual({ ts: 1000, type: "tool_call" });
    expect(makeRunEvent("tool_call", { name: "tasks", granted: true }, 1000)).toEqual({
      ts: 1000,
      type: "tool_call",
      detail: { name: "tasks", granted: true },
    });
  });

  it("appendRunEvent pushes onto the runner buffer in order and returns the event", () => {
    const buffer: RunEvent[] = [];
    appendRunEvent(buffer, "claimed", undefined, 1);
    appendRunEvent(buffer, "spawned", undefined, 2);
    const reported = appendRunEvent(buffer, "report", { outcome: "done" }, 3);
    expect(buffer.map((e) => e.type)).toEqual(["claimed", "spawned", "report"]);
    expect(reported).toEqual({ ts: 3, type: "report", detail: { outcome: "done" } });
  });

  it("round-trips events through metadata persistence", () => {
    const buffer: RunEvent[] = [];
    appendRunEvent(buffer, "claimed", undefined, 1);
    appendRunEvent(buffer, "killed", { reason: "halt" }, 2);
    const metadata = writeRunEventsToMetadata({ intent: "x" }, buffer);
    expect(metadata.intent).toBe("x"); // preserves existing metadata
    expect(readRunEventsFromMetadata(metadata)).toEqual(buffer);
  });

  it("readRunEventsFromMetadata is defensive against missing/garbage", () => {
    expect(readRunEventsFromMetadata(undefined)).toEqual([]);
    expect(readRunEventsFromMetadata({})).toEqual([]);
    expect(readRunEventsFromMetadata({ events: "nope" })).toEqual([]);
    expect(readRunEventsFromMetadata({ events: [{ bad: 1 }, { ts: 5, type: "alive" }] })).toEqual([
      { ts: 5, type: "alive" },
    ]);
  });

  it("writeRunEventsToMetadata does not mutate the input metadata", () => {
    const original = { intent: "x" };
    const next = writeRunEventsToMetadata(original, [makeRunEvent("report", undefined, 1)]);
    expect(original).toEqual({ intent: "x" });
    expect(next).not.toBe(original);
  });
});
