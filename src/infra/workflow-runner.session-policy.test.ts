import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { createArgentCodingTools } from "../agents/pi-tools.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { buildWorkflowAgentSessionKey, seedWorkflowSessionToolPolicy } from "./workflow-runner.js";

/**
 * Regression: workflow agent nodes declared toolsAllow, but the dispatcher
 * rendered it only as prose in the prompt — the embedded session ran with the
 * FULL tool set. That is how the "MSP Morning Podcast 2" workflow's draft
 * agent was able to save new active, cron-scheduled copies of its own
 * workflow every morning (143 copies by 2026-07-02). The grants must be
 * seeded onto the session entry so pi-tools enforces them structurally, the
 * same seam Worker Runtime v2 ephemeral sessions use.
 */
describe("seedWorkflowSessionToolPolicy", () => {
  let storeDir: string;
  let cfg: ArgentConfig;

  beforeEach(() => {
    storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-workflow-session-policy-"));
    cfg = {
      session: { store: path.join(storeDir, "sessions-{agentId}.json") },
    } as ArgentConfig;
  });

  afterEach(() => {
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it("writes the node grants onto the session entry", async () => {
    const sessionKey = buildWorkflowAgentSessionKey("main", 1234);
    const seeded = await seedWorkflowSessionToolPolicy({
      sessionKey,
      toolsAllow: ["web_search", "doc_panel", "podcast_plan"],
      toolsDeny: ["exec"],
      cfg,
    });
    expect(seeded).toBe(true);

    const storePath = resolveStorePath(cfg.session?.store, { agentId: "main" });
    const store = loadSessionStore(storePath);
    expect(store[sessionKey]).toMatchObject({
      toolsAllow: ["web_search", "doc_panel", "podcast_plan"],
      toolsDeny: ["exec"],
    });
    expect(typeof store[sessionKey]?.sessionId).toBe("string");
  });

  it("no grants declared → seeds nothing (default policy applies)", async () => {
    const sessionKey = buildWorkflowAgentSessionKey("main", 5678);
    const seeded = await seedWorkflowSessionToolPolicy({ sessionKey, cfg });
    expect(seeded).toBe(false);

    const storePath = resolveStorePath(cfg.session?.store, { agentId: "main" });
    const store = loadSessionStore(storePath);
    expect(store[sessionKey]).toBeUndefined();
  });

  it("the model-visible tool registry shrinks to the grants (structural filtering)", async () => {
    const sessionKey = buildWorkflowAgentSessionKey("main", 9012);
    await seedWorkflowSessionToolPolicy({
      sessionKey,
      toolsAllow: ["web_search", "doc_panel"],
      cfg,
    });

    const baseline = createArgentCodingTools({
      config: cfg,
      sessionKey: buildWorkflowAgentSessionKey("main", 9999),
      senderIsOwner: true,
    });
    expect(baseline.length).toBeGreaterThan(20);

    const granted = createArgentCodingTools({
      config: cfg,
      sessionKey,
      senderIsOwner: true,
    });
    const grantedNames = granted.map((tool) => tool.name);
    expect(grantedNames.length).toBeLessThanOrEqual(2);
    // The self-replication vector: workflow-save and messaging tools must be
    // gone when the node only granted research tools.
    expect(grantedNames).not.toContain("message");
    expect(grantedNames).not.toContain("sessions_spawn");
    expect(grantedNames).not.toContain("exec");
  });
});
