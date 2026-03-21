/**
 * Built-in avatar presets for the Yiota Customizable VTuber.
 * Each preset is a partial parameter override merged on top of defaults.
 */

import {
  DEFAULT_PARAMETERS,
  getModelPathForResolution,
  type AvatarConfig,
  type AvatarResolution,
} from "./avatarConfig";

export interface PresetDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  parameters: Record<string, number>;
}

// Hue range is 0..6 (roughly a full color wheel rotation: 0=base, ~1=warm, ~3=green, ~4.5=purple, ~5.3=pink)
// Saturation/Brightness remain -1..1
// Body sliders: -30..30, Face: -25..25, Eyes: -10..10

export const PRESETS: PresetDef[] = [
  {
    id: "professional",
    name: "Professional",
    description: "Business-ready default. Conservative hair, glasses, neutral palette.",
    icon: "💼",
    parameters: {
      // Hair: tidy medium bang, short side hair
      MiddleBangPicker: 1,
      SideBangPicker: 1,
      SideHair1Picker: 1,
      BackhairPicker: 1,
      // Glasses on
      GlassesPicker: 1,
      // Clothes: formal top + bottom
      ChestPicker: 2,
      SleevePicker: 2,
      TorsoPicker: 1,
      BottomPicker: 2,
      FeetPicker: 1,
      // Neutral dark hair color (brightness -1..1 range is correct)
      MiddleBangLBrightness: -0.3,
      MiddleBangRBrightness: -0.3,
      SideBangLBrightness: -0.3,
      SideBangRBrightness: -0.3,
      SideHair1LBrightness: -0.3,
      SideHair1RBrightness: -0.3,
      BackhairLBrightness: -0.3,
      BackhairRBrightness: -0.3,
      BackhairInnerBrightness: -0.4,
      // Neutral clothes colors (saturation -1..1 is correct)
      ChestSaturation: -0.5,
      SleevesSaturation: -0.5,
      TorsoSaturation: -0.5,
      BottomsBrightness: -0.3,
    },
  },
  {
    id: "casual",
    name: "Casual",
    description: "Relaxed after-hours look. Longer hair, warm colors.",
    icon: "🌅",
    parameters: {
      // Hair: flowing
      MiddleBangPicker: 2,
      SideBangPicker: 2,
      SideHair1Picker: 2,
      SideHair2Picker: 1,
      BackhairPicker: 2,
      BackhairLength: 0.3,
      // No glasses
      GlassesPicker: 0,
      // Casual outfit
      ChestPicker: 1,
      SleevePicker: 1,
      BottomPicker: 1,
      FeetPicker: 1,
      // Warm brown hair (hue ~0.8 = warm/auburn on 0-6 scale)
      MiddleBangLHue: 0.8,
      MiddleBangRHue: 0.8,
      SideBangLHue: 0.8,
      SideBangRHue: 0.8,
      SideHair1LHue: 0.8,
      SideHair1RHue: 0.8,
      BackhairLHue: 0.8,
      BackhairRHue: 0.8,
      MiddleBangLSaturation: 0.2,
      MiddleBangRSaturation: 0.2,
      // Warmer clothes
      ChestHue: 0.5,
      ChestSaturation: 0.1,
    },
  },
  {
    id: "tech",
    name: "Tech",
    description: "Cyberpunk gaming mode. Edgy hair, darker palette.",
    icon: "🎮",
    parameters: {
      // Edgy hair
      MiddleBangPicker: 3,
      SideBangPicker: 3,
      SideHair1Picker: 3,
      BackhairPicker: 3,
      AhogePicker: 1,
      HairextrasPicker: 1,
      // No glasses
      GlassesPicker: 0,
      // Tech outfit
      ChestPicker: 3,
      SleevePicker: 3,
      TorsoPicker: 2,
      BottomPicker: 3,
      FeetPicker: 2,
      // Dark hair with purple tint (hue ~4.5 = purple on 0-6 scale)
      MiddleBangLHue: 4.5,
      MiddleBangRHue: 4.5,
      SideBangLHue: 4.5,
      SideBangRHue: 4.5,
      SideHair1LHue: 4.5,
      SideHair1RHue: 4.5,
      BackhairLHue: 4.5,
      BackhairRHue: 4.5,
      MiddleBangLBrightness: -0.4,
      MiddleBangRBrightness: -0.4,
      SideBangLBrightness: -0.4,
      SideBangRBrightness: -0.4,
      BackhairLBrightness: -0.4,
      BackhairRBrightness: -0.4,
      BackhairInnerBrightness: -0.5,
      // Purple iris (hue ~4.5)
      IrisMainLHue: 4.5,
      IrisMainRHue: 4.5,
      IrisMainSaturationL: 0.3,
      IrisMainSaturationR: 0.3,
      // Dark clothes
      ChestBrightness: -0.4,
      SleevesBrightness: -0.4,
      TorsoBrightness: -0.4,
      BottomsBrightness: -0.4,
    },
  },
  {
    id: "kawaii",
    name: "Kawaii",
    description: "Cute mode. Animal ears, bright pastels, playful accessories.",
    icon: "🎀",
    parameters: {
      // Fun hair (clamped to actual picker maxes: SideBang max=3, SideHair1 max=3)
      MiddleBangPicker: 4,
      SideBangPicker: 3,
      SideHair1Picker: 3,
      SideHair2Picker: 2,
      BackhairPicker: 4,
      AhogePicker: 2,
      HairextrasPicker: 2,
      // Animal ears!
      AnimalEarsPicker: 1,
      AnimalTailPicker: 1,
      // No glasses, no horns
      GlassesPicker: 0,
      HornsPicker: 0,
      // Cute outfit
      ChestPicker: 4,
      SleevePicker: 4,
      BottomPicker: 4,
      FeetPicker: 3,
      // Pink hair (hue ~5.3 = pink/magenta on 0-6 scale)
      MiddleBangLHue: 5.3,
      MiddleBangRHue: 5.3,
      SideBangLHue: 5.3,
      SideBangRHue: 5.3,
      SideHair1LHue: 5.3,
      SideHair1RHue: 5.3,
      SideHair2LHue: 5.2,
      SideHair2RHue: 5.2,
      BackhairLHue: 5.3,
      BackhairRHue: 5.3,
      MiddleBangLSaturation: 0.4,
      MiddleBangRSaturation: 0.4,
      SideBangLSaturation: 0.4,
      SideBangRSaturation: 0.4,
      SideHair1LSaturation: 0.4,
      SideHair1RSaturation: 0.4,
      BackhairLSaturation: 0.4,
      BackhairRSaturation: 0.4,
      // Pink ears & tail
      AnimalEarLHue: 5.3,
      AnimalEarRHue: 5.3,
      AnimalEarLSaturation: 0.3,
      AnimalEarRSaturation: 0.3,
      TailHie: 5.3,
      TailSaturation: 0.3,
      // Bright pink iris
      IrisMainLHue: 5.3,
      IrisMainRHue: 5.3,
      IrisMainSaturationL: 0.4,
      IrisMainSaturationR: 0.4,
      // Pastel clothes
      ChestHue: 5.3,
      ChestSaturation: 0.3,
      ChestBrightness: 0.2,
      SleevesSaturation: 0.2,
      BottomsHue: 5.2,
      BottomsSaturation: 0.2,
      // Blush on
      BlushOn: 1,
    },
  },
];

/** Build a full AvatarConfig from a preset, merging over defaults.
 *  Checks for user-saved overrides first, falling back to built-in defaults. */
export function buildPresetConfig(presetId: string, resolution?: AvatarResolution): AvatarConfig {
  const res = resolution ?? 4096;
  const preset = PRESETS.find((p) => p.id === presetId);
  // Check for user-saved override of this preset
  const override = loadPresetOverride(presetId);
  return {
    modelPath: getModelPathForResolution(res),
    resolution: res,
    presetId,
    parameters: {
      ...DEFAULT_PARAMETERS,
      ...(preset?.parameters ?? {}),
      ...(override ?? {}),
    },
  };
}

/** Get preset by ID (checks built-in and custom). */
export function getPreset(id: string): PresetDef | undefined {
  return PRESETS.find((p) => p.id === id) ?? loadCustomPresets().find((p) => p.id === id);
}

// ── Preset overrides (persistent user modifications to built-in presets) ──

const PRESET_OVERRIDES_KEY = "argent-avatar-preset-overrides";

/** Load all user overrides: presetId → full parameter set */
function loadAllPresetOverrides(): Record<string, Record<string, number>> {
  try {
    const stored = localStorage.getItem(PRESET_OVERRIDES_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return {};
}

/** Load saved override for a specific preset. Returns null if no override exists. */
export function loadPresetOverride(presetId: string): Record<string, number> | null {
  return loadAllPresetOverrides()[presetId] ?? null;
}

/** Save the current parameters as an override for a built-in preset.
 *  Next time buildPresetConfig is called (e.g. by time-of-day switching),
 *  these values will be used instead of the hardcoded defaults. */
export function savePresetOverride(presetId: string, parameters: Record<string, number>): void {
  const all = loadAllPresetOverrides();
  all[presetId] = { ...parameters };
  localStorage.setItem(PRESET_OVERRIDES_KEY, JSON.stringify(all));
}

/** Remove a user override, reverting a preset back to its built-in defaults. */
export function resetPresetOverride(presetId: string): void {
  const all = loadAllPresetOverrides();
  delete all[presetId];
  localStorage.setItem(PRESET_OVERRIDES_KEY, JSON.stringify(all));
}

/** Check whether a preset has a user override saved. */
export function hasPresetOverride(presetId: string): boolean {
  return loadAllPresetOverrides()[presetId] != null;
}

// ── Custom user presets (2 saveable slots) ───────────────────────

const CUSTOM_PRESETS_KEY = "argent-avatar-custom-presets";
const MAX_CUSTOM_PRESETS = 2;

export interface CustomPresetSlot extends PresetDef {
  slotIndex: number; // 0 or 1
}

export function loadCustomPresets(): CustomPresetSlot[] {
  try {
    const stored = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
}

export function saveCustomPreset(
  slotIndex: number,
  name: string,
  parameters: Record<string, number>,
): CustomPresetSlot {
  if (slotIndex < 0 || slotIndex >= MAX_CUSTOM_PRESETS) {
    throw new Error(`Slot index must be 0-${MAX_CUSTOM_PRESETS - 1}`);
  }
  const presets = loadCustomPresets();
  const slot: CustomPresetSlot = {
    id: `custom-${slotIndex}`,
    name: name || `Custom ${slotIndex + 1}`,
    description: "Your saved custom look",
    icon: slotIndex === 0 ? "🎨" : "✨",
    parameters: { ...parameters },
    slotIndex,
  };
  const existing = presets.findIndex((p) => p.slotIndex === slotIndex);
  if (existing >= 0) {
    presets[existing] = slot;
  } else {
    presets.push(slot);
  }
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  return slot;
}

export function deleteCustomPreset(slotIndex: number): void {
  const presets = loadCustomPresets().filter((p) => p.slotIndex !== slotIndex);
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
}
