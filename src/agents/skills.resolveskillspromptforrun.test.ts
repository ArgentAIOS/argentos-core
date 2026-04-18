import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SkillEntry } from "./skills.js";
import { matchSkillCandidatesForPrompt, resolveSkillsPromptForRun } from "./skills.js";

async function _writeSkill(params: {
  dir: string;
  name: string;
  description: string;
  metadata?: string;
  body?: string;
}) {
  const { dir, name, description, metadata, body } = params;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---
name: ${name}
description: ${description}${metadata ? `\nmetadata: ${metadata}` : ""}
---

${body ?? `# ${name}\n`}
`,
    "utf-8",
  );
}

describe("resolveSkillsPromptForRun", () => {
  it("prefers snapshot prompt when available", () => {
    const prompt = resolveSkillsPromptForRun({
      skillsSnapshot: { prompt: "SNAPSHOT", skills: [] },
      workspaceDir: "/tmp/argent",
    });
    expect(prompt).toBe("SNAPSHOT");
  });
  it("builds prompt from entries when snapshot is missing", () => {
    const entry: SkillEntry = {
      skill: {
        name: "demo-skill",
        description: "Demo",
        filePath: "/app/skills/demo-skill/SKILL.md",
        baseDir: "/app/skills/demo-skill",
        source: "argent-bundled",
      },
      frontmatter: {},
    };
    const prompt = resolveSkillsPromptForRun({
      entries: [entry],
      workspaceDir: "/tmp/argent",
    });
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("/app/skills/demo-skill/SKILL.md");
  });

  it("matches skill candidates from the current prompt for visibility", () => {
    const entry: SkillEntry = {
      skill: {
        name: "podcast-production",
        description: "Build podcast publishing workflows and video pipeline steps",
        filePath: "/app/skills/podcast-production/SKILL.md",
        baseDir: "/app/skills/podcast-production",
        source: "argent-workspace",
      },
      frontmatter: {},
    };

    const matches = matchSkillCandidatesForPrompt({
      prompt: "Can you help me with the podcast video pipeline?",
      entries: [entry],
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.name).toBe("podcast-production");
    expect(matches[0]?.kind).toBe("generic");
    expect(matches[0]?.score).toBeGreaterThan(0);
    expect(matches[0]?.reasons.join(" ")).toContain("podcast");
  });
});
