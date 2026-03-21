/**
 * Argent Agent — OAuth Types
 *
 * Pi-compatible OAuth credential and provider types.
 * Matches shapes from the legacy upstream AI SDK.
 *
 * Used by: 12 files (auth profiles, CLI credentials, onboarding, providers)
 *
 * @module argent-agent/oauth-types
 */

// ============================================================================
// OAuth Credentials
// ============================================================================

/**
 * OAuth credentials returned from an OAuth flow.
 * Used for GitHub Copilot, Google Antigravity, and other OAuth providers.
 */
export interface OAuthCredentials {
  /** The access token for API calls */
  accessToken: string;
  /** Refresh token for obtaining new access tokens */
  refreshToken?: string;
  /** Expiration timestamp (Unix ms) */
  expiresAt?: number;
  /** Token type (typically "Bearer") */
  tokenType?: string;
  /** Granted scopes */
  scope?: string;
}

// ============================================================================
// OAuth Provider
// ============================================================================

/**
 * Known OAuth providers that use browser-based auth flows
 * instead of API keys.
 */
export type OAuthProvider =
  | "github-copilot"
  | "google-antigravity"
  | "google-gemini-cli"
  | "openai-codex";
