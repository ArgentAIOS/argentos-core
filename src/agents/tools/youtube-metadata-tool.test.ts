import { describe, expect, it } from "vitest";
import { createYoutubeMetadataTool } from "./youtube-metadata-tool.js";

function parseResultJson(result: { content?: Array<{ type?: string; text?: string }> }): any {
  const text = result.content?.find((entry) => entry.type === "text")?.text;
  if (!text) throw new Error("missing text output");
  return JSON.parse(text);
}

describe("youtube_metadata_generate", () => {
  it("builds title options, description, and chapters", async () => {
    const tool = createYoutubeMetadataTool();
    const result = await tool.execute("call-1", {
      episode_title: "The Great Model Convergence",
      show_name: "Argent's Bleeding Edge Morning Show",
      summary: "Frontier model launches are converging into a tighter competitive field.",
      key_points: [
        "Model capability gaps are shrinking",
        "Inference costs keep dropping",
        "Agent workflows are becoming the differentiator",
      ],
      deep_dive: "Why architecture and execution pipelines matter more than benchmark deltas.",
      sponsor_name: "Titanium Computing",
      sponsor_url: "https://titaniumcomputing.com",
      links: [{ label: "Main site", url: "https://argentos.ai" }],
      hashtags: ["AI", "LLM", "Agents"],
      include_timestamps: true,
      segments: [
        { title: "Intro", duration_sec: 60 },
        { title: "Top Stories", duration_sec: 300 },
        { title: "Deep Dive", duration_sec: 420 },
      ],
    });

    const json = parseResultJson(result as any);
    expect(Array.isArray(json.title_options)).toBe(true);
    expect(json.title_options.length).toBeGreaterThan(1);
    expect(String(json.recommended_title)).toContain("Great Model Convergence");
    expect(String(json.description)).toContain("In this episode:");
    expect(String(json.description)).toContain("Sponsor: Titanium Computing");
    expect(Array.isArray(json.chapters)).toBe(true);
    expect(json.chapters[0]).toBe("00:00 Intro");
    expect(String(json.description)).toContain("#AI #LLM #Agents");
    expect(json.thumbnail_brief.headline).toBeTruthy();
  });

  it("supports creator_longform layout with top links and section blocks", async () => {
    const tool = createYoutubeMetadataTool();
    const result = await tool.execute("call-2", {
      episode_title: "Agent Infrastructure Is Crossing the Line",
      description_style: "creator_longform",
      summary: "AGI does not arrive with a headline; it shows up in deployment patterns.",
      key_points: [
        "Why governance changes enterprise deployment",
        "How secure runtimes unlock autonomous operations",
      ],
      top_links: [
        { label: "Try Deep Agent", url: "https://example.com/deep-agent" },
        { label: "Watch Part 1", url: "https://example.com/part-1" },
      ],
      extra_sections: [
        {
          heading: "CONNECT",
          lines: ["Twitter: https://x.com/example", "LinkedIn: https://linkedin.com/in/example"],
        },
      ],
      divider_line: "........................",
      hashtags: ["AI", "AGI"],
    });

    const json = parseResultJson(result as any);
    expect(json.description_style).toBe("creator_longform");
    expect(String(json.description)).toContain("-> Try Deep Agent: https://example.com/deep-agent");
    expect(String(json.description)).toContain("Inside this breakdown:");
    expect(String(json.description)).toContain("........................");
    expect(String(json.description)).toContain("CONNECT");
    expect(String(json.description)).toContain("#AI #AGI");
  });
});
