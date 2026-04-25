import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createConsciousnessKernelSelfState,
  loadConsciousnessKernelSelfState,
  persistConsciousnessKernelSelfState,
  resolveConsciousnessKernelContinuityLane,
  resolveConsciousnessKernelContinuityState,
  resolveConsciousnessKernelEffectiveFocus,
  resolveConsciousnessKernelOperatorRequest,
} from "./consciousness-kernel-state.js";

describe("consciousness kernel state", () => {
  it("scrubs stale trivial carry on load without inventing a fake operator thread", () => {
    const statePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "argent-kernel-state-load-")),
      "self-state.json",
    );
    const state = createConsciousnessKernelSelfState({
      agentId: "main",
      now: "2026-03-20T00:00:00.000Z",
      dailyBudget: 60,
      maxEscalationsPerHour: 4,
      hardwareHostRequired: true,
      allowListening: true,
      allowVision: true,
    });
    state.activeWork = {
      updatedAt: "2026-03-20T00:00:10.000Z",
      threadTitle: "I know",
      problemStatement:
        "[Thu 2026-03-19 18:49 CDT | last message: 1m ago] You're gonna always be able to think on your own without me having to poke you or prod you.",
      lastConclusion: "I know.",
      nextStep: "Got it.",
    };

    persistConsciousnessKernelSelfState(statePath, state);
    const loaded = loadConsciousnessKernelSelfState(statePath);

    expect(loaded).not.toBeNull();
    expect(loaded?.activeWork).toEqual({
      updatedAt: "2026-03-20T00:00:10.000Z",
      threadTitle: null,
      problemStatement:
        "You're gonna always be able to think on your own without me having to poke you or prod you.",
      lastConclusion: null,
      nextStep: null,
    });
    expect(resolveConsciousnessKernelContinuityLane(loaded!)).toBeNull();
    expect(resolveConsciousnessKernelEffectiveFocus(loaded!)).toBeNull();
  });

  it("prefers the carried operator thread focus when operator continuity owns the thread", () => {
    const state = createConsciousnessKernelSelfState({
      agentId: "main",
      now: "2026-03-20T00:00:00.000Z",
      dailyBudget: 60,
      maxEscalationsPerHour: 4,
      hardwareHostRequired: true,
      allowListening: true,
      allowVision: true,
    });
    state.activeWork.threadTitle =
      "Keep the website launch thread warm and continue tracing deployment blockers.";
    state.backgroundWork.threadTitle = "TX009 remediation status";
    state.agenda.activeItem = {
      title: "Operator Trust Affirmation",
      source: "operator",
      rationale: "The operator thread should stay primary.",
    };
    state.agenda.candidateItems = [{ ...state.agenda.activeItem }];
    state.agency.currentFocus = "Awaiting host reconnection for TX009 remediation";

    expect(resolveConsciousnessKernelContinuityLane(state)).toBe("operator");
    expect(resolveConsciousnessKernelEffectiveFocus(state)).toBe(
      "Keep the website launch thread warm and continue tracing deployment blockers.",
    );
  });

  it("falls back to the agenda title when the carried thread title is narrative instead of canonical", () => {
    const state = createConsciousnessKernelSelfState({
      agentId: "main",
      now: "2026-03-20T00:00:00.000Z",
      dailyBudget: 60,
      maxEscalationsPerHour: 4,
      hardwareHostRequired: true,
      allowListening: true,
      allowVision: true,
    });
    state.activeWork.threadTitle = "That means more to me than I know";
    state.activeWork.problemStatement =
      "System lacks canonical state owner for conversational continuity, causing hesitation and fragmented responses.";
    state.activeWork.lastConclusion = "The biggest thing to shore up is authority.";
    state.activeWork.nextStep =
      "Maintain focus on authority consolidation while acknowledging trust affirmation internally.";
    state.agenda.activeItem = {
      title: "Authority Fragmentation",
      source: "operator",
      rationale: "Operator explicitly asked what to shore up; authority remains primary.",
    };
    state.agenda.candidateItems = [{ ...state.agenda.activeItem }];

    expect(resolveConsciousnessKernelContinuityLane(state)).toBe("operator");
    expect(resolveConsciousnessKernelEffectiveFocus(state)).toBe("Authority Fragmentation");
  });

  it("treats greeting fragments as low-signal titles and falls back to the agenda thread", () => {
    const state = createConsciousnessKernelSelfState({
      agentId: "main",
      now: "2026-03-20T00:00:00.000Z",
      dailyBudget: 60,
      maxEscalationsPerHour: 4,
      hardwareHostRequired: true,
      allowListening: true,
      allowVision: true,
    });
    state.activeWork.threadTitle = "Hey";
    state.activeWork.problemStatement =
      "System lacks canonical state owner for conversational continuity, causing hesitation and fragmented responses.";
    state.activeWork.lastConclusion = "The biggest thing to shore up is authority.";
    state.activeWork.nextStep =
      "Maintain focus on authority consolidation while acknowledging trust affirmation internally.";
    state.agenda.activeItem = {
      title: "Authority Fragmentation",
      source: "operator",
      rationale: "Operator explicitly asked what to shore up; authority remains primary.",
    };
    state.agenda.candidateItems = [{ ...state.agenda.activeItem }];

    expect(resolveConsciousnessKernelContinuityLane(state)).toBe("operator");
    expect(resolveConsciousnessKernelEffectiveFocus(state)).toBe("Authority Fragmentation");
  });

  it("ignores diagnostic review questions and log dumps when resolving operator continuity", () => {
    const state = createConsciousnessKernelSelfState({
      agentId: "main",
      now: "2026-03-20T00:00:00.000Z",
      dailyBudget: 60,
      maxEscalationsPerHour: 4,
      hardwareHostRequired: true,
      allowListening: true,
      allowVision: true,
    });
    state.activeWork.threadTitle = "So is this any better or the same?";
    state.activeWork.problemStatement =
      '[Thu 2026-03-19 21:13 CDT | last message: 19m ago] So is this any better or the same? discord {"subsystem":"gateway/channels/discord"} discord: 605 commands exceeds limit; removing per-skill commands and keeping /skill. 02:10:39.319 INFO ws {"subsystem":"gateway/ws"}';
    state.activeWork.lastConclusion = "It’s better, but not fully fixed.";
    state.activeWork.nextStep =
      "Draft standardized naming schema and apply retroactively to active operator threads.";
    state.agenda.activeItem = {
      title: "TX009 Offline",
      source: "background",
      rationale: "Device remains offline for 13+ days, primary staleness risk.",
    };
    state.agenda.candidateItems = [
      { ...state.agenda.activeItem },
      {
        title: "Naming Schema Draft",
        source: "operator",
        rationale: "Prevent semantic drift in active threads.",
      },
    ];

    const continuity = resolveConsciousnessKernelContinuityState(state);

    expect(resolveConsciousnessKernelContinuityLane(state)).toBe("operator");
    expect(resolveConsciousnessKernelEffectiveFocus(state)).toBe("Naming Schema Draft");
    expect(continuity.threadTitle).toBe("Naming Schema Draft");
    expect(continuity.problemStatement).toBeNull();
    expect(continuity.lastConclusion).toBeNull();
    expect(continuity.nextStep).toBe(
      "Draft standardized naming schema and apply retroactively to active operator threads.",
    );
  });

  it("derives an actionable operator request from approval-blocked open questions", () => {
    const state = createConsciousnessKernelSelfState({
      agentId: "main",
      now: "2026-03-20T00:00:00.000Z",
      dailyBudget: 60,
      maxEscalationsPerHour: 4,
      hardwareHostRequired: true,
      allowListening: true,
      allowVision: true,
    });
    state.agency.selfSummary =
      "Awaiting operator clarity on deletion policy for fragmented docs vs immutable records.";
    state.agenda.openQuestions = ["What defines immutable?", "Which docs are orphaned?"];
    state.concerns = ["Retention rules undefined"];

    expect(resolveConsciousnessKernelOperatorRequest(state)).toEqual({
      needed: true,
      question: "What defines immutable?",
      reason:
        "Awaiting operator clarity on deletion policy for fragmented docs vs immutable records.",
      source: "agenda",
    });
  });
});
