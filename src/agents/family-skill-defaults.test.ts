import { describe, expect, it } from "vitest";
import { resolveFamilySkillMapping } from "./family-skill-defaults.js";

describe("family skill defaults", () => {
  it("applies coding-family defaults for dev-team engineers", () => {
    const mapping = resolveFamilySkillMapping({
      team: "dev-team",
      role: "software_engineer",
    });

    expect(mapping).toEqual({
      source: "team-role-default",
      defaultKey: "dev-team-implementer",
      skills: [
        "argentos-family-team-development",
        "argentos-implementation-planning",
        "argentos-test-driven-development",
        "argentos-systematic-debugging",
        "argentos-code-verification",
      ],
    });
  });

  it("keeps explicit mappings authoritative", () => {
    const mapping = resolveFamilySkillMapping({
      team: "dev-team",
      role: "software_engineer",
      skills: ["custom-skill", "custom-skill", " argentos-code-verification "],
      hasExplicitSkills: true,
    });

    expect(mapping).toEqual({
      source: "explicit",
      skills: ["custom-skill", "argentos-code-verification"],
    });
  });

  it("leaves non-dev teams unmapped until a team bundle exists", () => {
    expect(
      resolveFamilySkillMapping({
        team: "support-team",
        role: "tier_1_support_specialist",
      }),
    ).toEqual({
      source: "unmapped",
      skills: [],
    });
  });
});
