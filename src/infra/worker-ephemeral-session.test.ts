import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { createArgentCodingTools } from "../agents/pi-tools.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { buildWorkerSessionKey, createEphemeralWorkerSession } from "./worker-ephemeral-session.js";

/**
 * Worker Runtime v2 D1: each job run gets a fresh session born with the role
 * profile's grants on the entry — structural default-deny, no mutate/restore
 * of any shared session — and the session is discarded after the run.
 */
describe("ephemeral worker sessions", () => {
  let storeDir: string;
  let cfg: ArgentConfig;

  beforeEach(() => {
    storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-worker-ephemeral-"));
    cfg = {
      session: { store: path.join(storeDir, "sessions-{agentId}.json") },
    } as ArgentConfig;
  });

  afterEach(() => {
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it("creates a per-run session entry carrying the grants, and dispose removes it", async () => {
    const session = await createEphemeralWorkerSession({
      cfg,
      agentId: "main",
      assignmentId: "asg-1",
      runId: "run-1",
      toolsAllow: ["tasks", "work_report"],
      toolsDeny: ["exec"],
    });
    expect(session.sessionKey).toBe(
      buildWorkerSessionKey({ agentId: "main", assignmentId: "asg-1", runId: "run-1" }),
    );

    const storePath = resolveStorePath(cfg.session?.store, { agentId: "main" });
    const store = loadSessionStore(storePath);
    expect(store[session.sessionKey]).toMatchObject({
      sessionId: session.sessionId,
      toolsAllow: ["tasks", "work_report"],
      toolsDeny: ["exec"],
    });

    await session.dispose();
    const afterDispose = loadSessionStore(storePath);
    expect(afterDispose[session.sessionKey]).toBeUndefined();
  });

  it("the model-visible tool registry shrinks to the grants (structural filtering)", async () => {
    const session = await createEphemeralWorkerSession({
      cfg,
      agentId: "main",
      assignmentId: "asg-1",
      runId: "run-2",
      toolsAllow: ["tasks", "memory_recall", "work_report"],
    });

    const baseline = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:worker-execution",
      senderIsOwner: true,
    });
    expect(baseline.length).toBeGreaterThan(20);

    const granted = createArgentCodingTools({
      config: cfg,
      sessionKey: session.sessionKey,
      senderIsOwner: true,
    });
    const grantedNames = granted.map((tool) => tool.name).toSorted();
    expect(grantedNames.length).toBeLessThanOrEqual(3);
    expect(grantedNames).toContain("work_report");
    expect(grantedNames).toContain("tasks");
    expect(grantedNames).not.toContain("exec");
    expect(grantedNames).not.toContain("message");
    expect(grantedNames).not.toContain("sessions_spawn");

    await session.dispose();
  });

  it("dispose removes the transcript file unless ARGENT_WORKER_KEEP_SESSIONS=1", async () => {
    const session = await createEphemeralWorkerSession({
      cfg,
      agentId: "main",
      assignmentId: "asg-1",
      runId: "run-3",
      toolsAllow: ["work_report"],
    });
    // Simulate a run having written a transcript at the default path for this
    // agent/session id (entry has no explicit sessionFile).
    const storePath = resolveStorePath(cfg.session?.store, { agentId: "main" });
    const store = loadSessionStore(storePath);
    const entry = store[session.sessionKey];
    expect(entry).toBeDefined();

    const prevState = process.env.ARGENT_STATE_DIR;
    process.env.ARGENT_STATE_DIR = storeDir;
    try {
      const transcriptDir = path.join(storeDir, "agents", "main", "sessions");
      fs.mkdirSync(transcriptDir, { recursive: true });
      const transcriptPath = path.join(transcriptDir, `${session.sessionId}.jsonl`);
      fs.writeFileSync(transcriptPath, '{"role":"system"}\n');

      await session.dispose();
      expect(fs.existsSync(transcriptPath)).toBe(false);
    } finally {
      if (prevState === undefined) {
        delete process.env.ARGENT_STATE_DIR;
      } else {
        process.env.ARGENT_STATE_DIR = prevState;
      }
    }
  });
});
