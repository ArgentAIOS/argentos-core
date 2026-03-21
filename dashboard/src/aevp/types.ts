/**
 * AEVP Phases 2-6 — Ambient Mode Types
 *
 * Configuration, identity, render state, tonal presence,
 * and accessibility types for the WebGL2 ambient presence renderer.
 */

// ── Configuration ──────────────────────────────────────────────────────────

export interface AEVPConfig {
  renderer: "live2d" | "aevp";
  identity: AgentVisualIdentity;
}

// ── Style & Personality (Phase 5) ──────────────────────────────────────────

export type IdentityStyleCategory = "minimal" | "warm" | "corporate" | "artistic" | "technical";
export type EdgeStyle = "crisp" | "soft" | "dissolving";

export interface IdentityStyle {
  category: IdentityStyleCategory;
  edgeStyle: EdgeStyle;
  renderQuality: "standard" | "high";
}

export interface IdentityPersonality {
  warmth: number; // 0-1: shifts color temperature (0=cool, 1=warm)
  energy: number; // 0-1: scales animation speed + particle density
  formality: number; // 0-1: affects edge crispness (1=crisp, 0=soft)
  openness: number; // 0-1: affects form expansiveness (1=larger baseline)
}

// ── Agent Visual Identity ──────────────────────────────────────────────────

export interface AgentVisualIdentity {
  colorPalette: {
    primary: [number, number, number]; // RGB 0-1 (Argent = silver/purple)
    secondary: [number, number, number];
    warm: [number, number, number]; // Positive valence
    cool: [number, number, number]; // Negative/analytical valence
    alert: [number, number, number]; // Uncertainty/error
  };
  presence: {
    ambientIntensity: number; // 0-1
    particleDensity: number; // 0-1
    glowExtension: number; // px beyond bounds
    breathingBaseRate: number; // Hz (~0.2 = 12 breaths/min)
  };
  inhabitation: {
    dashboardInfluence: number; // 0-1
    elementResonance: boolean; // Phase 3
  };
  style: IdentityStyle;
  personality: IdentityPersonality;
}

// ── Tonal Presence (Phase 6) ───────────────────────────────────────────────

export interface TonalPresenceConfig {
  enabled: boolean;
  volume: number; // 0-1, default 0.03 (very quiet)
  ambientTone: boolean;
  breathingAudio: boolean;
  stateChimes: boolean;
  preSpeechCue: boolean;
}

export interface AccessibilityConfig {
  tonalPresence: TonalPresenceConfig;
  reducedMotion: boolean;
}

export const DEFAULT_ACCESSIBILITY: AccessibilityConfig = {
  tonalPresence: {
    enabled: false, // Off by default, opt-in
    volume: 0.03,
    ambientTone: true,
    breathingAudio: true,
    stateChimes: true,
    preSpeechCue: true,
  },
  reducedMotion: false,
};

// ── Per-Frame Render State ─────────────────────────────────────────────────

/** Computed each frame from useAgentState() + identity by colorMapping.ts */
export interface AEVPRenderState {
  // Colors
  coreColor: [number, number, number]; // RGB 0-1
  glowColor: [number, number, number]; // RGB 0-1
  glowIntensity: number; // 0-1

  // Animation
  breathingRate: number; // Hz
  breathingDepth: number; // 0-1
  pulseIntensity: number; // 0-1

  // Form
  edgeCoherence: number; // 0-1 (1 = solid, 0 = dissolving)
  formExpansion: number; // 0-1 (how expanded the orb is)

  // Shape morphing (Phase 4: shape IS expression)
  squash: number; // -1 to 1 (-1=tall/elongated, 0=circle, 1=wide/squat)
  wobble: number; // 0 to 1 (organic blob movement)
  speechAmplitude: number; // 0 to 1 (drives orb pulse during speech)

  // Particles
  particleSpeed: number; // 0-2
  particleCount: number; // 0-100

  // Phase 3: Tool-specific visuals
  toolCategory: import("./toolCategories").ToolCategory;
  resonanceTargets: string[];
}

// ── Argent Default Identity ────────────────────────────────────────────────

export const ARGENT_DEFAULT_IDENTITY: AgentVisualIdentity = {
  colorPalette: {
    primary: [0.7, 0.55, 0.9], // Vivid silver-purple
    secondary: [0.5, 0.3, 0.85], // Deep rich purple
    warm: [0.95, 0.55, 0.45], // Warm rose-coral (noticeably warm)
    cool: [0.35, 0.6, 0.95], // Cool electric blue (noticeably cool)
    alert: [1.0, 0.5, 0.3], // Bright alert amber-orange
  },
  presence: {
    ambientIntensity: 0.85,
    particleDensity: 0.6,
    glowExtension: 120,
    breathingBaseRate: 0.2, // ~12 breaths/min
  },
  inhabitation: {
    dashboardInfluence: 0.7,
    elementResonance: true, // Phase 3: enabled
  },
  style: {
    category: "artistic",
    edgeStyle: "soft",
    renderQuality: "high",
  },
  personality: {
    warmth: 0.6,
    energy: 0.65,
    formality: 0.3,
    openness: 0.7,
  },
};
