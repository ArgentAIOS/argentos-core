/**
 * Argent Agent — Model Discovery
 *
 * Re-exports AuthStorage and ModelRegistry for use by embedded runtime
 * loaders. These currently delegate to Pi's implementations but are
 * isolated behind the argent-agent boundary.
 *
 * Important: keep this module independent from the argent-agent barrel
 * and agent-core/coding barrel to avoid ESM chunk cycles.
 *
 * MIGRATION (#286): this file used to import directly from
 * `@earendil-works/pi-coding-agent`. As of the pi-bridge foundation
 * (codex/fix-286-pi-bridge), the symbols are sourced from
 * `./pi-bridge/index.js` — the single import point for pi-coding-agent
 * shapes. The bridge is forward-compatible with pi 0.73+'s
 * private-constructor change.
 *
 * TODO: Replace with fully Argent-native implementations when
 * pi-coding-agent dependency is removed entirely.
 *
 * @module argent-agent/model-discovery
 */

export { AuthStorage, ModelRegistry } from "./pi-bridge/index.js";
