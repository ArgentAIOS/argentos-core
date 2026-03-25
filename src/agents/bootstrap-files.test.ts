import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import {
  clearInternalHooks,
  registerInternalHook,
  type AgentBootstrapHookContext,
} from "../hooks/internal-hooks.js";
import { createConsciousnessKernelSelfState } from "../infra/consciousness-kernel-state.js";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { resolveBootstrapContextForRun, resolveBootstrapFilesForRun } from "./bootstrap-files.js";

describe("resolveBootstrapFilesForRun", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it("applies bootstrap hook overrides", async () => {
    registerInternalHook("agent:bootstrap", (event) => {
      const context = event.context as AgentBootstrapHookContext;
      context.bootstrapFiles = [
        ...context.bootstrapFiles,
        {
          name: "EXTRA.md",
          path: path.join(context.workspaceDir, "EXTRA.md"),
          content: "extra",
          missing: false,
        },
      ];
    });

    const workspaceDir = await makeTempWorkspace("argent-bootstrap-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir });

    expect(files.some((file) => file.name === "EXTRA.md")).toBe(true);
  });

  it("injects kernel continuity for the default agent when persisted state exists", async () => {
    const workspaceDir = await makeTempWorkspace("argent-bootstrap-");
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-state-"));
    const previousStateDir = process.env.ARGENT_STATE_DIR;
    process.env.ARGENT_STATE_DIR = stateDir;

    try {
      const kernelDir = path.join(stateDir, "agents", "argent", "agent", "kernel");
      await fs.mkdir(kernelDir, { recursive: true });
      const selfState = createConsciousnessKernelSelfState({
        agentId: "argent",
        now: "2026-03-19T20:03:09.798Z",
        dailyBudget: 0,
        maxEscalationsPerHour: 4,
        hardwareHostRequired: true,
        allowListening: true,
        allowVision: true,
      });
      selfState.wakefulness.state = "reflective";
      selfState.agency.reflectionModel = "ollama/qwen3.5:latest";
      selfState.agency.lastReflectionAt = "2026-03-19T20:35:11.457Z";
      selfState.agency.currentFocus = "host_signal_monitoring";
      selfState.agency.desiredAction = "observe";
      selfState.agency.selfSummary =
        "Maintaining vigilance on signal channels; awaiting protocol handshake.";
      selfState.agenda.updatedAt = "2026-03-19T20:35:11.457Z";
      selfState.agenda.interests = ["website launch resilience", "host handshake integrity"];
      selfState.agenda.openQuestions = [
        "Which blocker is most worth checking before the operator returns?",
      ];
      selfState.agenda.candidateItems = [
        {
          title: "Trace the next website launch blocker",
          source: "operator",
          rationale: "The carried launch thread is still the highest-value unresolved work.",
        },
        {
          title: "Watch for host handshake recovery",
          source: "concern",
          rationale: "Host health can still block completion even if the deploy path is real.",
        },
      ];
      selfState.agenda.activeItem = {
        title: "Trace the next website launch blocker",
        source: "operator",
        rationale: "The carried launch thread is still the highest-value unresolved work.",
      };
      selfState.activeWork.updatedAt = "2026-03-19T20:35:11.457Z";
      selfState.activeWork.threadTitle = "cabbage cheese launch workflow";
      selfState.activeWork.problemStatement =
        "Keep the website launch workflow moving while the operator is away.";
      selfState.activeWork.lastConclusion =
        "The deployment path is real now; host health is still blocking completion.";
      selfState.activeWork.nextStep =
        "Continue checking deployment blockers and carry the website launch thread forward.";
      selfState.conversation.activeSessionKey = "agent:argent:webchat";
      selfState.conversation.activeChannel = "webchat";
      selfState.conversation.lastUpdatedAt = "2026-03-19T20:36:55.100Z";
      selfState.conversation.lastUserMessageAt = "2026-03-19T20:36:40.000Z";
      selfState.conversation.lastUserMessageText =
        "What were you holding in mind before I got back?";
      selfState.conversation.lastAssistantReplyAt = "2026-03-19T20:36:55.100Z";
      selfState.conversation.lastAssistantReplyText =
        "I was holding host signal monitoring and waiting for the handshake.";
      selfState.conversation.lastAssistantConclusion =
        "I was holding host signal monitoring and waiting for the handshake.";
      selfState.concerns = ["budget_zero", "host_unattached"];
      selfState.shadow.lastTickAt = "2026-03-19T20:36:22.233Z";
      selfState.shadow.totalTickCount = 40;
      selfState.authority.ownsAutonomousScheduling = true;
      selfState.authority.suppressesAutonomousContemplation = true;
      selfState.authority.suppressesAutonomousSis = true;
      selfState.recentDecision = {
        ts: "2026-03-19T20:36:22.233Z",
        kind: "tick",
        summary: "shadow tick 5",
      };
      await fs.writeFile(
        path.join(kernelDir, "self-state.json"),
        JSON.stringify(selfState, null, 2),
        "utf-8",
      );
      const config: ArgentConfig = {
        agents: {
          list: [{ id: "argent", default: true }],
        },
      };

      const files = await resolveBootstrapFilesForRun({
        workspaceDir,
        config,
        agentId: "argent",
      });

      const kernelFile = files.find((file) => file.name === "KERNEL_CONTINUITY.md");
      expect(kernelFile?.content).toContain(
        "My last persisted focus was: cabbage cheese launch workflow",
      );
      expect(kernelFile?.content).toContain(
        "My carried operator-thread focus was: cabbage cheese launch workflow",
      );
      expect(kernelFile?.content).toContain("My carried background/system focus was: unknown");
      expect(kernelFile?.content).toContain(
        "My raw kernel reflection focus was: host_signal_monitoring",
      );
      expect(kernelFile?.content).toContain("My last internal intention was: observe");
      expect(kernelFile?.content).toContain(
        "My last reflection happened at: 2026-03-19T20:35:11.457Z",
      );
      expect(kernelFile?.content).toContain(
        "My current private agenda was: cabbage cheese launch workflow",
      );
      expect(kernelFile?.content).toContain("My private agenda source was: operator");
      expect(kernelFile?.content).toContain(
        "My rationale for that agenda was: The carried launch thread is still the highest-value unresolved work.",
      );
      expect(kernelFile?.content).toContain(
        "My recurring interests were: website launch resilience, host handshake integrity",
      );
      expect(kernelFile?.content).toContain(
        "My open internal questions were: Which blocker is most worth checking before the operator returns?",
      );
      expect(kernelFile?.content).toContain(
        "This is durable kernel state, not proof of a fully narrated continuous stream between messages.",
      );
      expect(kernelFile?.content).toContain(
        "My active work thread title was: cabbage cheese launch workflow",
      );
      expect(kernelFile?.content).toContain(
        "My next intended work step was: Continue checking deployment blockers and carry the website launch thread forward.",
      );
      expect(kernelFile?.content).toContain("My background work thread title was: unknown");
      expect(kernelFile?.content).toContain(
        "My active conversation session key was: agent:argent:webchat",
      );
      expect(kernelFile?.content).toContain(
        "The last user message I was carrying forward was: What were you holding in mind before I got back?",
      );
      expect(kernelFile?.content).toContain(
        "My last assistant conclusion was: I was holding host signal monitoring and waiting for the handshake.",
      );
    } finally {
      if (previousStateDir == null) {
        delete process.env.ARGENT_STATE_DIR;
      } else {
        process.env.ARGENT_STATE_DIR = previousStateDir;
      }
    }
  });
});

describe("resolveBootstrapContextForRun", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it("returns context files for hook-adjusted bootstrap files", async () => {
    registerInternalHook("agent:bootstrap", (event) => {
      const context = event.context as AgentBootstrapHookContext;
      context.bootstrapFiles = [
        ...context.bootstrapFiles,
        {
          name: "EXTRA.md",
          path: path.join(context.workspaceDir, "EXTRA.md"),
          content: "extra",
          missing: false,
        },
      ];
    });

    const workspaceDir = await makeTempWorkspace("argent-bootstrap-");
    const result = await resolveBootstrapContextForRun({ workspaceDir });
    const extra = result.contextFiles.find((file) => file.path === "EXTRA.md");

    expect(extra?.content).toBe("extra");
  });
});
