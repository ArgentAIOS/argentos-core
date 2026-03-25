import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { runConsciousnessKernelExecutiveCycle } from "./consciousness-kernel-executive.js";
import {
  createConsciousnessKernelSelfState,
  resolveConsciousnessKernelPaths,
  type ConsciousnessKernelSelfState,
} from "./consciousness-kernel-state.js";

function makeConfig(): ArgentConfig {
  return {
    agents: {
      defaults: {
        kernel: {
          enabled: true,
          mode: "shadow",
        },
      },
      list: [{ id: "main" }],
    },
  } satisfies ArgentConfig;
}

function makeState(now: string): ConsciousnessKernelSelfState {
  const selfState = createConsciousnessKernelSelfState({
    agentId: "main",
    now,
    dailyBudget: 4,
    maxEscalationsPerHour: 4,
    hardwareHostRequired: false,
    allowListening: false,
    allowVision: false,
  });
  selfState.activeWork = {
    updatedAt: now,
    threadTitle: "Naming Schema Draft",
    problemStatement: "Operator naming thread risks semantic drift.",
    lastConclusion: "Naming draft should stay warm.",
    nextStep: "Draft standardized naming labels.",
  };
  selfState.backgroundWork = {
    updatedAt: now,
    threadTitle: "TX009 Offline",
    problemStatement: "Device TX009 has been offline for 13+ days with no recovery signal.",
    lastConclusion: "Previous reflection stalled without new evidence.",
    nextStep: "Initiate site-side power or network validation.",
  };
  selfState.conversation.activeSessionKey = "agent:main:webchat";
  selfState.conversation.activeChannel = "webchat";
  selfState.conversation.lastUserMessageAt = "2026-03-20T01:30:00.000Z";
  selfState.conversation.lastUpdatedAt = "2026-03-20T01:30:00.000Z";
  return selfState;
}

describe("runConsciousnessKernelExecutiveCycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("acts on the selected agenda workstream, writes an artifact, and queues it when the operator is away", async () => {
    const cfg = makeConfig();
    const now = "2026-03-20T02:00:00.000Z";
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-executive-cycle-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);
    const paths = resolveConsciousnessKernelPaths(cfg, "main");
    const selfState = makeState(now);
    selfState.agency.desiredAction = "research";
    selfState.agenda.activeItem = {
      title: "TX009 Staleness Risk",
      source: "background",
      rationale: "Device remains offline for 13+ days, primary staleness risk.",
    };
    selfState.agenda.candidateItems = [selfState.agenda.activeItem];
    selfState.agenda.updatedAt = now;

    const getMemorySearchManagerFn = vi.fn(async () => ({
      manager: {
        search: vi.fn(async () => [
          {
            path: "/tmp/tx009.md",
            startLine: 42,
            snippet: "Previous recovery attempt failed; no heartbeat returned.",
            score: 0.83,
          },
        ]),
        close: vi.fn(async () => undefined),
      },
    }));
    const createWebSearchToolFn = vi.fn(() => ({
      execute: vi.fn(async () => ({
        details: {
          content: "Found a fresh external status update for TX009.",
          results: [
            {
              title: "TX009 Status",
              url: "https://example.com/tx009",
              description: "Device still offline pending site-side validation.",
            },
          ],
        },
      })),
    }));

    const result = await runConsciousnessKernelExecutiveCycle(
      {
        cfg,
        agentId: "main",
        now,
        sessionKey: "agent:main:webchat",
        paths,
        selfState,
      },
      {
        getMemorySearchManagerFn,
        createWebSearchToolFn,
        listSystemPresenceFn: () => [],
      },
    );

    expect(result).toMatchObject({
      status: "acted",
      actionKind: "web_research",
      artifactType: "research-brief",
      surfaceMode: "queue",
      progressed: true,
      work: {
        lane: "background",
        title: "TX009 Staleness Risk",
      },
      pendingSurface: {
        mode: "queue",
        title: "TX009 Staleness Risk",
      },
    });
    if (result.status !== "acted") {
      throw new Error("expected acted result");
    }
    expect(fs.existsSync(result.artifactPath)).toBe(true);
    expect(fs.readFileSync(result.artifactPath, "utf-8")).toContain(
      "# Kernel Artifact: TX009 Staleness Risk",
    );
    expect(fs.readFileSync(paths.artifactLedgerPath, "utf-8")).toContain(
      '"actionKind":"web_research"',
    );
    expect(result.work.evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("TX009 Status"),
        expect.stringContaining("/tmp/tx009.md:42"),
      ]),
    );
  });

  it("holds the artifact privately when no new traction emerges", async () => {
    const cfg = makeConfig();
    const now = "2026-03-20T03:00:00.000Z";
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-executive-hold-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);
    const paths = resolveConsciousnessKernelPaths(cfg, "main");
    const selfState = makeState(now);
    selfState.agency.desiredAction = "observe";
    selfState.agenda.activeItem = {
      title: "Naming Schema Draft",
      source: "operator",
      rationale: "Prevent semantic drift in active threads.",
    };
    selfState.agenda.candidateItems = [selfState.agenda.activeItem];
    selfState.agenda.updatedAt = now;

    const result = await runConsciousnessKernelExecutiveCycle(
      {
        cfg,
        agentId: "main",
        now,
        sessionKey: "agent:main:webchat",
        paths,
        selfState,
      },
      {
        getMemorySearchManagerFn: async () => ({
          manager: {
            search: vi.fn(async () => []),
            close: vi.fn(async () => undefined),
          },
        }),
        listSystemPresenceFn: () => [
          {
            text: "Node: test (127.0.0.1) · app test · last input 5s ago · mode tty · reason operator",
            ts: Date.now(),
            mode: "tty",
            lastInputSeconds: 5,
          },
        ],
      },
    );

    expect(result).toMatchObject({
      status: "acted",
      actionKind: "memory_research",
      progressed: false,
      surfaceMode: "hold",
      pendingSurface: {
        mode: "hold",
      },
    });
    if (result.status !== "acted") {
      throw new Error("expected acted result");
    }
    expect(fs.existsSync(result.artifactPath)).toBe(true);
    expect(fs.readFileSync(result.artifactPath, "utf-8")).toContain("Surface: hold");
  });

  it("skips repeated identical actions while the same work item is cooling down", async () => {
    const cfg = makeConfig();
    const now = "2026-03-20T04:00:00.000Z";
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-executive-cooldown-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);
    const paths = resolveConsciousnessKernelPaths(cfg, "main");
    const selfState = makeState(now);
    selfState.agency.desiredAction = "observe";
    selfState.agenda.activeItem = {
      title: "Naming Schema Draft",
      source: "operator",
      rationale: "Prevent semantic drift in active threads.",
    };
    selfState.executive.work = {
      updatedAt: "2026-03-20T03:50:00.000Z",
      lane: "operator",
      source: "operator",
      title: "Naming Schema Draft",
      whyItMatters: "Prevent semantic drift in active threads.",
      problemStatement: "Operator naming thread risks semantic drift.",
      hypotheses: [],
      evidence: [],
      attemptedActions: [],
      lastConclusion: "Memory scan produced no fresh traction.",
      nextStep: "Draft standardized naming labels.",
      progressSignals: [],
      stopCondition: null,
    };
    selfState.executive.lastActionAt = "2026-03-20T03:55:00.000Z";
    selfState.executive.lastActionKind = "memory_research";
    selfState.executive.lastActionQuery = "Draft standardized naming labels.";

    const result = await runConsciousnessKernelExecutiveCycle(
      {
        cfg,
        agentId: "main",
        now,
        sessionKey: "agent:main:webchat",
        paths,
        selfState,
      },
      {
        getMemorySearchManagerFn: vi.fn(),
        listSystemPresenceFn: () => [],
      },
    );

    expect(result).toEqual({
      status: "skipped",
      reason: "action-cooldown",
      work: expect.objectContaining({
        title: "Naming Schema Draft",
      }),
      pendingSurface: null,
    });
    expect(fs.existsSync(paths.artifactLedgerPath)).toBe(false);
  });
});
