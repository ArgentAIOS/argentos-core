/**
 * useAgentState — Unified agent state hook for AEVP Phase 1.
 *
 * Normalizes SIS emotional data, activity state, and voice state into a single
 * state object consumed by any renderer (Live2D today, WebGL AEVP in Phase 2+).
 *
 * Data sources:
 *   - aevp_episode events: SIS emotional state (authoritative mood/valence/arousal)
 *   - aevp_activity events: fine-grained activity substates (thinking/working/etc.)
 *   - [MOOD:name] text markers: legacy fallback when no SIS episode has been emitted
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { MoodName } from "../lib/moodSystem";
import type {
  EmotionalState,
  EpisodeEvent,
  ActivityEvent,
  ActivityStateName,
  IdentityLink,
  PresenceEvent,
  GestureEvent,
  SetIdentityEvent,
  FormationWriteEvent,
  SymbolExpressEvent,
} from "../types/agentState";
import { MOOD_ALIASES, MOODS } from "../lib/moodSystem";
import { DEFAULT_EMOTIONAL } from "../types/agentState";

// ── SIS Mood → MoodName mapping ────────────────────────────────────────────
// Reuses the comprehensive MOOD_ALIASES from moodSystem.ts (single source of truth)

export function mapSISMoodToMoodName(sisMood: string): MoodName {
  const lower = sisMood.toLowerCase().trim();
  // Exact match first
  if (MOODS[lower as MoodName]) return lower as MoodName;
  // Alias lookup
  return MOOD_ALIASES[lower] ?? "neutral";
}

// ── Identity Resonance ──────────────────────────────────────────────────────

function calcResonance(links: IdentityLink[]): number {
  if (!links || links.length === 0) return 0;
  // More identity links with strong relevance = higher resonance
  const subjectCount = links.filter((l) => l.role === "subject").length;
  const collaboratorCount = links.filter((l) => l.role === "collaborator").length;
  const total = links.length;
  // Weighted: subject links are most resonant
  const raw = subjectCount * 0.4 + collaboratorCount * 0.3 + total * 0.1;
  return Math.min(1, raw);
}

// ── AvatarState derivation ──────────────────────────────────────────────────

type AvatarState = "idle" | "thinking" | "working" | "success" | "error";

function deriveAvatarState(activity: ActivityStateName, isSpeaking: boolean): AvatarState {
  if (isSpeaking) return "idle"; // Live2D handles lip sync separately
  switch (activity) {
    case "thinking":
      return "thinking";
    case "working":
      return "working";
    case "speaking":
    case "listening":
    case "idle":
    default:
      return "idle";
  }
}

// ── Time of Day (used by Phase 2+ AEVP renderer) ───────────────────────────

export function getTimeOfDay(): "morning" | "afternoon" | "evening" | "night" {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

// ── Hook Return Type ────────────────────────────────────────────────────────

export interface AgentStateHook {
  /** Full normalized state (for Phase 2+ AEVP renderer) */
  emotional: EmotionalState;
  activityState: ActivityStateName;
  isSpeaking: boolean;
  /** Current tool name from aevp_activity events (Phase 3) */
  currentTool: string | undefined;
  /** Backend-classified tool category (Phase 3) */
  currentToolCategory: string | undefined;
  /** Live2D-compatible avatar state */
  avatarState: AvatarState;
  /** Live2D-compatible mood name (mapped from SIS mood) */
  moodName: MoodName;
  /** Whether SIS has provided at least one episode (vs. relying on text markers) */
  hasSISData: boolean;
  /** Accept a [MOOD:name] fallback from text parsing. rawMood is the original mood string before alias mapping. */
  applyTextMood: (mood: MoodName, rawMood?: string) => void;
  /** Override activity state (for external callers) */
  setActivityState: (state: ActivityStateName) => void;
  /** Toggle speaking state */
  setIsSpeaking: (speaking: boolean) => void;
  /** Speech amplitude (0-1) from audio analyser for orb pulse (ref-based, no re-renders) */
  speechAmplitude: number;
  /** Set speech amplitude (writes to ref, no React re-render) */
  setSpeechAmplitude: (v: number) => void;
  /** Active gesture from agent's visual_presence tool (Phase 5+6) */
  activeGesture: GestureEvent | null;
  /** Active particle formation request from visual_presence tool */
  activeFormation: FormationWriteEvent | null;
  /** Active symbolic behavior expression from visual_presence tool */
  activeSymbol: SymbolExpressEvent | null;
  /** Agent-requested identity change (consumed by App.tsx) */
  pendingIdentityChange: SetIdentityEvent | null;
  /** Clear the pending identity change after consuming it */
  clearPendingIdentityChange: () => void;
}

// ── MoodName → Approximate Emotional Parameters ──────────────────────────────
// Used as fallback when SIS episodes haven't arrived yet but [MOOD:name] text
// markers are present. Drives AEVP color mapping with approximate values.

interface MoodEmotionalParams {
  valence: number; // -2 to +2
  arousal: number; // 0 to 1
  uncertainty: number; // 0 to 1
  energy: "low" | "medium" | "high";
}

const MOOD_EMOTIONAL_PARAMS: Record<string, MoodEmotionalParams> = {
  // ── Canonical MoodNames ─────────────────────────────────────────────
  neutral: { valence: 0, arousal: 0.2, uncertainty: 0, energy: "medium" },
  happy: { valence: 1.2, arousal: 0.5, uncertainty: 0, energy: "medium" },
  excited: { valence: 1.5, arousal: 0.85, uncertainty: 0.1, energy: "high" },
  sad: { valence: -1.2, arousal: 0.15, uncertainty: 0.2, energy: "low" },
  frustrated: { valence: -1.0, arousal: 0.7, uncertainty: 0.4, energy: "high" },
  proud: { valence: 1.0, arousal: 0.4, uncertainty: 0, energy: "medium" },
  focused: { valence: 0.3, arousal: 0.6, uncertainty: 0.1, energy: "medium" },
  embarrassed: { valence: -0.5, arousal: 0.5, uncertainty: 0.6, energy: "low" },
  loving: { valence: 1.8, arousal: 0.4, uncertainty: 0, energy: "medium" },
  // ── Common SIS moods (before alias mapping) ─────────────────────────
  thoughtful: { valence: 0.3, arousal: 0.35, uncertainty: 0.15, energy: "medium" },
  curious: { valence: 0.6, arousal: 0.55, uncertainty: 0.2, energy: "medium" },
  contemplative: { valence: 0.2, arousal: 0.25, uncertainty: 0.1, energy: "low" },
  confident: { valence: 0.8, arousal: 0.45, uncertainty: 0, energy: "medium" },
  calm: { valence: 0.4, arousal: 0.15, uncertainty: 0, energy: "low" },
  anxious: { valence: -0.8, arousal: 0.7, uncertainty: 0.6, energy: "high" },
  surprised: { valence: 0.5, arousal: 0.8, uncertainty: 0.5, energy: "high" },
  concerned: { valence: -0.4, arousal: 0.4, uncertainty: 0.4, energy: "medium" },
  grateful: { valence: 1.4, arousal: 0.3, uncertainty: 0, energy: "medium" },
  playful: { valence: 1.0, arousal: 0.7, uncertainty: 0, energy: "high" },
  analytical: { valence: 0.2, arousal: 0.5, uncertainty: 0.1, energy: "medium" },
  determined: { valence: 0.6, arousal: 0.65, uncertainty: 0, energy: "high" },
  reflective: { valence: 0.1, arousal: 0.2, uncertainty: 0.15, energy: "low" },
  amused: { valence: 1.0, arousal: 0.5, uncertainty: 0, energy: "medium" },
  melancholy: { valence: -0.7, arousal: 0.15, uncertainty: 0.2, energy: "low" },
  uncertain: { valence: -0.2, arousal: 0.4, uncertainty: 0.7, energy: "medium" },
  enthusiastic: { valence: 1.3, arousal: 0.8, uncertainty: 0, energy: "high" },
  vulnerable: { valence: -0.3, arousal: 0.3, uncertainty: 0.5, energy: "low" },
};

// ── Hook ────────────────────────────────────────────────────────────────────

export function useAgentState(gateway: {
  connected: boolean;
  on: (event: string, handler: (payload: unknown) => void) => () => void;
}): AgentStateHook {
  const [emotional, setEmotional] = useState<EmotionalState>(DEFAULT_EMOTIONAL);
  const [activityState, setActivityState] = useState<ActivityStateName>("idle");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [hasSISData, setHasSISData] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | undefined>();
  const [currentToolCategory, setCurrentToolCategory] = useState<string | undefined>();
  // Speech amplitude uses a ref (not state) — updated at 60fps by the audio analyser.
  // React re-renders are not needed; the WebGL renderer reads this directly.
  const speechAmplitudeRef = useRef(0);
  const setSpeechAmplitude = useCallback((v: number) => {
    speechAmplitudeRef.current = v;
  }, []);

  // Phase 5+6: Agent-initiated visual presence
  const [activeGesture, setActiveGesture] = useState<GestureEvent | null>(null);
  const [activeFormation, setActiveFormation] = useState<FormationWriteEvent | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<SymbolExpressEvent | null>(null);
  const [pendingIdentityChange, setPendingIdentityChange] = useState<SetIdentityEvent | null>(null);
  const gestureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const symbolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track last text-marker mood separately — SIS overrides when available
  const textMoodRef = useRef<MoodName>("neutral");

  // Listen for aevp_episode events
  useEffect(() => {
    if (!gateway.connected) return;
    return gateway.on("aevp_episode", (payload) => {
      const ep = payload as EpisodeEvent;
      console.log(
        "[AEVP] Episode received:",
        ep.mood?.state,
        "valence:",
        ep.valence,
        "arousal:",
        ep.arousal,
      );
      setHasSISData(true);
      setEmotional({
        mood: ep.mood,
        valence: ep.valence,
        arousal: ep.arousal,
        uncertainty: ep.uncertainty ? 0.5 : 0,
        identityResonance: calcResonance(ep.identityLinks),
      });
    });
  }, [gateway.connected, gateway.on]);

  // Listen for aevp_activity events
  useEffect(() => {
    if (!gateway.connected) return;
    return gateway.on("aevp_activity", (payload) => {
      const act = payload as ActivityEvent;
      console.log(
        "[AEVP] Activity:",
        act.state,
        act.tool ? `(${act.tool} → ${act.category ?? "?"})` : "",
      );
      setActivityState(act.state);
      setCurrentTool(act.tool);
      setCurrentToolCategory(act.category);
    });
  }, [gateway.connected, gateway.on]);

  // Listen for aevp_presence events (agent-initiated visual expression)
  useEffect(() => {
    if (!gateway.connected) return;
    return gateway.on("aevp_presence", (payload) => {
      const evt = payload as PresenceEvent;

      if (evt.type === "gesture") {
        const gesture = evt as GestureEvent;
        console.log(
          "[AEVP] Gesture:",
          gesture.gesture,
          "intensity:",
          gesture.intensity,
          "duration:",
          gesture.durationMs,
        );
        setActiveGesture(gesture);

        // Clear gesture after duration (decay back to baseline)
        if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
        gestureTimerRef.current = setTimeout(() => {
          setActiveGesture(null);
          gestureTimerRef.current = null;
        }, gesture.durationMs);
      } else if (evt.type === "set_identity") {
        console.log("[AEVP] Identity change from agent:", evt);
        setPendingIdentityChange(evt as SetIdentityEvent);
      } else if (evt.type === "formation_write") {
        const formation = evt as FormationWriteEvent;
        console.log(
          "[AEVP] Formation:",
          formation.text,
          "duration:",
          formation.durationMs,
          "dissolve:",
          formation.dissolveMs,
          "font:",
          formation.font,
          "scale:",
          formation.scale,
        );
        setActiveFormation(formation);
      } else if (evt.type === "symbol_express") {
        const symbolEvt = evt as SymbolExpressEvent;
        console.log(
          "[AEVP] Symbol expression:",
          symbolEvt.symbol,
          "duration:",
          symbolEvt.durationMs,
        );
        setActiveSymbol(symbolEvt);

        if (symbolTimerRef.current) clearTimeout(symbolTimerRef.current);
        symbolTimerRef.current = setTimeout(() => {
          setActiveSymbol(null);
          symbolTimerRef.current = null;
        }, symbolEvt.durationMs);
      }
    });
  }, [gateway.connected, gateway.on]);

  const clearPendingIdentityChange = useCallback(() => {
    setPendingIdentityChange(null);
  }, []);

  // Track whether SIS data has arrived via ref (avoids stale closure in callback)
  const hasSISDataRef = useRef(false);
  hasSISDataRef.current = hasSISData;

  // Accept text-marker mood — ALWAYS updates emotional state for AEVP color changes.
  // rawMood is the original [MOOD:xxx] string before alias mapping to MoodName.
  // SIS episodes override when they arrive, but text markers are the primary signal
  // during active conversation (SIS episodes only come during contemplation cycles).
  const applyTextMood = useCallback((mood: MoodName, rawMood?: string) => {
    const rawKey = rawMood?.toLowerCase().trim();
    // Use raw mood name for richer lookup, fall back to canonical MoodName
    const moodState = rawKey || mood;
    const params =
      rawKey && MOOD_EMOTIONAL_PARAMS[rawKey]
        ? MOOD_EMOTIONAL_PARAMS[rawKey]
        : (MOOD_EMOTIONAL_PARAMS[mood] ?? MOOD_EMOTIONAL_PARAMS.neutral);

    textMoodRef.current = mood;

    setEmotional((prev) => {
      // Skip if nothing actually changed
      if (prev.mood.state === moodState && prev.valence === params.valence) return prev;

      console.log(
        "[AEVP] Text mood →",
        moodState,
        "valence:",
        params.valence,
        "arousal:",
        params.arousal,
        "hasSIS:",
        hasSISDataRef.current,
      );

      return {
        mood: { state: moodState, energy: params.energy },
        valence: params.valence,
        arousal: params.arousal,
        uncertainty: params.uncertainty,
        identityResonance: prev.identityResonance,
      };
    });
  }, []);

  // Derive MoodName: prefer SIS mood, fall back to text marker
  const moodName = hasSISData ? mapSISMoodToMoodName(emotional.mood.state) : textMoodRef.current;

  // Derive AvatarState for Live2D compatibility
  const avatarState = deriveAvatarState(activityState, isSpeaking);

  return {
    emotional,
    activityState,
    isSpeaking,
    currentTool,
    currentToolCategory,
    avatarState,
    moodName,
    hasSISData,
    applyTextMood,
    setActivityState,
    setIsSpeaking,
    speechAmplitude: speechAmplitudeRef.current,
    setSpeechAmplitude,
    activeGesture,
    activeFormation,
    activeSymbol,
    pendingIdentityChange,
    clearPendingIdentityChange,
  };
}
