import { describe, expect, it } from "vitest";
import { mistralProvider } from "./index.js";

describe("mistralProvider", () => {
  it("uses Mistral base URL by default", async () => {
    let seenUrl: string | null = null;
    const fetchFn = async (input: RequestInfo | URL) => {
      seenUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ text: "bonjour" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await mistralProvider.transcribeAudio!({
      buffer: Buffer.from("audio-bytes"),
      fileName: "voice.ogg",
      apiKey: "mistral-test-key",
      timeoutMs: 1000,
      fetchFn,
    });

    expect(seenUrl).toBe("https://api.mistral.ai/v1/audio/transcriptions");
    expect(result.text).toBe("bonjour");
  });

  it("allows overriding baseUrl", async () => {
    let seenUrl: string | null = null;
    const fetchFn = async (input: RequestInfo | URL) => {
      seenUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ text: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await mistralProvider.transcribeAudio!({
      buffer: Buffer.from("audio"),
      fileName: "note.mp3",
      apiKey: "mistral-test-key",
      timeoutMs: 1000,
      baseUrl: "http://127.0.0.1:8089/v1",
      fetchFn,
    });

    expect(seenUrl).toBe("http://127.0.0.1:8089/v1/audio/transcriptions");
  });
});
