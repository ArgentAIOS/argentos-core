"use strict";

/**
 * Dashboard API provider registry seed fallback.
 *
 * The runtime merges this seed with ~/.argentos/provider-registry.json.
 * Keeping this module present avoids startup noise when the API server
 * expects a local provider catalog artifact.
 */
module.exports = {
  PROVIDER_REGISTRY_SEED_VERSION: 1,
  DEFAULT_PROVIDER_REGISTRY: {
    version: 1,
    providers: {},
  },
};
