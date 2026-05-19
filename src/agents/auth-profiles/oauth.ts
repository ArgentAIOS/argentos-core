import lockfile from "proper-lockfile";
import type { ArgentConfig } from "../../config/config.js";
import type { AuthProfileStore } from "./types.js";
import {
  argentGetOAuthApiKey,
  argentGetOAuthProviders,
  type OAuthCredentials,
  type OAuthProvider,
} from "../../agent-core/ai.js";
import { refreshQwenPortalCredentials } from "../../providers/qwen-portal-oauth.js";
import { refreshChutesTokens } from "../chutes-oauth.js";
import { isAccessTokenExpiring, refreshOpenAICodexCredentials } from "../openai-codex-auth.js";
import { AUTH_STORE_LOCK_OPTIONS, log } from "./constants.js";
import { formatAuthDoctorHint } from "./doctor.js";
import { ensureAuthStoreFile, resolveAuthStorePath } from "./paths.js";
import { suggestOAuthProfileIdForLegacyDefault } from "./repair.js";
import { ensureAuthProfileStore, saveAuthProfileStore } from "./store.js";

/**
 * Module-scope tracker of in-flight refreshes, keyed by `profileId`. Prevents
 * thundering-herd refreshes when multiple chat turns inside the 5-min skew
 * window all decide the token is "expiring soon" at the same time. Mirrors
 * subctl's `_inFlightRefresh` map (components/master/openai-codex-auth.ts L59).
 *
 * Process-level coordination across CLI/dashboard processes is handled by the
 * `proper-lockfile` lock on `auth-profiles.json` (see `refreshOAuthTokenWithLock`).
 * This Map handles the in-process case.
 */
const _inFlightRefresh = new Map<string, Promise<unknown>>();

/**
 * Fire-and-forget hint: if an OAuth credential's access token is within the
 * 5-min skew window of `exp`, kick off a background refresh. Returns immediately
 * with the still-valid token — the operator's *next* chat turn picks up the
 * rotated token off disk.
 *
 * Subctl L341-L393 (components/master/openai-codex-auth.ts) is the reference
 * implementation. This is a *hint*, not a replacement for the lazy refresh-on-401
 * path in `refreshOAuthTokenWithLock` — that's still the safety net.
 *
 * Currently scoped to `openai-codex` since that is the provider whose JWT we
 * know how to inspect; other providers continue to use lazy refresh only.
 */
export function maybeKickEagerRefresh(params: {
  profileId: string;
  credentials: OAuthCredentials & { provider?: string };
  agentDir?: string;
}): void {
  const provider = String(params.credentials.provider ?? "").trim();
  if (provider !== "openai-codex") return;

  const access = typeof params.credentials.access === "string" ? params.credentials.access : "";
  if (!isAccessTokenExpiring(access)) return;

  if (_inFlightRefresh.has(params.profileId)) return;

  const promise = (async () => {
    try {
      const refreshed = await refreshOAuthTokenWithLock({
        profileId: params.profileId,
        agentDir: params.agentDir,
      });
      if (refreshed) {
        // Structured log mirrors subctl's account=<id>, exp_in_s=<seconds>
        // format. We deliberately do NOT log access/refresh tokens.
        const expIn = Math.max(
          0,
          Math.round((refreshed.newCredentials.expires - Date.now()) / 1000),
        );
        const account =
          typeof refreshed.newCredentials.chatgptAccountId === "string"
            ? refreshed.newCredentials.chatgptAccountId
            : "unknown";
        log.info("openai-codex eager refresh succeeded", {
          profileId: params.profileId,
          account,
          exp_in_s: expIn,
        });
      }
    } catch (err) {
      // Swallow network failures — the still-valid token returned by the
      // synchronous caller covers this turn, and the next call will retry.
      log.warn("openai-codex eager refresh failed (current token still valid)", {
        profileId: params.profileId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      _inFlightRefresh.delete(params.profileId);
    }
  })();
  _inFlightRefresh.set(params.profileId, promise);
}

/** Test-only helper to inspect the in-flight refresh tracker. */
export function _peekInFlightRefresh(profileId: string): Promise<unknown> | undefined {
  return _inFlightRefresh.get(profileId);
}

const OAUTH_PROVIDER_IDS = new Set<string>(
  argentGetOAuthProviders().map((provider) => provider.id),
);

const isOAuthProvider = (provider: string): provider is OAuthProvider =>
  OAUTH_PROVIDER_IDS.has(provider);

const resolveOAuthProvider = (provider: string): OAuthProvider | null =>
  isOAuthProvider(provider) ? provider : null;

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldUseOpenaiCodexRefreshFallback(params: {
  provider: string;
  credentials: OAuthCredentials;
  error: unknown;
}): boolean {
  if (String(params.provider).trim().toLowerCase() !== "openai-codex") {
    return false;
  }
  const message = extractErrorMessage(params.error);
  if (!/extract\s+accountid\s+from\s+token/i.test(message)) {
    return false;
  }
  return (
    typeof params.credentials.access === "string" && params.credentials.access.trim().length > 0
  );
}

function sanitizePossiblyUrlAppendedToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  // Some providers/bridges may accidentally persist callback query params
  // onto bearer tokens (e.g. "...&scope=...&state=...").
  const markers = ["&scope=", "&state=", "?scope=", "?state="];
  const cutAt = markers
    .map((marker) => trimmed.indexOf(marker))
    .filter((idx) => idx >= 0)
    .reduce<number | undefined>(
      (lowest, idx) => (typeof lowest === "number" && lowest < idx ? lowest : idx),
      undefined,
    );
  if (typeof cutAt === "number" && cutAt > 0) {
    return trimmed.slice(0, cutAt);
  }
  return trimmed;
}

function buildOAuthApiKey(provider: string, credentials: OAuthCredentials): string {
  const needsProjectId = provider === "google-gemini-cli" || provider === "google-antigravity";
  return needsProjectId
    ? JSON.stringify({
        token: credentials.access,
        projectId: credentials.projectId,
      })
    : credentials.access;
}

async function refreshOAuthTokenWithLock(params: {
  profileId: string;
  agentDir?: string;
}): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null> {
  const authPath = resolveAuthStorePath(params.agentDir);
  ensureAuthStoreFile(authPath);

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(authPath, {
      ...AUTH_STORE_LOCK_OPTIONS,
    });

    const store = ensureAuthProfileStore(params.agentDir);
    const cred = store.profiles[params.profileId];
    if (!cred || cred.type !== "oauth") {
      return null;
    }

    if (Date.now() < cred.expires) {
      return {
        apiKey: buildOAuthApiKey(cred.provider, cred),
        newCredentials: cred,
      };
    }

    const oauthCreds: Record<string, OAuthCredentials> = {
      [cred.provider]: cred,
    };

    let result: { apiKey: string; newCredentials: OAuthCredentials } | null;
    if (String(cred.provider) === "chutes") {
      const newCredentials = await refreshChutesTokens({
        credential: cred,
      });
      result = { apiKey: newCredentials.access, newCredentials };
    } else if (String(cred.provider) === "qwen-portal") {
      const newCredentials = await refreshQwenPortalCredentials(cred);
      result = { apiKey: newCredentials.access, newCredentials };
    } else if (String(cred.provider) === "openai-codex") {
      const newCredentials = await refreshOpenAICodexCredentials(cred);
      result = { apiKey: newCredentials.access, newCredentials };
    } else {
      const oauthProvider = resolveOAuthProvider(cred.provider);
      result = oauthProvider ? await argentGetOAuthApiKey(oauthProvider, oauthCreds) : null;
    }
    if (!result) {
      return null;
    }
    store.profiles[params.profileId] = {
      ...cred,
      ...result.newCredentials,
      type: "oauth",
    };
    saveAuthProfileStore(store, params.agentDir);

    return result;
  } finally {
    if (release) {
      try {
        await release();
      } catch {
        // ignore unlock errors
      }
    }
  }
}

async function tryResolveOAuthProfile(params: {
  cfg?: ArgentConfig;
  store: AuthProfileStore;
  profileId: string;
  agentDir?: string;
}): Promise<{ apiKey: string; provider: string; email?: string } | null> {
  const { cfg, store, profileId } = params;
  const cred = store.profiles[profileId];
  if (!cred || cred.type !== "oauth") {
    return null;
  }
  const profileConfig = cfg?.auth?.profiles?.[profileId];
  if (profileConfig && profileConfig.provider !== cred.provider) {
    return null;
  }
  if (profileConfig && profileConfig.mode !== cred.type) {
    return null;
  }

  if (Date.now() < cred.expires) {
    // Eager refresh hint: if we're inside the 5-min skew window of the JWT's
    // exp claim, kick a background refresh. Operator's next chat turn picks
    // up the rotated token off disk. Not awaited.
    maybeKickEagerRefresh({
      profileId,
      credentials: cred,
      agentDir: params.agentDir,
    });
    return {
      apiKey: buildOAuthApiKey(cred.provider, cred),
      provider: cred.provider,
      email: cred.email,
    };
  }

  const refreshed = await refreshOAuthTokenWithLock({
    profileId,
    agentDir: params.agentDir,
  });
  if (!refreshed) {
    return null;
  }
  return {
    apiKey: refreshed.apiKey,
    provider: cred.provider,
    email: cred.email,
  };
}

export async function resolveApiKeyForProfile(params: {
  cfg?: ArgentConfig;
  store: AuthProfileStore;
  profileId: string;
  agentDir?: string;
}): Promise<{ apiKey: string; provider: string; email?: string } | null> {
  const { cfg, store, profileId } = params;
  const cred = store.profiles[profileId];
  if (!cred) {
    return null;
  }
  const profileConfig = cfg?.auth?.profiles?.[profileId];
  if (profileConfig && profileConfig.provider !== cred.provider) {
    return null;
  }
  if (profileConfig && profileConfig.mode !== cred.type) {
    // Compatibility: treat "oauth" config as compatible with stored token profiles.
    if (!(profileConfig.mode === "oauth" && cred.type === "token")) {
      return null;
    }
  }

  if (cred.type === "api_key") {
    const key = sanitizePossiblyUrlAppendedToken(cred.key ?? "");
    if (!key) {
      return null;
    }
    return { apiKey: key, provider: cred.provider, email: cred.email };
  }
  if (cred.type === "token") {
    const token = cred.token?.trim();
    if (!token) {
      return null;
    }
    if (
      typeof cred.expires === "number" &&
      Number.isFinite(cred.expires) &&
      cred.expires > 0 &&
      Date.now() >= cred.expires
    ) {
      return null;
    }
    return { apiKey: token, provider: cred.provider, email: cred.email };
  }
  if (Date.now() < cred.expires) {
    maybeKickEagerRefresh({
      profileId,
      credentials: cred,
      agentDir: params.agentDir,
    });
    return {
      apiKey: buildOAuthApiKey(cred.provider, cred),
      provider: cred.provider,
      email: cred.email,
    };
  }

  try {
    const result = await refreshOAuthTokenWithLock({
      profileId,
      agentDir: params.agentDir,
    });
    if (!result) {
      return null;
    }
    return {
      apiKey: result.apiKey,
      provider: cred.provider,
      email: cred.email,
    };
  } catch (error) {
    const refreshedStore = ensureAuthProfileStore(params.agentDir);
    const refreshed = refreshedStore.profiles[profileId];
    if (refreshed?.type === "oauth" && Date.now() < refreshed.expires) {
      return {
        apiKey: buildOAuthApiKey(refreshed.provider, refreshed),
        provider: refreshed.provider,
        email: refreshed.email ?? cred.email,
      };
    }
    const fallbackProfileId = suggestOAuthProfileIdForLegacyDefault({
      cfg,
      store: refreshedStore,
      provider: cred.provider,
      legacyProfileId: profileId,
    });
    if (fallbackProfileId && fallbackProfileId !== profileId) {
      try {
        const fallbackResolved = await tryResolveOAuthProfile({
          cfg,
          store: refreshedStore,
          profileId: fallbackProfileId,
          agentDir: params.agentDir,
        });
        if (fallbackResolved) {
          return fallbackResolved;
        }
      } catch {
        // keep original error
      }
    }

    // Fallback: if this is a secondary agent, try using the main agent's credentials
    if (params.agentDir) {
      try {
        const mainStore = ensureAuthProfileStore(undefined); // main agent (no agentDir)
        const mainCred = mainStore.profiles[profileId];
        if (mainCred?.type === "oauth" && Date.now() < mainCred.expires) {
          // Main agent has fresh credentials - copy them to this agent and use them
          refreshedStore.profiles[profileId] = { ...mainCred };
          saveAuthProfileStore(refreshedStore, params.agentDir);
          log.info("inherited fresh OAuth credentials from main agent", {
            profileId,
            agentDir: params.agentDir,
            expires: new Date(mainCred.expires).toISOString(),
          });
          return {
            apiKey: buildOAuthApiKey(mainCred.provider, mainCred),
            provider: mainCred.provider,
            email: mainCred.email,
          };
        }
      } catch {
        // keep original error if main agent fallback also fails
      }
    }

    if (
      shouldUseOpenaiCodexRefreshFallback({
        provider: cred.provider,
        credentials: cred,
        error,
      })
    ) {
      log.warn("openai-codex oauth refresh failed; using cached access token fallback", {
        profileId,
        provider: cred.provider,
      });
      return {
        apiKey: cred.access,
        provider: cred.provider,
        email: cred.email,
      };
    }

    const message = extractErrorMessage(error);
    const hint = formatAuthDoctorHint({
      cfg,
      store: refreshedStore,
      provider: cred.provider,
      profileId,
    });
    throw new Error(
      `OAuth token refresh failed for ${cred.provider}: ${message}. ` +
        "Please try again or re-authenticate." +
        (hint ? `\n\n${hint}` : ""),
      { cause: error },
    );
  }
}
