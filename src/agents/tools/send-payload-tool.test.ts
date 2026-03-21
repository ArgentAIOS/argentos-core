import { describe, expect, it } from "vitest";
import { __testing } from "./send-payload-tool.js";

describe("send_payload helpers", () => {
  it("recognizes internal main-session routes", () => {
    expect(__testing.isMainSessionRoute("main-session")).toBe(true);
    expect(__testing.isMainSessionRoute("webchat")).toBe(true);
    expect(__testing.isMainSessionRoute("discord")).toBe(false);
  });

  it("recognizes audio routes", () => {
    expect(__testing.isAudioRoute("audio")).toBe(true);
    expect(__testing.isAudioRoute("audio-alert")).toBe(true);
    expect(__testing.isAudioRoute("slack")).toBe(false);
  });

  it("composes payload text with MEDIA directives", () => {
    const text = __testing.composePayloadText("Hello", ["https://x.test/a.png", "/tmp/a.mp3"]);
    expect(text).toContain("Hello");
    expect(text).toContain("MEDIA:https://x.test/a.png");
    expect(text).toContain("MEDIA:/tmp/a.mp3");
  });

  it("splits large payload into bounded chunks", () => {
    const source = "A".repeat(35);
    const chunks = __testing.splitIntoChunks(source, 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
  });
});
