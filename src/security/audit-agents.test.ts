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
});
