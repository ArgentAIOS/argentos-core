/**
 * Composio connector — public entrypoints (slice 2.1).
 *
 * Slices 2.2–2.7 will extend this surface with auth-config flows, tool
 * discovery, execution, and capability projection. The slice 2.1 boundary
 * is intentionally narrow: SDK install, identity + secret resolution, and a
 * read-only connectivity probe.
 */

export {
  COMPOSIO_API_KEY_VAR,
  DEFAULT_COMPOSIO_BASE_URL,
  type ComposioActorContext,
  type ComposioClientConfig,
  type ComposioConnectivityResult,
  type ComposioFeatureFlags,
  type ComposioServiceKeyVariable,
} from "./types.js";

export {
  createComposioClient,
  isComposioEnabled,
  isComposioToolRouterEnabled,
  resolveComposioApiKey,
  resolveComposioUserId,
  tailApiKey,
  tryCreateComposioClientForActor,
} from "./client.js";

export { checkComposioConnectivity, type ComposioConnectivityCheckParams } from "./connectivity.js";
