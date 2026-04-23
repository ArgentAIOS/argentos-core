/**
 * AEVP Phases 2-5 — Color Mapping
 *
 * Maps EmotionalState + AgentVisualIdentity → AEVPRenderState.
 * Each mood has a distinct visual profile: color, brightness, size, pulse, shape.
 * Phase 5 adds personality modulation (warmth, energy, formality, openness)
 * and reduced motion accessibility support.
 */

import type { EmotionalState, ActivityStateName } from "../types/agentState";
import type { AgentVisualIdentity, AEVPRenderState } from "./types";
import { classifyTool, getResonanceTargets } from "./toolCategories";
import { getMaxParticlesCap, getDensityScale } from "./pi-profile";

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// ── Per-Mood Visual Profiles ──────────────────────────────────────────────
// Each mood defines a distinct visual fingerprint across all dimensions:
//   color:      [r, g, b] 0-1 — the mood's signature tint
//   brightness: 0-1 — glow intensity (0 = dim, 1 = radiant)
//   size:       0-1 — orb expansion (0 = compact, 1 = large)
//   pulseRate:  multiplier on breathing/pulse speed (1 = normal)
//   edgeSoft:   0-1 — how soft/dissolved the edges are (0 = crisp, 1 = cloudy)
//   squash:     -1 to 1 — shape deformation (-1=tall, 0=circle, 1=wide)
//   wobble:     0 to 1 — organic blob movement intensity

interface MoodVisualProfile {
  color: [number, number, number];
  brightness: number;
  size: number;
  pulseRate: number;
  edgeSoft: number;
  squash: number;
  wobble: number;
}

const MOOD_VISUALS: Record<string, MoodVisualProfile> = {
  // ── Positive / Warm ──────────────────────────────────────────────
  happy: {
    color: [0.95, 0.75, 0.3],
    brightness: 0.85,
    size: 0.65,
    pulseRate: 1.3,
    edgeSoft: 0.15,
    squash: 0.12,
    wobble: 0.25,
  },
  excited: {
    color: [1.0, 0.55, 0.2],
    brightness: 0.95,
    size: 0.8,
    pulseRate: 1.8,
    edgeSoft: 0.2,
    squash: 0.05,
    wobble: 0.45,
  },
  joyful: {
    color: [1.0, 0.8, 0.35],
    brightness: 0.9,
    size: 0.7,
    pulseRate: 1.5,
    edgeSoft: 0.1,
    squash: 0.1,
    wobble: 0.3,
  },
  grateful: {
    color: [0.9, 0.7, 0.5],
    brightness: 0.75,
    size: 0.55,
    pulseRate: 0.8,
    edgeSoft: 0.1,
    squash: 0.05,
    wobble: 0.1,
  },
  proud: {
    color: [0.85, 0.6, 0.9],
    brightness: 0.8,
    size: 0.7,
    pulseRate: 1.0,
    edgeSoft: 0.1,
    squash: -0.1,
    wobble: 0.08,
  },
  content: {
    color: [0.85, 0.75, 0.45],
    brightness: 0.65,
    size: 0.5,
    pulseRate: 0.7,
    edgeSoft: 0.05,
    squash: 0.05,
    wobble: 0.06,
  },
  playful: {
    color: [0.95, 0.5, 0.7],
    brightness: 0.85,
    size: 0.65,
    pulseRate: 1.6,
    edgeSoft: 0.25,
    squash: 0.08,
    wobble: 0.35,
  },
  amused: {
    color: [0.9, 0.65, 0.4],
    brightness: 0.75,
    size: 0.55,
    pulseRate: 1.2,
    edgeSoft: 0.15,
    squash: 0.08,
    wobble: 0.2,
  },
  enthusiastic: {
    color: [1.0, 0.6, 0.25],
    brightness: 0.9,
    size: 0.75,
    pulseRate: 1.7,
    edgeSoft: 0.2,
    squash: 0.05,
    wobble: 0.4,
  },
  loving: {
    color: [0.95, 0.4, 0.55],
    brightness: 0.8,
    size: 0.6,
    pulseRate: 0.9,
    edgeSoft: 0.1,
    squash: 0.15,
    wobble: 0.2,
  },
  confident: {
    color: [0.8, 0.55, 0.95],
    brightness: 0.8,
    size: 0.7,
    pulseRate: 1.1,
    edgeSoft: 0.05,
    squash: -0.08,
    wobble: 0.06,
  },
  determined: {
    color: [0.85, 0.5, 0.85],
    brightness: 0.85,
    size: 0.75,
    pulseRate: 1.3,
    edgeSoft: 0.05,
    squash: -0.15,
    wobble: 0.08,
  },

  // ── Analytical / Cool ──────────────────────────────────────────
  focused: {
    color: [0.3, 0.55, 0.95],
    brightness: 0.7,
    size: 0.55,
    pulseRate: 1.2,
    edgeSoft: 0.05,
    squash: -0.2,
    wobble: 0.05,
  },
  curious: {
    color: [0.35, 0.65, 1.0],
    brightness: 0.75,
    size: 0.6,
    pulseRate: 1.4,
    edgeSoft: 0.2,
    squash: -0.1,
    wobble: 0.15,
  },
  analytical: {
    color: [0.25, 0.5, 0.9],
    brightness: 0.65,
    size: 0.5,
    pulseRate: 1.1,
    edgeSoft: 0.05,
    squash: -0.12,
    wobble: 0.04,
  },
  thoughtful: {
    color: [0.5, 0.45, 0.85],
    brightness: 0.6,
    size: 0.5,
    pulseRate: 0.8,
    edgeSoft: 0.15,
    squash: -0.05,
    wobble: 0.1,
  },
  contemplative: {
    color: [0.45, 0.4, 0.8],
    brightness: 0.55,
    size: 0.45,
    pulseRate: 0.6,
    edgeSoft: 0.2,
    squash: 0.0,
    wobble: 0.12,
  },
  reflective: {
    color: [0.4, 0.45, 0.75],
    brightness: 0.5,
    size: 0.4,
    pulseRate: 0.5,
    edgeSoft: 0.25,
    squash: 0.0,
    wobble: 0.08,
  },

  // ── Neutral / Silver ──────────────────────────────────────────
  neutral: {
    color: [0.7, 0.55, 0.9],
    brightness: 0.55,
    size: 0.45,
    pulseRate: 0.7,
    edgeSoft: 0.1,
    squash: 0.0,
    wobble: 0.08,
  },
  calm: {
    color: [0.6, 0.6, 0.85],
    brightness: 0.5,
    size: 0.4,
    pulseRate: 0.5,
    edgeSoft: 0.05,
    squash: 0.0,
    wobble: 0.05,
  },
  serene: {
    color: [0.55, 0.65, 0.85],
    brightness: 0.5,
    size: 0.4,
    pulseRate: 0.4,
    edgeSoft: 0.05,
    squash: 0.0,
    wobble: 0.04,
  },

  // ── Negative / Muted ──────────────────────────────────────────
  sad: {
    color: [0.3, 0.35, 0.65],
    brightness: 0.35,
    size: 0.3,
    pulseRate: 0.4,
    edgeSoft: 0.35,
    squash: -0.08,
    wobble: 0.03,
  },
  melancholy: {
    color: [0.35, 0.3, 0.6],
    brightness: 0.3,
    size: 0.3,
    pulseRate: 0.35,
    edgeSoft: 0.4,
    squash: -0.05,
    wobble: 0.03,
  },
  frustrated: {
    color: [0.9, 0.3, 0.2],
    brightness: 0.8,
    size: 0.7,
    pulseRate: 1.8,
    edgeSoft: 0.3,
    squash: 0.0,
    wobble: 0.55,
  },
  anxious: {
    color: [0.8, 0.45, 0.25],
    brightness: 0.7,
    size: 0.55,
    pulseRate: 2.0,
    edgeSoft: 0.5,
    squash: 0.0,
    wobble: 0.4,
  },
  concerned: {
    color: [0.75, 0.5, 0.3],
    brightness: 0.6,
    size: 0.5,
    pulseRate: 1.3,
    edgeSoft: 0.3,
    squash: -0.05,
    wobble: 0.2,
  },
  embarrassed: {
    color: [0.85, 0.45, 0.55],
    brightness: 0.55,
    size: 0.4,
    pulseRate: 1.5,
    edgeSoft: 0.4,
    squash: 0.05,
    wobble: 0.25,
  },
  vulnerable: {
    color: [0.55, 0.4, 0.7],
    brightness: 0.45,
    size: 0.35,
    pulseRate: 0.9,
    edgeSoft: 0.45,
    squash: -0.03,
    wobble: 0.15,
  },

  // ── Alert / Surprise ──────────────────────────────────────────
  surprised: {
    color: [1.0, 0.7, 0.2],
    brightness: 0.9,
    size: 0.75,
    pulseRate: 2.2,
    edgeSoft: 0.35,
    squash: -0.15,
    wobble: 0.35,
  },
  uncertain: {
    color: [0.7, 0.5, 0.35],
    brightness: 0.5,
    size: 0.45,
    pulseRate: 1.4,
    edgeSoft: 0.55,
    squash: 0.0,
    wobble: 0.3,
  },
};

// Default profile for moods not in the table
const DEFAULT_VISUAL: MoodVisualProfile = MOOD_VISUALS.neutral;

function getMoodVisual(moodState: string): MoodVisualProfile {
  return MOOD_VISUALS[moodState.toLowerCase().trim()] ?? DEFAULT_VISUAL;
}

// ── Activity → visual modifiers ────────────────────────────────────────────

interface ActivityModifiers {
  pulseBoost: number;
  expansionBoost: number;
  particleSpeedMod: number;
  breathingMod: number;
}

const ACTIVITY_MODIFIERS: Record<ActivityStateName, ActivityModifiers> = {
  idle: { pulseBoost: 0, expansionBoost: 0, particleSpeedMod: 1.0, breathingMod: 1.0 },
  thinking: { pulseBoost: 0.2, expansionBoost: 0.1, particleSpeedMod: 1.3, breathingMod: 1.2 },
  working: { pulseBoost: 0.35, expansionBoost: 0.2, particleSpeedMod: 1.5, breathingMod: 1.4 },
  speaking: { pulseBoost: 0.25, expansionBoost: 0.15, particleSpeedMod: 1.2, breathingMod: 1.1 },
  listening: { pulseBoost: 0.1, expansionBoost: 0.05, particleSpeedMod: 0.8, breathingMod: 0.9 },
};

// ── Core mapping function ──────────────────────────────────────────────────

export function computeRenderState(
  emotional: EmotionalState,
  activityState: ActivityStateName,
  identity: AgentVisualIdentity,
  currentTool?: string,
  backendCategory?: string,
  _isSpeaking?: boolean,
  speechAmplitude?: number,
  reducedMotion?: boolean,
): AEVPRenderState {
  const { valence, arousal, uncertainty, mood } = emotional;
  const palette = identity.colorPalette;
  const presence = identity.presence;
  const activity = ACTIVITY_MODIFIERS[activityState] ?? ACTIVITY_MODIFIERS.idle;

  // Look up mood-specific visual profile
  const moodVis = getMoodVisual(mood.state);

  // Energy multiplier from mood.energy
  const energyMul = mood.energy === "high" ? 1.3 : mood.energy === "low" ? 0.7 : 1.0;

  // ── Color ──────────────────────────────────────────────────────────────
  // Start from the mood's signature color, then modulate with valence for warmth/coolness

  // Blend the mood color with the identity palette based on valence direction
  const valenceNorm = clamp((valence + 2) / 4, 0, 1); // -2..+2 → 0..1
  let coreColor: [number, number, number] = [...moodVis.color];

  // Tint toward palette warm/cool based on valence (±30% influence)
  if (valenceNorm < 0.4) {
    coreColor = lerpColor(coreColor, palette.cool, (0.4 - valenceNorm) * 0.75);
  } else if (valenceNorm > 0.6) {
    coreColor = lerpColor(coreColor, palette.warm, (valenceNorm - 0.6) * 0.75);
  }

  // Mix in alert color when uncertainty is high
  if (uncertainty > 0.3) {
    const alertBlend = (uncertainty - 0.3) * 1.43; // 0.3-1 → 0-1
    coreColor = lerpColor(coreColor, palette.alert, alertBlend * 0.5);
  }

  // ── Brightness (glow intensity) ────────────────────────────────────────
  // Mood sets the baseline, arousal adds energy, activity amplifies
  const glowIntensity = clamp(
    moodVis.brightness * presence.ambientIntensity * (0.7 + arousal * 0.3) * energyMul,
    0.2,
    1.0,
  );

  // ── Pulsating speed ────────────────────────────────────────────────────
  // Mood sets the baseline pulse rate, activity and arousal amplify
  let breathingRate =
    presence.breathingBaseRate *
    moodVis.pulseRate *
    activity.breathingMod *
    (0.8 + arousal * 0.4) *
    energyMul;

  // Breathing depth: deeper when calm, shallower when agitated
  const breathingDepth = clamp(
    0.7 - moodVis.pulseRate * 0.15 - arousal * 0.2 + (1 - uncertainty) * 0.15,
    0.2,
    0.9,
  );

  // Pulse intensity: mood baseline + arousal + activity
  let pulseIntensity = clamp(moodVis.pulseRate * 0.3 + arousal * 0.4 + activity.pulseBoost, 0, 1.0);

  // ── Size (form expansion) ──────────────────────────────────────────────
  // Mood sets the baseline size, arousal and activity add expansion
  let formExpansion = clamp(moodVis.size + arousal * 0.15 + activity.expansionBoost, 0.2, 0.95);

  // ── Edge coherence ─────────────────────────────────────────────────────
  // Mood softness + uncertainty dissolve edges
  let edgeCoherence = clamp(1 - moodVis.edgeSoft - uncertainty * 0.4, 0.15, 1.0);

  // ── Shape morphing ─────────────────────────────────────────────────────
  // Mood provides base squash/wobble, arousal modulates wobble
  const squash = clamp(moodVis.squash, -1, 1);
  let wobble = clamp(moodVis.wobble + arousal * 0.1, 0, 1);

  // ── Particles ──────────────────────────────────────────────────────────
  let particleSpeed = clamp(
    (0.3 + arousal * 0.7) * moodVis.pulseRate * activity.particleSpeedMod * energyMul,
    0.1,
    2.5,
  );

  // Pi profile: scale density + apply a hard cap on top of identity preset.
  const piCap = getMaxParticlesCap();
  const piScale = getDensityScale();
  const maxParticles = Math.min(
    piCap,
    Math.round(100 * presence.particleDensity * piScale),
  );
  let particleCount = Math.round(
    clamp(
      maxParticles * (0.3 + moodVis.brightness * 0.4 + arousal * 0.3) * energyMul,
      maxParticles === 0 ? 0 : Math.min(5, maxParticles),
      maxParticles,
    ),
  );

  // Phase 3: Tool category — prefer backend classification (context-aware),
  // fall back to dashboard-side name-only classification
  const toolCategory =
    (backendCategory as import("./toolCategories").ToolCategory) ?? classifyTool(currentTool);
  const resonanceTargets = getResonanceTargets(toolCategory);

  // ── Phase 5: Personality modulation (subtle ±15-25% shifts) ──────────────
  const p = identity.personality;

  // Warmth → shift color temperature (warm tint when high, cool tint when low)
  const warmthShift = (p.warmth - 0.5) * 0.25; // ±0.125
  const warmTint: [number, number, number] = [
    clamp(coreColor[0] + warmthShift * 0.4, 0, 1),
    clamp(coreColor[1] + warmthShift * 0.1, 0, 1),
    clamp(coreColor[2] - warmthShift * 0.3, 0, 1),
  ];
  coreColor = warmTint;

  // Energy → scale animation speed + particle density (0.8x to 1.2x)
  const energyScale = 0.8 + p.energy * 0.4;
  breathingRate *= energyScale;
  particleSpeed = clamp(particleSpeed * energyScale, 0.1, 2.5);
  particleCount = Math.round(
    clamp(
      particleCount * (0.7 + p.energy * 0.6),
      maxParticles === 0 ? 0 : Math.min(3, maxParticles),
      maxParticles,
    ),
  );

  // Formality → edge crispness (higher formality → crisper edges)
  const formalityEdge = p.formality * 0.2; // 0 to 0.2 bonus
  edgeCoherence = clamp(edgeCoherence + formalityEdge, 0.15, 1.0);

  // Openness → form expansion baseline (higher → larger resting size)
  const openBoost = (p.openness - 0.5) * 0.15; // ±0.075
  formExpansion = clamp(formExpansion + openBoost, 0.2, 0.95);

  // ── Phase 6: Reduced motion override ─────────────────────────────────────
  if (reducedMotion) {
    particleCount = 0;
    pulseIntensity = 0;
    wobble = 0;
    particleSpeed = 0;
    // Slow breathing to near-static
    breathingRate = Math.min(breathingRate, 0.08);
  }

  return {
    coreColor,
    glowColor: lerpColor(coreColor, palette.secondary, 0.3), // Recompute after warmth tint
    glowIntensity,
    breathingRate,
    breathingDepth,
    pulseIntensity,
    edgeCoherence,
    formExpansion,
    squash,
    wobble,
    speechAmplitude: speechAmplitude ?? 0,
    particleSpeed,
    particleCount,
    toolCategory,
    resonanceTargets,
  };
}
