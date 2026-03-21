/**
 * AEVP (Agent Expressive Visual Presence) — Dashboard-Side Types
 *
 * Mirror of src/infra/aevp-types.ts for the dashboard (no backend imports).
 * Consumed by useAgentState() hook and any renderer.
 */

// ── Viseme ───────────────────────────────────────────────────────────────────

export type VisemeCategory = "rest" | "open" | "round" | "wide" | "closed" | "teeth";

// ── Mood ────────────────────────────────────────────────────────────────────

export interface Mood {
  state: string;
  energy: "low" | "medium" | "high";
}

// ── Identity Link ───────────────────────────────────────────────────────────

export interface IdentityLink {
  entity: string;
  role: "subject" | "mentioned" | "about" | "collaborator";
  relevance?: string;
}

// ── Normalized Agent State ──────────────────────────────────────────────────

export interface NormalizedAgentState {
  // Emotional (from SIS — authoritative)
  valence: number; // -2 to +2
  arousal: number; // 0 to 1
  mood: Mood;
  uncertainty: number; // 0 to 1
  identityResonance: number; // 0 to 1

  // Activity
  activityState: ActivityStateName;
  currentTool?: string;

  // Voice (rendering detail)
  currentPhoneme?: string;
  speechAmplitude: number;
  isSpeaking: boolean;

  // Context
  userPresent: boolean;
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
}

// ── WebSocket Event Payloads ────────────────────────────────────────────────

export interface EpisodeEvent {
  type: "episode_captured";
  id: string;
  ts: string;
  episodeType: string;
  mood: Mood;
  valence: number;
  arousal: number;
  uncertainty?: string;
  identityLinks: IdentityLink[];
  outcome: { result: string; summary: string };
  success: boolean;
}

export interface MoodTransitionEvent {
  type: "mood_transition";
  from: { state: string; energy: string };
  to: { state: string; energy: string };
  valence: number;
  arousal: number;
  timestamp: number;
}

export type ActivityStateName = "idle" | "thinking" | "working" | "speaking" | "listening";

export interface ActivityEvent {
  type: "activity_state";
  state: ActivityStateName;
  tool?: string;
  category?: string;
  reason?: string;
  timestamp: number;
}

// ── Emotional State (internal to useAgentState) ─────────────────────────────

export interface EmotionalState {
  mood: Mood;
  valence: number;
  arousal: number;
  uncertainty: number;
  identityResonance: number;
}

export const DEFAULT_EMOTIONAL: EmotionalState = {
  mood: { state: "neutral", energy: "medium" },
  valence: 0,
  arousal: 0.2,
  uncertainty: 0,
  identityResonance: 0,
};

// ── Visual Presence Events (Phase 5+6 — agent-initiated) ──────────────────

export type GestureName =
  | "brighten"
  | "dim"
  | "warm_up"
  | "cool_down"
  | "expand"
  | "contract"
  | "pulse"
  | "still"
  | "soften"
  | "sharpen";

export interface GestureEvent {
  type: "gesture";
  gesture: GestureName;
  intensity: number; // 0-1
  durationMs: number; // ms before decay
  timestamp: number;
}

export interface SetIdentityEvent {
  type: "set_identity";
  preset?: string;
  warmth?: number;
  energy?: number;
  formality?: number;
  openness?: number;
  timestamp: number;
}

export type FormationFont = "block" | "thin";

export interface FormationWriteEvent {
  type: "formation_write";
  text: string;
  durationMs: number;
  dissolveMs: number;
  font: FormationFont;
  scale: number;
  timestamp: number;
}

export type ArgentSymbolName = "presence" | "witnessing" | "bridging" | "holding" | "orienting";

export interface SymbolExpressEvent {
  type: "symbol_express";
  symbol: ArgentSymbolName;
  durationMs: number; // how long to hold the symbol behavior
  timestamp: number;
}

export type PresenceEvent =
  | GestureEvent
  | SetIdentityEvent
  | FormationWriteEvent
  | SymbolExpressEvent;
