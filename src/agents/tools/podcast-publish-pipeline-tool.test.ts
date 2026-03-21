import { describe, expect, it } from "vitest";
import { createPodcastPublishPipelineTool } from "./podcast-publish-pipeline-tool.js";

function parseJsonText(result: { content?: Array<{ type?: string; text?: string }> }): any {
  const text = result.content?.find((entry) => entry.type === "text")?.text;
  if (!text) {
    throw new Error("missing text output");
  }
  return JSON.parse(text);
}

describe("podcast_publish_pipeline", () => {
  it("returns a resolved execution plan in mode=plan", async () => {
    const tool = createPodcastPublishPipelineTool();
    const result = await tool.execute("call-plan", {
      mode: "plan",
      podcast_generate: {
        title: "Pipeline Plan Test",
        dialogue: [{ text: "Hello world", voice_id: "voice-a" }],
      },
      heygen: { enabled: true },
      youtube_upload: { enabled: true },
    });

    const json = parseJsonText(result as any);
    expect(json.status).toBe("planned");
    expect(json.title).toBe("Pipeline Plan Test");
    expect(Array.isArray(json.plan.steps)).toBe(true);
    expect(json.plan.steps.some((step: any) => step.id === "podcast_generate")).toBe(true);
    expect(json.plan.steps.some((step: any) => step.id === "youtube_upload" && step.enabled)).toBe(
      true,
    );
  });

  it("can return structured partial_failure when fail_fast=false", async () => {
    const tool = createPodcastPublishPipelineTool();
    const result = await tool.execute("call-partial", {
      mode: "run",
      fail_fast: false,
    });
    const json = parseJsonText(result as any);
    expect(json.status).toBe("partial_failure");
    expect(String(json.error)).toContain("podcast_generate payload required");
  });
});
