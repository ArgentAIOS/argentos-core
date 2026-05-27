import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import { engagementHandlers } from "./engagement.js";

// We don't want to depend on the real loadConfig() reading ~/.argent/argent.json
// during tests. Mock it to point at a tmp agent directory we control.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "engagement-handler-test-"));
const agentId = "test-agent";

vi.mock("../../config/config.js", async () => {
  return {
    loadConfig: () => ({
      agents: {
        defaults: {},
        list: [{ id: agentId, dir: tmpRoot }],
      },
    }),
  };
});

vi.mock("../../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: () => agentId,
}));

vi.mock("../../infra/consciousness-kernel-state.js", () => ({
  resolveConsciousnessKernelPaths: () => ({
    rootDir: tmpRoot,
    statePath: path.join(tmpRoot, "self-state.json"),
    decisionLogPath: path.join(tmpRoot, "decision-ledger.jsonl"),
    artifactDir: path.join(tmpRoot, "artifacts"),
    artifactLedgerPath: path.join(tmpRoot, "artifact-ledger.jsonl"),
    scaffoldDir: path.join(tmpRoot, "scaffold"),
    scaffoldVersionsDir: path.join(tmpRoot, "scaffold", ".versions"),
    innerLoopPromptPath: path.join(tmpRoot, "scaffold", "inner-loop-prompt.md"),
    engagementLedgerPath: path.join(tmpRoot, "engagement-ledger.jsonl"),
  }),
}));

function makeRespond(): {
  ok: boolean | null;
  body: unknown;
  fn: (ok: boolean, body: unknown) => void;
} {
  const captured = { ok: null as boolean | null, body: null as unknown };
  return {
    ...captured,
    fn(ok: boolean, body: unknown) {
      captured.ok = ok;
      captured.body = body;
      this.ok = ok;
      this.body = body;
    },
  };
}

function callRecord(params: Record<string, unknown>): {
  ok: boolean | null;
  body: unknown;
} {
  const r = makeRespond();
  engagementHandlers["engagement.record"]({
    params,
    respond: r.fn.bind(r),
    // Minimal context — the handler doesn't currently use it.
    context: {} as unknown as Parameters<
      (typeof engagementHandlers)["engagement.record"]
    >[0]["context"],
  });
  return { ok: r.ok, body: r.body };
}

describe("engagement.record handler", () => {
  beforeEach(() => {
    // Clean engagement ledger between tests.
    try {
      fs.unlinkSync(path.join(tmpRoot, "engagement-ledger.jsonl"));
    } catch {
      /* not present */
    }
  });

  afterEach(() => {
    // ledger cleanup
  });

  it("rejects missing surfaceId", () => {
    const r = callRecord({ outcome: "acted", source: "dashboard_click" });
    expect(r.ok).toBe(false);
    expect(r.body).toMatchObject({
      code: ErrorCodes.INVALID_REQUEST,
      message: expect.stringContaining("surfaceId"),
    });
  });

  it("rejects unknown outcome", () => {
    const r = callRecord({
      surfaceId: "s1",
      outcome: "definitely-not-a-real-outcome",
      source: "dashboard_click",
    });
    expect(r.ok).toBe(false);
    expect(r.body).toMatchObject({ code: ErrorCodes.INVALID_REQUEST });
  });

  it("rejects unknown source", () => {
    const r = callRecord({
      surfaceId: "s1",
      outcome: "acted",
      source: "carrier-pigeon",
    });
    expect(r.ok).toBe(false);
    expect(r.body).toMatchObject({ code: ErrorCodes.INVALID_REQUEST });
  });

  it("writes a valid engagement entry to the ledger and responds ok", () => {
    const r = callRecord({
      surfaceId: "surface-abc",
      outcome: "acted",
      source: "dashboard_click",
      ts: "2026-05-24T18:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    expect(r.body).toMatchObject({
      ok: true,
      surfaceId: "surface-abc",
      outcome: "acted",
      source: "dashboard_click",
      ts: "2026-05-24T18:00:00.000Z",
      agentId,
    });

    const ledgerPath = path.join(tmpRoot, "engagement-ledger.jsonl");
    const lines = fs.readFileSync(ledgerPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(entry).toMatchObject({
      type: "outcome",
      surfaceId: "surface-abc",
      outcome: "acted",
      source: "dashboard_click",
      ts: "2026-05-24T18:00:00.000Z",
    });
  });

  it("defaults ts to the current ISO timestamp when not provided", () => {
    const before = Date.now();
    const r = callRecord({ surfaceId: "s2", outcome: "acked", source: "dashboard_click" });
    const after = Date.now();
    expect(r.ok).toBe(true);
    const ts = Date.parse((r.body as { ts: string }).ts);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("accepts system_unavailable for use by gateway-shutdown callers (though normally written internally)", () => {
    const r = callRecord({
      surfaceId: "s3",
      outcome: "system_unavailable",
      source: "gateway_shutdown",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects malformed ts string", () => {
    const r = callRecord({
      surfaceId: "s4",
      outcome: "acked",
      source: "dashboard_click",
      ts: "yesterday afternoon",
    });
    expect(r.ok).toBe(false);
    expect(r.body).toMatchObject({ code: ErrorCodes.INVALID_REQUEST });
  });
});
