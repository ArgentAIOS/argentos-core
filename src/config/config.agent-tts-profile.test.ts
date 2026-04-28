import { describe, expect, it, vi } from "vitest";

describe("agent TTS profile config", () => {
  it("accepts per-agent TTS overrides with generic provider bindings and personas", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const res = validateConfigObject({
      messages: {
        tts: {
          provider: "elevenlabs",
          providers: {
            elevenlabs: { apiKey: "shared", voiceId: "shared-voice" },
          },
          personas: {
            narrator: {
              label: "Narrator",
              provider: "elevenlabs",
              providers: {
                elevenlabs: { voiceId: "persona-voice" },
              },
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "sam",
            tts: {
              provider: "fish",
              providers: {
                fish: { voiceId: "sam-fish", outputFormat: "mp3" },
              },
            },
          },
        ],
      },
    });

    expect(res.ok).toBe(true);
  });
});
