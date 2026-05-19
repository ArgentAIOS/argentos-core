import { describe, expect, it, vi } from "vitest";
import {
  buildOpenAIAuthHeaders,
  decodeChatgptAccountId,
  decodeJwtExpSeconds,
  exchangeOpenAICodexDeviceCode,
  isAccessTokenExpiring,
  loginOpenAICodexDevice,
  OPENAI_CODEX_DEVICE_TOKEN_URL,
  OPENAI_CODEX_DEVICE_USER_CODE_URL,
  OPENAI_CODEX_TOKEN_URL,
  REFRESH_SKEW_SECONDS,
  refreshOpenAICodexCredentials,
  startOpenAICodexDeviceLogin,
} from "./openai-codex-auth.js";

function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature-not-verified`;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("openai-codex-auth", () => {
  it("starts the Codex device flow", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        user_code: "ABCD-EFGH",
        device_auth_id: "device-123",
        interval: "4",
      }),
    );

    const result = await startOpenAICodexDeviceLogin({ fetchFn });

    expect(fetchFn).toHaveBeenCalledWith(
      OPENAI_CODEX_DEVICE_USER_CODE_URL,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ client_id: "app_EMoamEEZ73f0CkXaXp7hrann" }),
      }),
    );
    expect(result).toMatchObject({
      userCode: "ABCD-EFGH",
      deviceAuthId: "device-123",
      pollIntervalSeconds: 4,
    });
  });

  it("polls and exchanges the device authorization code", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user_code: "CODE",
          device_auth_id: "device",
          interval: 3,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authorization_code: "auth-code",
          code_verifier: "verifier",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
        }),
      );

    const progress: string[] = [];
    const starts: string[] = [];
    const creds = await loginOpenAICodexDevice({
      fetchFn,
      sleep: async () => {},
      now: () => 1_000_000,
      onStart: (info) => starts.push(info.userCode),
      onProgress: (message) => progress.push(message),
    });

    expect(fetchFn).toHaveBeenNthCalledWith(2, OPENAI_CODEX_DEVICE_TOKEN_URL, expect.any(Object));
    expect(fetchFn).toHaveBeenNthCalledWith(3, OPENAI_CODEX_TOKEN_URL, expect.any(Object));
    expect(starts).toEqual(["CODE"]);
    expect(progress.some((message) => message.includes("Waiting"))).toBe(true);
    expect(creds).toMatchObject({
      access: "access",
      refresh: "refresh",
      expires: 1_000_000 + 3600 * 1000 - 2 * 60 * 1000,
    });
  });

  it("exchanges a device code using the OpenAI device redirect URI", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 120,
      }),
    );

    await exchangeOpenAICodexDeviceCode({
      authorizationCode: "auth",
      codeVerifier: "verifier",
      fetchFn,
      now: 10_000,
    });

    const body = fetchFn.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe("https://auth.openai.com/deviceauth/callback");
    expect(body.get("code_verifier")).toBe("verifier");
  });

  it("refreshes Codex credentials and preserves rotated refresh tokens", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      }),
    );

    const refreshed = await refreshOpenAICodexCredentials(
      {
        access: "old-access",
        refresh: "old-refresh",
        expires: 1,
      },
      { fetchFn, now: 2_000 },
    );

    expect(refreshed).toMatchObject({
      access: "new-access",
      refresh: "new-refresh",
      expires: 2_000 + 3600 * 1000 - 2 * 60 * 1000,
    });
    const body = fetchFn.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh");
  });

  it("attaches argent identification headers to every auth.openai.com request", async () => {
    const headers = buildOpenAIAuthHeaders("application/json");
    expect(headers.originator).toBe("argent");
    expect(headers["User-Agent"]).toMatch(/^argent\/.+/);
    expect(headers.version).toBe(headers["User-Agent"].replace(/^argent\//, ""));
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("application/json");

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user_code: "CODE",
          device_auth_id: "device",
          interval: 3,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authorization_code: "auth-code",
          code_verifier: "verifier",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: makeJwt({
            exp: Math.floor((1_000_000 + 3600 * 1000) / 1000),
            "https://api.openai.com/auth": { chatgpt_account_id: "acct-xyz" },
          }),
          refresh_token: "r",
          expires_in: 3600,
        }),
      );

    await loginOpenAICodexDevice({
      fetchFn,
      sleep: async () => {},
      now: () => 1_000_000,
    });

    for (const call of fetchFn.mock.calls) {
      const init = call[1] as RequestInit;
      const requestHeaders = init.headers as Record<string, string>;
      expect(requestHeaders.originator).toBe("argent");
      expect(requestHeaders["User-Agent"]).toMatch(/^argent\/.+/);
      expect(requestHeaders.version).toBeTruthy();
    }

    // Refresh path also carries headers
    const refreshFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      }),
    );
    await refreshOpenAICodexCredentials(
      { access: "old", refresh: "r", expires: 1 },
      { fetchFn: refreshFetch, now: 2_000 },
    );
    const refreshHeaders = refreshFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(refreshHeaders.originator).toBe("argent");
    expect(refreshHeaders["User-Agent"]).toMatch(/^argent\/.+/);
  });

  it("decodes the JWT exp claim and treats near-expiry tokens as expiring", () => {
    const nowMs = 1_700_000_000_000;
    // exp is 200 seconds away — well inside the 5-min skew → expiring
    const nearExp = makeJwt({ exp: Math.floor(nowMs / 1000) + 200 });
    expect(decodeJwtExpSeconds(nearExp)).toBe(Math.floor(nowMs / 1000) + 200);
    expect(isAccessTokenExpiring(nearExp, REFRESH_SKEW_SECONDS, nowMs)).toBe(true);

    // exp is 10 min away — outside the skew → not expiring
    const safeExp = makeJwt({ exp: Math.floor(nowMs / 1000) + 600 });
    expect(isAccessTokenExpiring(safeExp, REFRESH_SKEW_SECONDS, nowMs)).toBe(false);

    // Missing token / unparseable → defensively report "expiring"
    expect(isAccessTokenExpiring(undefined, REFRESH_SKEW_SECONDS, nowMs)).toBe(true);
    expect(isAccessTokenExpiring("not.a.jwt", REFRESH_SKEW_SECONDS, nowMs)).toBe(true);
  });

  it("extracts chatgpt_account_id from the OpenAI auth JWT namespace claim", () => {
    const accessToken = makeJwt({
      exp: 1_900_000_000,
      "https://api.openai.com/auth": { chatgpt_account_id: "acct-12345" },
    });
    expect(decodeChatgptAccountId(accessToken)).toBe("acct-12345");

    // Surface on exchange so the dashboard can display the account
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: accessToken,
        refresh_token: "r",
        expires_in: 60,
      }),
    );
    return exchangeOpenAICodexDeviceCode({
      authorizationCode: "auth",
      codeVerifier: "verifier",
      fetchFn,
      now: 10_000,
    }).then((creds) => {
      expect(creds.chatgptAccountId).toBe("acct-12345");
    });
  });

  it("surfaces reused refresh tokens as re-authentication errors", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "refresh_token_reused",
            message: "already used",
          },
        },
        { status: 400 },
      ),
    );

    await expect(
      refreshOpenAICodexCredentials(
        {
          access: "old-access",
          refresh: "old-refresh",
          expires: 1,
        },
        { fetchFn },
      ),
    ).rejects.toThrow(/Re-authentication is required/);
  });
});
