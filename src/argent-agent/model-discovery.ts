/**
 * Argent Agent — Model Discovery
 *
 * Re-exports AuthStorage and ModelRegistry for use by embedded runtime
 * loaders. These currently delegate to Pi's implementations but are
 * isolated behind this Argent module boundary.
 *
 * Important: keep this module independent from the argent-agent barrel
 * and agent-core/coding barrel to avoid ESM chunk cycles.
 *
 * TODO: Replace with fully Argent-native implementations when
 * pi-coding-agent dependency is removed entirely.
 *
 * @module argent-agent/model-discovery
 */

export { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
