import { describe, expect, it } from "vitest";
import type { SkillEntry } from "./skills.js";
import { buildRoomReaderOpportunityPromptBlock, resolveRoomReaderOpportunity } from "./skills.js";

function entry(name: string, description: string): SkillEntry {
  return {
    skill: {
      name,
      description,
      filePath: `/app/skills/${name}/SKILL.md`,
      baseDir: `/app/skills/${name}`,
      source: "argent-bundled",
    },
    frontmatter: {},
  };
}

const entries = [
  entry("podcast-production", "Turn notes into podcast episodes and show notes"),
  entry("article-writer", "Draft articles, newsletters, essays, and blog posts"),
  entry("research-brief", "Research topics, compare options, and cite sources"),
  entry("data-collector", "Collect business info, leads, CSV rows, and spreadsheets"),
  entry("workflow-builder", "Design automations, workflows, triggers, and pipelines"),
];

describe("Room Reader opportunity router", () => {
  it("detects podcast requests and recommends the podcast skill", () => {
    const result = resolveRoomReaderOpportunity({
      prompt: "Turn these notes into a podcast episode outline with show notes.",
      entries,
    });

    expect(result.mode).toBe("activate");
    expect(result.patterns[0]?.id).toBe("podcast");
    expect(result.recommended?.name).toBe("podcast-production");
  });

  it("detects article requests and does not recommend SpecForge", () => {
    const result = resolveRoomReaderOpportunity({
      prompt: "Can you draft this into a polished article for the blog?",
      entries,
    });

    expect(result.mode).toBe("activate");
    expect(result.patterns[0]?.id).toBe("article");
    expect(result.recommended?.name).toBe("article-writer");
    expect(result.recommended?.name).not.toBe("specforge");
  });

  it("detects business-info spreadsheet data collection", () => {
    const result = resolveRoomReaderOpportunity({
      prompt: "Gather business info for these prospects and fill in a spreadsheet.",
      entries,
    });

    expect(result.mode).toBe("activate");
    expect(result.patterns[0]?.id).toBe("data_collection");
    expect(result.recommended?.name).toBe("data-collector");
  });

  it("routes build-an-app prompts to the SpecForge project workflow", () => {
    const result = resolveRoomReaderOpportunity({
      prompt: "I want to build an app for tracking client onboarding.",
      entries,
    });

    expect(result.mode).toBe("activate");
    expect(result.patterns[0]?.id).toBe("project_build");
    expect(result.recommended).toEqual({
      kind: "workflow",
      name: "specforge",
      source: "core",
    });
  });

  it("routes coding application prompts to the SpecForge project workflow", () => {
    const result = resolveRoomReaderOpportunity({
      prompt: "I want to build a coding application",
      entries,
    });
    const block = buildRoomReaderOpportunityPromptBlock(result);

    expect(result.mode).toBe("activate");
    expect(result.patterns[0]?.id).toBe("project_build");
    expect(result.recommended).toEqual({
      kind: "workflow",
      name: "specforge",
      source: "core",
    });
    expect(block).toContain("Recommended workflow: specforge.");
  });

  it("observes read-only coding application discussion without injecting SpecForge", () => {
    const result = resolveRoomReaderOpportunity({
      prompt: "What is a coding application?",
      entries,
    });

    expect(result.mode).toBe("observe");
    expect(buildRoomReaderOpportunityPromptBlock(result)).toBeUndefined();
  });

  it("detects research as a non-SpecForge opportunity", () => {
    const result = resolveRoomReaderOpportunity({
      prompt: "Research the best options and compare them with sources.",
      entries,
    });

    expect(result.patterns[0]?.id).toBe("research");
    expect(result.recommended?.name).toBe("research-brief");
    expect(result.recommended?.name).not.toBe("specforge");
  });

  it("observes ambiguous chat without prompt injection", () => {
    const result = resolveRoomReaderOpportunity({
      prompt: "That sounds pretty good, thanks.",
      entries,
    });

    expect(result.mode).toBe("observe");
    expect(buildRoomReaderOpportunityPromptBlock(result)).toBeUndefined();
  });

  it("builds a concise prompt block without multi-skill-load instructions", () => {
    const result = resolveRoomReaderOpportunity({
      prompt: "Set up a recurring workflow that sends a weekly report.",
      entries,
    });
    const block = buildRoomReaderOpportunityPromptBlock(result);

    expect(block).toContain("## Opportunity Router");
    expect(block).toContain("workflow_automation");
    expect(block).toContain("Recommended skill: workflow-builder.");
    expect(block).not.toContain("read more than one skill");
    expect(block).not.toContain("multiple skills");
    expect((block ?? "").split("\n").length).toBeLessThanOrEqual(6);
  });
});
