import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHeygenVideoTool } from "./heygen-video-tool.js";

function extractJson(result: { content?: Array<{ type?: string; text?: string }> }): any {
  const text = result.content?.find((entry) => entry.type === "text")?.text;
  if (!text) {
    throw new Error("missing text content");
  }
  return JSON.parse(text);
}

describe("heygen_video", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.HEYGEN_API_KEY;
  const originalDefaultAvatar = process.env.HEYGEN_DEFAULT_AVATAR_ID;

  beforeEach(() => {
    process.env.HEYGEN_API_KEY = "test-heygen-key";
    process.env.HEYGEN_DEFAULT_AVATAR_ID = "avatar-default";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.HEYGEN_API_KEY;
    else process.env.HEYGEN_API_KEY = originalKey;
    if (originalDefaultAvatar === undefined) delete process.env.HEYGEN_DEFAULT_AVATAR_ID;
    else process.env.HEYGEN_DEFAULT_AVATAR_ID = originalDefaultAvatar;
    vi.restoreAllMocks();
  });

  it("submits generation payload with simplified params", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ data: { video_id: "vid_123" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const tool = createHeygenVideoTool();
    const result = await tool.execute("call-1", {
      action: "generate_video",
      avatar_id: "avatar_abc",
      script: "Hello from Argent",
      voice_id: "voice_xyz",
      aspect_ratio: "16:9",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.heygen.com/v2/video/generate");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-heygen-key");

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const input = ((body.video_inputs as unknown[])?.[0] || {}) as Record<string, unknown>;
    const character = (input.character || {}) as Record<string, unknown>;
    const voice = (input.voice || {}) as Record<string, unknown>;

    expect(character.avatar_id).toBe("avatar_abc");
    expect(voice.input_text).toBe("Hello from Argent");
    expect(voice.voice_id).toBe("voice_xyz");
    expect((body.dimension as Record<string, unknown>).width).toBe(1280);
    expect((body.dimension as Record<string, unknown>).height).toBe(720);

    const json = extractJson(result as any);
    expect(json.video_id).toBe("vid_123");
  });

  it("builds multi-scene payload using default avatar id for cut/B-roll style flow", async () => {
    const tool = createHeygenVideoTool();
    const result = await tool.execute("call-scenes", {
      action: "build_payload",
      scenes: [
        {
          script: "Intro scene with avatar",
          voice_id: "voice_intro",
          background_type: "color",
          background_value: "#101820",
        },
        {
          script: "Cut to B-roll style segment",
          voice_id: "voice_intro",
          background_type: "video",
          background_value: "https://cdn.example.com/broll.mp4",
          background_play_style: "fit_to_scene",
          character_scale: 0.75,
          character_offset_x: -0.55,
          character_offset_y: -0.1,
          character_matting: true,
        },
      ],
      aspect_ratio: "16:9",
    });

    const json = extractJson(result as any);
    const payload = json.payload as Record<string, unknown>;
    const videoInputs = payload.video_inputs as Array<Record<string, unknown>>;
    expect(Array.isArray(videoInputs)).toBe(true);
    expect(videoInputs).toHaveLength(2);

    const firstCharacter = (videoInputs[0]?.character || {}) as Record<string, unknown>;
    expect(firstCharacter.avatar_id).toBe("avatar-default");

    const secondInput = videoInputs[1] as Record<string, unknown>;
    const secondCharacter = (secondInput.character || {}) as Record<string, unknown>;
    const secondBackground = (secondInput.background || {}) as Record<string, unknown>;
    expect(secondCharacter.avatar_id).toBe("avatar-default");
    expect(secondCharacter.scale).toBe(0.75);
    expect((secondCharacter.offset as Record<string, unknown>).x).toBe(-0.55);
    expect((secondCharacter.offset as Record<string, unknown>).y).toBe(-0.1);
    expect(secondCharacter.matting).toBe(true);
    expect(secondBackground.type).toBe("video");
    expect(secondBackground.value).toBe("https://cdn.example.com/broll.mp4");
    expect(secondBackground.play_style).toBe("fit_to_scene");
  });

  it("fetches status for a video id", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ data: { status: "processing" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const tool = createHeygenVideoTool();
    const result = await tool.execute("call-2", {
      action: "video_status",
      video_id: "vid_456",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.heygen.com/v1/video_status.get?video_id=vid_456");

    const json = extractJson(result as any);
    expect((json.data as Record<string, unknown>).status).toBe("processing");
  });

  it("returns a compact avatar list by default to avoid oversized transcripts", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            talking_photos: [
              {
                talking_photo_id: "avatar_1",
                talking_photo_name: "Argent",
                preview_image_url: `https://cdn.example.com/${"a".repeat(400)}`,
              },
              {
                talking_photo_id: "avatar_2",
                talking_photo_name: "Juniper",
                preview_image_url: "https://cdn.example.com/juniper.png",
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const tool = createHeygenVideoTool();
    const result = await tool.execute("call-list-avatars", {
      action: "list_avatars",
      max_items: 1,
    });

    const json = extractJson(result as any);
    expect(json.action).toBe("list_avatars");
    expect(json.total).toBe(2);
    expect(json.returned).toBe(1);
    expect(json.truncated).toBe(true);
    expect(json.avatars[0].avatar_id).toBe("avatar_1");
    expect(json.avatars[0].name).toBe("Argent");
    expect(typeof json.avatars[0].preview_image_url).toBe("string");
    expect((json.avatars[0].preview_image_url as string).length).toBeLessThanOrEqual(181);
  });

  it("can include full raw payload for list actions when explicitly requested", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            voices: [{ voice_id: "voice_1", name: "Argent Voice", language: "en" }],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const tool = createHeygenVideoTool();
    const result = await tool.execute("call-list-voices", {
      action: "list_voices",
      include_raw: true,
    });

    const json = extractJson(result as any);
    expect(json.action).toBe("list_voices");
    expect(json.voices).toHaveLength(1);
    expect(json.raw).toBeTruthy();
    expect((json.raw.data.voices as Array<Record<string, unknown>>)[0].voice_id).toBe("voice_1");
  });
});
