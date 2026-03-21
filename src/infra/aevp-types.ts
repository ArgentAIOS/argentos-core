/**
 * AEVP (Agent Expressive Visual Presence) — State Aggregator Types
 *
 * Defines the normalized agent state consumed by any renderer (Live2D, WebGL, etc.).
 * Backend-side types for WebSocket event payloads broadcast from the gateway.
 */

import type { Mood, IdentityLink } from "./episode-types.js";

// ── Normalized Agent State ──────────────────────────────────────────────────

export interface NormalizedAgentState {
  // Emotional (from SIS — authoritative)
  valence: number; // -2 to +2
  arousal: number; // 0 to 1
  mood: { state: string; energy: "low" | "medium" | "high" };
  uncertainty: number; // 0 to 1
  identityResonance: number; // 0 to 1

  // Activity
  activityState: "idle" | "thinking" | "working" | "speaking" | "listening";
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
  reason?: string;
  timestamp: number;
}

export type ArgentSymbolName = "presence" | "witnessing" | "bridging" | "holding" | "orienting";

export interface SymbolExpressEvent {
  type: "symbol_express";
  symbol: ArgentSymbolName;
  durationMs: number;
  timestamp: number;
}
