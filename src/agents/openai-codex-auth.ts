import type { OAuthCredentials } from "../agent-core/ai.js";
import { formatCliCommand } from "../cli/command-format.js";

export const OPENAI_CODEX_ISSUER = "https://auth.openai.com";
export const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_CODEX_TOKEN_URL = `${OPENAI_CODEX_ISSUER}/oauth/token`;
export const OPENAI_CODEX_DEVICE_URL = `${OPENAI_CODEX_ISSUER}/codex/device`;
export const OPENAI_CODEX_DEVICE_USER_CODE_URL = `${OPENAI_CODEX_ISSUER}/api/accounts/deviceauth/usercode`;
export const OPENAI_CODEX_DEVICE_TOKEN_URL = `${OPENAI_CODEX_ISSUER}/api/accounts/deviceauth/token`;
export const OPENAI_CODEX_DEVICE_REDIRECT_URI = `${OPENAI_CODEX_ISSUER}/deviceauth/callback`;
export const OPENAI_CODEX_DEFAULT_BASE_URL = "https://chatgpt.com/backend-api/codex";

const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const MIN_POLL_INTERVAL_SECONDS = 3;
const DEFAULT_EXPIRES_IN_SECONDS = 60 * 60;
const DEFAULT_EXPIRES_BUFFER_MS = 2 * 60 * 1000;

type FetchLike = typeof fetch;

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
    headers: { "Content-Type": "application/json", Accept: "application/json" },
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
    headers: { "Content-Type": "application/json", Accept: "application/json" },
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
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
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

  return {
    access,
    refresh,
    expires: expiresFromNow(payload.expires_in, now),
    tokenType: payload.token_type ?? "Bearer",
    scope: payload.scope,
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
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
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

  return {
    ...credentials,
    access,
    refresh: payload.refresh_token?.trim() || refresh,
    expires: expiresFromNow(payload.expires_in, now),
    tokenType: payload.token_type ?? credentials.tokenType,
    scope: payload.scope ?? credentials.scope,
  };
}
