/**
 * AEVP Phase 5 — Identity Presets
 *
 * Five complete AgentVisualIdentity presets, each with a distinct
 * color palette, personality, and visual character.
 */

import type { AgentVisualIdentity, IdentityStyleCategory } from "./types";
import { ARGENT_DEFAULT_IDENTITY } from "./types";

// ── Preset Definitions ────────────────────────────────────────────────────

const MINIMAL: AgentVisualIdentity = {
  colorPalette: {
    primary: [0.78, 0.78, 0.82], // Silver-white
    secondary: [0.6, 0.6, 0.65], // Cool gray
    warm: [0.85, 0.8, 0.75], // Warm silver
    cool: [0.65, 0.7, 0.8], // Cool slate
    alert: [0.9, 0.7, 0.55], // Muted amber
  },
  presence: {
    ambientIntensity: 0.5,
    particleDensity: 0.2,
    glowExtension: 60,
    breathingBaseRate: 0.15,
  },
  inhabitation: {
    dashboardInfluence: 0.3,
    elementResonance: false,
  },
  style: {
    category: "minimal",
    edgeStyle: "crisp",
    renderQuality: "standard",
  },
  personality: {
    warmth: 0.3,
    energy: 0.25,
    formality: 0.85,
    openness: 0.35,
  },
};

const WARM: AgentVisualIdentity = {
  colorPalette: {
    primary: [0.95, 0.7, 0.4], // Amber-gold
    secondary: [0.85, 0.5, 0.3], // Deep coral
    warm: [1.0, 0.65, 0.35], // Bright gold
    cool: [0.7, 0.55, 0.85], // Soft lavender
    alert: [1.0, 0.55, 0.25], // Warm orange
  },
  presence: {
    ambientIntensity: 0.8,
    particleDensity: 0.55,
    glowExtension: 110,
    breathingBaseRate: 0.18,
  },
  inhabitation: {
    dashboardInfluence: 0.65,
    elementResonance: true,
  },
  style: {
    category: "warm",
    edgeStyle: "soft",
    renderQuality: "high",
  },
  personality: {
    warmth: 0.9,
    energy: 0.55,
    formality: 0.2,
    openness: 0.8,
  },
};

const CORPORATE: AgentVisualIdentity = {
  colorPalette: {
    primary: [0.3, 0.45, 0.7], // Steel blue
    secondary: [0.25, 0.35, 0.55], // Dark navy
    warm: [0.5, 0.6, 0.75], // Warm slate
    cool: [0.2, 0.4, 0.7], // Deep blue
    alert: [0.85, 0.55, 0.3], // Amber alert
  },
  presence: {
    ambientIntensity: 0.6,
    particleDensity: 0.35,
    glowExtension: 80,
    breathingBaseRate: 0.17,
  },
  inhabitation: {
    dashboardInfluence: 0.4,
    elementResonance: false,
  },
  style: {
    category: "corporate",
    edgeStyle: "crisp",
    renderQuality: "standard",
  },
  personality: {
    warmth: 0.25,
    energy: 0.4,
    formality: 0.9,
    openness: 0.35,
  },
};

// Artistic is essentially the Argent default
const ARTISTIC: AgentVisualIdentity = { ...ARGENT_DEFAULT_IDENTITY };

const TECHNICAL: AgentVisualIdentity = {
  colorPalette: {
    primary: [0.2, 0.75, 0.85], // Cyan
    secondary: [0.15, 0.55, 0.7], // Teal
    warm: [0.3, 0.85, 0.6], // Electric green
    cool: [0.2, 0.6, 0.95], // Bright blue
    alert: [0.95, 0.6, 0.2], // Tech orange
  },
  presence: {
    ambientIntensity: 0.75,
    particleDensity: 0.7,
    glowExtension: 100,
    breathingBaseRate: 0.22,
  },
  inhabitation: {
    dashboardInfluence: 0.6,
    elementResonance: true,
  },
  style: {
    category: "technical",
    edgeStyle: "crisp",
    renderQuality: "high",
  },
  personality: {
    warmth: 0.4,
    energy: 0.8,
    formality: 0.5,
    openness: 0.55,
  },
};

// ── Exports ───────────────────────────────────────────────────────────────

export const IDENTITY_PRESETS: Record<IdentityStyleCategory, AgentVisualIdentity> = {
  minimal: MINIMAL,
  warm: WARM,
  corporate: CORPORATE,
  artistic: ARTISTIC,
  technical: TECHNICAL,
};

/** Preset display metadata for the ConfigPanel UI */
export const PRESET_META: Record<IdentityStyleCategory, { label: string; description: string }> = {
  minimal: { label: "Minimal", description: "Clean, quiet, understated" },
  warm: { label: "Warm", description: "Friendly, approachable" },
  corporate: { label: "Corporate", description: "Professional, precise" },
  artistic: { label: "Artistic", description: "Expressive, vivid" },
  technical: { label: "Technical", description: "Sharp, responsive" },
};

export function getPreset(name: IdentityStyleCategory): AgentVisualIdentity {
  return IDENTITY_PRESETS[name] ?? ARTISTIC;
}

/** Apply personality overrides to a preset base, returning a new identity */
export function applyPersonality(
  base: AgentVisualIdentity,
  personality: AgentVisualIdentity["personality"],
): AgentVisualIdentity {
  return { ...base, personality };
}
