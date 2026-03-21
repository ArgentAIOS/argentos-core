import { describe, expect, it } from "vitest";
import { createPodcastPlanTool } from "./podcast-plan-tool.js";

function readJsonResult(result: { content?: Array<{ type?: string; text?: string }> }): any {
  const textItem = result.content?.find((item) => item.type === "text");
  if (!textItem?.text) {
    throw new Error("Missing text payload");
  }
  return JSON.parse(textItem.text);
}

describe("podcast_plan", () => {
  it("parses SPEAKER script into podcast_generate payload", async () => {
    const tool = createPodcastPlanTool();
    const result = await tool.execute("call-1", {
      title: "Bleeding Edge Test",
      personas: [
        { id: "argent", voice_id: "voice-argent", aliases: ["ARGENT", "HOST"] },
        { id: "juniper", voice_id: "voice-juniper", aliases: ["JUNIPER"] },
      ],
      script: `
[MUSIC: intro]
ARGENT: Welcome back to the show.
Today we cover model convergence.
JUNIPER: So everything is converging?
ARGENT: Fast. And costs are dropping.
`,
      publish: { spotify: true, youtube: true, heygen: true },
    });

    const json = readJsonResult(result as any);
    const dialogue = json.podcast_generate.dialogue as Array<Record<string, unknown>>;

    expect(dialogue).toHaveLength(3);
    expect(dialogue[0]?.persona).toBe("argent");
    expect(dialogue[0]?.voice_id).toBe("voice-argent");
    expect(String(dialogue[0]?.text)).toContain("Today we cover model convergence.");
    expect(dialogue[1]?.persona).toBe("juniper");
    expect(dialogue[1]?.voice_id).toBe("voice-juniper");
    expect(json.runbook.some((step: any) => step.id === "publish_spotify")).toBe(true);
    expect(json.runbook.some((step: any) => step.id === "generate_video")).toBe(true);
    expect(json.runbook.some((step: any) => step.id === "publish_youtube")).toBe(true);
  });

  it("uses default voice for unmapped speakers", async () => {
    const tool = createPodcastPlanTool();
    const result = await tool.execute("call-2", {
      title: "Fallback Voice Test",
      personas: [{ id: "argent", voice_id: "voice-argent", aliases: ["ARGENT"] }],
      default_voice_id: "voice-fallback",
      script: `
UNKNOWN: This speaker is not mapped.
ARGENT: This one is mapped.
`,
    });

    const json = readJsonResult(result as any);
    const dialogue = json.podcast_generate.dialogue as Array<Record<string, unknown>>;
    expect(dialogue).toHaveLength(2);
    expect(dialogue[0]?.voice_id).toBe("voice-fallback");
    expect(Array.isArray(json.parse.warnings)).toBe(true);
    expect(
      (json.parse.warnings as string[]).some((warning) => warning.includes("fallback voice")),
    ).toBe(true);
  });
});
