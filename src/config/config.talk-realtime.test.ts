import { describe, expect, it, vi } from "vitest";

describe("talk.realtime config", () => {
  it("accepts browser realtime Talk defaults and provider config", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const res = validateConfigObject({
      talk: {
        realtime: {
          enabled: true,
          provider: "openai",
          transport: "webrtc-sdp",
          model: "gpt-realtime-1.5",
          voice: "marin",
          instructions: "Be concise.",
          providers: {
            openai: {
              apiKey: "server-only",
            },
          },
        },
      },
    });
    expect(res.ok).toBe(true);
  });

  it("rejects unsupported realtime transports", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const res = validateConfigObject({
      talk: {
        realtime: {
          transport: "phone-call",
        },
      },
    });
    expect(res.ok).toBe(false);
  });
});
