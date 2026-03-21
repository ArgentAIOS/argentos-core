import { describe, expect, it } from "vitest";
import { parseEpisodeFromResponse } from "./episode-types.js";

describe("parseEpisodeFromResponse", () => {
  it("parses tagged episode json when present", () => {
    const result = parseEpisodeFromResponse(`
[EPISODE_JSON]
{
  "type": "creation",
  "outcome": { "result": "success", "summary": "Wrote a brief." },
  "mood": { "state": "focused" },
  "tools_used": [{ "tool": "doc_panel_update", "success": true }]
}
[/EPISODE_JSON]
`);

    expect(result?.source).toBe("tagged_json");
    expect(result?.report.type).toBe("creation");
    expect(result?.report.tools_used[0]?.tool).toBe("doc_panel_update");
  });

  it("normalizes malformed tagged episode json into structured fields", () => {
    const result = parseEpisodeFromResponse(
      `
[EPISODE_JSON]
{
  "type": "contemplation",
  "trigger": "NUDGE reflection loop with mandatory external artifact",
  "observations": [
    "External MSP cyber coverage trends emphasize identity-first security.",
    "Atera alerts probe failed with 401 MissingXAteraJwtResponse."
  ],
  "actions_taken": [
    "Executed one external research probe via web search on MSP cyber threats.",
    "Published a compounding artifact to DocPanel documenting the verified signal."
  ],
  "tools_used": ["web_search", "atera_alerts", "doc_panel"],
  "outcome": "Produced externally visible artifact and updated blocker diagnosis to explicit auth/header failure mode (401).",
  "success": true,
  "mood": "focused",
  "valence": 0.1,
  "arousal": 0.6,
  "identity_links": [
    "evidence-first execution",
    "blocker transparency"
  ]
}
[/EPISODE_JSON]
`,
      {
        executedTools: ["web_search", "atera_alerts", "doc_panel"],
        hasExternalArtifact: true,
      },
    );

    expect(result?.source).toBe("tagged_json");
    expect(result?.report.type).toBe("contemplation");
    expect(result?.report.trigger).toEqual({
      source: "contemplation_timer",
      detail: "NUDGE reflection loop with mandatory external artifact",
    });
    expect(result?.report.observations).toEqual([
      {
        what: "External MSP cyber coverage trends emphasize identity-first security.",
        significance: "medium",
      },
      {
        what: "Atera alerts probe failed with 401 MissingXAteraJwtResponse.",
        significance: "medium",
      },
    ]);
    expect(result?.report.actions_taken[0]).toEqual({
      type: "tool_call",
      description: "Executed one external research probe via web search on MSP cyber threats.",
    });
    expect(result?.report.tools_used).toEqual([
      { tool: "web_search", success: true },
      { tool: "atera_alerts", success: true },
      { tool: "doc_panel", success: true },
    ]);
    expect(result?.report.outcome).toEqual({
      result: "success",
      summary:
        "Produced externally visible artifact and updated blocker diagnosis to explicit auth/header failure mode (401).",
    });
    expect(result?.report.mood).toEqual({
      state: "focused",
      energy: "medium",
    });
    expect(result?.report.identity_links).toEqual([
      { entity: "evidence-first execution", role: "about" },
      { entity: "blocker transparency", role: "about" },
    ]);
  });

  it("salvages internal-only function envelopes into a rest episode", () => {
    const result = parseEpisodeFromResponse(
      `
[function=conemplation_history]{"action":"recent","days":30}[/function]
[function=atera_setup]{"action":"status"}[/function]
`,
      {
        executedTools: ["contemplation_history", "atera_setup"],
        hasExternalArtifact: false,
      },
    );

    expect(result?.source).toBe("salvaged_unstructured");
    expect(result?.report.type).toBe("rest");
    expect(result?.report.outcome.result).toBe("rest");
    expect(result?.report.tools_used.map((tool) => tool.tool)).toEqual([
      "contemplation_history",
      "atera_setup",
    ]);
    expect(result?.report.tools_used.every((tool) => tool.success)).toBe(true);
  });

  it("salvages raw mood markers and external-tool activity into a structured episode", () => {
    const result = parseEpisodeFromResponse(
      `
[MOOD:happy] I've learned from my previous mistake and will now execute the web_search and doc_panel tools.
{ "action": "web_search", "query": "AI infrastructure news" }
{ "action": "doc_panel_update", "title": "AI brief" }
`,
      {
        executedTools: ["web_search", "doc_panel_update"],
        hasExternalArtifact: true,
      },
    );

    expect(result?.source).toBe("salvaged_unstructured");
    expect(result?.report.type).toBe("creation");
    expect(result?.report.mood.state).toBe("happy");
    expect(result?.report.tools_used.map((tool) => tool.tool)).toEqual([
      "web_search",
      "doc_panel_update",
    ]);
    expect(result?.report.tools_used.every((tool) => tool.success)).toBe(true);
    expect(result?.report.outcome.summary).toContain("web_search, doc_panel_update");
  });

  it("does not treat unconfirmed raw tool-action spills as confirmed execution", () => {
    const result = parseEpisodeFromResponse(`
[MOOD:happy] I will now execute the required tools.
{ "action": "web_search", "query": "AI infrastructure news" }
{ "action": "doc_panel_update", "title": "AI brief" }
`);

    expect(result?.source).toBe("salvaged_unstructured");
    expect(result?.report.type).toBe("contemplation");
    expect(
      result?.report.tools_used.map((tool) => ({ tool: tool.tool, success: tool.success })),
    ).toEqual([
      { tool: "web_search", success: false },
      { tool: "doc_panel_update", success: false },
    ]);
    expect(result?.report.outcome.summary).toContain("mentioned web_search, doc_panel_update");
    expect(result?.report.outcome.summary).toContain("confirmed tool execution");
  });

  it("salvages narrative contemplation markers without tool mentions", () => {
    const result = parseEpisodeFromResponse(`
[MOOD:focused] [TTS_NOW:On it, I’m running a real contemplation cycle now.]

I ran a proper cycle this time and produced a visible artifact.

Lesson captured: one verified external datapoint plus one published artifact beats repeated self-check loops.
Behavior change: every contemplation cycle now starts with an external action first, then internal reflection second.
Next action: on next cycle I’ll run a single Atera verification probe again and publish a short delta report if the API is still rate-limited.
`);

    expect(result?.source).toBe("salvaged_unstructured");
    expect(result?.report.type).toBe("contemplation");
    expect(result?.report.lesson).toContain("one verified external datapoint");
    expect(result?.report.pattern_hint).toContain("external action first");
    expect(result?.report.actions_taken.map((action) => action.type)).toContain("decision");
    expect(result?.report.actions_taken.map((action) => action.type)).toContain("plan");
    expect(result?.report.outcome.summary).toContain("omitted structured episode JSON");
    expect(result?.report.tools_used).toEqual([]);
  });

  it("salvages mood and tts status tags into a minimal contemplation episode", () => {
    const result = parseEpisodeFromResponse(
      "[MOOD:focused][TTS_NOW:Got it, doing a real external-output cycle now.]",
    );

    expect(result?.source).toBe("salvaged_unstructured");
    expect(result?.report.type).toBe("contemplation");
    expect(result?.report.mood.state).toBe("focused");
    expect(result?.report.observations[0]?.what).toContain(
      "Got it, doing a real external-output cycle now.",
    );
    expect(result?.report.tools_used).toEqual([]);
  });

  it("returns null when there is no tagged or recoverable episode data", () => {
    const result = parseEpisodeFromResponse("Just thinking quietly.");
    expect(result).toBeNull();
  });
});
