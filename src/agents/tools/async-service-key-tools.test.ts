import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveServiceKeyAsyncMock = vi.fn<(name: string) => Promise<string | undefined>>();

vi.mock("../../infra/service-keys.js", () => ({
  resolveServiceKeyAsync: resolveServiceKeyAsyncMock,
}));

describe("async service key tool resolution", () => {
  beforeEach(() => {
    resolveServiceKeyAsyncMock.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    vi.unstubAllEnvs();
    delete process.env.RESEND_API_KEY;
    delete process.env.VERCEL_API_TOKEN;
    delete process.env.RAILWAY_API_TOKEN;
    delete process.env.RAILWAY_API_KEY;
    delete process.env.EASYDMARC_API_KEY;
    delete process.env.NAMECHEAP_API_USER;
    delete process.env.NAMECHEAP_USERNAME;
    delete process.env.NAMECHEAP_API_KEY;
    delete process.env.NAMECHEAP_CLIENT_IP;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.COOLIFY_API_KEY;
    delete process.env.COOLIFY_API_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("email_delivery uses the shared async resolver for provider tests", async () => {
    resolveServiceKeyAsyncMock.mockImplementation(async (name: string) =>
      name === "RESEND_API_KEY" ? "resend-secret" : undefined,
    );
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    const { createEmailDeliveryTool } = await import("./email-delivery-tool.js");
    const tool = createEmailDeliveryTool();
    const result = await tool.execute("tool-call", {
      action: "test_provider",
      provider: "resend",
    });

    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "RESEND_API_KEY",
      undefined,
      expect.objectContaining({ source: "email_delivery" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/domains",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer resend-secret" }),
      }),
    );
    expect(result.details).toMatchObject({ action: "test_provider", provider: "resend", ok: true });
  });

  it("vercel_deploy uses the shared async resolver for token and team id", async () => {
    resolveServiceKeyAsyncMock.mockImplementation(async (name: string) => {
      if (name === "VERCEL_API_TOKEN") return "vercel-secret";
      if (name === "VERCEL_TEAM_ID") return "team_123";
      return undefined;
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "usr_1", username: "sem" } }), { status: 200 }),
    );

    const { createVercelDeployTool } = await import("./vercel-deploy-tool.js");
    const tool = createVercelDeployTool();
    const result = await tool.execute("tool-call", {
      action: "test_connection",
    });

    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "VERCEL_API_TOKEN",
      undefined,
      expect.objectContaining({ source: "vercel_deploy" }),
    );
    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "VERCEL_TEAM_ID",
      undefined,
      expect.objectContaining({ source: "vercel_deploy" }),
    );
    const [vercelUrl, vercelInit] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(vercelUrl)).toContain("/v2/user?teamId=team_123");
    expect(vercelInit).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer vercel-secret" }),
    });
    expect(result.details).toMatchObject({
      action: "test_connection",
      ok: true,
      user: { id: "usr_1", username: "sem" },
    });
  });

  it("railway_deploy uses the shared async resolver for Railway tokens", async () => {
    resolveServiceKeyAsyncMock.mockImplementation(async (name: string) =>
      name === "RAILWAY_API_TOKEN" ? "railway-secret" : undefined,
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: { me: { id: "acct_1", email: "sem@example.com" } } }), {
        status: 200,
      }),
    );

    const { createRailwayDeployTool } = await import("./railway-deploy-tool.js");
    const tool = createRailwayDeployTool();
    const result = await tool.execute("tool-call", {
      action: "test_connection",
    });

    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "RAILWAY_API_TOKEN",
      undefined,
      expect.objectContaining({ source: "railway_deploy" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://backboard.railway.app/graphql/v2",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer railway-secret" }),
      }),
    );
    expect(result.details).toMatchObject({
      action: "test_connection",
      ok: true,
      account: { id: "acct_1", email: "sem@example.com" },
    });
  });

  it("namecheap_dns uses the shared async resolver for multi-part credentials", async () => {
    resolveServiceKeyAsyncMock.mockImplementation(async (name: string) => {
      switch (name) {
        case "NAMECHEAP_API_USER":
          return "api-user";
        case "NAMECHEAP_USERNAME":
          return "username";
        case "NAMECHEAP_API_KEY":
          return "namecheap-secret";
        case "NAMECHEAP_CLIENT_IP":
          return "1.2.3.4";
        default:
          return undefined;
      }
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response('<ApiResponse Status="OK"></ApiResponse>', { status: 200 }),
    );

    const { createNamecheapDnsTool } = await import("./namecheap-dns-tool.js");
    const tool = createNamecheapDnsTool();
    const result = await tool.execute("tool-call", {
      action: "test_connection",
    });

    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "NAMECHEAP_API_USER",
      undefined,
      expect.objectContaining({ source: "namecheap_dns" }),
    );
    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "NAMECHEAP_API_KEY",
      undefined,
      expect.objectContaining({ source: "namecheap_dns" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("ApiKey=namecheap-secret"),
      expect.any(Object),
    );
    expect(result.details).toMatchObject({ action: "test_connection", ok: true, status: "OK" });
  });

  it("coolify_deploy uses the shared async resolver for connection context", async () => {
    resolveServiceKeyAsyncMock.mockImplementation(async (name: string) => {
      if (name === "COOLIFY_API_KEY") return "coolify-secret";
      if (name === "COOLIFY_API_URL") return "https://coolify.example/api/v1";
      return undefined;
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 }),
    );

    const { createCoolifyDeployTool } = await import("./coolify-deploy-tool.js");
    const tool = createCoolifyDeployTool();
    const result = await tool.execute("tool-call", {
      action: "test_connection",
    });

    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "COOLIFY_API_KEY",
      undefined,
      expect.objectContaining({ source: "coolify_deploy" }),
    );
    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "COOLIFY_API_URL",
      undefined,
      expect.objectContaining({ source: "coolify_deploy" }),
    );
    const [coolifyUrl, coolifyInit] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(coolifyUrl)).toBe("https://coolify.example/api/v1/version");
    expect(coolifyInit).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer coolify-secret" }),
    });
    expect(result.details).toMatchObject({
      action: "test_connection",
      ok: true,
      api_url: "https://coolify.example/api/v1",
    });
  });

  it("heygen_video uses the shared async resolver for API key and default avatar", async () => {
    resolveServiceKeyAsyncMock.mockImplementation(async (name: string) => {
      if (name === "HEYGEN_API_KEY") return "heygen-secret";
      if (name === "HEYGEN_DEFAULT_AVATAR_ID") return "avatar-default";
      return undefined;
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            talking_photos: [{ talking_photo_id: "avatar_1", talking_photo_name: "Argent" }],
          },
        }),
        { status: 200 },
      ),
    );

    const { createHeygenVideoTool } = await import("./heygen-video-tool.js");
    const tool = createHeygenVideoTool();
    const result = await tool.execute("tool-call", {
      action: "list_avatars",
    });

    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "HEYGEN_API_KEY",
      undefined,
      expect.objectContaining({ source: "heygen_video" }),
    );
    expect(result.content?.[0]?.text).toContain('"action": "list_avatars"');
  });

  it("podcast_generate uses the shared async resolver for ElevenLabs keys", async () => {
    resolveServiceKeyAsyncMock.mockResolvedValue(undefined);

    const { createPodcastGenerateTool } = await import("./podcast-generate-tool.js");
    const tool = createPodcastGenerateTool();
    const result = await tool.execute("tool-call", {
      title: "Resolver check",
      dialogue: [{ text: "Hello world", voice_id: "voice-a" }],
    });

    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "ELEVENLABS_API_KEY",
      undefined,
      expect.objectContaining({ source: "podcast_generate" }),
    );
    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "XI_API_KEY",
      undefined,
      expect.objectContaining({ source: "podcast_generate" }),
    );
    expect(result.content?.[0]?.text).toContain("No ElevenLabs API key found");
  });

  it("audio_generate uses the shared async resolver for provider selection", async () => {
    resolveServiceKeyAsyncMock.mockImplementation(async (name: string) =>
      name === "ELEVENLABS_API_KEY" ? "eleven-secret" : undefined,
    );
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const { createAudioGenerationTool } = await import("./audio-generation-tool.js");
    const tool = createAudioGenerationTool();
    const result = await tool.execute("tool-call", {
      prompt: "rain on a tin roof",
      provider: "elevenlabs",
    });

    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "ELEVENLABS_API_KEY",
      undefined,
      expect.objectContaining({ source: "audio_generate" }),
    );
    expect(result.details).toMatchObject({ provider: "elevenlabs" });
    expect(result.content?.[0]?.text).toContain("MEDIA:");
  });

  it("tts_generate uses the shared async resolver for ElevenLabs keys", async () => {
    resolveServiceKeyAsyncMock.mockImplementation(async (name: string) =>
      name === "ELEVENLABS_API_KEY" ? "tts-secret" : undefined,
    );
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([4, 5, 6]), { status: 200 }));

    const { createTtsGenerateTool } = await import("./tts-generate-tool.js");
    const tool = createTtsGenerateTool();
    const result = await tool.execute("tool-call", {
      text: "Nightly update",
    });

    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "ELEVENLABS_API_KEY",
      undefined,
      expect.objectContaining({ source: "tts_generate" }),
    );
    expect(result.details).toMatchObject({ sizeBytes: 3 });
    expect(result.content?.[0]?.text).toContain("MEDIA:");
  });

  it("audio_alert uses the shared async resolver for ElevenLabs keys", async () => {
    resolveServiceKeyAsyncMock.mockImplementation(async (name: string) =>
      name === "ELEVENLABS_API_KEY" ? "alert-secret" : undefined,
    );
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([7, 8, 9]), { status: 200 }));

    const { createAudioAlertTool } = await import("./audio-alert-tool.js");
    const tool = createAudioAlertTool();
    const result = await tool.execute("tool-call", {
      message: "Build completed",
      urgency: "info",
      title: "Nightly Build",
    });

    expect(resolveServiceKeyAsyncMock).toHaveBeenCalledWith(
      "ELEVENLABS_API_KEY",
      undefined,
      expect.objectContaining({ source: "audio_alert" }),
    );
    expect(result.details).toMatchObject({ urgency: "info", title: "Nightly Build", sizeBytes: 3 });
    expect(result.content?.[0]?.text).toContain("[ALERT:Nightly Build]");
    expect(result.content?.[0]?.text).toContain("MEDIA:");
  });
});
