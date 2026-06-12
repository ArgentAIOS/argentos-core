import { beforeEach, describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import type { JobTemplate } from "../data/types.js";
import {
  clearRoleProfileCache,
  compileRoleProfile,
  getCompiledRoleProfile,
  getRoleProfileCacheStats,
} from "./worker-role-profile.js";

function makeTemplate(overrides?: Partial<JobTemplate>): JobTemplate {
  return {
    id: "tpl-1",
    name: "Help Desk Conductor",
    departmentId: "support",
    rolePrompt: "Triage inbound support tickets and route them to the right queue.",
    sop: "1. List open tickets. 2. Classify each. 3. File the triage log.",
    successDefinition: "Every open ticket has a classification in the triage log.",
    defaultMode: "simulate",
    toolsAllow: ["tasks", "memory_recall"],
    relationshipContract: { toneProfile: "calm, professional" },
    metadata: { simulationScenarios: ["angry customer", "billing dispute"] },
    createdAt: 1_000,
    updatedAt: 2_000,
    ...overrides,
  };
}

const cfg = {
  intent: {
    enabled: true,
    global: {
      objective: "Keep Titanium clients running with zero surprise downtime.",
      coreValues: ["honesty", "evidence over claims"],
      neverDo: ["promise refunds"],
    },
    departments: {
      support: { objective: "Resolve tickets fast without overpromising." },
    },
  },
} as unknown as ArgentConfig;

const simulateAssignment = { executionMode: "simulate" as const, deploymentStage: undefined };

describe("compileRoleProfile (Worker Runtime v2 D2)", () => {
  it("builds the four-part prompt: alignment + role contract + mode + tool rules", () => {
    const profile = compileRoleProfile({
      cfg,
      template: makeTemplate(),
      assignment: simulateAssignment,
    });
    const prompt = profile.systemPrompt;
    expect(prompt).toContain("# Worker Role: Help Desk Conductor");
    expect(prompt).toContain("## Company Alignment");
    expect(prompt).toContain("Resolve tickets fast without overpromising.");
    expect(prompt).toContain("Core values: honesty; evidence over claims");
    expect(prompt).toContain("## Role Contract");
    expect(prompt).toContain("Triage inbound support tickets");
    expect(prompt).toContain("## Standard Operating Procedure");
    expect(prompt).toContain("## Definition of Done");
    expect(prompt).toContain("## Relationship Contract");
    expect(prompt).toContain("SIMULATION MODE IS ENFORCED.");
    expect(prompt).toContain("Simulation scenarios: angry customer | billing dispute");
    expect(prompt).toContain("## Tool Rules");
    expect(prompt).toContain("COMPLETION CONTRACT: end with ONE work_report tool call");
  });

  it("prompt cleanliness by inspection (the law): zero operator-world text", () => {
    const profile = compileRoleProfile({
      cfg,
      template: makeTemplate(),
      assignment: simulateAssignment,
    });
    const prompt = profile.systemPrompt.toLowerCase();
    // Markers of the operator scaffold the blank-slate law bans from worker
    // prompts: identity files, memory, skills, channels, the assistant persona.
    const forbidden = [
      "soul.md",
      "identity.md",
      "personal assistant",
      "[mood:",
      "## memory",
      "memory recall",
      "## skills",
      "personal skill",
      "heartbeat",
      "silent repl",
      "sessions_spawn",
      "subagent",
      "group chat",
      "## messaging",
      "argent cli",
      "self-update",
      "workspace files",
      "project context",
    ];
    for (const marker of forbidden) {
      expect(
        prompt,
        `forbidden operator marker "${marker}" leaked into the worker prompt`,
      ).not.toContain(marker);
    }
  });

  it("grants are structural: template grants + work_report, default-deny when empty", () => {
    const granted = compileRoleProfile({
      cfg,
      template: makeTemplate(),
      assignment: simulateAssignment,
    });
    expect(granted.toolsAllow.toSorted()).toEqual(["memory_recall", "tasks", "work_report"]);

    const reportOnly = compileRoleProfile({
      cfg,
      template: makeTemplate({ toolsAllow: undefined }),
      assignment: simulateAssignment,
    });
    expect(reportOnly.toolsAllow).toEqual(["work_report"]);
  });

  it("mode directives follow the assignment stage", () => {
    const limited = compileRoleProfile({
      cfg,
      template: makeTemplate(),
      assignment: { executionMode: "live", deploymentStage: "limited-live" },
    });
    expect(limited.systemPrompt).toContain("LIMITED-LIVE MODE IS ENFORCED.");
    expect(limited.systemPrompt).not.toContain("SIMULATION MODE IS ENFORCED.");

    const live = compileRoleProfile({
      cfg,
      template: makeTemplate(),
      assignment: { executionMode: "live", deploymentStage: undefined },
    });
    expect(live.systemPrompt).toContain("LIVE MODE.");
  });

  it("reads the role model ref from template metadata (D8)", () => {
    const profile = compileRoleProfile({
      cfg,
      template: makeTemplate({ metadata: { model: "lmstudio/google/gemma-4-12b-qat" } }),
      assignment: simulateAssignment,
    });
    expect(profile.model).toBe("lmstudio/google/gemma-4-12b-qat");
  });

  it("stays small: minimal template compiles well under the worker budget", () => {
    const profile = compileRoleProfile({
      cfg: {} as ArgentConfig,
      template: makeTemplate({
        sop: undefined,
        successDefinition: undefined,
        relationshipContract: undefined,
        metadata: undefined,
      }),
      assignment: simulateAssignment,
    });
    // Scaffold overhead must stay tiny — the ≤2.5k-token live budget belongs
    // to the role content, not to this module.
    expect(profile.systemPrompt.length).toBeLessThan(2500);
  });
});

describe("role profile cache (compiled once per template version)", () => {
  beforeEach(() => {
    clearRoleProfileCache();
  });

  it("hits on warm runs with the same template version", () => {
    const template = makeTemplate();
    const first = getCompiledRoleProfile({ cfg, template, assignment: simulateAssignment });
    const second = getCompiledRoleProfile({ cfg, template, assignment: simulateAssignment });
    expect(second).toBe(first);
    expect(getRoleProfileCacheStats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it("invalidates on template edit (updatedAt bump) and evicts the stale version", () => {
    const template = makeTemplate();
    const first = getCompiledRoleProfile({ cfg, template, assignment: simulateAssignment });
    const edited = makeTemplate({ updatedAt: 3_000, rolePrompt: "New contract." });
    const second = getCompiledRoleProfile({
      cfg,
      template: edited,
      assignment: simulateAssignment,
    });
    expect(second).not.toBe(first);
    expect(second.systemPrompt).toContain("New contract.");
    const stats = getRoleProfileCacheStats();
    expect(stats.invalidations).toBe(1);
    expect(stats.size).toBe(1);
  });

  it("keys mode and stage separately without cross-invalidating", () => {
    const template = makeTemplate();
    const sim = getCompiledRoleProfile({ cfg, template, assignment: simulateAssignment });
    const live = getCompiledRoleProfile({
      cfg,
      template,
      assignment: { executionMode: "live", deploymentStage: "live" },
    });
    expect(sim).not.toBe(live);
    expect(getRoleProfileCacheStats().size).toBe(2);
    expect(getCompiledRoleProfile({ cfg, template, assignment: simulateAssignment })).toBe(sim);
  });
});
