import { describe, expect, it } from "vitest";
import {
  buildIntentSystemPromptHint,
  resolveEffectiveIntentForAgent,
  validateIntentHierarchy,
} from "./intent.js";

describe("intent hierarchy", () => {
  it("accepts monotonic tightening across layers", () => {
    const issues = validateIntentHierarchy({
      intent: {
        enabled: true,
        global: {
          allowedActions: ["reply", "refund_small"],
          neverDo: ["commit_outside_policy"],
          escalation: {
            sentimentThreshold: -0.35,
            maxAttemptsBeforeEscalation: 3,
          },
          requireAcknowledgmentBeforeClose: true,
        },
        departments: {
          support: {
            allowedActions: ["reply"],
            neverDo: ["commit_outside_policy", "close_without_ack"],
            escalation: {
              sentimentThreshold: -0.3,
              maxAttemptsBeforeEscalation: 2,
            },
            requireAcknowledgmentBeforeClose: true,
          },
        },
        agents: {
          main: {
            departmentId: "support",
            allowedActions: ["reply"],
            escalation: {
              sentimentThreshold: -0.25,
              maxAttemptsBeforeEscalation: 1,
            },
            neverDo: ["commit_outside_policy", "close_without_ack", "guess_financials"],
          },
        },
      },
    });
    expect(issues).toEqual([]);
  });

  it("rejects loosening numeric and boolean constraints", () => {
    const issues = validateIntentHierarchy({
      intent: {
        enabled: true,
        global: {
          escalation: {
            sentimentThreshold: -0.35,
            maxAttemptsBeforeEscalation: 2,
          },
          requireAcknowledgmentBeforeClose: true,
        },
        agents: {
          main: {
            escalation: {
              sentimentThreshold: -0.5,
              maxAttemptsBeforeEscalation: 4,
            },
            requireAcknowledgmentBeforeClose: false,
          },
        },
      },
    });
    expect(issues.map((issue) => issue.path)).toContain(
      "intent.agents.main.escalation.sentimentThreshold",
    );
    expect(issues.map((issue) => issue.path)).toContain(
      "intent.agents.main.escalation.maxAttemptsBeforeEscalation",
    );
    expect(issues.map((issue) => issue.path)).toContain(
      "intent.agents.main.requireAcknowledgmentBeforeClose",
    );
  });

  it("rejects expanding allowedActions beyond parent allowlist", () => {
    const issues = validateIntentHierarchy({
      intent: {
        enabled: true,
        global: {
          allowedActions: ["reply"],
        },
        agents: {
          main: {
            allowedActions: ["reply", "refund_small"],
          },
        },
      },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("intent.agents.main.allowedActions");
  });

  it("validates explicit version lineage pointers", () => {
    const issues = validateIntentHierarchy({
      intent: {
        enabled: true,
        global: {
          version: "global-v2",
        },
        departments: {
          support: {
            version: "dept-v3",
            parentGlobalVersion: "global-v1",
          },
        },
        agents: {
          main: {
            departmentId: "support",
            parentGlobalVersion: "global-v9",
            parentDepartmentVersion: "dept-v1",
          },
          orphan: {
            parentDepartmentVersion: "dept-v3",
          },
        },
      },
    });

    expect(issues.map((issue) => issue.path)).toContain(
      "intent.departments.support.parentGlobalVersion",
    );
    expect(issues.map((issue) => issue.path)).toContain("intent.agents.main.parentGlobalVersion");
    expect(issues.map((issue) => issue.path)).toContain(
      "intent.agents.main.parentDepartmentVersion",
    );
    expect(issues.map((issue) => issue.path)).toContain(
      "intent.agents.orphan.parentDepartmentVersion",
    );
  });

  it("resolves effective policy and emits prompt hint", () => {
    const resolved = resolveEffectiveIntentForAgent({
      agentId: "main",
      config: {
        intent: {
          enabled: true,
          runtimeMode: "advisory",
          global: {
            objective: "retain_customer",
            neverDo: ["commit_outside_policy"],
            escalation: {
              maxAttemptsBeforeEscalation: 3,
            },
          },
          departments: {
            support: {
              neverDo: ["close_without_ack"],
              escalation: {
                maxAttemptsBeforeEscalation: 2,
              },
            },
          },
          agents: {
            main: {
              departmentId: "support",
              neverDo: ["guess_financials"],
              escalation: {
                maxAttemptsBeforeEscalation: 1,
              },
            },
          },
        },
      },
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.policy.neverDo).toEqual([
      "commit_outside_policy",
      "close_without_ack",
      "guess_financials",
    ]);
    expect(resolved?.policy.escalation?.maxAttemptsBeforeEscalation).toBe(1);
    expect(resolved?.lineage.globalVersion).toBeUndefined();
    expect(resolved?.lineage.departmentId).toBe("support");
    const hint = buildIntentSystemPromptHint(resolved?.policy ?? {});
    expect(hint).toContain("Intent Constraints");
    expect(hint).toContain("retain_customer");
  });

  it("returns lineage versions for resolved agent policy", () => {
    const resolved = resolveEffectiveIntentForAgent({
      agentId: "main",
      config: {
        intent: {
          enabled: true,
          global: {
            version: "global-v2",
          },
          departments: {
            support: {
              version: "dept-v3",
              parentGlobalVersion: "global-v2",
            },
          },
          agents: {
            main: {
              departmentId: "support",
              version: "agent-v5",
              parentGlobalVersion: "global-v2",
              parentDepartmentVersion: "dept-v3",
            },
          },
        },
      },
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.lineage).toEqual({
      globalVersion: "global-v2",
      departmentId: "support",
      departmentVersion: "dept-v3",
      agentVersion: "agent-v5",
      parentGlobalVersion: "global-v2",
      parentDepartmentVersion: "dept-v3",
    });
  });
});
