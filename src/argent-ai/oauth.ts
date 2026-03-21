/**
 * Argent AI — OAuth Functions
 *
 * Argent-native implementations of Pi's getOAuthApiKey and getOAuthProviders.
 * These handle OAuth credential → API key resolution and provider discovery.
 *
 * Used by: src/agents/auth-profiles/oauth.ts (1 file, 2 functions)
 *
 * @module argent-ai/oauth
 */

import type { OAuthCredentials, OAuthProvider } from "../argent-agent/oauth-types.js";

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * OAuth provider definition with metadata.
 */
export interface OAuthProviderInfo {
  /** Provider identifier (matches OAuthProvider union) */
  id: OAuthProvider;
  /** Human-readable name */
  name: string;
  /** Token endpoint for refresh (if applicable) */
  tokenUrl?: string;
  /** Whether this provider supports token refresh */
  supportsRefresh: boolean;
}

/**
 * All known OAuth providers.
 * This is the canonical list — the OAuthProvider type union must match.
 */
const OAUTH_PROVIDERS: OAuthProviderInfo[] = [
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    tokenUrl: "https://api.github.com/copilot_internal/v2/token",
    supportsRefresh: true,
  },
  {
    id: "google-antigravity",
    name: "Google Antigravity",
    supportsRefresh: false,
  },
];

/**
 * Get all known OAuth providers.
 *
 * Returns the canonical list of OAuth providers with metadata.
 * Used by auth-profiles to build the set of known provider IDs.
 *
 * @returns Array of OAuth provider info objects
 */
export function getOAuthProviders(): OAuthProviderInfo[] {
  return [...OAUTH_PROVIDERS];
}

// ============================================================================
// API Key Resolution
// ============================================================================

/**
 * Result of resolving OAuth credentials to an API key.
 */
export interface OAuthApiKeyResult {
  /** The API key to use for requests */
  apiKey: string;
  /** Updated credentials (if a refresh occurred) */
  newCredentials?: OAuthCredentials;
}

/**
 * Resolve OAuth credentials to an API key for a provider.
 *
 * Different OAuth providers need different handling:
 * - **GitHub Copilot**: Exchange the OAuth token for a short-lived session
 *   token via GitHub's internal Copilot API
 * - **Google Antigravity**: Use the access token directly
 * - **Others**: Use the access token as-is
 *
 * If the token is expired and the provider supports refresh, this function
 * will attempt to refresh it before returning.
 *
 * @param provider - OAuth provider identifier
 * @param credentials - Map of provider ID → OAuth credentials
 * @returns API key + possibly refreshed credentials, or null if resolution fails
 */
export async function getOAuthApiKey(
  provider: OAuthProvider,
  credentials: Record<string, OAuthCredentials>,
): Promise<OAuthApiKeyResult | null> {
  const cred = credentials[provider];
  if (!cred) {
    return null;
  }

  // Check if token is expired
  if (cred.expiresAt && cred.expiresAt < Date.now()) {
    // Attempt refresh if we have a refresh token
    if (cred.refreshToken) {
      const refreshed = await refreshToken(provider, cred);
      if (refreshed) {
        return {
          apiKey: refreshed.accessToken,
          newCredentials: refreshed,
        };
      }
    }
    return null; // Expired with no refresh available
  }

  // Provider-specific key resolution
  switch (provider) {
    case "github-copilot":
      return resolveGitHubCopilotKey(cred);
    case "google-antigravity":
      return { apiKey: cred.accessToken };
    default:
      return { apiKey: cred.accessToken };
  }
}

// ============================================================================
// Provider-Specific Resolution
// ============================================================================

/**
 * GitHub Copilot: Exchange OAuth token for a Copilot session token.
 */
async function resolveGitHubCopilotKey(cred: OAuthCredentials): Promise<OAuthApiKeyResult | null> {
  try {
    const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
      headers: {
        Authorization: `Bearer ${cred.accessToken}`,
        Accept: "application/json",
        "User-Agent": "ArgentOS/1.0",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      token?: string;
      expires_at?: number;
    };

    if (!data.token) {
      return null;
    }

    return { apiKey: data.token };
  } catch {
    // Fall back to using the access token directly
    return { apiKey: cred.accessToken };
  }
}

/**
 * Refresh an expired OAuth token using the refresh token.
 */
async function refreshToken(
  provider: OAuthProvider,
  cred: OAuthCredentials,
): Promise<OAuthCredentials | null> {
  const providerInfo = OAUTH_PROVIDERS.find((p) => p.id === provider);
  if (!providerInfo?.tokenUrl || !cred.refreshToken) {
    return null;
  }

  try {
    const response = await fetch(providerInfo.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: cred.refreshToken,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
    };

    if (!data.access_token) {
      return null;
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? cred.refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type ?? cred.tokenType,
      scope: data.scope ?? cred.scope,
    };
  } catch {
    return null;
  }
}
