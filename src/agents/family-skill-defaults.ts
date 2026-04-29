export type FamilySkillSource = "explicit" | "team-role-default" | "unmapped";

export interface FamilySkillMappingInput {
  team?: string;
  role?: string;
  skills?: string[];
  hasExplicitSkills?: boolean;
}

export interface FamilySkillMapping {
  skills: string[];
  source: FamilySkillSource;
  defaultKey?: string;
}

const DEV_TEAM_BASE_SKILLS = [
  "argentos-family-team-development",
  "argentos-implementation-planning",
];

const ROLE_SKILL_RULES: Array<{
  key: string;
  roles: string[];
  skills: string[];
}> = [
  {
    key: "dev-team-planner",
    roles: ["planner", "architect", "lead", "orchestrator", "product"],
    skills: ["argentos-implementation-planning", "argentos-family-team-development"],
  },
  {
    key: "dev-team-implementer",
    roles: ["software_engineer", "engineer", "developer", "implementer", "coder"],
    skills: [
      "argentos-test-driven-development",
      "argentos-systematic-debugging",
      "argentos-code-verification",
    ],
  },
  {
    key: "dev-team-debugger",
    roles: ["debugger", "bug", "triage"],
    skills: ["argentos-systematic-debugging", "argentos-code-verification"],
  },
  {
    key: "dev-team-reviewer",
    roles: ["reviewer", "verifier", "qa", "test", "integrator"],
    skills: ["argentos-code-verification", "argentos-test-driven-development"],
  },
];

function normalizeSkillList(list: string[] | undefined): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const value = String(item ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function mergeSkills(...groups: string[][]): string[] {
  return normalizeSkillList(groups.flat());
}

export function resolveFamilySkillMapping(input: FamilySkillMappingInput): FamilySkillMapping {
  if (input.hasExplicitSkills) {
    return {
      skills: normalizeSkillList(input.skills),
      source: "explicit",
    };
  }

  const team = String(input.team ?? "")
    .trim()
    .toLowerCase();
  const role = String(input.role ?? "")
    .trim()
    .toLowerCase();
  if (team !== "dev-team") {
    return {
      skills: [],
      source: "unmapped",
    };
  }

  const matched = ROLE_SKILL_RULES.find((rule) => includesAny(role, rule.roles));
  return {
    skills: mergeSkills(DEV_TEAM_BASE_SKILLS, matched?.skills ?? []),
    source: "team-role-default",
    defaultKey: matched?.key ?? "dev-team-base",
  };
}
