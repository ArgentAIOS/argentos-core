import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendMemoryRecallTelemetry,
  readMemoryRecallTelemetryEntries,
  summarizeMemoryRecallTelemetry,
} from "./memu-recall-telemetry.js";

const tempDirs: string[] = [];

async function createTempFilePath() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "argent-mrql-"));
  tempDirs.push(dir);
  return path.join(dir, "memory-recall.jsonl");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("memu-recall-telemetry", () => {
  it("writes, filters, and summarizes recall telemetry entries", async () => {
    const filePath = await createTempFilePath();

    await appendMemoryRecallTelemetry(
      {
        version: 1,
        ts: 100,
        iso: new Date(100).toISOString(),
        status: "ok",
        tool: "memory_recall",
        toolCallId: "call-1",
        agentId: "argent",
        query: "What's my favorite color?",
        requestedMode: "general",
        resolvedMode: "preferences",
        queryClass: "identity_property",
        deep: true,
        resultCount: 3,
        answer: {
          value: "mossy oak green",
          strategy: "favorite-slot",
          confidence: 0.96,
          sourceId: "item-1",
          sourceType: "profile",
          sourceSummary: "Jason's favorite color is mossy oak green.",
        },
        recallFallback: {
          used: true,
          type: "vector",
          reason: "keyword_sparse",
          added: 5,
        },
        recallTelemetry: {
          queryVariants: ["Jason favorite color", "Jason's favorite color"],
          manualPropertyCandidates: 2,
          manualProjectCandidates: 0,
          preRerankTop: [{ id: "a", type: "behavior", summary: "generic preference", score: 0.8 }],
          postRerankTop: [{ id: "b", type: "profile", summary: "favorite color", score: 1.2 }],
          answerStrategy: "favorite-slot",
          answerSourceId: "item-1",
          vectorFallbackUsed: true,
        },
        topResults: [
          {
            id: "b",
            type: "profile",
            summary: "Jason's favorite color is mossy oak green.",
            score: 1.2,
          },
        ],
      },
      { filePath },
    );

    await appendMemoryRecallTelemetry(
      {
        version: 1,
        ts: 200,
        iso: new Date(200).toISOString(),
        status: "error",
        tool: "memory_recall",
        toolCallId: "call-2",
        agentId: "argent",
        query: "What happened last Tuesday?",
        requestedMode: "general",
        resolvedMode: "timeline",
        queryClass: "timeline_episodic",
        deep: true,
        resultCount: 0,
        error: "adapter unavailable",
      },
      { filePath },
    );

    const identityEntries = await readMemoryRecallTelemetryEntries({
      filePath,
      queryClass: "identity_property",
      limit: 10,
    });
    expect(identityEntries).toHaveLength(1);
    expect(identityEntries[0]?.answer?.value).toBe("mossy oak green");

    const allEntries = await readMemoryRecallTelemetryEntries({ filePath, limit: 10 });
    expect(allEntries).toHaveLength(2);
    expect(allEntries[1]?.status).toBe("error");

    const summary = summarizeMemoryRecallTelemetry(allEntries);
    expect(summary.total).toBe(2);
    expect(summary.ok).toBe(1);
    expect(summary.error).toBe(1);
    expect(summary.answered).toBe(1);
    expect(summary.empty).toBe(1);
    expect(summary.vectorFallbacks).toBe(1);
    expect(summary.queryClasses.identity_property).toBe(1);
    expect(summary.queryClasses.timeline_episodic).toBe(1);
    expect(summary.answerStrategies["favorite-slot"]).toBe(1);
    expect(summary.resolvedModes.preferences).toBe(1);
  });
});
