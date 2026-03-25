/**
 * AEVPPresence — React component wrapping the WebGL2 ambient renderer.
 *
 * Bridges useAgentState() emotional data → colorMapping → WebGL2 renderer,
 * and drives dashboard climate CSS custom properties.
 * Phase 6: Integrates TonalPresenceEngine for audio presence.
 *
 * Supports two modes:
 *   - fill: expands to fill its parent container (use with absolute/relative parent)
 *   - fixed: explicit width/height in pixels
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { AgentVisualIdentity, AccessibilityConfig, AEVPRenderState } from "../aevp/types";
import type { AgentStateHook } from "../hooks/useAgentState";
import type { GestureEvent, GestureName } from "../types/agentState";
import { computeRenderState } from "../aevp/colorMapping";
import {
  updateDashboardClimate,
  clearDashboardClimate,
  updateElementResonance,
  clearElementResonance,
} from "../aevp/environment";
import { AEVPRenderer } from "../aevp/renderer";
import { TonalPresenceEngine } from "../aevp/tonalPresence";

// ── Gesture Overlay ────────────────────────────────────────────────────────
// Each gesture defines parameter shifts applied as temporary overlays.
// intensity scales the shift (0-1). Values are additive/multiplicative.

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function applyGestureOverlay(state: AEVPRenderState, gesture: GestureEvent): AEVPRenderState {
  const i = gesture.intensity;
  const s = { ...state };
  // Copy mutable color arrays
  s.coreColor = [...state.coreColor] as [number, number, number];
  s.glowColor = [...state.glowColor] as [number, number, number];

  const gestures: Record<GestureName, () => void> = {
    brighten: () => {
      s.glowIntensity = clamp(s.glowIntensity + 0.3 * i, 0, 1);
      s.coreColor = s.coreColor.map((c) => clamp(c + 0.15 * i, 0, 1)) as [number, number, number];
      s.formExpansion = clamp(s.formExpansion + 0.1 * i, 0, 0.95);
    },
    dim: () => {
      s.glowIntensity = clamp(s.glowIntensity - 0.25 * i, 0.1, 1);
      s.formExpansion = clamp(s.formExpansion - 0.1 * i, 0.2, 0.95);
      s.particleCount = Math.round(s.particleCount * (1 - 0.5 * i));
    },
    warm_up: () => {
      s.coreColor[0] = clamp(s.coreColor[0] + 0.15 * i, 0, 1);
      s.coreColor[2] = clamp(s.coreColor[2] - 0.1 * i, 0, 1);
      s.glowColor[0] = clamp(s.glowColor[0] + 0.1 * i, 0, 1);
    },
    cool_down: () => {
      s.coreColor[2] = clamp(s.coreColor[2] + 0.15 * i, 0, 1);
      s.coreColor[0] = clamp(s.coreColor[0] - 0.1 * i, 0, 1);
      s.glowColor[2] = clamp(s.glowColor[2] + 0.1 * i, 0, 1);
    },
    expand: () => {
      s.formExpansion = clamp(s.formExpansion + 0.2 * i, 0.2, 0.95);
      s.glowIntensity = clamp(s.glowIntensity + 0.1 * i, 0, 1);
    },
    contract: () => {
      s.formExpansion = clamp(s.formExpansion - 0.2 * i, 0.15, 0.95);
      s.particleSpeed = clamp(s.particleSpeed * (1 - 0.3 * i), 0.05, 2.5);
    },
    pulse: () => {
      s.pulseIntensity = clamp(s.pulseIntensity + 0.5 * i, 0, 1);
      s.breathingRate = s.breathingRate * (1 + 0.8 * i);
      s.wobble = clamp(s.wobble + 0.3 * i, 0, 1);
    },
    still: () => {
      s.pulseIntensity = s.pulseIntensity * (1 - 0.8 * i);
      s.wobble = s.wobble * (1 - 0.9 * i);
      s.particleSpeed = s.particleSpeed * (1 - 0.6 * i);
      s.breathingRate = s.breathingRate * (1 - 0.5 * i);
    },
    soften: () => {
      s.edgeCoherence = clamp(s.edgeCoherence - 0.3 * i, 0.1, 1);
      s.wobble = clamp(s.wobble + 0.15 * i, 0, 1);
    },
    sharpen: () => {
      s.edgeCoherence = clamp(s.edgeCoherence + 0.3 * i, 0.15, 1);
      s.wobble = clamp(s.wobble - 0.15 * i, 0, 1);
    },
  };

  const apply = gestures[gesture.gesture];
  if (apply) apply();
  return s;
}

interface AEVPPresenceProps {
  /** Fill the parent container (absolute positioning) */
  fill?: boolean;
  /** Fixed width in pixels (ignored when fill=true) */
  width?: number;
  /** Fixed height in pixels (ignored when fill=true) */
  height?: number;
  agentState: AgentStateHook;
  identity: AgentVisualIdentity;
  accessibilityConfig?: AccessibilityConfig;
  /** Callback to expose pre-speech cue function to parent */
  onPreSpeechCueReady?: (fn: () => void) => void;
  /** Callback to expose renderer's direct amplitude setter (bypasses React) */
  onAmplitudeTargetReady?: (setter: (v: number) => void) => void;
  /** Orb anchor Y in normalized canvas space (0 bottom, 1 top). */
  orbCenterY?: number;
  /** Pixel offsets applied to orb + particle composition only. */
  presenceOffsetX?: number;
  presenceOffsetY?: number;
  /** Additional scale applied to orb + particle composition only. */
  presenceScale?: number;
}

export function AEVPPresence({
  fill,
  width: fixedWidth,
  height: fixedHeight,
  agentState,
  identity,
  accessibilityConfig,
  onPreSpeechCueReady,
  onAmplitudeTargetReady,
  orbCenterY,
  presenceOffsetX = 0,
  presenceOffsetY = 0,
  presenceScale = 1,
}: AEVPPresenceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AEVPRenderer | null>(null);
  const tonalRef = useRef<TonalPresenceEngine | null>(null);
  const prevMoodRef = useRef<string>("");
  const [size, setSize] = useState<{ w: number; h: number }>({
    w: fixedWidth ?? 450,
    h: fixedHeight ?? 750,
  });
  const resolvedOrbCenterY = Math.max(0, Math.min(1, orbCenterY ?? 0.65));

  // Measure container when in fill mode
  const measureContainer = useCallback(() => {
    if (!fill || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize((prev) => {
        if (prev.w === Math.round(rect.width) && prev.h === Math.round(rect.height)) return prev;
        return { w: Math.round(rect.width), h: Math.round(rect.height) };
      });
    }
  }, [fill]);

  // ResizeObserver for fill mode
  useEffect(() => {
    if (!fill || !containerRef.current) return;
    measureContainer();
    const ro = new ResizeObserver(measureContainer);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [fill, measureContainer]);

  // Update size from props in fixed mode
  useEffect(() => {
    if (!fill && fixedWidth && fixedHeight) {
      setSize({ w: fixedWidth, h: fixedHeight });
    }
  }, [fill, fixedWidth, fixedHeight]);

  // Mount/unmount renderer lifecycle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    console.log("[AEVP] AEVPPresence mounted, creating renderer", size.w, "x", size.h);
    const renderer = new AEVPRenderer(canvas);
    rendererRef.current = renderer;
    renderer.setOrbCenter(0.5, resolvedOrbCenterY);
    renderer.resize(size.w, size.h);
    renderer.start();

    // Expose direct amplitude setter so App.tsx can bypass React for 60fps updates
    onAmplitudeTargetReady?.((v) => rendererRef.current?.setSpeechAmplitude(v));

    return () => {
      console.log("[AEVP] AEVPPresence unmounting, destroying renderer");
      renderer.destroy();
      rendererRef.current = null;
      clearDashboardClimate();
      clearElementResonance();
    };
    // Only on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rendererRef.current?.setOrbCenter(0.5, resolvedOrbCenterY);
  }, [resolvedOrbCenterY]);

  useEffect(() => {
    rendererRef.current?.setPresenceTransform(presenceOffsetX, presenceOffsetY, presenceScale);
  }, [presenceOffsetX, presenceOffsetY, presenceScale]);

  // Phase 6: Tonal presence engine lifecycle
  useEffect(() => {
    const tonalConfig = accessibilityConfig?.tonalPresence;
    if (!tonalConfig?.enabled) {
      // Destroy if disabled
      tonalRef.current?.destroy();
      tonalRef.current = null;
      return;
    }

    // Create or update engine
    if (!tonalRef.current) {
      tonalRef.current = new TonalPresenceEngine(tonalConfig);
    } else {
      tonalRef.current.updateConfig(tonalConfig);
    }

    return () => {
      tonalRef.current?.destroy();
      tonalRef.current = null;
    };
  }, [accessibilityConfig?.tonalPresence]);

  // Expose pre-speech cue function to parent
  useEffect(() => {
    onPreSpeechCueReady?.(() => {
      tonalRef.current?.playPreSpeechCue();
    });
  }, [onPreSpeechCueReady]);

  // Resize renderer when dimensions change
  useEffect(() => {
    rendererRef.current?.resize(size.w, size.h);
  }, [size.w, size.h]);

  // Phase 7: Agent-requested particle formation writes
  useEffect(() => {
    if (!agentState.activeFormation) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.requestFormation(agentState.activeFormation);
  }, [agentState.activeFormation]);

  // Agent-requested symbolic particle behavior expressions
  useEffect(() => {
    if (!agentState.activeSymbol) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.requestSymbolExpression(agentState.activeSymbol);
  }, [agentState.activeSymbol]);

  // Update render state + dashboard climate + tonal when emotional/activity changes
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const reducedMotion = accessibilityConfig?.reducedMotion ?? false;

    let renderState = computeRenderState(
      agentState.emotional,
      agentState.activityState,
      identity,
      agentState.currentTool,
      agentState.currentToolCategory,
      agentState.isSpeaking,
      0, // amplitude fed directly to renderer via setSpeechAmplitude (bypasses React)
      reducedMotion,
    );

    // Phase 5+6: Apply gesture overlay if active
    if (agentState.activeGesture) {
      renderState = applyGestureOverlay(renderState, agentState.activeGesture);
    }

    console.log(
      "[AEVP] Render update — mood:",
      agentState.emotional.mood.state,
      "tool:",
      agentState.currentTool ?? "none",
      "→",
      renderState.toolCategory,
      "color:",
      renderState.coreColor.map((c) => c.toFixed(2)).join(","),
      "brightness:",
      renderState.glowIntensity.toFixed(2),
      "size:",
      renderState.formExpansion.toFixed(2),
      "squash:",
      renderState.squash.toFixed(2),
      "wobble:",
      renderState.wobble.toFixed(2),
    );
    renderer.updateState(renderState);

    if (identity.inhabitation.dashboardInfluence > 0) {
      updateDashboardClimate(agentState.emotional, identity.inhabitation.dashboardInfluence);
    }

    // Phase 3: Element resonance — glow related dashboard panels
    if (identity.inhabitation.elementResonance && renderState.resonanceTargets.length > 0) {
      updateElementResonance(renderState.resonanceTargets, agentState.emotional.arousal);
    } else {
      clearElementResonance();
    }

    // Phase 6: Tonal presence updates
    const tonal = tonalRef.current;
    if (tonal) {
      tonal.updateEmotional(agentState.emotional);
      tonal.updateBreathing(renderState.breathingRate);

      // Detect mood change → play chime
      const currentMood = agentState.emotional.mood.state;
      if (prevMoodRef.current && prevMoodRef.current !== currentMood) {
        tonal.playChime("mood");
      }
      prevMoodRef.current = currentMood;
    }
  }, [
    agentState.emotional,
    agentState.activityState,
    agentState.currentTool,
    agentState.currentToolCategory,
    agentState.isSpeaking,
    agentState.activeGesture,
    identity,
    accessibilityConfig?.reducedMotion,
  ]);

  if (fill) {
    return (
      <div ref={containerRef} style={{ position: "absolute", inset: 0, zIndex: 10 }}>
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          style={{ display: "block", width: "100%", height: "100%" }}
        />
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={fixedWidth}
      height={fixedHeight}
      style={{ display: "block", position: "relative", zIndex: 10 }}
    />
  );
}
