/**
 * AEVP Phase 2 — Dashboard Environment Climate System
 *
 * Sets CSS custom properties on document.documentElement so the entire
 * dashboard subtly shifts color temperature with Argent's emotional state.
 * Effects are intentionally subtle (max ~15% influence) to avoid distraction.
 */

import type { EmotionalState } from "../types/agentState";

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Mood → glow base color (RGB 0-255) ─────────────────────────────────────

const MOOD_GLOW_COLORS: Record<string, [number, number, number]> = {
  // Positive / warm
  confident: [200, 180, 160],
  happy: [210, 185, 150],
  excited: [220, 175, 140],
  grateful: [195, 180, 175],
  proud: [200, 175, 185],
  playful: [210, 170, 190],

  // Analytical / cool
  curious: [150, 170, 210],
  focused: [140, 160, 200],
  analytical: [130, 155, 205],
  thoughtful: [145, 165, 200],

  // Neutral / silver
  neutral: [180, 175, 195],
  calm: [170, 175, 195],
  serene: [165, 175, 200],

  // Negative / muted
  frustrated: [200, 145, 130],
  anxious: [190, 155, 140],
  sad: [140, 150, 180],
  melancholy: [145, 150, 185],

  // Alert / amber
  surprised: [210, 170, 130],
  uncertain: [195, 160, 130],
  concerned: [190, 155, 135],
};

const DEFAULT_GLOW: [number, number, number] = [180, 175, 195]; // Silver-neutral

function getGlowBaseColor(moodState: string): [number, number, number] {
  const lower = moodState.toLowerCase().trim();
  return MOOD_GLOW_COLORS[lower] ?? DEFAULT_GLOW;
}

// ── CSS Variable Names ──────────────────────────────────────────────────────

const VAR_WARMTH = "--aevp-climate-warmth";
const VAR_INTENSITY = "--aevp-climate-intensity";
const VAR_GLOW_COLOR = "--aevp-glow-color";
const VAR_GLOW_OPACITY = "--aevp-glow-opacity";

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Update dashboard climate CSS custom properties from emotional state.
 *
 * @param emotional - Current emotional state from useAgentState()
 * @param influence - 0-1 scaling factor (identity.inhabitation.dashboardInfluence)
 */
export function updateDashboardClimate(emotional: EmotionalState, influence: number): void {
  const { valence, arousal, mood } = emotional;
  const inf = clamp(influence, 0, 1);

  // ── Warmth (color temperature 4200-5800K, base 5000K) ──────────────
  // Positive valence → warmer (lower K), negative → cooler (higher K)
  // Arousal amplifies the effect
  const warmthShift = valence * 200 * (0.5 + arousal * 0.5);
  const warmth = clamp(5000 - warmthShift * inf, 4200, 5800);

  // ── Intensity (0 to 0.35) ──────────────────────────────────────────
  // Higher arousal = more visible; influence scales everything
  const intensity = clamp(lerp(0.05, 0.35, arousal) * inf, 0, 0.35);

  // ── Glow color (RGB string) ────────────────────────────────────────
  // Start from mood base color, tint toward warm/cool based on valence
  const base = getGlowBaseColor(mood.state);
  const valenceNorm = clamp((valence + 2) / 4, 0, 1); // -2..+2 → 0..1
  // Warm tint: push red up, blue down. Cool tint: push blue up, red down.
  const warmCoolShift = (valenceNorm - 0.5) * 60 * inf;
  const r = Math.round(clamp(base[0] + warmCoolShift, 0, 255));
  const g = Math.round(clamp(base[1], 0, 255));
  const b = Math.round(clamp(base[2] - warmCoolShift, 0, 255));

  // ── Glow opacity (0.04 to 0.20) ──────────────────────────────────
  // Scales with arousal and influence; visible at rest, strong when active
  const glowOpacity = clamp(lerp(0.04, 0.2, arousal) * inf, 0.04, 0.2);

  // ── Apply ──────────────────────────────────────────────────────────
  const root = document.documentElement.style;
  root.setProperty(VAR_WARMTH, String(Math.round(warmth)));
  root.setProperty(VAR_INTENSITY, intensity.toFixed(4));
  root.setProperty(VAR_GLOW_COLOR, `${r}, ${g}, ${b}`);
  root.setProperty(VAR_GLOW_OPACITY, glowOpacity.toFixed(4));
}

/**
 * Reset all AEVP climate CSS variables to remove environmental effects.
 */
export function clearDashboardClimate(): void {
  const root = document.documentElement.style;
  root.removeProperty(VAR_WARMTH);
  root.removeProperty(VAR_INTENSITY);
  root.removeProperty(VAR_GLOW_COLOR);
  root.removeProperty(VAR_GLOW_OPACITY);
}

// ── Phase 3: Element Resonance ──────────────────────────────────────────────

const RESONANCE_ATTR = "data-aevp-resonance";

/** Track elements with active resonance for efficient cleanup */
let activeResonanceElements: Element[] = [];

/**
 * Apply subtle glow to dashboard elements matching the resonance targets.
 * Sets data-aevp-resonance="active" and an inline box-shadow scaled by intensity.
 *
 * @param targets - CSS selectors for elements to resonate
 * @param intensity - 0-1 scaling (typically arousal)
 */
export function updateElementResonance(targets: string[], intensity: number): void {
  // Clear previous resonance first
  clearElementResonance();

  if (targets.length === 0) return;

  const selector = targets.join(", ");
  let elements: NodeListOf<Element>;
  try {
    elements = document.querySelectorAll(selector);
  } catch {
    return; // Invalid selector — graceful fallback
  }

  const glowColor =
    document.documentElement.style.getPropertyValue(VAR_GLOW_COLOR) || "180, 175, 195";
  const opacity = clamp(0.03 + intensity * 0.08, 0.03, 0.11);
  const spread = Math.round(10 + intensity * 15);

  activeResonanceElements = [];
  elements.forEach((el) => {
    el.setAttribute(RESONANCE_ATTR, "active");
    (el as HTMLElement).style.boxShadow =
      `0 0 ${spread}px rgba(${glowColor}, ${opacity.toFixed(3)})`;
    (el as HTMLElement).style.transition = "box-shadow 3s ease";
    activeResonanceElements.push(el);
  });
}

/**
 * Remove resonance attribute and glow from all previously affected elements.
 */
export function clearElementResonance(): void {
  for (const el of activeResonanceElements) {
    el.removeAttribute(RESONANCE_ATTR);
    (el as HTMLElement).style.boxShadow = "";
    (el as HTMLElement).style.transition = "";
  }
  activeResonanceElements = [];
}
