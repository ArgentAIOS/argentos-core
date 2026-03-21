/**
 * AEVP (Agent Expressive Visual Presence) — Phase 2 Public API
 */

// Types + identity
export type { AEVPConfig, AgentVisualIdentity, AEVPRenderState } from "./types";
export { ARGENT_DEFAULT_IDENTITY } from "./types";

// Color mapping
export { computeRenderState } from "./colorMapping";

// Renderer
export { AEVPRenderer } from "./renderer";

// Particles
export { ParticleSystem } from "./particles";

// Environment (dashboard climate)
export { updateDashboardClimate, clearDashboardClimate } from "./environment";
