/**
 * Mood Continuity — prevents jarring emotional flips between turns.
 *
 * Rules:
 * - Same mood or same valence family → accept immediately
 * - Cross-valence (positive ↔ negative) → blocked unless enough time has passed
 * - Neutral is a bridge → always accepted (and accepts transitions from)
 * - After N turns with no marker → decay to neutral
 */

import type { MoodName } from "./moodSystem.js";

const POSITIVE: ReadonlySet<MoodName> = new Set(["happy", "excited", "proud", "loving"]);
const NEGATIVE: ReadonlySet<MoodName> = new Set(["sad", "frustrated", "embarrassed"]);
// "neutral" and "focused" are neither — they act as bridges

interface MoodState {
  lastDisplayed: MoodName | null;
  lastChangedAt: number;
  turnsSinceChange: number;
}

const state: MoodState = {
  lastDisplayed: null,
  lastChangedAt: 0,
  turnsSinceChange: 0,
};

/** How many turns before cross-valence is allowed regardless */
const CROSS_VALENCE_COOLDOWN_TURNS = 2;

/** After this many turns with no explicit mood, drift to neutral */
const DECAY_TURNS = 4;

function isSameValenceFamily(a: MoodName, b: MoodName): boolean {
  if (POSITIVE.has(a) && POSITIVE.has(b)) return true;
  if (NEGATIVE.has(a) && NEGATIVE.has(b)) return true;
  return false;
}

function isBridge(mood: MoodName): boolean {
  return mood === "neutral" || mood === "focused";
}

/**
 * Apply continuity filter to a proposed mood change.
 * Call this with all parsed [MOOD:...] markers from a response (last one wins).
 * Returns the mood that should actually be displayed.
 */
export function applyMoodContinuity(proposedMoods: MoodName[], now: number = Date.now()): MoodName {
  // No markers in response → increment turn counter, maybe decay
  if (proposedMoods.length === 0) {
    state.turnsSinceChange++;
    if (
      state.turnsSinceChange >= DECAY_TURNS &&
      state.lastDisplayed &&
      !isBridge(state.lastDisplayed)
    ) {
      state.lastDisplayed = "neutral";
      state.lastChangedAt = now;
      state.turnsSinceChange = 0;
    }
    return state.lastDisplayed ?? "neutral";
  }

  const proposed = proposedMoods[proposedMoods.length - 1];

  // First mood ever → accept
  if (!state.lastDisplayed) {
    state.lastDisplayed = proposed;
    state.lastChangedAt = now;
    state.turnsSinceChange = 0;
    return proposed;
  }

  // Same mood → accept (no-op)
  if (proposed === state.lastDisplayed) {
    state.turnsSinceChange = 0;
    return proposed;
  }

  // Bridge moods (neutral, focused) → always accepted in either direction
  if (isBridge(proposed) || isBridge(state.lastDisplayed)) {
    state.lastDisplayed = proposed;
    state.lastChangedAt = now;
    state.turnsSinceChange = 0;
    return proposed;
  }

  // Same valence family → accept (happy → excited is natural)
  if (isSameValenceFamily(proposed, state.lastDisplayed)) {
    state.lastDisplayed = proposed;
    state.lastChangedAt = now;
    state.turnsSinceChange = 0;
    return proposed;
  }

  // Cross-valence → only allow after cooldown turns
  state.turnsSinceChange++;
  if (state.turnsSinceChange >= CROSS_VALENCE_COOLDOWN_TURNS) {
    state.lastDisplayed = proposed;
    state.lastChangedAt = now;
    state.turnsSinceChange = 0;
    return proposed;
  }

  // Block cross-valence → stay on current mood
  return state.lastDisplayed;
}

/**
 * Force-reset mood state (e.g. on session clear).
 */
export function resetMoodState(): void {
  state.lastDisplayed = null;
  state.lastChangedAt = 0;
  state.turnsSinceChange = 0;
}

/**
 * Get the current tracked mood (for external reads).
 */
export function getCurrentMoodState(): Readonly<MoodState> {
  return { ...state };
}
