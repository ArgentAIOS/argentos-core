/**
 * Argent AI — OpenAI Codex OAuth (PKCE Flow)
 *
 * Implements the OAuth 2.0 PKCE authorization flow for OpenAI Codex.
 * Starts a local HTTP server for the callback, opens the browser for auth,
 * then exchanges the auth code for access/refresh tokens.
 *
 * This is an Argent-native replacement for Pi's `loginOpenAICodex`.
 * Only 1 call site: src/commands/auth-choice.apply.openai.ts
 *
 * @module argent-ai/openai-codex-oauth
 */

import { randomBytes, createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL, URLSearchParams } from "node:url";
import type { OAuthCredentials } from "../argent-agent/oauth-types.js";

// ============================================================================
// Constants
// ============================================================================

const CALLBACK_PORT = 1455;
const CALLBACK_HOST = "127.0.0.1";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

/**
 * OpenAI OAuth endpoints.
 * These match the standard Auth0-based OpenAI auth flow.
 */
const OPENAI_AUTH_URL = "https://auth.openai.com/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";

/**
 * The client ID for the OpenAI Codex CLI.
 * This is a public client ID (no client secret — PKCE flow).
 * Must match Pi's client ID so the same OAuth app is used.
 */
const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/**
 * Scope requested during the OAuth flow.
 * Matches the scopes used by the official OpenAI Codex CLI.
 */
const OPENAI_SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke";

/**
 * Audience for OpenAI API.
 */
const OPENAI_AUDIENCE = "https://api.openai.com/v1";

// ============================================================================
// PKCE Helpers
// ============================================================================

/**
 * Generate a cryptographically random code verifier (43-128 chars, base64url).
 */
function generateCodeVerifier(length = 64): string {
  return randomBytes(length).toString("base64url").slice(0, 128);
}

/**
 * Derive the code challenge from a code verifier using SHA-256.
 */
function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Generate a random state parameter for CSRF protection.
 */
function generateState(): string {
  return randomBytes(32).toString("hex");
}

// ============================================================================
// Local Callback Server
// ============================================================================

interface CallbackResult {
  code: string;
  state: string;
}

/**
 * Start a local HTTP server to receive the OAuth callback.
 * Returns the auth code when the callback is received.
 */
function startCallbackServer(
  expectedState: string,
  signal?: AbortSignal,
): { promise: Promise<CallbackResult>; close: () => void } {
  let resolveCallback: (result: CallbackResult) => void;
  let rejectCallback: (error: Error) => void;

  const promise = new Promise<CallbackResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${CALLBACK_HOST}:${CALLBACK_PORT}`);

    if (url.pathname !== "/callback") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    // Return a nice HTML page regardless of outcome
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

    if (error) {
      res.end(
        `<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:4rem">` +
          `<h1>Authentication Failed</h1>` +
          `<p>${errorDescription || error}</p>` +
          `<p>You can close this tab.</p></body></html>`,
      );
      rejectCallback(new Error(`OAuth error: ${errorDescription || error}`));
      return;
    }

    if (!code || !state) {
      res.end(
        `<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:4rem">` +
          `<h1>Missing Parameters</h1>` +
          `<p>No authorization code received.</p></body></html>`,
      );
      rejectCallback(new Error("Missing code or state in callback"));
      return;
    }

    if (state !== expectedState) {
      res.end(
        `<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:4rem">` +
          `<h1>Invalid State</h1>` +
          `<p>State mismatch — possible CSRF attack.</p></body></html>`,
      );
      rejectCallback(new Error("State mismatch in OAuth callback"));
      return;
    }

    res.end(
      `<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:4rem">` +
        `<h1>Authentication Successful</h1>` +
        `<p>You can close this tab and return to the terminal.</p></body></html>`,
    );
    resolveCallback({ code, state });
  });

  server.listen(CALLBACK_PORT, CALLBACK_HOST);

  // Handle abort signal
  if (signal) {
    signal.addEventListener("abort", () => {
      server.close();
      rejectCallback(new Error("OAuth flow was cancelled"));
    });
  }

  // Auto-close after 5 minutes
  const timeout = setTimeout(
    () => {
      server.close();
      rejectCallback(new Error("OAuth callback timed out (5 minutes)"));
    },
    5 * 60 * 1000,
  );

  const close = () => {
    clearTimeout(timeout);
    server.close();
  };

  // Resolve the promise and close the server when callback is received
  const wrappedPromise = promise.finally(close);

  return { promise: wrappedPromise, close };
}

// ============================================================================
// Token Exchange
// ============================================================================

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
}

/**
 * Exchange the authorization code for tokens using PKCE.
 */
async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<OAuthCredentials> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: OPENAI_CODEX_CLIENT_ID,
    code_verifier: codeVerifier,
    code,
    redirect_uri: REDIRECT_URI,
  });

  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as TokenResponse;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type || "Bearer",
    scope: data.scope,
  };
}

// ============================================================================
// Main Login Function
// ============================================================================

export interface LoginOpenAICodexOptions {
  /** Called with the auth URL — open it in a browser */
  onAuth: (info: { url: string; instructions?: string }) => void;
  /** Called when user input is needed (e.g., paste redirect URL) */
  onPrompt: (prompt: {
    message: string;
    placeholder?: string;
    allowEmpty?: boolean;
  }) => Promise<string>;
  /** Called with progress messages */
  onProgress?: (message: string) => void;
  /** Called to manually input an auth code (fallback for no-browser envs) */
  onManualCodeInput?: () => Promise<string>;
  /** Originator identifier for tracking */
  originator?: string;
}

/**
 * Run the full OpenAI Codex OAuth PKCE login flow.
 *
 * 1. Generate PKCE code verifier + challenge
 * 2. Start local callback server on port 1455
 * 3. Open browser to OpenAI auth URL
 * 4. Wait for callback with auth code
 * 5. Exchange code for tokens
 * 6. Return OAuthCredentials
 *
 * @param options - Callbacks for auth URL opening, prompting, and progress
 * @returns OAuth credentials (access_token, refresh_token, etc.)
 */
export async function loginOpenAICodex(
  options: LoginOpenAICodexOptions,
): Promise<OAuthCredentials> {
  const { onAuth, onPrompt, onProgress } = options;

  onProgress?.("Generating PKCE challenge…");

  // Step 1: Generate PKCE parameters
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Step 2: Start local callback server
  onProgress?.("Starting callback server on port 1455…");

  const { promise: callbackPromise, close: closeServer } = startCallbackServer(state);

  try {
    // Step 3: Build the authorization URL
    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: OPENAI_CODEX_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: OPENAI_SCOPE,
      audience: OPENAI_AUDIENCE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authUrl = `${OPENAI_AUTH_URL}?${authParams.toString()}`;

    // Step 4: Open browser for authentication
    onProgress?.("Opening browser for authentication…");
    onAuth({
      url: authUrl,
      instructions: "Sign in with your OpenAI account to authorize Codex access.",
    });

    // Step 5: Wait for callback (with manual URL paste fallback)
    onProgress?.("Waiting for authentication callback…");

    let authCode: string;
    const manualAbort = new AbortController();
    try {
      // Race: callback server vs manual URL input
      const result = await Promise.race([
        callbackPromise.then((r) => {
          manualAbort.abort();
          return r;
        }),
        waitForManualCallback(onPrompt, state, manualAbort.signal),
      ]);
      authCode = result.code;
    } catch (err) {
      manualAbort.abort();
      // If callback fails, try manual code input
      if (options.onManualCodeInput) {
        onProgress?.("Callback failed, trying manual code input…");
        authCode = await options.onManualCodeInput();
      } else {
        throw err;
      }
    }

    // Step 6: Exchange code for tokens
    onProgress?.("Exchanging authorization code for tokens…");
    const credentials = await exchangeCodeForTokens(authCode, codeVerifier);

    onProgress?.("Authentication successful!");
    return credentials;
  } finally {
    closeServer();
  }
}

/**
 * Fallback: let the user paste the redirect URL manually.
 * This handles remote/VPS environments where the browser callback
 * can't reach localhost.
 */
async function waitForManualCallback(
  onPrompt: LoginOpenAICodexOptions["onPrompt"],
  expectedState: string,
  signal?: AbortSignal,
): Promise<CallbackResult> {
  // Wait a bit to give the automatic callback a chance
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 30_000);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Manual callback cancelled — server callback resolved first"));
    });
  });

  const redirectUrl = await onPrompt({
    message: "If the browser didn't redirect automatically, paste the full redirect URL here:",
    placeholder: "http://localhost:1455/callback?code=...",
    allowEmpty: false,
  });

  if (!redirectUrl || !redirectUrl.trim()) {
    throw new Error("No redirect URL provided");
  }

  const url = new URL(redirectUrl.trim());
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    throw new Error("No authorization code found in the redirect URL");
  }

  if (state && state !== expectedState) {
    throw new Error("State mismatch in manually provided redirect URL");
  }

  return { code, state: state || expectedState };
}
