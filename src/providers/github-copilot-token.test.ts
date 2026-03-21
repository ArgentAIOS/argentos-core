import fsSync from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveStateDir = vi.fn().mockReturnValue("/tmp/argent-state");

vi.mock("../config/paths.js", () => ({
  resolveStateDir,
}));

describe("github-copilot token", () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;
  let readFileSyncSpy: ReturnType<typeof vi.spyOn>;
  let writeFileSyncSpy: ReturnType<typeof vi.spyOn>;
  let mkdirSyncSpy: ReturnType<typeof vi.spyOn>;
  let chmodSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    resolveStateDir.mockReset();
    resolveStateDir.mockReturnValue("/tmp/argent-state");

    existsSyncSpy = vi.spyOn(fsSync, "existsSync").mockReturnValue(false);
    readFileSyncSpy = vi.spyOn(fsSync, "readFileSync").mockReturnValue("{}");
    writeFileSyncSpy = vi.spyOn(fsSync, "writeFileSync").mockImplementation(() => {});
    mkdirSyncSpy = vi.spyOn(fsSync, "mkdirSync").mockImplementation(() => "" as never);
    chmodSyncSpy = vi.spyOn(fsSync, "chmodSync").mockImplementation(() => {});
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
    writeFileSyncSpy.mockRestore();
    mkdirSyncSpy.mockRestore();
    chmodSyncSpy.mockRestore();
  });

  it("derives baseUrl from token", async () => {
    const { deriveCopilotApiBaseUrlFromToken } = await import("./github-copilot-token.js");

    expect(deriveCopilotApiBaseUrlFromToken("token;proxy-ep=proxy.example.com;")).toBe(
      "https://api.example.com",
    );
    expect(deriveCopilotApiBaseUrlFromToken("token;proxy-ep=https://proxy.foo.bar;")).toBe(
      "https://api.foo.bar",
    );
  });

  it("uses cache when token is still valid", async () => {
    const now = Date.now();
    const cachedData = {
      token: "cached;proxy-ep=proxy.example.com;",
      expiresAt: now + 60 * 60 * 1000,
      updatedAt: now,
    };
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify(cachedData));

    const { resolveCopilotApiToken } = await import("./github-copilot-token.js");

    const fetchImpl = vi.fn();
    const res = await resolveCopilotApiToken({
      githubToken: "gh",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.token).toBe("cached;proxy-ep=proxy.example.com;");
    expect(res.baseUrl).toBe("https://api.example.com");
    expect(String(res.source)).toContain("cache:");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches and stores token when cache is missing", async () => {
    existsSyncSpy.mockReturnValue(false);

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        token: "fresh;proxy-ep=https://proxy.contoso.test;",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    });

    const { resolveCopilotApiToken } = await import("./github-copilot-token.js");

    const res = await resolveCopilotApiToken({
      githubToken: "gh",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.token).toBe("fresh;proxy-ep=https://proxy.contoso.test;");
    expect(res.baseUrl).toBe("https://api.contoso.test");
    expect(writeFileSyncSpy).toHaveBeenCalledTimes(1);
  });
});
