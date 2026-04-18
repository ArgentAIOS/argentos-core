import { describe, expect, it } from "vitest";
import { buildSystemPromptReport } from "./system-prompt-report.js";

describe("buildSystemPromptReport", () => {
  it("includes matched skill candidates when provided", () => {
    const report = buildSystemPromptReport({
      source: "run",
      generatedAt: Date.now(),
      bootstrapMaxChars: 1000,
      systemPrompt:
        "Tool names are case-sensitive. Call tools exactly as listed.\n\nTOOLS.md does not control tool availability; it is user guidance for how to use external tools.",
      bootstrapFiles: [],
      injectedFiles: [],
      skillsPrompt:
        "<available_skills>\n  <skill>\n    <name>podcast-production</name>\n  </skill>\n</available_skills>",
      matchedSkillCandidates: [
        {
          name: "podcast-production",
          source: "workspace",
          kind: "generic",
          score: 4.5,
          reasons: ["name:podcast", "context:pipeline"],
        },
      ],
      tools: [],
    });

    expect(report.skills.matchedCandidates).toHaveLength(1);
    expect(report.skills.matchedCandidates?.[0]?.name).toBe("podcast-production");
    expect(report.skills.matchedCandidates?.[0]?.source).toBe("workspace");
    expect(report.skills.matchedCandidates?.[0]?.kind).toBe("generic");
  });
});
