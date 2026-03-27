import { getLive2dAssetPath, normalizeLive2dModelPath } from "./live2dAssets";

/**
 * Avatar Configuration — Parameter registry, types, and persistence
 * for the Yiota Customizable VTuber v1.4 Live2D model.
 *
 * All ~200 customization parameters are mapped here from the CDI3 file.
 */

// ── Parameter types ──────────────────────────────────────────────

export type ParamType = "picker" | "hsb" | "slider" | "toggle";

export interface ParamDef {
  id: string;
  name: string;
  type: ParamType;
  min?: number;
  max?: number;
  step?: number;
  default?: number;
}

export interface ParamGroup {
  key: string;
  label: string;
  params: ParamDef[];
}

// ── Resolution ──────────────────────────────────────────────────

export type AvatarResolution = 2048 | 4096 | 8192;

export const RESOLUTION_OPTIONS: { value: AvatarResolution; label: string; size: string }[] = [
  { value: 2048, label: "2K", size: "~30 MB" },
  { value: 4096, label: "4K", size: "~89 MB" },
  { value: 8192, label: "8K", size: "~405 MB" },
];

const RESOLUTION_MODEL_PATHS: Record<AvatarResolution, string> = {
  2048: getLive2dAssetPath("yiota/yiota-2k.model3.json"),
  4096: getLive2dAssetPath("yiota/yiota.model3.json"),
  8192: getLive2dAssetPath("yiota/yiota-8k.model3.json"),
};

export function getModelPathForResolution(resolution: AvatarResolution): string {
  return RESOLUTION_MODEL_PATHS[resolution] ?? RESOLUTION_MODEL_PATHS[4096];
}

// ── Config interface ─────────────────────────────────────────────

export interface AvatarConfig {
  modelPath: string;
  resolution: AvatarResolution;
  presetId: string | null;
  parameters: Record<string, number>;
}

// ── Storage ──────────────────────────────────────────────────────

const STORAGE_KEY = "argent-avatar-config";

export function loadConfig(): AvatarConfig | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const config = JSON.parse(stored) as AvatarConfig;
      // Backwards-compat: add resolution if missing from older saves
      if (!config.resolution) {
        config.resolution = 4096;
        config.modelPath = getModelPathForResolution(4096);
      } else {
        config.modelPath = normalizeLive2dModelPath(config.modelPath);
      }
      return config;
    }
  } catch (e) {
    console.error("[AvatarConfig] Failed to load:", e);
  }
  return null;
}

export function saveConfig(config: AvatarConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("[AvatarConfig] Failed to save:", e);
  }
}

// ── Default zoom preference ─────────────────────────────────────

export type ZoomPreset = "face" | "portrait" | "full";

const ZOOM_PREF_KEY = "argent-avatar-default-zoom";

export function loadDefaultZoom(): ZoomPreset {
  try {
    const stored = localStorage.getItem(ZOOM_PREF_KEY);
    if (stored === "face" || stored === "portrait" || stored === "full") return stored;
  } catch {}
  return "full";
}

export function saveDefaultZoom(zoom: ZoomPreset) {
  try {
    localStorage.setItem(ZOOM_PREF_KEY, zoom);
  } catch {}
}

// ── Time-of-day preset assignments ──────────────────────────────

export type TimeSlot = "morning" | "evening" | "night";

export interface TimePresetConfig {
  morning: string; // preset ID for 5am-5pm
  evening: string; // preset ID for 5pm-10pm
  night: string; // preset ID for 10pm-5am
}

const TIME_PRESETS_KEY = "argent-avatar-time-presets";

const DEFAULT_TIME_PRESETS: TimePresetConfig = {
  morning: "professional",
  evening: "casual",
  night: "tech",
};

export function loadTimePresets(): TimePresetConfig {
  try {
    const stored = localStorage.getItem(TIME_PRESETS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<TimePresetConfig>;
      return { ...DEFAULT_TIME_PRESETS, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_TIME_PRESETS };
}

export function saveTimePresets(config: TimePresetConfig) {
  try {
    localStorage.setItem(TIME_PRESETS_KEY, JSON.stringify(config));
  } catch {}
}

/** Get the preset ID for the current time of day. */
export function getPresetForCurrentTime(): string {
  const hour = new Date().getHours();
  const tp = loadTimePresets();
  if (hour >= 5 && hour < 17) return tp.morning;
  if (hour >= 17 && hour < 22) return tp.evening;
  return tp.night;
}

// ── Bubble position preference ──────────────────────────────────

export interface BubbleConfig {
  offsetX: number;
  offsetY: number;
  scale: number;
}

const BUBBLE_CONFIG_KEY = "argent-avatar-bubble";

const DEFAULT_BUBBLE: BubbleConfig = { offsetX: 0, offsetY: 630, scale: 0.208 };

export function loadBubbleConfig(): BubbleConfig {
  try {
    const stored = localStorage.getItem(BUBBLE_CONFIG_KEY);
    if (stored) return { ...DEFAULT_BUBBLE, ...JSON.parse(stored) };
  } catch {}
  return { ...DEFAULT_BUBBLE };
}

export function saveBubbleConfig(config: BubbleConfig) {
  try {
    localStorage.setItem(BUBBLE_CONFIG_KEY, JSON.stringify(config));
  } catch {}
}

// ── Apply config to Live2D core model ────────────────────────────

export function applyConfig(coreModel: any, config: AvatarConfig) {
  if (!coreModel?.setParameterValueById) return;
  for (const [paramId, value] of Object.entries(config.parameters)) {
    try {
      coreModel.setParameterValueById(paramId, value);
    } catch {
      // Parameter may not exist on this model version
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function picker(id: string, name: string, min = 0, max = 10): ParamDef {
  return { id, name, type: "picker", min, max, step: 1, default: min };
}

function slider(id: string, name: string, min = 0, max = 1, step = 0.01, def = 0): ParamDef {
  return { id, name, type: "slider", min, max, step, default: def };
}

function toggle(id: string, name: string): ParamDef {
  return { id, name, type: "toggle", min: 0, max: 1, step: 1, default: 0 };
}

/** HSB group — Hue is 0..6, Saturation is -1..1, Brightness is -1..1 (from moc3 ranges) */
function hsbGroup(
  _prefix: string,
  label: string,
  hueId: string,
  satId: string,
  briId: string,
): ParamDef[] {
  return [
    { id: hueId, name: `${label} Hue`, type: "slider", min: 0, max: 6, step: 0.05, default: 0 },
    {
      id: satId,
      name: `${label} Saturation`,
      type: "slider",
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
    },
    {
      id: briId,
      name: `${label} Brightness`,
      type: "slider",
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
    },
  ];
}

// ── Parameter Registry ───────────────────────────────────────────

export const PARAMETER_REGISTRY: ParamGroup[] = [
  // ── Hair Options ── (picker ranges from moc3)
  {
    key: "hairOptions",
    label: "Hair Options",
    params: [
      picker("MiddleBangPicker", "Middle Bang", 1, 6),
      picker("SideBangPicker", "Side Bang", 1, 3),
      picker("SideHair1Picker", "Side Hair 1", 1, 3),
      picker("SideHair2Picker", "Side Hair 2", 0, 4),
      picker("AhogePicker", "Ahoge", 0, 2),
      picker("BackhairPicker", "Back Hair", 1, 10),
      picker("HairextrasPicker", "Hair Extras", 0, 4),
      picker("AnimalEarsPicker", "Animal Ears", 0, 6),
      picker("AnimalTailPicker", "Animal Tail", 0, 4),
      toggle("Param81", "Tail Up"),
      toggle("HairOff", "Hair OFF"),
    ],
  },

  // ── Hair Length ── (all -1..1 confirmed from moc3)
  {
    key: "hairLength",
    label: "Hair Length",
    params: [
      slider("MiddleBangLength", "Middle Bang Length", -1, 1),
      slider("Sidehair1Length", "Side Hair 1 Length", -1, 1),
      slider("Sidehair2Length", "Side Hair 2 Length", -1, 1),
      slider("BackhairLength", "Back Hair Length", -1, 1),
      slider("TwintailsLength", "Ponytail/Twintails Length", -1, 1),
      slider("HairExtrasPlacement", "Hair Extras Placement", -1, 1, 0.01, 1),
      slider("PonytailPlacement", "Ponytail Placement", 0, 1),
    ],
  },

  // ── Hair Colors ──
  {
    key: "hairColor",
    label: "Hair Colors",
    params: [
      ...hsbGroup("ahoge", "Ahoge", "AhogeHue", "AhogeSaturation", "AhogeBrightness"),
      ...hsbGroup(
        "mbL",
        "Middle Bang L",
        "MiddleBangLHue",
        "MiddleBangLSaturation",
        "MiddleBangLBrightness",
      ),
      ...hsbGroup(
        "mbR",
        "Middle Bang R",
        "MiddleBangRHue",
        "MiddleBangRSaturation",
        "MiddleBangRBrightness",
      ),
      ...hsbGroup(
        "sbL",
        "Side Bang L",
        "SideBangLHue",
        "SideBangLSaturation",
        "SideBangLBrightness",
      ),
      ...hsbGroup(
        "sbR",
        "Side Bang R",
        "SideBangRHue",
        "SideBangRSaturation",
        "SideBangRBrightness",
      ),
      ...hsbGroup(
        "sh1L",
        "Side Hair 1 L",
        "SideHair1LHue",
        "SideHair1LSaturation",
        "SideHair1LBrightness",
      ),
      ...hsbGroup(
        "sh1R",
        "Side Hair 1 R",
        "SideHair1RHue",
        "SideHair1RSaturation",
        "SideHair1RBrightness",
      ),
      ...hsbGroup(
        "sh2L",
        "Side Hair 2 L",
        "SideHair2LHue",
        "SideHair2LSaturation",
        "SideHair2LBrightness",
      ),
      ...hsbGroup(
        "sh2R",
        "Side Hair 2 R",
        "SideHair2RHue",
        "SideHair2RSaturation",
        "SideHair2RBrightness",
      ),
      ...hsbGroup(
        "bhL",
        "Back Hair L",
        "BackhairLHue",
        "BackhairLSaturation",
        "BackhairLBrightness",
      ),
      ...hsbGroup(
        "bhR",
        "Back Hair R",
        "BackhairRHue",
        "BackhairRSaturation",
        "BackhairRBrightness",
      ),
      ...hsbGroup(
        "bhI",
        "Back Hair Inner",
        "BackhairInnerHue",
        "BackhairInnerSaturation",
        "BackhairInnerBrightness",
      ),
      ...hsbGroup(
        "heL",
        "Hair Extras L",
        "HairExtrasLHue",
        "HairExtrasLSaturation",
        "HairExtrasLBrightness",
      ),
      ...hsbGroup(
        "heR",
        "Hair Extras R",
        "HairExtrasRHue",
        "HairExtrasRSaturation",
        "HairExtrasRBrightness",
      ),
      ...hsbGroup(
        "earR",
        "Animal Ear R",
        "AnimalEarRHue",
        "AnimalEarRSaturation",
        "AnimalEarRBrightness",
      ),
      ...hsbGroup(
        "earL",
        "Animal Ear L",
        "AnimalEarLHue",
        "AnimalEarLSaturation",
        "AnimalEarLBrightness",
      ),
      ...hsbGroup("tail", "Tail", "TailHie", "TailSaturation", "TailBrightness"),
    ],
  },

  // ── Head ── (ranges from moc3)
  {
    key: "head",
    label: "Head",
    params: [
      slider("FaceHeight", "Face Height", -25, 25, 0.5),
      picker("EarPicker", "Ear Type", 0, 2),
      picker("GlassesPicker", "Glasses", 0, 1),
      picker("HornsPicker", "Horns", 0, 3),
      slider("HornsHeight", "Horns Height", 0, 30, 0.5),
    ],
  },

  // ── Brows ── (moc3: height/length are -25..25)
  {
    key: "brows",
    label: "Brows",
    params: [
      slider("BrowHeight", "Brow Height", -25, 25, 0.5),
      slider("BrowLength", "Brow Length", -25, 25, 0.5),
      ...hsbGroup("browL", "Brow L", "BrowHueL", "BrowSaturationL", "BrowBrightnessL"),
      ...hsbGroup("browR", "Brow R", "BrowHueR", "BrowSaturationR", "BrowBrightnessR"),
    ],
  },

  // ── Eyes ── (moc3: pickers 0-6, curve/height -10..10, irisWidth -1..1)
  {
    key: "eyes",
    label: "Eyes",
    params: [
      picker("PupilPickerL", "Pupil L", 0, 6),
      picker("PupilPickerR", "Pupil R", 0, 6),
      slider("IrisWidth", "Iris Width", -1, 1),
      slider("EyeCurveNew", "Eye Curve", -10, 10, 0.2),
      slider("EyeHeightNEW", "Eye Height", -10, 10, 0.2),
      // Left eye colors
      ...hsbGroup(
        "pupilL",
        "Pupil L",
        "PupilHueL_NEW",
        "PupilSaturationLNew",
        "PupilBrightnessLNEW",
      ),
      ...hsbGroup(
        "irisMainL",
        "Iris Main L",
        "IrisMainLHue",
        "IrisMainSaturationL",
        "IrisMainBrightnessL",
      ),
      ...hsbGroup(
        "irisLowerL",
        "Iris Lower L",
        "IrisLowerHueL",
        "IrisLowerSaturationL",
        "IrisLowerBrightnessL",
      ),
      ...hsbGroup(
        "irisOuterL",
        "Iris Outer L",
        "IrisOuterHueL",
        "IrisOuterSaturationL",
        "IrisOuterBrightnessL",
      ),
      slider("ScleraHueL", "Sclera Hue L", 0, 6, 0.05),
      slider("ScleraDarknessL", "Sclera Darkness L", -1, 1),
      slider("LashesBrightnessL", "Lashes Brightness L", -1, 1),
      // Right eye colors
      ...hsbGroup(
        "pupilR",
        "Pupil R",
        "PupilHueR_NEW",
        "PupilSaturationRNew",
        "PupilBrightnessRNEW",
      ),
      ...hsbGroup(
        "irisMainR",
        "Iris Main R",
        "IrisMainRHue",
        "IrisMainSaturationR",
        "IrisMainBrightnessR",
      ),
      ...hsbGroup(
        "irisLowerR",
        "Iris Lower R",
        "IrisLowerHueR",
        "IrisLowerSaturationR",
        "IrisLowerBrightnessR",
      ),
      ...hsbGroup(
        "irisOuterR",
        "Iris Outer R",
        "IrisOuterHueR",
        "IrisOuterSaturationR",
        "IrisOuterBrightnessR",
      ),
      slider("ScleraHueR", "Sclera Hue R", 0, 6, 0.05),
      slider("ScleraDarknessR", "Sclera Darkness R", -1, 1),
      slider("LashesBrightnessR", "Lashes Brightness R", -1, 1),
      // Shared eye makeup
      slider("LashesTint", "Lashes Tint", 0, 6, 0.05),
      ...hsbGroup(
        "eyelinerUp",
        "Upper Eyeliner",
        "UpperEyelinerHue",
        "UpperEyelinerSaturation",
        "UpperEyelinerBrightness",
      ),
      ...hsbGroup(
        "eyeshadowUp",
        "Upper Eyeshadow",
        "UpperEyeshadowHue",
        "UpperEyeshadowSaturation",
        "UpperEyeshadowBrightness",
      ),
      ...hsbGroup(
        "eyelinerLo",
        "Lower Eyeliner",
        "LowerEyelinerHue",
        "LowerEyelinerSaturation",
        "LowerEyelinerBrightness",
      ),
    ],
  },

  // ── Mouth ── (CanineTeeth 0-2, TongueColor/LipDarkness -1..1, Param121 is lip hue 0..6)
  {
    key: "mouth",
    label: "Mouth",
    params: [
      picker("CanineTeeth", "Canine Teeth", 0, 2),
      slider("TongueColor", "Tongue Color", -1, 1),
      slider("Param121", "Lip Hue", 0, 6, 0.05),
      slider("LipDarkness", "Lip Darkness", -1, 1),
    ],
  },

  // ── Skin ──
  {
    key: "skin",
    label: "Skin",
    params: [
      ...hsbGroup("skin", "Skin", "SkinHue", "SkinSaturation", "SkinBrightness"),
      slider("Param92", "Lineart Brightness", -1, 1),
    ],
  },

  // ── Body ── (moc3: ChestSize/Height/Fitness are -30..30)
  {
    key: "body",
    label: "Body",
    params: [
      slider("ChestSize", "Chest Size", -30, 30, 0.5),
      slider("HeightAdjustment", "Height", -30, 30, 0.5),
      slider("FitnessAdjustment", "Fitness", -30, 30, 0.5),
      toggle("FingerNailsON", "Finger Nails ON"),
      slider("FingerNailsLength", "Finger Nails Length", -1, 1),
      ...hsbGroup(
        "fnails",
        "Finger Nails",
        "FingerNailsHue",
        "FingerNailsSaturation",
        "FingerNailsBrightness",
      ),
      toggle("ToeNailsOn", "Toe Nails ON"),
      ...hsbGroup("tnails", "Toe Nails", "ToeNailsHue", "ToeNailsSaturation", "ToeNailsBrightness"),
      toggle("HideLowerArmL", "Hide Lower Arm L"),
      toggle("HideLowerArmR", "Hide Lower Arm R"),
      toggle("HideBody", "Hide Body"),
      toggle("HideNeck", "Hide Neck"),
    ],
  },

  // ── Clothes Options ── (picker ranges from moc3)
  {
    key: "clothesOptions",
    label: "Clothes",
    params: [
      picker("NeckPicker", "Neckwear", 0, 7),
      picker("StrapsPicker", "Straps", 0, 5),
      picker("ChestPicker", "Chest", 1, 6),
      picker("SleevePicker", "Sleeves", 0, 6),
      picker("OuterwearPicker", "Outerwear", 0, 7),
      picker("BottomPicker", "Bottom", 0, 7),
      picker("TorsoPicker", "Torso", 0, 8),
      picker("Param97", "Underwear", 0, 2),
      picker("LegLPicker", "Leg L", 0, 5),
      picker("LegRPicker", "Leg R", 0, 5),
      picker("FeetPicker", "Feet", 0, 4),
    ],
  },

  // ── Clothes Colors ──
  {
    key: "clothesColor",
    label: "Clothes Colors",
    params: [
      ...hsbGroup("horns", "Horns", "HornsHue", "HornsSaturation", "HornsBrightness"),
      ...hsbGroup("neck", "Neck", "NeckHue", "NeckSaturation", "NeckBrightness"),
      ...hsbGroup("straps", "Straps", "StrapsHue", "StrapsSaturation", "StrapsBrightness"),
      ...hsbGroup("chest", "Chest", "ChestHue", "ChestSaturation", "ChestBrightness"),
      ...hsbGroup("sleeves", "Sleeves", "SleevesHue", "SleevesSaturation", "SleevesBrightness"),
      ...hsbGroup("torso", "Torso", "TorsoHue", "TorsoSaturation", "TorsoBrightness"),
      ...hsbGroup(
        "outerwear",
        "Outerwear",
        "OuterwearHue",
        "OuterwearSaturation",
        "OuterwearBrightness",
      ),
      ...hsbGroup(
        "underwear",
        "Underwear",
        "UnderwearHue",
        "UnderwearSaturation",
        "UnderwearBrightness",
      ),
      ...hsbGroup("bottoms", "Bottoms", "BottomsHue", "BottomsSaturation", "BottomsBrightness"),
      ...hsbGroup("legL", "Leg L", "LegLHue", "LegLSaturation", "LegLBrightness"),
      slider("LegLTransparency", "Leg L Transparency", -1, 1),
      ...hsbGroup("legR", "Leg R", "LegRHue", "LegRSaturation", "LegRBrightness"),
      slider("LegRTransparency", "Leg R Transparency", -1, 1),
      ...hsbGroup("shoes", "Shoes", "ShoesHue", "ShoesSaturation", "ShoesBrightness"),
    ],
  },

  // ── Toggles (expressions/effects) ──
  {
    key: "toggles",
    label: "Expression Toggles",
    params: [
      toggle("BlushOn", "Blush"),
      toggle("DarkOn", "Dark Face"),
      toggle("Param123", "Heart Eyes"),
      toggle("StarEyesOn", "Star Eyes"),
      toggle("TearsOn", "Tears"),
    ],
  },
];

// ── Build default parameters map from registry ───────────────────

function buildDefaults(): Record<string, number> {
  const defaults: Record<string, number> = {};
  for (const group of PARAMETER_REGISTRY) {
    for (const param of group.params) {
      defaults[param.id] = param.default ?? 0;
    }
  }
  return defaults;
}

export const DEFAULT_PARAMETERS = buildDefaults();

export function getDefaultConfig(): AvatarConfig {
  return {
    modelPath: getLive2dAssetPath("yiota/yiota.model3.json"),
    resolution: 4096,
    presetId: "professional",
    parameters: { ...DEFAULT_PARAMETERS },
  };
}

// ── Get all customization param IDs (for reset) ──────────────────

export function getAllCustomizationParamIds(): string[] {
  return PARAMETER_REGISTRY.flatMap((g) => g.params.map((p) => p.id));
}
