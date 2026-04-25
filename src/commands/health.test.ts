import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthSummary } from "./health.js";
import { formatHealthChannelLines, healthCommand } from "./health.js";

const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGatewayMock(...args),
}));

describe("healthCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("outputs JSON from gateway", async () => {
    const agentSessions = {
      path: "/tmp/sessions.json",
      count: 1,
      recent: [{ key: "+1555", updatedAt: Date.now(), age: 0 }],
    };
    const snapshot: HealthSummary = {
      ok: true,
      ts: Date.now(),
      durationMs: 5,
      channels: {
        whatsapp: { accountId: "default", linked: true, authAgeMs: 5000 },
        telegram: {
          accountId: "default",
          configured: true,
          probe: { ok: true, elapsedMs: 1 },
        },
        discord: { accountId: "default", configured: false },
      },
      channelOrder: ["whatsapp", "telegram", "discord"],
      channelLabels: {
        whatsapp: "WhatsApp",
        telegram: "Telegram",
        discord: "Discord",
      },
      heartbeatSeconds: 60,
      defaultAgentId: "main",
      agents: [
        {
          agentId: "main",
          isDefault: true,
          heartbeat: {
            enabled: true,
            every: "1m",
            everyMs: 60_000,
            prompt: "hi",
            target: "last",
            ackMaxChars: 160,
          },
          sessions: agentSessions,
        },
      ],
      sessions: agentSessions,
    };
    callGatewayMock.mockResolvedValueOnce(snapshot);

    await healthCommand({ json: true, timeoutMs: 5000 }, runtime as never);

    expect(runtime.exit).not.toHaveBeenCalled();
    const logged = runtime.log.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(logged) as HealthSummary;
    expect(parsed.channels.whatsapp?.linked).toBe(true);
    expect(parsed.channels.telegram?.configured).toBe(true);
    expect(parsed.sessions.count).toBe(1);
  });

  it("prints text summary when not json", async () => {
    callGatewayMock.mockResolvedValueOnce({
      ok: true,
      ts: Date.now(),
      durationMs: 5,
      channels: {
        whatsapp: { accountId: "default", linked: false, authAgeMs: null },
        telegram: { accountId: "default", configured: false },
        discord: { accountId: "default", configured: false },
      },
      channelOrder: ["whatsapp", "telegram", "discord"],
      channelLabels: {
        whatsapp: "WhatsApp",
        telegram: "Telegram",
        discord: "Discord",
      },
      heartbeatSeconds: 60,
      defaultAgentId: "main",
      agents: [
        {
          agentId: "main",
          isDefault: true,
          heartbeat: {
            enabled: true,
            every: "1m",
            everyMs: 60_000,
            prompt: "hi",
            target: "last",
            ackMaxChars: 160,
          },
          sessions: { path: "/tmp/sessions.json", count: 0, recent: [] },
        },
      ],
      sessions: { path: "/tmp/sessions.json", count: 0, recent: [] },
      kernel: {
        configured: true,
        enabled: true,
        mode: "shadow",
        status: "running",
        active: true,
        defaultAgentId: "main",
        tickMs: 60_000,
        localModel: null,
        maxEscalationsPerHour: 4,
        dailyBudget: 0,
        hardwareHostRequired: false,
        allowListening: false,
        allowVision: false,
        startedAt: "2026-03-19T12:00:00.000Z",
        lastTickAt: "2026-03-19T12:01:00.000Z",
        tickCount: 2,
        wakefulnessState: "reflective",
        statePath: "/tmp/kernel/self-state.json",
        decisionLogPath: "/tmp/kernel/decision-ledger.jsonl",
        lastPersistedAt: "2026-03-19T12:01:00.000Z",
        bootCount: 1,
        resumeCount: 0,
        totalTickCount: 2,
        decisionCount: 3,
        lastDecisionAt: "2026-03-19T12:01:00.000Z",
        lastDecisionKind: "tick",
        lastReflectionAt: "2026-03-19T12:01:00.000Z",
        reflectionModel: "ollama/qwen3.5:latest",
        currentFocus: "Review current internal priorities",
        effectiveFocus: "website launch blockers",
        continuityLane: "operator",
        continuitySource: "operator",
        continuityUpdatedAt: "2026-03-19T12:01:10.000Z",
        continuityThreadTitle: "website launch blockers",
        continuityProblemStatement:
          "Keep the website launch workflow moving while the operator is away.",
        continuityLastConclusion: "Carry the website launch thread forward.",
        continuityNextStep: "Trace the next deployment blocker and surface it clearly.",
        desiredAction: "plan",
        selfSummary: "Stay awake, keep continuity, and prepare the next move.",
        agendaUpdatedAt: "2026-03-19T12:01:00.000Z",
        agendaInterests: ["website launch resilience", "continuity polish"],
        agendaOpenQuestions: ["Which blocker is ripest to move next?"],
        agendaCandidateItems: [
          {
            title: "Trace website launch blockers",
            source: "operator",
            rationale: "This is still the best unresolved carried thread.",
          },
        ],
        agendaActiveTitle: "website launch blockers",
        agendaActiveSource: "operator",
        agendaActiveRationale: "This is still the best unresolved carried thread.",
        operatorRequestNeeded: true,
        operatorRequestQuestion: "Which blocker is ripest to move next?",
        operatorRequestReason: "Policy ambiguity prevents cleanup without operator input.",
        operatorRequestSource: "agenda",
        reflectionRepeatCount: 1,
        activeWorkUpdatedAt: "2026-03-19T12:01:10.000Z",
        activeWorkThreadTitle: "website launch blockers",
        activeWorkProblemStatement:
          "Keep the website launch workflow moving while the operator is away.",
        activeWorkLastConclusion: "Carry the website launch thread forward.",
        activeWorkNextStep: "Trace the next deployment blocker and surface it clearly.",
        backgroundWorkUpdatedAt: null,
        backgroundWorkThreadTitle: null,
        backgroundWorkProblemStatement: null,
        backgroundWorkLastConclusion: null,
        backgroundWorkNextStep: null,
        activeConversationSessionKey: "agent:main:webchat",
        activeConversationChannel: "webchat",
        lastConversationAt: "2026-03-19T12:01:10.000Z",
        lastUserMessageAt: "2026-03-19T12:01:05.000Z",
        lastAssistantReplyAt: "2026-03-19T12:01:10.000Z",
        lastAssistantConclusion: "Carry the website launch thread forward.",
        lastError: null,
        schedulerAuthorityActive: true,
        suppressesAutonomousContemplation: true,
        suppressesAutonomousSis: true,
      },
    } satisfies HealthSummary);

    await healthCommand({ json: false }, runtime as never);

    expect(runtime.exit).not.toHaveBeenCalled();
    expect(runtime.log).toHaveBeenCalled();
    const output = runtime.log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Kernel:");
    expect(output).toContain("focus=website launch blockers");
    expect(output).toContain("kernelFocus=Review current internal priorities");
    expect(output).not.toContain("agenda=");
    expect(output).toContain("agendaSource=operator");
    expect(output).toContain("agendaWhy=This is still the best unresolved carried thread.");
    expect(output).toContain("operatorRequest=Which blocker is ripest to move next?");
    expect(output).toContain("operatorRequestSource=agenda");
    expect(output).toContain("question=Which blocker is ripest to move next?");
    expect(output).toContain("thread=website launch blockers");
    expect(output).toContain("next=Trace the next deployment blocker and surface it clearly.");
    expect(output).toContain("stall=x2");
    expect(output).toContain("channel=webchat");
    expect(output).toContain("carry=Carry the website launch thread forward.");
  });

  it("formats per-account probe timings", () => {
    const summary: HealthSummary = {
      ok: true,
      ts: Date.now(),
      durationMs: 5,
      channels: {
        telegram: {
          accountId: "main",
          configured: true,
          probe: { ok: true, elapsedMs: 196, bot: { username: "pinguini_ugi_bot" } },
          accounts: {
            main: {
              accountId: "main",
              configured: true,
              probe: { ok: true, elapsedMs: 196, bot: { username: "pinguini_ugi_bot" } },
            },
            flurry: {
              accountId: "flurry",
              configured: true,
              probe: { ok: true, elapsedMs: 190, bot: { username: "flurry_ugi_bot" } },
            },
            poe: {
              accountId: "poe",
              configured: true,
              probe: { ok: true, elapsedMs: 188, bot: { username: "poe_ugi_bot" } },
            },
          },
        },
      },
      channelOrder: ["telegram"],
      channelLabels: { telegram: "Telegram" },
      heartbeatSeconds: 60,
      defaultAgentId: "main",
      agents: [
        {
          agentId: "main",
          isDefault: true,
          heartbeat: {
            enabled: true,
            every: "1m",
            everyMs: 60_000,
            prompt: "hi",
            target: "last",
            ackMaxChars: 160,
          },
          sessions: { path: "/tmp/sessions.json", count: 0, recent: [] },
        },
      ],
      sessions: { path: "/tmp/sessions.json", count: 0, recent: [] },
    };

    const lines = formatHealthChannelLines(summary, { accountMode: "all" });
    expect(lines).toContain(
      "Telegram: ok (@pinguini_ugi_bot:main:196ms, @flurry_ugi_bot:flurry:190ms, @poe_ugi_bot:poe:188ms)",
    );
  });
});
