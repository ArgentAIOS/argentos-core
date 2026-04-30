import { describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { collectAgentProfileFindings } from "./audit-agents.js";

describe("agent/profile security audit", () => {
  it("flags shared agent directories", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          { id: "forge", name: "Forge", agentDir: "/tmp/argent/agents/shared/agent" },
          { id: "reviewer", name: "Reviewer", agentDir: "/tmp/argent/agents/shared/agent" },
        ],
      },
    };

    expect(collectAgentProfileFindings(cfg)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "agents.agent_dir.shared",
          severity: "critical",
          domain: "agents",
        }),
      ]),
    );
  });

  it("flags shared auth profile stores exposed by agentDir", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          { id: "forge", name: "Forge", agentDir: "/tmp/argent/agents/shared/agent" },
          { id: "reviewer", name: "Reviewer", agentDir: "/tmp/argent/agents/shared/agent" },
        ],
      },
    };

    const finding = collectAgentProfileFindings(cfg).find(
      (entry) => entry.checkId === "agents.auth_profiles.shared",
    );
    expect(finding).toEqual(
      expect.objectContaining({
        severity: "critical",
        domain: "agents",
      }),
    );
    expect(finding?.detail).toContain("auth-profiles.json");
    expect(finding?.remediation).toContain("separate auth-profiles.json");
  });

  it("flags shared explicit auth profile paths when raw config exposes them", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          {
            id: "forge",
            name: "Forge",
            authProfilesPath: "/tmp/argent/shared/auth-profiles.json",
          } as unknown as ArgentConfig["agents"]["list"][number],
          {
            id: "reviewer",
            name: "Reviewer",
            auth: { authProfilesPath: "/tmp/argent/shared/auth-profiles.json" },
          } as unknown as ArgentConfig["agents"]["list"][number],
        ],
      },
    };

    const finding = collectAgentProfileFindings(cfg).find(
      (entry) => entry.checkId === "agents.auth_profiles.shared",
    );
    expect(finding?.detail).toContain("Forge");
    expect(finding?.detail).toContain("Reviewer");
  });

  it("flags coding family agents without skill mappings", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          {
            id: "forge",
            name: "Forge",
            role: "software_engineer",
            team: "dev-team",
          },
        ],
      },
    };

    expect(collectAgentProfileFindings(cfg)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "agents.dev_team.skills_missing",
          severity: "warn",
        }),
      ]),
    );
  });

  it("does not flag coding family agents with default skill metadata", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          {
            id: "forge",
            name: "Forge",
            role: "software_engineer",
            team: "dev-team",
            skillSource: "team-role-default",
          },
        ],
      },
    };

    expect(
      collectAgentProfileFindings(cfg).some(
        (finding) => finding.checkId === "agents.dev_team.skills_missing",
      ),
    ).toBe(false);
  });

  it("warns when a weak agent model has high-risk external or elevated tools", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          {
            id: "forge",
            name: "Forge",
            model: "ollama/qwen2.5-coder:14b",
            tools: { allow: ["exec", "web_search"] },
          },
        ],
      },
    };

    const finding = collectAgentProfileFindings(cfg).find(
      (entry) => entry.checkId === "agents.models.high_risk_tools_on_weak_model",
    );
    expect(finding).toEqual(
      expect.objectContaining({
        severity: "warn",
        domain: "agents",
      }),
    );
    expect(finding?.detail).toContain("qwen2.5-coder:14b");
    expect(finding?.detail).toContain("exec");
    expect(finding?.detail).toContain("web_search");
    expect(finding?.remediation).toContain("stronger model-backed agent");
  });

  it("warns when inherited weak defaults are paired with a high-risk tool profile", () => {
    const cfg: ArgentConfig = {
      agents: {
        defaults: { model: { primary: "anthropic/claude-3-haiku" } },
        list: [
          {
            id: "forge",
            name: "Forge",
            tools: { profile: "coding" },
          },
        ],
      },
    };

    const finding = collectAgentProfileFindings(cfg).find(
      (entry) => entry.checkId === "agents.models.high_risk_tools_on_weak_model",
    );
    expect(finding?.detail).toContain("claude-3-haiku");
    expect(finding?.detail).toContain("profile:coding");
  });

  it("flags conflicting profile source-of-truth metadata when raw fields exist", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          {
            id: "forge",
            name: "Forge",
            profileSourceOfTruth: "identity.json",
            identitySource: "argent.json",
          } as unknown as ArgentConfig["agents"]["list"][number],
        ],
      },
    };

    const finding = collectAgentProfileFindings(cfg).find(
      (entry) => entry.checkId === "agents.profile.source_mismatch",
    );
    expect(finding?.detail).toContain("profileSourceOfTruth=identity.json");
    expect(finding?.detail).toContain("identitySource=argent.json");
  });

  it("does not invent source-of-truth findings for the current typed config shape", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          {
            id: "forge",
            name: "Forge",
            agentDir: "/tmp/argent/agents/forge/agent",
            skills: ["code-review"],
          },
        ],
      },
    };

    expect(
      collectAgentProfileFindings(cfg).some(
        (finding) => finding.checkId === "agents.profile.source_mismatch",
      ),
    ).toBe(false);
  });
});
