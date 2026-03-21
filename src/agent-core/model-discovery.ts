/**
 * Dedicated seam for model-discovery primitives used by embedded runtime loaders.
 *
 * SEAM SWAP: Now delegates through argent-agent/model-discovery instead of
 * importing @mariozechner/pi-coding-agent directly. The pi dependency is
 * isolated behind the argent-agent boundary.
 *
 * Important: keep this module independent from `agent-core/index` and the
 * `agent-core/coding` barrel to avoid ESM chunk cycles in bundler output.
 */
export { AuthStorage, ModelRegistry } from "../argent-agent/model-discovery.js";
