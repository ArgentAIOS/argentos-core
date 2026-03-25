import { Live2DModel } from "pixi-live2d-display/cubism4";
// Make PIXI globally available
import * as PIXI from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { loadConfig, getAllCustomizationParamIds } from "../lib/avatarConfig";
import { buildPresetConfig } from "../lib/avatarPresets";
import { getLive2dAssetPath } from "../lib/live2dAssets";
import {
  getMoodColor,
  type MoodName,
  MOODS,
  MOOD_POSE_PARAM_IDS,
  EXPRESSION_PARAM_IDS,
  getMood,
} from "../lib/moodSystem";
(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI;

// Prefer WebGL2 for better rendering support
PIXI.settings.PREFER_ENV = PIXI.ENV.WEBGL2;

// ── Clipping mask patch ──────────────────────────────────────────
// The Yiota Customizable VTuber v1.4 model has ~97 clipping masks total,
// which distributes to ~25 per channel. pixi-live2d-display only handles
// up to 16 per channel (4x4 grid). We patch setupLayoutBounds to support
// 5x5 (25), 6x6 (36) and arbitrary NxN grids.
let clippingPatched = false;

function patchClippingManager(model: Live2DModel) {
  if (clippingPatched) return;
  clippingPatched = true;

  try {
    const internalModel = model.internalModel as any;
    const renderer = internalModel?.renderer;
    const clippingManager = renderer?._clippingManager;
    if (!clippingManager) return;

    const proto = Object.getPrototypeOf(clippingManager);
    if (!proto.setupLayoutBounds) return;

    proto.setupLayoutBounds = function (usingClipCount: number) {
      const ColorChannelCount = 4;
      const div = ~~(usingClipCount / ColorChannelCount);
      const mod = usingClipCount % ColorChannelCount;
      let curClipIndex = 0;

      for (let channelNo = 0; channelNo < ColorChannelCount; channelNo++) {
        const layoutCount = div + (channelNo < mod ? 1 : 0);
        if (layoutCount === 0) continue;

        // Determine smallest NxN grid that fits layoutCount
        let gridSize: number;
        if (layoutCount <= 1) gridSize = 1;
        else if (layoutCount <= 4) gridSize = 2;
        else if (layoutCount <= 9) gridSize = 3;
        else if (layoutCount <= 16) gridSize = 4;
        else if (layoutCount <= 25) gridSize = 5;
        else if (layoutCount <= 36) gridSize = 6;
        else gridSize = Math.ceil(Math.sqrt(layoutCount));

        for (let i = 0; i < layoutCount; i++) {
          const cc = this._clippingContextListForMask[curClipIndex++];
          const xpos = ~~(i % gridSize);
          const ypos = ~~(i / gridSize);
          cc._layoutChannelNo = channelNo;
          cc._layoutBounds.x = xpos / gridSize;
          cc._layoutBounds.y = ypos / gridSize;
          cc._layoutBounds.width = 1.0 / gridSize;
          cc._layoutBounds.height = 1.0 / gridSize;
        }
      }
    };

    console.log("[Live2D] Patched clipping manager for extended mask support (>16 per channel)");
  } catch (e) {
    console.warn("[Live2D] Could not patch clipping manager:", e);
  }
}

// ── Multiply/Screen color patch ────────────────────────────────
// pixi-live2d-display v0.4.0 never reads per-drawable multiplyColors /
// screenColors from the Cubism 4 core model.  The HSB customization
// parameters (SkinHue, HairHue, etc.) produce multiply/screen colour
// data that the renderer silently ignores.  We patch the renderer's
// doDrawModel → drawMesh pipeline so that each drawable's multiply
// colour is folded into the per-draw modelColor before the shader
// uniform is set.
let colorPatched = false;

function patchRendererColors(model: Live2DModel) {
  if (colorPatched) return;
  colorPatched = true;

  try {
    const renderer = (model.internalModel as any)?.renderer;
    if (!renderer) return;

    const _model = renderer.getModel?.();
    if (!_model) return;

    // Store original drawMesh
    const origDrawMesh = renderer.drawMesh.bind(renderer);

    // We'll store current drawable index during the draw loop
    let currentDrawableIndex = -1;

    // Override drawMesh to incorporate per-drawable multiply/screen colors
    renderer.drawMesh = function (
      textureNo: number,
      indexCount: number,
      vertexCount: number,
      indexArray: any,
      vertexArray: any,
      uvArray: any,
      opacity: number,
      colorBlendMode: number,
      invertedMask: boolean,
    ) {
      if (currentDrawableIndex >= 0) {
        // Read multiply color from Cubism core model drawables
        const coreModel = (model.internalModel as any)?.coreModel;
        const drawables = coreModel?._model?.drawables;
        if (drawables?.multiplyColors) {
          const mc = drawables.multiplyColors;
          const sc = drawables.screenColors;
          const off = currentDrawableIndex * 4;
          const mr = mc[off],
            mg = mc[off + 1],
            mb = mc[off + 2];
          const sr = sc[off],
            sg = sc[off + 1],
            sb = sc[off + 2];

          // If drawable has non-default multiply or screen color, fold into model color
          const hasMultiply = mr !== 1 || mg !== 1 || mb !== 1;
          const hasScreen = sr !== 0 || sg !== 0 || sb !== 0;

          if (hasMultiply || hasScreen) {
            // Save and modify the model color
            const origColor = this.getModelColor();
            const savedR = origColor.R,
              savedG = origColor.G;
            const savedB = origColor.B,
              savedA = origColor.A;

            // Apply multiply color to model color
            // Formula: finalColor = texColor * multiplyColor * modelColor + screenColor
            // We fold multiply into modelColor; screen is approximated by adding to RGB
            origColor.R = savedR * mr + sr * savedA;
            origColor.G = savedG * mg + sg * savedA;
            origColor.B = savedB * mb + sb * savedA;

            this.setModelColor(origColor.R, origColor.G, origColor.B, origColor.A);
            origDrawMesh(
              textureNo,
              indexCount,
              vertexCount,
              indexArray,
              vertexArray,
              uvArray,
              opacity,
              colorBlendMode,
              invertedMask,
            );

            // Restore original model color
            this.setModelColor(savedR, savedG, savedB, savedA);
            return;
          }
        }
      }
      // Default path — no color modification needed
      origDrawMesh(
        textureNo,
        indexCount,
        vertexCount,
        indexArray,
        vertexArray,
        uvArray,
        opacity,
        colorBlendMode,
        invertedMask,
      );
    };

    // Override doDrawModel to track the current drawable index

    renderer.doDrawModel = function () {
      this.preDraw();
      if (this._clippingManager != null) {
        this._clippingManager.setupClippingContext(this.getModel(), this);
      }

      const drawableCount = this.getModel().getDrawableCount();
      const renderOrder = this.getModel().getDrawableRenderOrders();
      for (let i = 0; i < drawableCount; ++i) {
        const order = renderOrder[i];
        this._sortedDrawableIndexList[order] = i;
      }

      for (let i = 0; i < drawableCount; ++i) {
        const drawableIndex = this._sortedDrawableIndexList[i];
        if (!this.getModel().getDrawableDynamicFlagIsVisible(drawableIndex)) {
          continue;
        }

        this.setClippingContextBufferForDraw(
          this._clippingManager != null
            ? this._clippingManager.getClippingContextListForDraw()[drawableIndex]
            : null,
        );
        this.setIsCulling(this.getModel().getDrawableCulling(drawableIndex));

        // Store drawable index so drawMesh can read its colors
        currentDrawableIndex = drawableIndex;

        this.drawMesh(
          this.getModel().getDrawableTextureIndices(drawableIndex),
          this.getModel().getDrawableVertexIndexCount(drawableIndex),
          this.getModel().getDrawableVertexCount(drawableIndex),
          this.getModel().getDrawableVertexIndices(drawableIndex),
          this.getModel().getDrawableVertices(drawableIndex),
          this.getModel().getDrawableVertexUvs(drawableIndex),
          this.getModel().getDrawableOpacity(drawableIndex),
          this.getModel().getDrawableBlendMode(drawableIndex),
          this.getModel().getDrawableInvertedMaskBit(drawableIndex),
        );

        currentDrawableIndex = -1;
      }
    };

    console.log("[Live2D] Patched renderer for per-drawable multiply/screen color support");
  } catch (e) {
    console.warn("[Live2D] Could not patch renderer colors:", e);
  }
}

type AvatarState = "idle" | "thinking" | "working" | "success" | "error";

interface Live2DAvatarProps {
  state: AvatarState;
  mood?: MoodName;
  width?: number;
  height?: number;
  modelPath?: string;
  audioElement?: HTMLAudioElement | null;
  mode?: "full" | "bubble"; // full = full body, bubble = head only in circle
  zoomPreset?: "face" | "portrait" | "full" | "custom";
  customZoom?: number;
  debugPresets?: {
    full: { scale: number; x: number; y: number };
    portrait: { scale: number; x: number; y: number };
    face: { scale: number; x: number; y: number };
  };
  bubbleOffsetX?: number;
  bubbleOffsetY?: number;
  bubbleScale?: number;
}

const stateColors = {
  idle: "#FFD700",
  thinking: "#A855F7",
  working: "#22C55E",
  success: "#22C55E",
  error: "#EF4444",
};

const stateMotions: Record<AvatarState, string> = {
  idle: "Idle",
  thinking: "Idle",
  working: "Idle",
  success: "Idle",
  error: "Cry",
};

// Singleton to survive React StrictMode and HMR re-mounts
let globalApp: PIXI.Application | null = null;
let globalModel: Live2DModel | null = null;
let globalCanvas: HTMLCanvasElement | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let lipSyncAnimationId: number | null = null;
let initPromise: Promise<void> | null = null;
let initMode: string | null = null;
let initWidth: number | null = null;
let initHeight: number | null = null;

// Reset on HMR only
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    console.log("[Live2D] HMR dispose - cleaning up");
    if (lipSyncAnimationId) cancelAnimationFrame(lipSyncAnimationId);
    lipSyncAnimationId = null;
    globalModel = null;
    globalCanvas?.remove();
    globalCanvas = null;
    globalApp?.destroy(true, { children: true, texture: true, baseTexture: true });
    globalApp = null;
    initPromise = null;
    initMode = null;
    initWidth = null;
    initHeight = null;
    tickerRegistered = false;
    zoomTickerRegistered = false;
    moodTickerRegistered = false;
    zoomTarget = null;
    activeCustomization = {};
    currentMoodPose = {};
    targetMoodPose = {};
    activeMoodName = "neutral";
    clippingPatched = false;
    colorPatched = false;
  });
}

// Lip sync function using pre-created analyser (preferred - from TTS AudioContext)
function startLipSyncWithAnalyser(externalAnalyser: AnalyserNode) {
  if (!globalModel) return;

  // Stop any existing lip sync
  if (lipSyncAnimationId) {
    cancelAnimationFrame(lipSyncAnimationId);
    lipSyncAnimationId = null;
  }

  analyser = externalAnalyser;
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  // Animation loop for lip sync
  const animate = () => {
    if (!analyser || !globalModel) return;

    analyser.getByteFrequencyData(dataArray);

    // Get average volume (focus on lower frequencies for voice)
    let sum = 0;
    const voiceRange = Math.floor(dataArray.length * 0.3); // Lower 30% for voice
    for (let i = 0; i < voiceRange; i++) {
      sum += dataArray[i];
    }
    const average = sum / voiceRange;

    // Threshold - mouth stays closed for quiet sounds
    const threshold = 30;
    let mouthOpen = 0;

    if (average > threshold) {
      // Map volume above threshold to 0-0.8 range (don't go full open)
      mouthOpen = Math.min(0.8, ((average - threshold) / 100) * 0.8);
    }

    // Set mouth parameter
    try {
      const coreModel = (globalModel.internalModel as any).coreModel;
      if (coreModel && coreModel.setParameterValueById) {
        coreModel.setParameterValueById("ParamMouthOpenY", mouthOpen);
      }
    } catch (e) {
      console.warn("Could not set mouth parameter:", e);
    }

    lipSyncAnimationId = requestAnimationFrame(animate);
  };

  animate();
}

// Stop lip sync and close mouth
function stopLipSync() {
  if (lipSyncAnimationId) {
    cancelAnimationFrame(lipSyncAnimationId);
    lipSyncAnimationId = null;
  }
  // Close mouth
  try {
    const coreModel = (globalModel?.internalModel as any)?.coreModel;
    if (coreModel?.setParameterValueById) {
      coreModel.setParameterValueById("ParamMouthOpenY", 0);
    }
  } catch {}
}

// Legacy lip sync function - analyzes audio element directly
function startLipSync(audio: HTMLAudioElement) {
  if (!globalModel) return;

  // Create audio context if needed
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  // Resume if suspended
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  // Create analyser
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.5;

  // Connect audio to analyser
  const source = audioContext.createMediaElementSource(audio);
  source.connect(analyser);
  analyser.connect(audioContext.destination);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  // Animation loop for lip sync
  const animate = () => {
    if (!analyser || !globalModel) return;

    analyser.getByteFrequencyData(dataArray);

    // Get average volume (focus on lower frequencies for voice)
    let sum = 0;
    const voiceRange = Math.floor(dataArray.length * 0.3); // Lower 30% for voice
    for (let i = 0; i < voiceRange; i++) {
      sum += dataArray[i];
    }
    const average = sum / voiceRange;

    // Map to 0-1 range with some amplification
    const mouthOpen = Math.min(1, (average / 128) * 1.5);

    // Set mouth parameter
    try {
      const coreModel = (globalModel.internalModel as any).coreModel;
      if (coreModel && coreModel.setParameterValueById) {
        coreModel.setParameterValueById("ParamMouthOpenY", mouthOpen);
      }
    } catch (e) {
      console.warn("Could not set mouth parameter:", e);
    }

    lipSyncAnimationId = requestAnimationFrame(animate);
  };

  animate();

  // Stop when audio ends
  audio.addEventListener(
    "ended",
    () => {
      stopLipSync();
    },
    { once: true },
  );
}

// ── Avatar customization config ──────────────────────────────────
// The model's update loop (motions, physics) resets parameters every frame.
// We store the desired customization state and reapply it each frame via a ticker.

let activeCustomization: Record<string, number> = {};
let tickerRegistered = false;

/** Per-frame ticker callback — applies customization params after model update */
function customizationTicker() {
  if (!globalModel) return;
  const coreModel = (globalModel.internalModel as any)?.coreModel;
  if (!coreModel?.setParameterValueById) return;

  for (const [paramId, value] of Object.entries(activeCustomization)) {
    try {
      coreModel.setParameterValueById(paramId, value);
    } catch {}
  }
}

/** Register the per-frame ticker on the PIXI app */
function ensureTickerRegistered() {
  if (tickerRegistered || !globalApp) return;
  globalApp.ticker.add(customizationTicker);
  tickerRegistered = true;
}

/** Apply saved or preset config to the loaded model.
 *  If activeCustomization already has values (e.g., from before a mode-switch reinit),
 *  keep those in-memory values to avoid reverting unsaved changes.
 *  Only loads from localStorage if activeCustomization is empty. */
function applyAvatarConfig() {
  if (Object.keys(activeCustomization).length > 0) {
    // Preserve in-memory state across reinit (e.g., full→bubble→full)
    ensureTickerRegistered();
    console.log("[Live2D] Preserved in-memory avatar config across reinit");
    return;
  }
  // Load saved config, fallback to professional preset
  const saved = loadConfig();
  const config = saved ?? buildPresetConfig("professional");
  activeCustomization = { ...config.parameters };
  ensureTickerRegistered();
  console.log("[Live2D] Applied avatar config from localStorage, preset:", config.presetId);
}

/** Apply arbitrary parameters to the live model (called by AvatarCustomizer in real-time) */
function applyCustomization(params: Record<string, number>) {
  // Merge into active customization state (applied every frame by ticker)
  Object.assign(activeCustomization, params);
  ensureTickerRegistered();
}

/** Reset all customization parameters to 0 before applying new config */
function resetCustomizationParams() {
  const zeroed: Record<string, number> = {};
  for (const paramId of getAllCustomizationParamIds()) {
    zeroed[paramId] = 0;
  }
  activeCustomization = zeroed;
}

/** Get all model parameters with their ranges (for debugging/inspection) */
function getModelParameters(): Record<
  string,
  { value: number; min: number; max: number; default: number }
> {
  if (!globalModel) return {};
  const coreModel = (globalModel.internalModel as any)?.coreModel;
  if (!coreModel) return {};

  const result: Record<string, { value: number; min: number; max: number; default: number }> = {};
  try {
    // Try Cubism 4 API first
    const count = coreModel.getParameterCount?.() ?? 0;
    for (let i = 0; i < count; i++) {
      const id = coreModel.getParameterId?.(i);
      if (id) {
        result[id] = {
          value: coreModel.getParameterValueByIndex?.(i) ?? 0,
          min: coreModel.getParameterMinimumValue?.(i) ?? -1,
          max: coreModel.getParameterMaximumValue?.(i) ?? 1,
          default: coreModel.getParameterDefaultValue?.(i) ?? 0,
        };
      }
    }

    // If count was 0, try accessing the internal _model directly
    if (count === 0 && coreModel._model) {
      const m = coreModel._model;
      const paramCount = m.parameters?.count ?? 0;
      const ids = m.parameters?.ids ?? [];
      const mins = m.parameters?.minimumValues;
      const maxs = m.parameters?.maximumValues;
      const defaults = m.parameters?.defaultValues;
      const values = m.parameters?.values;
      for (let i = 0; i < paramCount; i++) {
        result[ids[i]] = {
          value: values?.[i] ?? 0,
          min: mins?.[i] ?? -1,
          max: maxs?.[i] ?? 1,
          default: defaults?.[i] ?? 0,
        };
      }
    }
  } catch (e) {
    console.error("[Live2D] getModelParameters error:", e);
  }
  return result;
}

// ── Mood-driven pose system ───────────────────────────────────────
// Smoothly interpolates body parameters between moods each frame.
// The mood system replaces the old expression system with richer control.

let currentMoodPose: Record<string, number> = {}; // current interpolated pose values
let targetMoodPose: Record<string, number> = {}; // target pose from active mood
let moodTransitionSpeed = 0.08; // lerp factor per frame (derived from transitionMs)
let activeMoodName: MoodName = "neutral";

/** Per-frame ticker callback — smoothly interpolates pose parameters toward target */
function moodPoseTicker() {
  if (!globalModel) return;
  const coreModel = (globalModel.internalModel as any)?.coreModel;
  if (!coreModel?.setParameterValueById) return;

  // Safety net: ensure cursor tracking stays disabled when a mood is active.
  // The FocusController writes to the same ParamAngle* params we control.
  if (activeMoodName !== "neutral" && (globalModel as any).autoInteract) {
    (globalModel as any).autoInteract = false;
  }

  // When neutral, let the FocusController handle pose params (cursor tracking).
  // Only override pose params when a non-neutral mood is active.
  if (activeMoodName === "neutral") return;

  for (const paramId of MOOD_POSE_PARAM_IDS) {
    const target = targetMoodPose[paramId] ?? 0;
    const current = currentMoodPose[paramId] ?? 0;
    const next = current + (target - current) * moodTransitionSpeed;
    currentMoodPose[paramId] = next;
    try {
      coreModel.setParameterValueById(paramId, next);
    } catch {}
  }
}

/** Set the active mood — triggers expression + begins pose transition */
function setMood(mood: MoodName) {
  if (mood === activeMoodName) return;
  const config = getMood(mood);
  const prevMood = activeMoodName;
  activeMoodName = mood;

  console.log("[Live2D] Mood change:", prevMood, "→", mood);

  // Disable cursor tracking when mood is active — mood poses take full control
  // of ParamAngleX/Y/BodyAngleX/Y. The FocusController would fight our values.
  if (globalModel) {
    const isNeutral = mood === "neutral";
    (globalModel as any).autoInteract = isNeutral;
    // Reset focus controller target so it doesn't hold the last cursor position
    try {
      const fc = (globalModel.internalModel as any).focusController;
      if (fc) {
        fc.targetX = 0;
        fc.targetY = 0;
      }
    } catch {}
    console.log("[Live2D] Cursor tracking:", isNeutral ? "enabled" : "disabled (mood active)");
  }

  // Calculate lerp speed from transition duration (~60fps assumed)
  const frames = Math.max(1, (config.pose.transitionMs / 1000) * 60);
  moodTransitionSpeed = Math.min(1, 2.0 / frames); // asymptotic approach

  // Set target pose
  targetMoodPose = { ...config.pose.params };

  // Reset old expression params before applying new ones
  if (globalModel) {
    const coreModel = (globalModel.internalModel as any)?.coreModel;
    if (coreModel?.setParameterValueById) {
      for (const paramId of EXPRESSION_PARAM_IDS) {
        try {
          coreModel.setParameterValueById(paramId, 0);
        } catch {}
      }
    }
  }

  // Trigger expression
  if (globalModel) {
    try {
      if (config.expression.expressionIndex !== undefined) {
        globalModel.expression(config.expression.expressionIndex);
      }
      // Apply any additional expression params (e.g., BlushOn, TearsOn)
      if (config.expression.params) {
        const coreModel = (globalModel.internalModel as any)?.coreModel;
        if (coreModel?.setParameterValueById) {
          for (const [paramId, value] of Object.entries(config.expression.params)) {
            try {
              coreModel.setParameterValueById(paramId, value);
            } catch {}
          }
        }
      }
    } catch (e) {
      console.error("[Live2D] Mood expression error:", e);
    }
  }

  ensureMoodTickerRegistered();
}

let moodTickerRegistered = false;

function ensureMoodTickerRegistered() {
  if (moodTickerRegistered || !globalApp) return;
  globalApp.ticker.add(moodPoseTicker);
  moodTickerRegistered = true;
}

/** Get the current active mood name */
function getActiveMood(): MoodName {
  return activeMoodName;
}

// ── Legacy expression control (backwards compat) ─────────────────
// Maps old state-based expressions to the new mood system.
// Only used when no explicit mood is set by the AI.

function setExpression(expression: "neutral" | "thinking" | "happy" | "success" | "error") {
  console.log("[Live2D] setExpression called:", expression);
  // Map legacy expressions to moods for pose/expression
  switch (expression) {
    case "thinking":
      setMood("focused");
      break;
    case "happy":
      setMood("happy");
      break;
    case "success":
      setMood("proud");
      break;
    case "error":
      setMood("frustrated");
      break;
    case "neutral":
    default:
      setMood("neutral");
      break;
  }
}

// Test functions - call from console
if (typeof window !== "undefined") {
  (window as any).testExpression = (name: string) => {
    if (globalModel) {
      console.log("[Live2D] Testing expression:", name);
      try {
        globalModel.expression(name);
      } catch (e) {
        console.error("[Live2D] Test expression error:", e);
      }
    } else {
      console.log("[Live2D] No model loaded");
    }
  };

  // List available expressions
  (window as any).listExpressions = () => {
    if (globalModel) {
      const defs = (globalModel.internalModel as any)?.settings?.expressions;
      console.log("[Live2D] Available expressions:", defs);
    }
  };

  // Avatar customization control
  (window as any).argentAvatar = {
    applyCustomization,
    resetCustomizationParams,
    applyAvatarConfig,
    getModelParameters,
    setCustomizerZoom,
    setCustomizerZoomDebug,
    getAvatarPosition,
    getCustomizerZoomMap,
    setCustomizerZoomEntry,
    setAvatarPosition,
    setMood,
    getActiveMood,
    MOODS,
    // Debug: expose internal model references
    debugModel: () => {
      if (!globalModel) return { error: "no globalModel" };
      const im = globalModel.internalModel as any;
      const cm = im?.coreModel;
      if (!cm) return { error: "no coreModel" };
      return {
        model: globalModel,
        internalModel: im,
        coreModel: cm,
        _model: cm._model,
        renderer: im?.renderer,
      };
    },
    getParamRanges: (paramIds: string[]) => {
      if (!globalModel) return {};
      const cm = (globalModel.internalModel as any)?.coreModel;
      if (!cm?._model?.parameters) return {};
      const p = cm._model.parameters;
      const ids = Array.from(p.ids as string[]);
      const mins = p.minimumValues as Float32Array;
      const maxs = p.maximumValues as Float32Array;
      const defs = p.defaultValues as Float32Array;
      const vals = p.values as Float32Array;
      const result: Record<string, any> = {};
      for (const pid of paramIds) {
        const idx = ids.indexOf(pid);
        if (idx >= 0) {
          result[pid] = { min: mins[idx], max: maxs[idx], default: defs[idx], current: vals[idx] };
        } else {
          result[pid] = { error: "not found" };
        }
      }
      return result;
    },
  };
}

// Export for external use
export {
  startLipSync,
  startLipSyncWithAnalyser,
  stopLipSync,
  setExpression,
  setMood,
  getActiveMood,
  applyCustomization,
  resetCustomizationParams,
  getModelParameters,
  setCustomizerZoom,
  setCustomizerZoomDebug,
  getAvatarPosition,
  getCustomizerZoomMap,
  setCustomizerZoomEntry,
  setAvatarPosition,
};

// Zoom presets for different views
const zoomPresets = {
  full: { scale: 0.084, x: -26, y: -46 },
  portrait: { scale: 0.14, x: -60, y: -280 },
  face: { scale: 0.2, x: -100, y: -450 },
};

// ── Customizer context zoom ─────────────────────────────────────
// When the user switches customizer tabs, the avatar smoothly zooms
// to highlight the relevant body section.  Positions are persisted
// to localStorage so calibrated values survive refreshes.

const ZOOM_CALIBRATION_KEY = "argent-avatar-zoom-calibration";

/** Load calibrated zoom positions from localStorage */
function loadCalibratedZoom(): Record<string, { scale: number; x: number; y: number }> {
  try {
    const stored = localStorage.getItem(ZOOM_CALIBRATION_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return {};
}

/** Save calibrated zoom positions to localStorage */
function saveCalibratedZoom(map: Record<string, { scale: number; x: number; y: number }>) {
  try {
    localStorage.setItem(ZOOM_CALIBRATION_KEY, JSON.stringify(map));
  } catch {}
}

// Only use calibrated (user-locked) positions — no hardcoded defaults
let customizerZoomMap: Record<string, { scale: number; x: number; y: number }> =
  loadCalibratedZoom();

// Smooth zoom animation state
let zoomTarget: { scale: number; x: number; y: number } | null = null;
const ZOOM_LERP_SPEED = 0.08; // 0-1, higher = faster

/** Per-frame zoom animation — lerps model toward target position */
function zoomAnimationTicker() {
  if (!globalModel || !zoomTarget) return;

  const dx = zoomTarget.x - globalModel.x;
  const dy = zoomTarget.y - globalModel.y;
  const ds = zoomTarget.scale - globalModel.scale.x;

  // If close enough, snap and stop
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(ds) < 0.0001) {
    globalModel.x = zoomTarget.x;
    globalModel.y = zoomTarget.y;
    globalModel.scale.set(zoomTarget.scale);
    zoomTarget = null;
    return;
  }

  globalModel.x += dx * ZOOM_LERP_SPEED;
  globalModel.y += dy * ZOOM_LERP_SPEED;
  globalModel.scale.set(globalModel.scale.x + ds * ZOOM_LERP_SPEED);
}

let zoomTickerRegistered = false;

function ensureZoomTickerRegistered() {
  if (zoomTickerRegistered || !globalApp) return;
  globalApp.ticker.add(zoomAnimationTicker);
  zoomTickerRegistered = true;
}

/** Smoothly zoom the avatar to highlight a customizer section.
 *  Only zooms if the tab has a calibrated position.
 *  Uncalibrated tabs stay at the current position (no jump). */
function setCustomizerZoom(tabKey: string) {
  if (customizerZoomDebug) return; // Don't auto-zoom in calibration mode
  const target = customizerZoomMap[tabKey];
  if (!target) return; // No calibrated position — don't move
  zoomTarget = { ...target };
  ensureZoomTickerRegistered();
}

// ── Calibration debug mode ──────────────────────────────────────
// When enabled, auto-zoom is paused so the user can manually drag/scroll
// the model into the perfect position for each customizer tab.

let customizerZoomDebug = false;

/** Enable/disable calibration mode. When enabled, auto-zoom is paused. */
function setCustomizerZoomDebug(enabled: boolean) {
  customizerZoomDebug = enabled;
  if (enabled) {
    zoomTarget = null; // Cancel any in-progress animation
  }
}

/** Get the current model position (for calibration readout). */
function getAvatarPosition(): { scale: number; x: number; y: number } | null {
  if (!globalModel) return null;
  return {
    scale: globalModel.scale.x,
    x: Math.round(globalModel.x),
    y: Math.round(globalModel.y),
  };
}

/** Get the full customizerZoomMap (for displaying all current values). */
function getCustomizerZoomMap(): Record<string, { scale: number; x: number; y: number }> {
  return { ...customizerZoomMap };
}

/** Update a customizerZoomMap entry and persist to localStorage. */
function setCustomizerZoomEntry(tabKey: string, pos: { scale: number; x: number; y: number }) {
  customizerZoomMap[tabKey] = { ...pos };
  saveCalibratedZoom(customizerZoomMap);
}

/** Directly set model position/scale (for calibration sliders). No animation. */
function setAvatarPosition(pos: { scale: number; x: number; y: number }) {
  if (!globalModel) return;
  zoomTarget = null; // Cancel any animation
  globalModel.scale.set(pos.scale);
  globalModel.x = pos.x;
  globalModel.y = pos.y;
}

export function Live2DAvatar({
  state,
  mood,
  width = 400,
  height = 500,
  modelPath = loadConfig()?.modelPath ?? getLive2dAssetPath("yiota/yiota.model3.json"),
  audioElement,
  mode = "full",
  zoomPreset = "full",
  customZoom = 100,
  debugPresets,
  bubbleOffsetX = 0,
  bubbleOffsetY = 630,
  bubbleScale = 0.208,
}: Live2DAvatarProps) {
  // Use debug presets if provided, otherwise use defaults
  const activePresets = debugPresets || zoomPresets;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Debug mode: OFF - both modes locked
  const [debugMode, setDebugMode] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0, scale: 0 });
  const ringColor = stateColors[state];
  // Mood glow: when a mood is active, override the glow color with the mood's color
  const moodGlowColor = mood ? getMoodColor(mood) : null;
  const glowColor = moodGlowColor || ringColor;

  // For bubble mode, force square dimensions
  const canvasWidth = mode === "bubble" ? Math.min(width, height) - 32 : width;
  const canvasHeight = mode === "bubble" ? Math.min(width, height) - 32 : height;

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const needsReinit =
      initMode !== mode || initWidth !== canvasWidth || initHeight !== canvasHeight;

    // If singleton is already loaded and compatible, just reattach
    if (globalApp && globalModel && globalCanvas && !needsReinit) {
      console.log("[Live2D] Reusing existing singleton");
      if (!container.contains(globalCanvas)) {
        container.appendChild(globalCanvas);
      }
      setIsLoaded(true);
      setError(null);
      return;
    }

    // If already loading with same params, wait for it
    if (initPromise && !needsReinit) {
      console.log("[Live2D] Init already in progress, waiting...");
      initPromise.then(() => {
        if (globalCanvas && !container.contains(globalCanvas)) {
          container.appendChild(globalCanvas);
        }
        setIsLoaded(true);
        setError(null);
      });
      return;
    }

    // Need fresh init — destroy existing
    if (globalCanvas) {
      globalCanvas.remove();
      globalCanvas = null;
    }
    if (globalApp) {
      globalApp.destroy(true);
      globalApp = null;
    }
    globalModel = null;
    // CRITICAL: Reset ALL flags so they get re-applied on the new app/model.
    // Without this, the old callbacks/patches are destroyed with the old app
    // but the flags stay true, so nothing gets re-registered on the new app.
    tickerRegistered = false;
    zoomTickerRegistered = false;
    moodTickerRegistered = false;
    clippingPatched = false;
    colorPatched = false;

    // Track what we're initializing for
    initMode = mode;
    initWidth = canvasWidth;
    initHeight = canvasHeight;

    const init = async () => {
      try {
        console.log(
          "[Live2D] Starting fresh init, mode:",
          mode,
          "size:",
          canvasWidth,
          "x",
          canvasHeight,
        );
        // Create fresh app
        const app = new PIXI.Application({
          width: canvasWidth,
          height: canvasHeight,
          backgroundAlpha: 0,
          resolution: 1,
          antialias: true,
        });

        globalApp = app;
        globalCanvas = app.view as HTMLCanvasElement;
        globalCanvas.style.position = "absolute";
        globalCanvas.style.left = "0";
        globalCanvas.style.top = "0";
        container.appendChild(globalCanvas);

        // Load model with timeout
        console.log("[Live2D] Starting model load from:", modelPath);
        let model: Live2DModel;
        try {
          const loadPromise = Live2DModel.from(modelPath, { autoUpdate: true });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Model load timed out after 60s")), 60000),
          );
          model = await Promise.race([loadPromise, timeoutPromise]);
          console.log("[Live2D] Model load promise resolved");
        } catch (loadErr) {
          console.error("[Live2D] Model load failed:", loadErr);
          setError("Model load failed: " + String(loadErr));
          return;
        }

        // Verify app still exists (HMR could have destroyed it)
        if (!globalApp || !globalApp.stage) {
          console.error("[Live2D] App was destroyed during model load");
          setError("App destroyed during load");
          return;
        }
        globalModel = model;

        // Default state is neutral mood = cursor tracking ON.
        // autoInteract maps mouse position to ParamAngleX/Y/BodyAngleX/Y.
        // It gets disabled when a non-neutral mood is active (setMood handles this).
        (model as any).autoInteract = true;
        console.log("[Live2D] Cursor tracking enabled (default neutral state)");

        // Patch clipping manager to handle Yiota's high mask count
        patchClippingManager(model);

        // Patch renderer to support per-drawable multiply/screen colors (HSB)
        patchRendererColors(model);

        // Set anchor point to center for proper scaling
        model.anchor.set(0.5, 0.5);

        // Locked positions for full vs bubble mode
        if (mode === "full") {
          const preset =
            activePresets[zoomPreset === "custom" ? "full" : zoomPreset] || activePresets.full;
          const scale = zoomPreset === "custom" ? (customZoom / 100) * 0.084 : preset.scale;
          model.scale.set(scale);
          model.x = preset.x;
          model.y = preset.y;
        } else {
          model.scale.set(bubbleScale);
          model.x = canvasWidth / 2 + bubbleOffsetX;
          model.y = canvasHeight / 2 + bubbleOffsetY;
        }

        globalApp.stage.addChild(model);
        console.log("[Live2D] Model loaded, mode:", mode);

        // Apply saved avatar customization config
        applyAvatarConfig();

        // Enable dragging for positioning (trackpad friendly)
        model.interactive = true;
        model.cursor = "grab";

        let dragging = false;
        let dragOffset = { x: 0, y: 0 };

        model.on("pointerdown", (e: PIXI.InteractionEvent) => {
          dragging = true;
          model.cursor = "grabbing";
          const pos = e.data.global;
          dragOffset = { x: pos.x - model.x, y: pos.y - model.y };
        });

        model.on("pointermove", (e: PIXI.InteractionEvent) => {
          if (dragging) {
            const pos = e.data.global;
            model.x = pos.x - dragOffset.x;
            model.y = pos.y - dragOffset.y;
            setPosition({ x: Math.round(model.x), y: Math.round(model.y), scale: model.scale.x });
          }
        });

        model.on("pointerup", () => {
          dragging = false;
          model.cursor = "grab";
        });
        model.on("pointerupoutside", () => {
          dragging = false;
          model.cursor = "grab";
        });

        // Two-finger scroll/pinch to zoom (trackpad friendly)
        globalCanvas!.addEventListener(
          "wheel",
          (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.01 : 0.01;
            const newScale = Math.max(0.05, Math.min(1.0, model.scale.x + delta));
            model.scale.set(newScale);
            setPosition({ x: Math.round(model.x), y: Math.round(model.y), scale: newScale });
          },
          { passive: false },
        );

        setPosition({ x: Math.round(model.x), y: Math.round(model.y), scale: model.scale.x });

        try {
          model.motion("Idle");
        } catch {}

        setIsLoaded(true);
        setError(null);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("Live2D error:", err);
        console.error("Model path was:", modelPath);
        setError(errorMsg);
      } finally {
        initPromise = null;
      }
    };

    initPromise = init();

    // No cleanup — singleton persists across re-mounts.
    // Only HMR dispose (above) or mode/size changes trigger destruction.
  }, [modelPath, canvasWidth, canvasHeight, mode]);

  // ResizeObserver: resize PIXI canvas when container dimensions change
  // (happens when CanvasPanel slides in/out and causes layout reflow)
  useEffect(() => {
    if (!containerRef.current || !isLoaded) return;
    const container = containerRef.current;

    const observer = new ResizeObserver(() => {
      if (globalApp && globalCanvas) {
        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          globalApp.renderer.resize(rect.width, rect.height);
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [isLoaded]);

  // Handle audio element for lip sync
  useEffect(() => {
    if (audioElement && isLoaded) {
      const handlePlay = () => startLipSync(audioElement);
      audioElement.addEventListener("play", handlePlay);
      return () => audioElement.removeEventListener("play", handlePlay);
    }
  }, [audioElement, isLoaded]);

  // Handle AI-driven mood changes (takes priority over state-based expressions)
  useEffect(() => {
    if (!globalModel || !isLoaded || !mood) return;
    console.log("[Live2D] AI mood set:", mood);
    setMood(mood);
    ensureMoodTickerRegistered();
  }, [mood, isLoaded]);

  // Handle state-based motions and expressions (fallback when no AI mood is active)
  useEffect(() => {
    console.log("[Live2D] State changed to:", state, "isLoaded:", isLoaded);
    if (!globalModel || !isLoaded) return;

    // Trigger motion
    try {
      globalModel.motion(stateMotions[state]);
    } catch {}

    // Only use state-based expressions if no explicit AI mood is set
    if (!mood) {
      switch (state) {
        case "thinking":
          setExpression("thinking");
          break;
        case "working":
          setExpression("happy");
          break;
        case "success":
          setExpression("success");
          break;
        case "error":
          setExpression("error");
          break;
        case "idle":
        default:
          setExpression("neutral");
          break;
      }
    }
  }, [state, isLoaded, mood]);

  // Handle zoom changes (full mode)
  useEffect(() => {
    if (!isLoaded || !globalModel || mode !== "full") return;

    const preset =
      activePresets[zoomPreset === "custom" ? "full" : zoomPreset] || activePresets.full;
    const scale = zoomPreset === "custom" ? (customZoom / 100) * 0.084 : preset.scale;

    console.log("[Live2D] Zoom change:", zoomPreset, scale, "pos:", preset.x, preset.y);
    globalModel.scale.set(scale);
    globalModel.x = preset.x;
    globalModel.y = preset.y;
  }, [zoomPreset, customZoom, isLoaded, mode, activePresets]);

  // Handle bubble position changes (bubble mode)
  useEffect(() => {
    if (!isLoaded || !globalModel || mode !== "bubble") return;

    console.log("[Live2D] Bubble position change:", bubbleOffsetX, bubbleOffsetY, bubbleScale);
    globalModel.scale.set(bubbleScale);
    globalModel.x = canvasWidth / 2 + bubbleOffsetX;
    globalModel.y = canvasHeight / 2 + bubbleOffsetY;
    setPosition({ x: Math.round(globalModel.x), y: Math.round(globalModel.y), scale: bubbleScale });
  }, [bubbleOffsetX, bubbleOffsetY, bubbleScale, isLoaded, mode, canvasWidth, canvasHeight]);

  // Full body mode - no bubble, just the model
  if (mode === "full") {
    return (
      <div className="relative" style={{ width, height }}>
        {/* Live2D container */}
        <div ref={containerRef} className="absolute inset-0" style={{ width, height }}>
          {!isLoaded && !error && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {error && (
            <div className="w-full h-full flex flex-col items-center justify-center text-white/50">
              <span className="text-6xl mb-2">⚡</span>
              <span className="text-sm">{error}</span>
            </div>
          )}
        </div>

        {/* Mood aura — multi-layer glow around the entire avatar area */}
        {/* Layer 1: Wide outer aura (extends well beyond avatar) */}
        <div
          className="absolute pointer-events-none transition-all duration-1000"
          style={{
            inset: mood ? "-20px" : "0px",
            background: mood
              ? `radial-gradient(ellipse at center, ${glowColor}00 40%, ${glowColor}30 65%, ${glowColor}15 80%, transparent 100%)`
              : "none",
            borderRadius: "24px",
            filter: mood ? "blur(8px)" : "none",
          }}
        />
        {/* Layer 2: Inner glow border with solid color presence */}
        <div
          className="absolute pointer-events-none transition-all duration-700"
          style={{
            inset: "-2px",
            boxShadow: mood
              ? `inset 0 0 100px 30px ${glowColor}40, inset 0 0 250px 80px ${glowColor}20, 0 0 60px 15px ${glowColor}50, 0 0 120px 30px ${glowColor}25`
              : state !== "idle"
                ? `inset 0 0 60px 10px ${glowColor}15`
                : "none",
            borderRadius: "12px",
            border: mood ? `2px solid ${glowColor}80` : "none",
          }}
        />
        {/* Layer 3: Bottom accent bar — strong color wash */}
        <div
          className="absolute bottom-0 left-0 right-0 transition-all duration-500 pointer-events-none"
          style={{
            height: mood ? "60px" : "4px",
            background: mood
              ? `linear-gradient(to top, ${glowColor}80, ${glowColor}30, transparent)`
              : `linear-gradient(to top, ${glowColor}50, transparent)`,
            opacity: mood || state !== "idle" ? 1 : 0.3,
            borderRadius: "0 0 12px 12px",
          }}
        />

        {/* Debug overlay - trackpad friendly controls */}
        {debugMode && isLoaded && (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/90 text-green-400 font-mono text-xs px-4 py-3 rounded-lg flex flex-col items-center gap-3"
            style={{ zIndex: 100 }}
          >
            <div className="text-white/70">Drag model to move • Two-finger scroll to zoom</div>
            <div className="text-yellow-400">
              x: {position.x} | y: {position.y} | scale: {position.scale.toFixed(3)}
            </div>
            <div className="flex gap-1 flex-wrap justify-center">
              <button
                className="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white active:bg-gray-500 text-xs"
                onClick={() => {
                  if (globalModel) {
                    const newScale = Math.max(0.01, globalModel.scale.x - 0.01);
                    globalModel.scale.set(newScale);
                    setPosition((p) => ({ ...p, scale: newScale }));
                  }
                }}
              >
                −−
              </button>
              <button
                className="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white active:bg-gray-500 text-xs"
                onClick={() => {
                  if (globalModel) {
                    const newScale = Math.max(0.01, globalModel.scale.x - 0.002);
                    globalModel.scale.set(newScale);
                    setPosition((p) => ({ ...p, scale: newScale }));
                  }
                }}
              >
                −
              </button>
              <button
                className="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white active:bg-gray-500 text-xs"
                onClick={() => {
                  if (globalModel) {
                    const newScale = Math.min(1.0, globalModel.scale.x + 0.002);
                    globalModel.scale.set(newScale);
                    setPosition((p) => ({ ...p, scale: newScale }));
                  }
                }}
              >
                +
              </button>
              <button
                className="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white active:bg-gray-500 text-xs"
                onClick={() => {
                  if (globalModel) {
                    const newScale = Math.min(1.0, globalModel.scale.x + 0.01);
                    globalModel.scale.set(newScale);
                    setPosition((p) => ({ ...p, scale: newScale }));
                  }
                }}
              >
                ++
              </button>
              <button
                className="bg-purple-700 hover:bg-purple-600 px-2 py-1 rounded text-white active:bg-purple-500 text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(
                    `x: ${position.x}, y: ${position.y}, scale: ${position.scale.toFixed(4)}`,
                  );
                }}
              >
                📋
              </button>
            </div>
            <button
              className="text-white/50 hover:text-white text-xs"
              onClick={() => setDebugMode(false)}
            >
              Hide debug (update code to lock in position)
            </button>
          </div>
        )}
      </div>
    );
  }

  // Bubble mode - head in circle (for canvas/compact view)
  const size = Math.min(width, height);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Ring border — mood color overrides state color */}
      <div
        className="absolute inset-0 rounded-full transition-all duration-500"
        style={{
          border: `4px solid ${mood ? glowColor : glowColor + "80"}`,
          boxShadow: mood
            ? `0 0 40px 12px ${glowColor}70, 0 0 80px 24px ${glowColor}40, 0 0 120px 40px ${glowColor}20, inset 0 0 30px ${glowColor}50`
            : "none",
          animation: state !== "idle" || mood ? "pulse 2s ease-in-out infinite" : "none",
          zIndex: 1,
        }}
      />
      {/* Background */}
      <div
        className="absolute inset-4 rounded-full overflow-hidden"
        style={{ zIndex: 2, background: "rgba(30, 20, 50, 0.5)" }}
      />
      {/* Live2D container */}
      <div
        ref={containerRef}
        className="absolute inset-4 overflow-hidden rounded-full"
        style={{ width: canvasWidth, height: canvasHeight, zIndex: 3 }}
      >
        {!isLoaded && !error && (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-6xl">⚡</span>
          </div>
        )}
      </div>
      {/* Glow effect — mood-colored outer aura */}
      <div
        className="absolute rounded-full transition-all duration-500 pointer-events-none"
        style={{
          inset: mood ? "-20px" : "4px",
          background: mood
            ? `radial-gradient(circle, ${glowColor}60 0%, ${glowColor}35 40%, ${glowColor}15 65%, transparent 80%)`
            : `radial-gradient(circle, ${glowColor}15 0%, transparent 70%)`,
          filter: mood ? "blur(6px)" : "none",
          zIndex: 0,
        }}
      />

      {/* Debug overlay for bubble mode */}
      {debugMode && isLoaded && (
        <div
          className="absolute -bottom-32 left-1/2 -translate-x-1/2 bg-black/90 text-green-400 font-mono text-xs px-4 py-3 rounded-lg flex flex-col items-center gap-3"
          style={{ zIndex: 100, width: "280px" }}
        >
          <div className="text-white/70 text-center">
            Drag model to move • Two-finger scroll to zoom
          </div>
          <div className="text-yellow-400">
            x: {position.x} | y: {position.y} | scale: {position.scale.toFixed(4)}
          </div>
          <div className="flex gap-1 flex-wrap justify-center">
            <button
              className="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white active:bg-gray-500 text-xs"
              onClick={() => {
                if (globalModel) {
                  const newScale = Math.max(0.01, globalModel.scale.x - 0.01);
                  globalModel.scale.set(newScale);
                  setPosition((p) => ({ ...p, scale: newScale }));
                }
              }}
            >
              −−
            </button>
            <button
              className="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white active:bg-gray-500 text-xs"
              onClick={() => {
                if (globalModel) {
                  const newScale = Math.max(0.01, globalModel.scale.x - 0.002);
                  globalModel.scale.set(newScale);
                  setPosition((p) => ({ ...p, scale: newScale }));
                }
              }}
            >
              −
            </button>
            <button
              className="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white active:bg-gray-500 text-xs"
              onClick={() => {
                if (globalModel) {
                  const newScale = Math.min(1.0, globalModel.scale.x + 0.002);
                  globalModel.scale.set(newScale);
                  setPosition((p) => ({ ...p, scale: newScale }));
                }
              }}
            >
              +
            </button>
            <button
              className="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white active:bg-gray-500 text-xs"
              onClick={() => {
                if (globalModel) {
                  const newScale = Math.min(1.0, globalModel.scale.x + 0.01);
                  globalModel.scale.set(newScale);
                  setPosition((p) => ({ ...p, scale: newScale }));
                }
              }}
            >
              ++
            </button>
            <button
              className="bg-purple-700 hover:bg-purple-600 px-2 py-1 rounded text-white active:bg-purple-500 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(
                  `x: ${position.x}, y: ${position.y}, scale: ${position.scale.toFixed(4)}`,
                );
              }}
            >
              📋
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
