import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureMemuSchema } from "./memu-schema.js";
import { MemuStore } from "./memu-store.js";
import { closeDatabase, openDatabase, type DatabaseSync } from "./sqlite.js";

describe("personal skill candidates", () => {
  let dbPath: string;
  let db: DatabaseSync;
  let store: MemuStore;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-personal-skill-"));
    dbPath = path.join(dir, "memory.db");
    db = openDatabase(dbPath);
    ensureMemuSchema(db);
    store = new MemuStore(db);
  });

  afterEach(async () => {
    closeDatabase(db);
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("creates, lists, and updates personal skill candidates", () => {
    const created = store.createPersonalSkillCandidate({
      agentId: "main",
      operatorId: "jason",
      scope: "operator",
      title: "Use the podcast publish pipeline payload template",
      summary: "Turn repeated podcast workflow preparation into a reusable procedure.",
      triggerPatterns: ["podcast", "pipeline", "episode"],
      preconditions: ["When podcast payload work is active"],
      executionSteps: ["Start from the v2 payload", "Verify stages", "Record evidence"],
      expectedOutcomes: ["A verified payload with evidence attached"],
      relatedTools: ["doc_panel", "podcast_publish_pipeline"],
      sourceLessonIds: ["lesson-1"],
      evidenceCount: 2,
      recurrenceCount: 2,
      confidence: 0.82,
    });

    expect(created).not.toBeNull();
    expect(created?.state).toBe("candidate");
    expect(created?.scope).toBe("operator");
    expect(created?.executionSteps).toContain("Verify stages");

    const listed = store.listPersonalSkillCandidates({ limit: 10 });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toContain("podcast publish pipeline");

    const updated = store.updatePersonalSkillCandidate(created!.id, {
      state: "incubating",
      lastReviewedAt: "2026-04-15T12:00:00.000Z",
      procedureOutline: "1. Start from the v2 payload.\n2. Verify stages.\n3. Record evidence.",
      supersedesCandidateIds: ["older-skill-1"],
    });

    expect(updated?.state).toBe("incubating");
    expect(updated?.procedureOutline).toContain("Start from the v2 payload");
    expect(updated?.lastReviewedAt).toBe("2026-04-15T12:00:00.000Z");
    expect(updated?.supersedesCandidateIds).toContain("older-skill-1");
  });
});
