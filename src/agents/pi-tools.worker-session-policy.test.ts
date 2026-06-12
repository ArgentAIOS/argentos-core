import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { resolveStorePath, updateSessionStore } from "../config/sessions.js";
import { buildAgentMainSessionKey } from "../routing/session-key.js";
import { createArgentCodingTools } from "./pi-tools.js";

/**
 * Worker-lane tool grants (#442/#407, Worker Runtime v2 D1): job runs are
 * born in ephemeral sessions whose entry carries `toolsAllow`/`toolsDeny`
 * (see worker-ephemeral-session.ts). The tool registry handed to the model
 * must shrink to the granted set — otherwise every worker turn ships the
 * full 100+-tool schema block (the measured ~43k-token prompt that breaks
 * local-model tool calling).
 *
 * This pins the generic session-policy read side with a custom session.store
 * path — including the cfg.session.store (not cfg.sessionStore) fix.
 */
describe("worker session tool policy filters the model-visible registry", () => {
  let storeDir: string;

  beforeEach(() => {
    storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-worker-policy-"));
  });

  afterEach(() => {
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it("ships only granted tools when the session entry carries toolsAllow", async () => {
    const cfg = {
      session: { store: path.join(storeDir, "sessions-{agentId}.json") },
    } as ArgentConfig;
    const agentId = "main";
    const sessionKey = buildAgentMainSessionKey({ agentId, mainKey: "worker-execution" });

    const baseline = createArgentCodingTools({
      config: cfg,
      sessionKey,
      senderIsOwner: true,
    });
    const baselineNames = baseline.map((tool) => tool.name);
    expect(baselineNames.length).toBeGreaterThan(20);

    // Worker write path: same store resolution + entry shape as
    // withSessionToolPolicyOverride.
    const storePath = resolveStorePath(cfg.session?.store, { agentId });
    await updateSessionStore(storePath, (store) => {
      store[sessionKey] = {
        sessionId: "00000000-0000-0000-0000-000000000001",
        updatedAt: Date.now(),
        toolsAllow: ["tasks", "memory_recall"],
      };
    });

    const granted = createArgentCodingTools({
      config: cfg,
      sessionKey,
      senderIsOwner: true,
    });
    const grantedNames = granted.map((tool) => tool.name).toSorted();

    expect(grantedNames.length).toBeLessThanOrEqual(4);
    expect(grantedNames).toContain("tasks");
    expect(grantedNames).not.toContain("exec");
    expect(grantedNames).not.toContain("message");
  });
});
