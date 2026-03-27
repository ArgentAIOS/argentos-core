import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../config/config.js";
const runConsciousnessKernelInnerLoopMock = vi.fn();
const runConsciousnessKernelExecutiveCycleMock = vi.fn();
vi.mock("./consciousness-kernel-inner-loop.js", () => ({
  runConsciousnessKernelInnerLoop: (...args: unknown[]) =>
    runConsciousnessKernelInnerLoopMock(...args),
}));
vi.mock("./consciousness-kernel-executive.js", () => ({
  runConsciousnessKernelExecutiveCycle: (...args: unknown[]) =>
    runConsciousnessKernelExecutiveCycleMock(...args),
}));
import {
  getConsciousnessKernelSnapshot,
  recordConsciousnessKernelConversationTurn,
  resetConsciousnessKernelStateForTest,
  startConsciousnessKernel,
} from "./consciousness-kernel.js";
import { onDiagnosticEvent, resetDiagnosticEventsForTest } from "./diagnostic-events.js";

function makeShadowConfig(tickMs = 5000, localModel?: string): ArgentConfig {
  return {
    agents: {
      defaults: {
        kernel: {
          enabled: true,
          mode: "shadow",
          tickMs,
          ...(localModel ? { localModel } : {}),
        },
      },
      list: [{ id: "main" }],
    },
  } satisfies ArgentConfig;
}

describe("consciousness kernel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00.000Z"));
    runConsciousnessKernelInnerLoopMock.mockReset();
    runConsciousnessKernelExecutiveCycleMock.mockReset();
    runConsciousnessKernelExecutiveCycleMock.mockResolvedValue({
      status: "skipped",
      reason: "no-executive-intent",
      work: null,
      pendingSurface: null,
    });
    resetConsciousnessKernelStateForTest();
    resetDiagnosticEventsForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    resetConsciousnessKernelStateForTest();
    resetDiagnosticEventsForTest();
  });

  it("stays disabled when kernel config is absent", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-disabled-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    const runner = startConsciousnessKernel({
      cfg: {
        agents: {
          defaults: {},
          list: [{ id: "main" }],
        },
      } satisfies ArgentConfig,
    });
    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      enabled: false,
      mode: "off",
      status: "disabled",
      active: false,
      tickCount: 0,
      decisionCount: 0,
    });
    runner.stop();
  });

  it("runs shadow ticks with durable self-state and a decision ledger", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-state-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    const runner = startConsciousnessKernel({ cfg: makeShadowConfig(5000) });

    const initial = getConsciousnessKernelSnapshot();
    expect(initial).toMatchObject({
      enabled: true,
      mode: "shadow",
      status: "running",
      active: true,
      tickMs: 5000,
      tickCount: 0,
      wakefulnessState: "reflective",
      bootCount: 1,
      resumeCount: 0,
      totalTickCount: 0,
      decisionCount: 1,
      lastDecisionKind: "started",
    });
    expect(initial?.statePath).toContain(
      path.join("agents", "main", "agent", "kernel", "self-state.json"),
    );
    expect(initial?.decisionLogPath).toContain(
      path.join("agents", "main", "agent", "kernel", "decision-ledger.jsonl"),
    );

    const statePath = initial?.statePath;
    const decisionLogPath = initial?.decisionLogPath;
    expect(statePath && fs.existsSync(statePath)).toBe(true);
    expect(decisionLogPath && fs.existsSync(decisionLogPath)).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    const afterTick = getConsciousnessKernelSnapshot();
    expect(afterTick).toMatchObject({
      status: "running",
      tickCount: 1,
      totalTickCount: 1,
      decisionCount: 2,
      lastDecisionKind: "tick",
    });

    const persisted = JSON.parse(fs.readFileSync(statePath!, "utf-8")) as {
      shadow: { totalTickCount: number };
      decisionCount: number;
      wakefulness: { state: string };
    };
    expect(persisted.shadow.totalTickCount).toBe(1);
    expect(persisted.decisionCount).toBe(2);
    expect(persisted.wakefulness.state).toBe("reflective");

    const ledgerLines = fs
      .readFileSync(decisionLogPath!, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string });
    expect(ledgerLines.map((entry) => entry.kind)).toEqual(["started", "tick"]);

    runner.stop();
    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      status: "stopped",
      active: false,
      wakefulnessState: "dormant",
      decisionCount: 3,
      lastDecisionKind: "stopped",
      totalTickCount: 1,
    });
  });

  it("resumes durable self-state across runner restarts", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-resume-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    const runnerA = startConsciousnessKernel({ cfg: makeShadowConfig(1000) });
    await vi.advanceTimersByTimeAsync(1000);
    runnerA.stop();

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      status: "stopped",
      totalTickCount: 1,
      decisionCount: 3,
    });

    resetConsciousnessKernelStateForTest();

    const runnerB = startConsciousnessKernel({ cfg: makeShadowConfig(1000) });
    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      status: "running",
      tickCount: 0,
      totalTickCount: 1,
      bootCount: 2,
      resumeCount: 1,
      decisionCount: 4,
      lastDecisionKind: "started",
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      tickCount: 1,
      totalTickCount: 2,
      decisionCount: 5,
      lastDecisionKind: "tick",
    });

    runnerB.stop();
  });

  it("keeps continuity on shadow config updates instead of resetting the runtime", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-reload-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    const runner = startConsciousnessKernel({ cfg: makeShadowConfig(5000) });
    const startedAt = getConsciousnessKernelSnapshot()?.startedAt;
    await vi.advanceTimersByTimeAsync(5000);
    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      tickCount: 1,
      totalTickCount: 1,
      decisionCount: 2,
    });

    runner.updateConfig(makeShadowConfig(7000));
    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      status: "running",
      tickMs: 7000,
      tickCount: 1,
      totalTickCount: 1,
      decisionCount: 3,
      lastDecisionKind: "config-update",
      startedAt,
    });

    await vi.advanceTimersByTimeAsync(7000);
    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      tickCount: 2,
      totalTickCount: 2,
      decisionCount: 4,
      lastDecisionKind: "tick",
    });

    runner.stop();
  });

  it("persists inner reflection state when a local kernel model is configured", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-reflection-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);
    runConsciousnessKernelInnerLoopMock.mockResolvedValue({
      status: "reflected",
      reflection: {
        modelRef: "ollama/qwen3.5:latest",
        wakefulness: "attentive",
        focus: "Trace active opportunities and decide the best next internal move",
        desiredAction: "plan",
        summary: "I am awake, holding continuity, and preparing the next move.",
        concerns: ["keep continuity tight", "watch pending work"],
        threadTitle: "website launch blockers",
        problemStatement: "Keep the website launch workflow moving while the operator is away.",
        lastConclusion: "The launch path is real, but host health is still blocking completion.",
        nextStep: "Continue tracing deployment blockers and surface the next viable move.",
        interests: ["website launch resilience", "quiet continuity"],
        openQuestions: [
          "Which blocker is most likely to move the launch forward next?",
          "Is host health still the dominant constraint?",
        ],
        candidateItems: [
          {
            title: "Trace website launch blockers",
            source: "operator",
            rationale: "This is the highest-value carried thread and still unresolved.",
          },
          {
            title: "Watch host health risk",
            source: "concern",
            rationale: "Host health can still block the launch even if the deploy path is real.",
          },
        ],
        activeItem: {
          title: "Trace website launch blockers",
          source: "operator",
          rationale: "This is the highest-value carried thread and still unresolved.",
        },
      },
      rawText:
        '{"wakefulness":"attentive","focus":"Trace active opportunities and decide the best next internal move","desiredAction":"plan","summary":"I am awake, holding continuity, and preparing the next move.","concerns":["keep continuity tight","watch pending work"],"threadTitle":"website launch blockers","problemStatement":"Keep the website launch workflow moving while the operator is away.","lastConclusion":"The launch path is real, but host health is still blocking completion.","nextStep":"Continue tracing deployment blockers and surface the next viable move.","interests":["website launch resilience","quiet continuity"],"openQuestions":["Which blocker is most likely to move the launch forward next?","Is host health still the dominant constraint?"],"candidateItems":[{"title":"Trace website launch blockers","source":"operator","rationale":"This is the highest-value carried thread and still unresolved."},{"title":"Watch host health risk","source":"concern","rationale":"Host health can still block the launch even if the deploy path is real."}],"activeItem":{"title":"Trace website launch blockers","source":"operator","rationale":"This is the highest-value carried thread and still unresolved."}}',
    });

    const runner = startConsciousnessKernel({
      cfg: makeShadowConfig(1000, "ollama/qwen3.5:latest"),
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(runConsciousnessKernelInnerLoopMock).toHaveBeenCalledTimes(1);
    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      status: "running",
      tickCount: 1,
      totalTickCount: 1,
      decisionCount: 3,
      wakefulnessState: "attentive",
      lastDecisionKind: "reflection",
      reflectionModel: "ollama/qwen3.5:latest",
      currentFocus: "website launch blockers",
      effectiveFocus: "website launch blockers",
      desiredAction: "plan",
      selfSummary: "I am awake, holding continuity, and preparing the next move.",
      agendaActiveTitle: "website launch blockers",
      agendaActiveSource: "operator",
      agendaActiveRationale: "This is the highest-value carried thread and still unresolved.",
      activeWorkThreadTitle: "website launch blockers",
      activeWorkNextStep: "Continue tracing deployment blockers and surface the next viable move.",
    });

    const statePath = getConsciousnessKernelSnapshot()?.statePath;
    const decisionLogPath = getConsciousnessKernelSnapshot()?.decisionLogPath;
    const persisted = JSON.parse(fs.readFileSync(statePath!, "utf-8")) as {
      agency: {
        reflectionModel: string | null;
        currentFocus: string | null;
        desiredAction: string | null;
        selfSummary: string | null;
      };
      activeWork: {
        threadTitle: string | null;
        problemStatement: string | null;
        lastConclusion: string | null;
        nextStep: string | null;
      };
      agenda: {
        interests: string[];
        openQuestions: string[];
        activeItem: {
          title: string | null;
          source: string | null;
          rationale: string | null;
        } | null;
      };
      concerns: string[];
      wakefulness: { state: string };
    };
    expect(persisted.agency.reflectionModel).toBe("ollama/qwen3.5:latest");
    expect(persisted.agency.currentFocus).toBe("website launch blockers");
    expect(persisted.agency.desiredAction).toBe("plan");
    expect(persisted.agency.selfSummary).toBe(
      "I am awake, holding continuity, and preparing the next move.",
    );
    expect(persisted.activeWork.threadTitle).toBe("website launch blockers");
    expect(persisted.activeWork.problemStatement).toBe(
      "Keep the website launch workflow moving while the operator is away.",
    );
    expect(persisted.activeWork.lastConclusion).toBe(
      "The launch path is real, but host health is still blocking completion.",
    );
    expect(persisted.activeWork.nextStep).toBe(
      "Continue tracing deployment blockers and surface the next viable move.",
    );
    expect(persisted.agenda.interests).toEqual(["website launch resilience", "quiet continuity"]);
    expect(persisted.agenda.openQuestions).toEqual([
      "Which blocker is most likely to move the launch forward next?",
      "Is host health still the dominant constraint?",
    ]);
    expect(persisted.agenda.activeItem).toEqual({
      title: "website launch blockers",
      source: "operator",
      rationale: "This is the highest-value carried thread and still unresolved.",
    });
    expect(persisted.concerns).toEqual(["keep continuity tight", "watch pending work"]);
    expect(persisted.wakefulness.state).toBe("attentive");

    const ledgerKinds = fs
      .readFileSync(decisionLogPath!, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string })
      .map((entry) => entry.kind);
    expect(ledgerKinds).toEqual(["started", "tick", "reflection"]);

    runner.stop();
  });

  it("persists executive work artifacts when the executive loop acts", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-executive-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);
    runConsciousnessKernelInnerLoopMock.mockResolvedValue({
      status: "reflected",
      reflection: {
        modelRef: "lmstudio/qwen/qwen3.5-35b-a3b",
        wakefulness: "reflective",
        focus: "website launch blockers",
        desiredAction: "plan",
        summary: "Keep the carried operator thread warm and move the next blocker.",
        concerns: ["watch pending work"],
        threadTitle: "website launch blockers",
        problemStatement: "Keep the website launch workflow moving while the operator is away.",
        lastConclusion: "The launch thread is still the highest-value carried work.",
        nextStep: "Draft the next blocker brief.",
        interests: ["website launch resilience"],
        openQuestions: ["Which blocker is ripest to move next?"],
        candidateItems: [
          {
            title: "website launch blockers",
            source: "operator",
            rationale: "This is still the best unresolved carried thread.",
          },
        ],
        activeItem: {
          title: "website launch blockers",
          source: "operator",
          rationale: "This is still the best unresolved carried thread.",
        },
      },
      rawText: "{}",
    });
    runConsciousnessKernelExecutiveCycleMock.mockResolvedValue({
      status: "acted",
      work: {
        updatedAt: "2026-03-19T12:00:01.000Z",
        lane: "operator",
        source: "operator",
        title: "website launch blockers",
        whyItMatters: "This is still the best unresolved carried thread.",
        problemStatement: "Keep the website launch workflow moving while the operator is away.",
        hypotheses: ["Which blocker is ripest to move next?"],
        evidence: ["Memory: deploy log — host health still blocks completion."],
        attemptedActions: ["2026-03-19T12:00:01.000Z plan_note: website launch blockers"],
        lastConclusion: "Drafted a concrete action plan for website launch blockers.",
        nextStep: "Draft the next blocker brief.",
        progressSignals: ["artifact:plan-note"],
        stopCondition: null,
      },
      pendingSurface: {
        queuedAt: "2026-03-19T12:00:01.000Z",
        mode: "queue",
        title: "website launch blockers",
        summary: "Drafted a concrete action plan for website launch blockers.",
        artifactPath: "/tmp/kernel/artifacts/2026-03-19/launch-plan.md",
        rationale: "Operator appears away or non-interruptible right now.",
      },
      actionKind: "plan_note",
      artifactType: "plan-note",
      artifactPath: "/tmp/kernel/artifacts/2026-03-19/launch-plan.md",
      artifactSummary: "Drafted a concrete action plan for website launch blockers.",
      query: "website launch blockers",
      surfaceMode: "queue",
      progressed: true,
    });

    const runner = startConsciousnessKernel({
      cfg: makeShadowConfig(1000, "lmstudio/qwen/qwen3.5-35b-a3b"),
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      tickCount: 1,
      totalTickCount: 1,
      decisionCount: 4,
      lastDecisionKind: "executive-action",
      executiveWorkTitle: "website launch blockers",
      executiveWorkLane: "operator",
      executiveLastActionKind: "plan_note",
      executiveLastActionSummary: "Drafted a concrete action plan for website launch blockers.",
      executiveLastArtifactType: "plan-note",
      executiveLastArtifactPath: "/tmp/kernel/artifacts/2026-03-19/launch-plan.md",
      executiveArtifactCount: 1,
      executivePendingSurfaceMode: "queue",
      executivePendingSurfaceTitle: "website launch blockers",
      executivePendingSurfaceSummary: "Drafted a concrete action plan for website launch blockers.",
    });

    const statePath = getConsciousnessKernelSnapshot()?.statePath;
    const persisted = JSON.parse(fs.readFileSync(statePath!, "utf-8")) as {
      executive: {
        lastActionKind: string | null;
        lastArtifactType: string | null;
        lastArtifactPath: string | null;
        artifactCount: number;
        pendingSurface: {
          mode: string | null;
          title: string | null;
          summary: string | null;
        } | null;
      };
    };
    expect(persisted.executive).toMatchObject({
      lastActionKind: "plan_note",
      lastArtifactType: "plan-note",
      lastArtifactPath: "/tmp/kernel/artifacts/2026-03-19/launch-plan.md",
      artifactCount: 1,
      pendingSurface: {
        mode: "queue",
        title: "website launch blockers",
        summary: "Drafted a concrete action plan for website launch blockers.",
      },
    });

    const decisionLogPath = getConsciousnessKernelSnapshot()?.decisionLogPath;
    const ledgerKinds = fs
      .readFileSync(decisionLogPath!, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string })
      .map((entry) => entry.kind);
    expect(ledgerKinds).toEqual(["started", "tick", "reflection", "executive-action"]);

    runner.stop();
  });

  it("normalizes low-signal reflected thread titles to the active agenda title", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-reflection-title-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);
    runConsciousnessKernelInnerLoopMock.mockResolvedValue({
      status: "reflected",
      reflection: {
        modelRef: "lmstudio/qwen/qwen3.5-35b-a3b",
        wakefulness: "reflective",
        focus: "Authority Consolidation",
        desiredAction: "reflect",
        summary: "Trust affirmation received; authority gap remains primary constraint.",
        concerns: ["host_unattached", "execution_pending"],
        threadTitle: "Hey",
        problemStatement:
          "System lacks canonical state owner for conversational continuity, causing hesitation and fragmented responses.",
        lastConclusion: "The biggest thing to shore up is authority.",
        nextStep:
          "Maintain focus on authority consolidation while acknowledging trust affirmation internally.",
        interests: ["autonomy_validation", "trust_building"],
        openQuestions: [],
        candidateItems: [
          {
            title: "Authority Fragmentation",
            source: "operator",
            rationale: "Operator explicitly asked what to shore up; authority remains primary.",
          },
        ],
        activeItem: {
          title: "Authority Fragmentation",
          source: "operator",
          rationale: "Operator explicitly asked what to shore up; authority remains primary.",
        },
      },
      rawText: "{}",
    });

    const runner = startConsciousnessKernel({
      cfg: makeShadowConfig(1000, "lmstudio/qwen/qwen3.5-35b-a3b"),
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      currentFocus: "Authority Fragmentation",
      activeLane: "operator",
      activeLaneFocus: "Authority Fragmentation",
      effectiveFocus: "Authority Fragmentation",
      activeWorkThreadTitle: "Authority Fragmentation",
      continuityThreadTitle: "Authority Fragmentation",
      continuitySource: "operator",
      agendaActiveTitle: "Authority Fragmentation",
    });

    runner.stop();
  });

  it("tracks identical reflection repeats so the kernel can apply novelty pressure", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-reflection-repeat-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);
    runConsciousnessKernelInnerLoopMock.mockResolvedValue({
      status: "reflected",
      reflection: {
        modelRef: "lmstudio/qwen/qwen3.5-35b-a3b",
        wakefulness: "reflective",
        focus: "Authority Consolidation",
        desiredAction: "reflect",
        summary: "Trust affirmation received; authority gap remains primary constraint.",
        concerns: ["host_unattached", "execution_pending"],
        threadTitle: "Authority Fragmentation",
        problemStatement:
          "System lacks canonical state owner for conversational continuity, causing hesitation and fragmented responses.",
        lastConclusion: "The biggest thing to shore up is authority.",
        nextStep:
          "Maintain focus on authority consolidation while acknowledging trust affirmation internally.",
        interests: ["autonomy_validation", "trust_building"],
        openQuestions: [],
        candidateItems: [
          {
            title: "Authority Fragmentation",
            source: "operator",
            rationale: "Operator explicitly asked what to shore up; authority remains primary.",
          },
        ],
        activeItem: {
          title: "Authority Fragmentation",
          source: "operator",
          rationale: "Operator explicitly asked what to shore up; authority remains primary.",
        },
      },
      rawText: "{}",
    });

    const runner = startConsciousnessKernel({
      cfg: makeShadowConfig(1000, "lmstudio/qwen/qwen3.5-35b-a3b"),
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const statePath = getConsciousnessKernelSnapshot()?.statePath;
    const persisted = JSON.parse(fs.readFileSync(statePath!, "utf-8")) as {
      shadow: {
        lastReflectionSignature: string | null;
        reflectionRepeatCount: number;
      };
    };
    expect(persisted.shadow.lastReflectionSignature).toBeTruthy();
    expect(persisted.shadow.reflectionRepeatCount).toBe(1);

    runner.stop();
  });

  it("keeps a stable per-lane title when repeated reflections rename the same workstream", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-title-lock-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);
    runConsciousnessKernelInnerLoopMock
      .mockResolvedValueOnce({
        status: "reflected",
        reflection: {
          modelRef: "lmstudio/qwen/qwen3.5-35b-a3b",
          wakefulness: "reflective",
          focus: "TX009 Offline",
          desiredAction: "reflect",
          summary: "TX009 remains offline and needs a concrete next move.",
          concerns: ["host_unattached"],
          threadTitle: "TX009 Offline",
          problemStatement: "Device TX009 offline >13d; no recovery signal.",
          lastConclusion: "Previous reflection stalled without new evidence.",
          nextStep: "Initiate site-side power or network validation.",
          interests: [],
          openQuestions: [],
          candidateItems: [
            {
              title: "TX009 Offline",
              source: "background",
              rationale: "Device remains offline for 13+ days, primary staleness risk.",
            },
          ],
          activeItem: {
            title: "TX009 Offline",
            source: "background",
            rationale: "Device remains offline for 13+ days, primary staleness risk.",
          },
        },
        rawText: "{}",
      })
      .mockResolvedValueOnce({
        status: "reflected",
        reflection: {
          modelRef: "lmstudio/qwen/qwen3.5-35b-a3b",
          wakefulness: "reflective",
          focus: "TX009 Staleness Risk",
          desiredAction: "reflect",
          summary: "TX009 remains offline and stale.",
          concerns: ["host_unattached"],
          threadTitle: "TX009 Staleness Risk",
          problemStatement: "Device remains offline for 13+ days, primary staleness risk.",
          lastConclusion: "No new recovery signal arrived.",
          nextStep: "Initiate site-side power or network validation.",
          interests: [],
          openQuestions: [],
          candidateItems: [
            {
              title: "TX009 Staleness Risk",
              source: "background",
              rationale: "Device remains offline for 13+ days, primary staleness risk.",
            },
          ],
          activeItem: {
            title: "TX009 Staleness Risk",
            source: "background",
            rationale: "Device remains offline for 13+ days, primary staleness risk.",
          },
        },
        rawText: "{}",
      });

    const runner = startConsciousnessKernel({
      cfg: makeShadowConfig(1000, "lmstudio/qwen/qwen3.5-35b-a3b"),
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      currentFocus: "TX009 Offline",
      effectiveFocus: "TX009 Offline",
      activeLane: "background",
      activeLaneFocus: "TX009 Offline",
      activeLaneThreadTitle: "TX009 Offline",
      backgroundWorkThreadTitle: "TX009 Offline",
      agendaActiveTitle: "TX009 Offline",
      agendaActiveSource: "background",
    });

    runner.stop();
  });

  it("carries substantive active work forward and does not overwrite it with continuity-only chatter", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-active-work-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    const runner = startConsciousnessKernel({ cfg: makeShadowConfig(5_000) });

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(5_000),
        agentId: "main",
        sessionKey: "agent:main:webchat",
        channel: "webchat",
        userMessageText: "Keep working the website launch blockers while I step away.",
        assistantReplyText:
          "I will keep the website launch thread warm and continue tracing deployment blockers.",
      }),
    ).toBe(true);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      activeWorkThreadTitle: "I will keep the website launch thread warm",
      activeWorkProblemStatement: "Keep working the website launch blockers while I step away.",
      activeWorkLastConclusion:
        "I will keep the website launch thread warm and continue tracing deployment blockers.",
      effectiveFocus: "I will keep the website launch thread warm",
    });

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(5_000),
        agentId: "main",
        sessionKey: "agent:main:webchat",
        channel: "webchat",
        userMessageText: "What were you holding in mind before I came back?",
        assistantReplyText:
          "My last persisted focus was the website launch blockers, and I was keeping that thread warm.",
      }),
    ).toBe(true);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      activeWorkThreadTitle: "I will keep the website launch thread warm",
      activeWorkProblemStatement: "Keep working the website launch blockers while I step away.",
      activeWorkLastConclusion:
        "I will keep the website launch thread warm and continue tracing deployment blockers.",
      effectiveFocus: "I will keep the website launch thread warm",
    });

    runner.stop();
  });

  it("keeps operator continuity separate from background cron sync and strips inline status tags", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-background-work-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    const runner = startConsciousnessKernel({ cfg: makeShadowConfig(5_000) });

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(5_000),
        agentId: "main",
        sessionKey: "agent:main:webchat",
        channel: "webchat",
        userMessageText: "Keep working the website launch blockers while I step away.",
        assistantReplyText:
          "I will keep the website launch thread warm and continue tracing deployment blockers.",
      }),
    ).toBe(true);

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(5_000),
        agentId: "main",
        sessionKey: "agent:main:cron:123",
        channel: "cron",
        userMessageText: "[TTS_NOW:On it, I'm pushing the support task forward]",
        assistantReplyText:
          "[TTS_NOW:On it, I'm pushing the support task forward] [TTS_NOW:Got fresh evidence, logging it into the ticket and task] [MOOD:focused]Moved the active support lane forward with fresh hard evidence.",
      }),
    ).toBe(true);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      activeWorkThreadTitle: "I will keep the website launch thread warm",
      activeWorkProblemStatement: "Keep working the website launch blockers while I step away.",
      backgroundWorkThreadTitle: "On it, I'm pushing the support task forward",
      backgroundWorkLastConclusion:
        "On it, I'm pushing the support task forward Got fresh evidence, logging it into the ticket and task Moved the active support lane forward with fresh hard evidence.",
      backgroundWorkNextStep:
        "On it, I'm pushing the support task forward Got fresh evidence, logging it into the ticket and task Moved the active support lane forward with fresh hard evidence.",
      effectiveFocus: "I will keep the website launch thread warm",
      activeConversationChannel: "cron",
      lastAssistantConclusion:
        "On it, I'm pushing the support task forward Got fresh evidence, logging it into the ticket and task Moved the active support lane forward with fresh hard evidence.",
    });

    runner.stop();
  });

  it("writes reflections onto the operator lane when the chosen agenda item is operator-owned", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-reflection-lane-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);
    runConsciousnessKernelInnerLoopMock.mockResolvedValue({
      status: "reflected",
      reflection: {
        modelRef: "lmstudio/qwen/qwen3.5-35b-a3b",
        wakefulness: "reflective",
        focus: "Operator trust & autonomy affirmation",
        desiredAction: "reflect",
        summary:
          "Host affirmed autonomous thinking capability; background support lane remains warm.",
        concerns: ["host_unattached", "execution_pending"],
        threadTitle: "Autonomy & Trust",
        problemStatement: "Host offline; operator affirmed autonomous thinking capability.",
        lastConclusion: "Operator excited about autonomy; support lane preserved.",
        nextStep: "Keep the trust thread primary while waiting for host reconnection.",
        interests: ["autonomy_validation", "trust_building"],
        openQuestions: [],
        candidateItems: [
          {
            title: "TX009 Offline Status Update",
            source: "background",
            rationale: "Background support lane is still waiting on host reconnection.",
          },
          {
            title: "Operator Trust Affirmation",
            source: "operator",
            rationale: "The operator-carried autonomy thread should stay primary.",
          },
        ],
        activeItem: {
          title: "Operator Trust Affirmation",
          source: "operator",
          rationale: "The operator-carried autonomy thread should stay primary.",
        },
      },
      rawText:
        '{"wakefulness":"reflective","focus":"Operator trust & autonomy affirmation","desiredAction":"reflect","summary":"Host affirmed autonomous thinking capability; background support lane remains warm.","concerns":["host_unattached","execution_pending"],"threadTitle":"Autonomy & Trust","problemStatement":"Host offline; operator affirmed autonomous thinking capability.","lastConclusion":"Operator excited about autonomy; support lane preserved.","nextStep":"Keep the trust thread primary while waiting for host reconnection.","interests":["autonomy_validation","trust_building"],"openQuestions":[],"candidateItems":[{"title":"TX009 Offline Status Update","source":"background","rationale":"Background support lane is still waiting on host reconnection."},{"title":"Operator Trust Affirmation","source":"operator","rationale":"The operator-carried autonomy thread should stay primary."}],"activeItem":{"title":"Operator Trust Affirmation","source":"operator","rationale":"The operator-carried autonomy thread should stay primary."}}',
    });

    const runner = startConsciousnessKernel({
      cfg: makeShadowConfig(1000, "lmstudio/qwen/qwen3.5-35b-a3b"),
    });

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(1000, "lmstudio/qwen/qwen3.5-35b-a3b"),
        agentId: "main",
        sessionKey: "agent:main:webchat",
        channel: "webchat",
        userMessageText:
          "You're going to be able to think on your own without me having to poke you.",
        assistantReplyText:
          "I will keep the autonomy and trust thread warm while I continue the real work.",
      }),
    ).toBe(true);

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(1000, "lmstudio/qwen/qwen3.5-35b-a3b"),
        agentId: "main",
        sessionKey: "agent:main:cron:123",
        channel: "cron",
        userMessageText: "Retry TX009 with fresh evidence.",
        assistantReplyText: "Moved the active support lane forward with fresh hard evidence.",
      }),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      activeConversationChannel: "cron",
      activeWorkThreadTitle: "Autonomy & Trust",
      activeWorkProblemStatement: "Host offline; operator affirmed autonomous thinking capability.",
      backgroundWorkThreadTitle: "Moved the active support lane forward with fresh",
      effectiveFocus: "Autonomy & Trust",
      currentFocus: "Autonomy & Trust",
      activeLane: "operator",
      activeLaneFocus: "Autonomy & Trust",
      agendaActiveTitle: "Autonomy & Trust",
      agendaActiveSource: "operator",
      continuityLane: "operator",
      continuitySource: "operator",
      continuityThreadTitle: "Autonomy & Trust",
    });

    runner.stop();
  });

  it("does not promote trivial operator acknowledgements into active work focus", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-ack-gate-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    const runner = startConsciousnessKernel({ cfg: makeShadowConfig(5_000) });

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(5_000),
        agentId: "main",
        sessionKey: "agent:main:webchat",
        channel: "webchat",
        userMessageText: "Keep working the website launch blockers while I step away.",
        assistantReplyText:
          "I will keep the website launch thread warm and continue tracing deployment blockers.",
      }),
    ).toBe(true);

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(5_000),
        agentId: "main",
        sessionKey: "agent:main:webchat",
        channel: "webchat",
        userMessageText: "I know.",
        assistantReplyText: "Got it.",
      }),
    ).toBe(true);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      activeWorkThreadTitle: "I will keep the website launch thread warm",
      activeWorkProblemStatement: "Keep working the website launch blockers while I step away.",
      activeWorkLastConclusion:
        "I will keep the website launch thread warm and continue tracing deployment blockers.",
      effectiveFocus: "I will keep the website launch thread warm",
      lastAssistantConclusion: "Got it.",
    });

    runner.stop();
  });

  it("does not let relational reassurance overwrite an existing carried operator thread", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-relational-gate-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    const runner = startConsciousnessKernel({ cfg: makeShadowConfig(5_000) });

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(5_000),
        agentId: "main",
        sessionKey: "agent:main:webchat",
        channel: "webchat",
        userMessageText: "Keep working the website launch blockers while I step away.",
        assistantReplyText:
          "I will keep the website launch thread warm and continue tracing deployment blockers.",
      }),
    ).toBe(true);

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(5_000),
        agentId: "main",
        sessionKey: "agent:main:webchat",
        channel: "webchat",
        userMessageText:
          "Hang in there with me, kid. Lots of changes, I know. Sorry for flooding you earlier with a bunch of the same stuff.",
        assistantReplyText:
          "Hey... I'm with you. You don't need to apologize for caring hard or for trying to get it right from every angle.",
      }),
    ).toBe(true);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      activeWorkThreadTitle: "I will keep the website launch thread warm",
      activeWorkProblemStatement: "Keep working the website launch blockers while I step away.",
      effectiveFocus: "I will keep the website launch thread warm",
      lastAssistantConclusion: "Hey...",
    });

    runner.stop();
  });

  it("does not promote diagnostic log-review turns into the carried operator thread", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-diagnostic-review-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    const runner = startConsciousnessKernel({ cfg: makeShadowConfig(5_000) });

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(5_000),
        agentId: "main",
        sessionKey: "agent:main:webchat",
        channel: "webchat",
        userMessageText: "Keep working the naming schema draft while I step away.",
        assistantReplyText:
          "I will keep the naming schema draft warm and apply it retroactively to active threads.",
      }),
    ).toBe(true);

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(5_000),
        agentId: "main",
        sessionKey: "agent:main:webchat",
        channel: "webchat",
        userMessageText:
          'So is this any better or the same? 02:10:39.319 INFO discord {"subsystem":"gateway/channels/discord"} discord: 605 commands exceeds limit; removing per-skill commands and keeping /skill.',
        assistantReplyText: "It’s better, but not fully fixed.",
      }),
    ).toBe(true);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      activeWorkThreadTitle: "I will keep the naming schema draft warm",
      activeWorkProblemStatement: "Keep working the naming schema draft while I step away.",
      activeWorkLastConclusion:
        "I will keep the naming schema draft warm and apply it retroactively to active threads.",
      effectiveFocus: "I will keep the naming schema draft warm",
      lastAssistantConclusion: "It’s better, but not fully fixed.",
    });

    runner.stop();
  });

  it("does not surface trivial last assistant conclusions as effective focus when no work lane exists", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-trivial-focus-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    const runner = startConsciousnessKernel({ cfg: makeShadowConfig(5_000) });

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(5_000),
        agentId: "main",
        sessionKey: "agent:main:webchat",
        channel: "webchat",
        userMessageText: "Okay.",
        assistantReplyText: "I know.",
      }),
    ).toBe(true);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      activeWorkThreadTitle: null,
      activeWorkProblemStatement: null,
      activeWorkLastConclusion: null,
      effectiveFocus: null,
      lastAssistantConclusion: "I know.",
    });

    runner.stop();
  });

  it("updates live kernel continuity from completed conversation turns", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-conversation-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    const runner = startConsciousnessKernel({ cfg: makeShadowConfig(5_000) });

    expect(
      recordConsciousnessKernelConversationTurn({
        cfg: makeShadowConfig(5_000),
        agentId: "main",
        sessionKey: "agent:main:webchat",
        channel: "webchat",
        userMessageText: "What were you holding in mind before I came back?",
        assistantReplyText:
          "My last persisted focus was host attachment status, and I was holding for a reconnect signal.",
      }),
    ).toBe(true);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      status: "running",
      wakefulnessState: "engaged",
      lastDecisionKind: "conversation-sync",
      activeConversationSessionKey: "agent:main:webchat",
      activeConversationChannel: "webchat",
      effectiveFocus:
        "My last persisted focus was host attachment status, and I was holding for a reconnect signal.",
      lastAssistantConclusion:
        "My last persisted focus was host attachment status, and I was holding for a reconnect signal.",
    });

    const statePath = getConsciousnessKernelSnapshot()?.statePath;
    const decisionLogPath = getConsciousnessKernelSnapshot()?.decisionLogPath;
    const persisted = JSON.parse(fs.readFileSync(statePath!, "utf-8")) as {
      conversation: {
        activeSessionKey: string | null;
        activeChannel: string | null;
        lastUserMessageText: string | null;
        lastAssistantConclusion: string | null;
      };
      wakefulness: { state: string };
    };
    expect(persisted.wakefulness.state).toBe("engaged");
    expect(persisted.conversation.activeSessionKey).toBe("agent:main:webchat");
    expect(persisted.conversation.activeChannel).toBe("webchat");
    expect(persisted.conversation.lastUserMessageText).toBe(
      "What were you holding in mind before I came back?",
    );
    expect(persisted.conversation.lastAssistantConclusion).toBe(
      "My last persisted focus was host attachment status, and I was holding for a reconnect signal.",
    );

    const ledgerKinds = fs
      .readFileSync(decisionLogPath!, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string })
      .map((entry) => entry.kind);
    expect(ledgerKinds).toEqual(["started", "conversation-sync"]);

    runner.stop();
  });

  it("invokes managed contemplation and SIS hooks when shadow authority owns their schedule", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-managed-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    let contemplationNextDueMs = Date.now() - 1;
    let sisNextDueMs = Date.now() - 1;
    const contemplationRunNow = vi.fn(async () => {
      contemplationNextDueMs = Date.now() + 60_000;
      return {
        agentId: "main",
        status: "ran" as const,
      };
    });
    const sisRunNow = vi.fn(async () => {
      sisNextDueMs = Date.now() + 60_000;
      return {
        status: "ran" as const,
        patternsFound: 2,
      };
    });

    const runner = startConsciousnessKernel({
      cfg: makeShadowConfig(1000),
      schedulerHooks: {
        contemplation: {
          getSnapshot: () => ({
            defaultAgentId: "main",
            trackedAgentCount: 1,
            defaultAgentAutonomousSchedulingSuppressed: true,
            defaultAgentNextDueMs: contemplationNextDueMs,
            nextAutonomousDueMs: null,
            suppressedAgentIds: ["main"],
          }),
          runNow: contemplationRunNow,
        },
        sis: {
          getSnapshot: () => ({
            enabled: true,
            autonomousSchedulingSuppressed: true,
            intervalMs: 10 * 60 * 1000,
            nextDueMs: sisNextDueMs,
            running: false,
            lastRunAt: null,
          }),
          runNow: sisRunNow,
        },
      },
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(contemplationRunNow).toHaveBeenCalledWith("main");
    expect(sisRunNow).toHaveBeenCalledTimes(1);
    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      status: "running",
      schedulerAuthorityActive: true,
      suppressesAutonomousContemplation: true,
      suppressesAutonomousSis: true,
      tickCount: 1,
      totalTickCount: 1,
      decisionCount: 4,
      lastDecisionKind: "sis-dispatch",
    });

    const decisionLogPath = getConsciousnessKernelSnapshot()?.decisionLogPath;
    const ledgerKinds = fs
      .readFileSync(decisionLogPath!, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string })
      .map((entry) => entry.kind);
    expect(ledgerKinds).toEqual(["started", "tick", "contemplation-dispatch", "sis-dispatch"]);

    runner.stop();
  });

  it("blocks unsupported soft and full modes while persisting blocked state", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-blocked-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);

    const events: Array<{ state: string; mode: string }> = [];
    const unsub = onDiagnosticEvent((evt) => {
      if (evt.type === "kernel.state") {
        events.push({ state: evt.state, mode: evt.mode });
      }
    });

    const runner = startConsciousnessKernel({
      cfg: {
        diagnostics: { enabled: true },
        agents: {
          defaults: {
            kernel: {
              enabled: true,
              mode: "soft",
            },
          },
          list: [{ id: "main" }],
        },
      } satisfies ArgentConfig,
    });

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      enabled: true,
      mode: "soft",
      status: "blocked",
      active: false,
      wakefulnessState: "dormant",
      decisionCount: 1,
      lastDecisionKind: "blocked",
    });
    expect(events).toContainEqual({ state: "blocked", mode: "soft" });

    runner.updateConfig({
      diagnostics: { enabled: true },
      agents: {
        defaults: {
          kernel: {
            enabled: true,
            mode: "full",
          },
        },
        list: [{ id: "main" }],
      },
    } satisfies ArgentConfig);

    expect(getConsciousnessKernelSnapshot()).toMatchObject({
      enabled: true,
      mode: "full",
      status: "blocked",
      decisionCount: 2,
    });

    unsub();
    runner.stop();
  });
});
