import type { OAuthCredentials } from "../agent-core/ai.js";
import { formatCliCommand } from "../cli/command-format.js";
import { VERSION } from "../version.js";

export const OPENAI_CODEX_ISSUER = "https://auth.openai.com";
export const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_CODEX_TOKEN_URL = `${OPENAI_CODEX_ISSUER}/oauth/token`;
export const OPENAI_CODEX_DEVICE_URL = `${OPENAI_CODEX_ISSUER}/codex/device`;
export const OPENAI_CODEX_DEVICE_USER_CODE_URL = `${OPENAI_CODEX_ISSUER}/api/accounts/deviceauth/usercode`;
export const OPENAI_CODEX_DEVICE_TOKEN_URL = `${OPENAI_CODEX_ISSUER}/api/accounts/deviceauth/token`;
export const OPENAI_CODEX_DEVICE_REDIRECT_URI = `${OPENAI_CODEX_ISSUER}/deviceauth/callback`;
export const OPENAI_CODEX_DEFAULT_BASE_URL = "https://chatgpt.com/backend-api/codex";

/**
 * Skew window (seconds) used by `isAccessTokenExpiring` and the eager refresh
 * policy. Within this many seconds of `exp` we treat the token as "expiring
 * soon" and kick a background refresh while still returning the still-valid
 * token to the current call site. Mirrors subctl's REFRESH_SKEW_SECONDS
 * (components/master/codex-oauth.ts L52).
 */
export const REFRESH_SKEW_SECONDS = 300;

const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const MIN_POLL_INTERVAL_SECONDS = 3;
const DEFAULT_EXPIRES_IN_SECONDS = 60 * 60;
const DEFAULT_EXPIRES_BUFFER_MS = 2 * 60 * 1000;

type FetchLike = typeof fetch;

/**
 * Identification headers attached to every outbound request against
 * `auth.openai.com`. OpenAI uses these to scope client behavior (rate-limits,
 * ChatGPT-Pro entitlement routing, experimental gating). Without them Argent
 * looks anonymous to OpenAI's auth backend and risks being silently
 * deprioritized during enforcement sweeps. This is the "inside-info" header
 * pattern subctl picked up from working with Peter — see
 * `/Users/sem/code/subctl/components/master/codex-oauth.ts` L73-L81.
 *
 * Note: we identify ourselves honestly as `argent`. Do NOT impersonate
 * `codex` or `openclaw` — that is plausibly an AUP violation.
 */
export function buildOpenAIAuthHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    Accept: "application/json",
    originator: "argent",
    "User-Agent": `argent/${VERSION}`,
    version: VERSION,
  };
}

/**
 * Decode the `exp` claim from a JWT access token. Returns `undefined` if the
 * token is malformed or the claim is missing/non-numeric.
 */
export function decodeJwtExpSeconds(token: string): number | undefined {
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (payloadB64.length % 4)) % 4;
    const padded = payloadB64 + "=".repeat(padLen);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json) as { exp?: unknown };
    const exp = typeof parsed.exp === "number" ? parsed.exp : Number(parsed.exp);
    return Number.isFinite(exp) ? exp : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decode the `chatgpt_account_id` from an OpenAI access token JWT. The claim
 * lives under the (URL-shaped) namespace key `https://api.openai.com/auth`.
 * Mirrors subctl's `decodeChatgptAccountId` (codex-oauth.ts L522-L536).
 */
export function decodeChatgptAccountId(token: string): string | undefined {
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (payloadB64.length % 4)) % 4;
    const padded = payloadB64 + "=".repeat(padLen);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const claim = parsed["https://api.openai.com/auth"];
    if (claim && typeof claim === "object") {
      const accountId = (claim as Record<string, unknown>).chatgpt_account_id;
      if (typeof accountId === "string" && accountId.trim()) {
        return accountId.trim();
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns true when the access token's `exp` claim is within `skewSeconds` of
 * now (i.e. the token is expiring soon, or already expired). Returns true
 * defensively when the token cannot be decoded — callers should treat
 * "unknown expiry" as "refresh would be a good idea".
 *
 * Subctl uses a 5-minute skew (REFRESH_SKEW_SECONDS=300) which masks ±2.5 min
 * of operator-machine clock skew. Don't tune below 60s without revisiting that
 * tradeoff.
 */
export function isAccessTokenExpiring(
  accessToken: string | undefined,
  skewSeconds: number = REFRESH_SKEW_SECONDS,
  nowMs: number = Date.now(),
): boolean {
  if (!accessToken) return true;
  const expSeconds = decodeJwtExpSeconds(accessToken);
  if (expSeconds == null) return true;
  const expMs = expSeconds * 1000;
  return expMs - nowMs <= skewSeconds * 1000;
}

export type OpenAICodexDeviceStart = {
  userCode: string;
  deviceAuthId: string;
  verificationUri: string;
  pollIntervalSeconds: number;
};

export type OpenAICodexDevicePoll = {
  authorizationCode: string;
  codeVerifier: string;
};

export type OpenAICodexDeviceLoginOptions = {
  fetchFn?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  onStart?: (info: OpenAICodexDeviceStart) => void | Promise<void>;
  onProgress?: (message: string) => void;
};

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

function expiresFromNow(expiresInSeconds: number | undefined, now: number): number {
  const seconds =
    typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds)
      ? expiresInSeconds
      : DEFAULT_EXPIRES_IN_SECONDS;
  const value = now + Math.max(0, Math.floor(seconds)) * 1000 - DEFAULT_EXPIRES_BUFFER_MS;
  return Math.max(value, now + 30_000);
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text || response.statusText || `HTTP ${response.status}`;
}

function parseCodexRefreshError(
  response: Response,
  raw: unknown,
): {
  code: string;
  message: string;
  reloginRequired: boolean;
} {
  let code = "codex_refresh_failed";
  let message = `Codex token refresh failed with status ${response.status}.`;

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === "object") {
      const err = error as Record<string, unknown>;
      const nestedCode = err.code ?? err.type;
      if (typeof nestedCode === "string" && nestedCode.trim()) {
        code = nestedCode.trim();
      }
      if (typeof err.message === "string" && err.message.trim()) {
        message = `Codex token refresh failed: ${err.message.trim()}`;
      }
    } else if (typeof error === "string" && error.trim()) {
      code = error.trim();
      const description = record.error_description ?? record.message;
      if (typeof description === "string" && description.trim()) {
        message = `Codex token refresh failed: ${description.trim()}`;
      }
    }
  }

  let reloginRequired =
    response.status === 401 ||
    response.status === 403 ||
    code === "invalid_grant" ||
    code === "invalid_token" ||
    code === "invalid_request";

  if (code === "refresh_token_reused") {
    reloginRequired = true;
    message =
      "Codex refresh token was already consumed by another client. " +
      `Re-authenticate with \`${formatCliCommand("argent models auth login --provider openai-codex")}\`.`;
  }

  return { code, message, reloginRequired };
}

function buildRefreshError(response: Response, raw: unknown): Error {
  const parsed = parseCodexRefreshError(response, raw);
  const error = new Error(
    parsed.reloginRequired ? `${parsed.message} Re-authentication is required.` : parsed.message,
  );
  error.name = parsed.code;
  return error;
}

export async function startOpenAICodexDeviceLogin(options?: {
  fetchFn?: FetchLike;
}): Promise<OpenAICodexDeviceStart> {
  const fetchFn = options?.fetchFn ?? fetch;
  const response = await fetchFn(OPENAI_CODEX_DEVICE_USER_CODE_URL, {
    method: "POST",
    headers: buildOpenAIAuthHeaders("application/json"),
    body: JSON.stringify({ client_id: OPENAI_CODEX_CLIENT_ID }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI Codex device code request failed: ${await errorText(response)}`);
  }

  const payload = (await response.json()) as {
    user_code?: string;
    device_auth_id?: string;
    interval?: number | string;
  };
  const userCode = payload.user_code?.trim();
  const deviceAuthId = payload.device_auth_id?.trim();
  if (!userCode || !deviceAuthId) {
    throw new Error("OpenAI Codex device code response missing user_code or device_auth_id.");
  }

  const interval =
    typeof payload.interval === "number"
      ? payload.interval
      : typeof payload.interval === "string"
        ? Number.parseInt(payload.interval, 10)
        : DEFAULT_POLL_INTERVAL_SECONDS;

  return {
    userCode,
    deviceAuthId,
    verificationUri: OPENAI_CODEX_DEVICE_URL,
    pollIntervalSeconds: Math.max(
      MIN_POLL_INTERVAL_SECONDS,
      Number.isFinite(interval) ? interval : DEFAULT_POLL_INTERVAL_SECONDS,
    ),
  };
}

export async function pollOpenAICodexDeviceLogin(params: {
  deviceAuthId: string;
  userCode: string;
  fetchFn?: FetchLike;
}): Promise<OpenAICodexDevicePoll | null> {
  const fetchFn = params.fetchFn ?? fetch;
  const response = await fetchFn(OPENAI_CODEX_DEVICE_TOKEN_URL, {
    method: "POST",
    headers: buildOpenAIAuthHeaders("application/json"),
    body: JSON.stringify({
      device_auth_id: params.deviceAuthId,
      user_code: params.userCode,
    }),
  });

  if (response.status === 403 || response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`OpenAI Codex device auth polling failed: ${await errorText(response)}`);
  }

  const payload = (await response.json()) as {
    authorization_code?: string;
    code_verifier?: string;
  };
  const authorizationCode = payload.authorization_code?.trim();
  const codeVerifier = payload.code_verifier?.trim();
  if (!authorizationCode || !codeVerifier) {
    throw new Error(
      "OpenAI Codex device auth response missing authorization_code or code_verifier.",
    );
  }

  return { authorizationCode, codeVerifier };
}

export async function exchangeOpenAICodexDeviceCode(params: {
  authorizationCode: string;
  codeVerifier: string;
  fetchFn?: FetchLike;
  now?: number;
}): Promise<OAuthCredentials> {
  const fetchFn = params.fetchFn ?? fetch;
  const now = params.now ?? Date.now();
  const response = await fetchFn(OPENAI_CODEX_TOKEN_URL, {
    method: "POST",
    headers: buildOpenAIAuthHeaders("application/x-www-form-urlencoded"),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.authorizationCode,
      redirect_uri: OPENAI_CODEX_DEVICE_REDIRECT_URI,
      client_id: OPENAI_CODEX_CLIENT_ID,
      code_verifier: params.codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI Codex token exchange failed: ${await errorText(response)}`);
  }

  const payload = (await response.json()) as TokenPayload;
  const access = payload.access_token?.trim();
  const refresh = payload.refresh_token?.trim();
  if (!access) {
    throw new Error("OpenAI Codex token exchange returned no access_token.");
  }
  if (!refresh) {
    throw new Error("OpenAI Codex token exchange returned no refresh_token.");
  }

  const chatgptAccountId = decodeChatgptAccountId(access);
  return {
    access,
    refresh,
    expires: expiresFromNow(payload.expires_in, now),
    tokenType: payload.token_type ?? "Bearer",
    scope: payload.scope,
    ...(chatgptAccountId ? { chatgptAccountId } : {}),
  };
}

export async function loginOpenAICodexDevice(
  options: OpenAICodexDeviceLoginOptions = {},
): Promise<OAuthCredentials> {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxWaitMs = options.maxWaitMs ?? 15 * 60 * 1000;

  options.onProgress?.("Requesting OpenAI Codex device code...");
  const start = await startOpenAICodexDeviceLogin({ fetchFn });
  await options.onStart?.(start);

  const deadline = now() + maxWaitMs;
  options.onProgress?.("Waiting for OpenAI Codex sign-in...");
  while (now() < deadline) {
    const result = await pollOpenAICodexDeviceLogin({
      deviceAuthId: start.deviceAuthId,
      userCode: start.userCode,
      fetchFn,
    });
    if (result) {
      options.onProgress?.("Exchanging OpenAI Codex device code...");
      return await exchangeOpenAICodexDeviceCode({
        authorizationCode: result.authorizationCode,
        codeVerifier: result.codeVerifier,
        fetchFn,
        now: now(),
      });
    }
    await sleep(start.pollIntervalSeconds * 1000);
  }

  throw new Error("OpenAI Codex device login timed out.");
}

export async function refreshOpenAICodexCredentials(
  credentials: OAuthCredentials,
  options?: {
    fetchFn?: FetchLike;
    now?: number;
  },
): Promise<OAuthCredentials> {
  const refresh = credentials.refresh?.trim();
  if (!refresh) {
    throw new Error(
      `Codex auth is missing a refresh token. Re-authenticate with \`${formatCliCommand("argent models auth login --provider openai-codex")}\`.`,
    );
  }

  const fetchFn = options?.fetchFn ?? fetch;
  const now = options?.now ?? Date.now();
  const response = await fetchFn(OPENAI_CODEX_TOKEN_URL, {
    method: "POST",
    headers: buildOpenAIAuthHeaders("application/x-www-form-urlencoded"),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: OPENAI_CODEX_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw buildRefreshError(response, body);
  }

  const payload = (await response.json()) as TokenPayload;
  const access = payload.access_token?.trim();
  if (!access) {
    throw new Error("OpenAI Codex refresh response missing access_token.");
  }

  const chatgptAccountId =
    decodeChatgptAccountId(access) ??
    (typeof credentials.chatgptAccountId === "string" ? credentials.chatgptAccountId : undefined);

  return {
    ...credentials,
    access,
    refresh: payload.refresh_token?.trim() || refresh,
    expires: expiresFromNow(payload.expires_in, now),
    tokenType: payload.token_type ?? credentials.tokenType,
    scope: payload.scope ?? credentials.scope,
    ...(chatgptAccountId ? { chatgptAccountId } : {}),
  };
}
