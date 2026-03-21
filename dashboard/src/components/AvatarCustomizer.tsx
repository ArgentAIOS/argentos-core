/**
 * AvatarCustomizer — Tabbed UI for full Live2D avatar customization.
 * Real-time preview: every change is applied instantly to the model.
 */

import { Download, Upload, RotateCcw, Save, Trash2 } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import {
  PARAMETER_REGISTRY,
  RESOLUTION_OPTIONS,
  loadConfig,
  saveConfig,
  getModelPathForResolution,
  loadDefaultZoom,
  saveDefaultZoom,
  loadTimePresets,
  saveTimePresets,
  loadBubbleConfig,
  saveBubbleConfig,
  type AvatarConfig,
  type AvatarResolution,
  type ZoomPreset,
  type TimePresetConfig,
  type BubbleConfig,
  type ParamDef,
  type ParamGroup,
} from "../lib/avatarConfig";
import {
  PRESETS,
  buildPresetConfig,
  loadCustomPresets,
  saveCustomPreset,
  deleteCustomPreset,
  savePresetOverride,
  resetPresetOverride,
  hasPresetOverride,
  type PresetDef,
  type CustomPresetSlot,
} from "../lib/avatarPresets";
import {
  applyCustomization,
  resetCustomizationParams,
  setCustomizerZoom,
  setCustomizerZoomDebug,
  getAvatarPosition,
  setCustomizerZoomEntry,
  setAvatarPosition,
} from "./Live2DAvatar";

// ── Sub-tab definitions ──────────────────────────────────────────

const SUB_TABS = [
  { key: "presets", label: "Presets" },
  { key: "settings", label: "Settings" },
  { key: "hairOptions", label: "Hair" },
  { key: "hairColor", label: "Hair Color" },
  { key: "head", label: "Face" },
  { key: "eyes", label: "Eyes" },
  { key: "mouth", label: "Mouth" },
  { key: "skin", label: "Skin" },
  { key: "body", label: "Body" },
  { key: "clothesOptions", label: "Clothes" },
  { key: "clothesColor", label: "Outfit Color" },
  { key: "toggles", label: "Toggles" },
] as const;

type SubTabKey = (typeof SUB_TABS)[number]["key"];

// ── Component ────────────────────────────────────────────────────

export function AvatarCustomizer() {
  const [activeTab, setActiveTabRaw] = useState<SubTabKey>("presets");
  const setActiveTab = useCallback((tab: SubTabKey) => {
    setActiveTabRaw(tab);
    setCustomizerZoom(tab);
  }, []);
  const [config, setConfig] = useState<AvatarConfig>(() => {
    return loadConfig() ?? buildPresetConfig("professional");
  });
  const [isDirty, setIsDirty] = useState(false);
  // Track which built-in preset we're editing (persists through param changes)
  const [editingPreset, setEditingPreset] = useState<string | null>(() => {
    const cfg = loadConfig();
    return cfg?.presetId ?? "professional";
  });
  const [customPresets, setCustomPresets] = useState<CustomPresetSlot[]>(() => loadCustomPresets());
  const [defaultZoom, setDefaultZoom] = useState<ZoomPreset>(() => loadDefaultZoom());
  const [timePresets, setTimePresets] = useState<TimePresetConfig>(() => loadTimePresets());
  const [bubble, setBubble] = useState<BubbleConfig>(() => loadBubbleConfig());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Param change handler (real-time) ──

  const handleParamChange = useCallback((paramId: string, value: number) => {
    setConfig((prev) => {
      const next = {
        ...prev,
        // Keep the presetId so we know which preset is being customized
        parameters: { ...prev.parameters, [paramId]: value },
      };
      // Apply immediately to model
      applyCustomization({ [paramId]: value });
      return next;
    });
    setIsDirty(true);
  }, []);

  // ── Resolution change ──

  const handleResolutionChange = useCallback((resolution: AvatarResolution) => {
    setConfig((prev) => ({
      ...prev,
      resolution,
      modelPath: getModelPathForResolution(resolution),
    }));
    setIsDirty(true);
  }, []);

  // ── Preset application (works for both built-in and custom) ──

  const applyPreset = useCallback((preset: PresetDef) => {
    setEditingPreset(preset.id);
    setConfig((prev) => {
      const cfg = buildPresetConfig(preset.id, prev.resolution);
      // If it's a custom preset, use its full parameters directly
      if (preset.id.startsWith("custom-")) {
        cfg.parameters = { ...preset.parameters };
        cfg.presetId = preset.id;
      }
      resetCustomizationParams();
      applyCustomization(cfg.parameters);
      return cfg;
    });
    setIsDirty(true);
  }, []);

  // ── Custom preset save ──

  const handleSaveCustomPreset = useCallback((slotIndex: number) => {
    const name = prompt(`Name for Custom ${slotIndex + 1}:`, `Custom ${slotIndex + 1}`);
    if (!name) return;
    setConfig((prev) => {
      const slot = saveCustomPreset(slotIndex, name, prev.parameters);
      setCustomPresets(loadCustomPresets());
      return { ...prev, presetId: slot.id };
    });
    setIsDirty(true);
  }, []);

  const handleDeleteCustomPreset = useCallback((slotIndex: number) => {
    deleteCustomPreset(slotIndex);
    setCustomPresets(loadCustomPresets());
  }, []);

  // ── Save / Reset / Export / Import ──

  const handleSave = useCallback(() => {
    // Save the current config as the active look
    saveConfig(config);
    // Also save as a preset override so time-of-day switching uses this version
    const presetId = editingPreset || config.presetId;
    if (presetId && !presetId.startsWith("custom-")) {
      savePresetOverride(presetId, config.parameters);
    }
    setIsDirty(false);
  }, [config, editingPreset]);

  /** Reset to the user's saved override for the current preset (or built-in if no override). */
  const handleReset = useCallback(() => {
    const presetId = editingPreset || config.presetId || "professional";
    setConfig((prev) => {
      const cfg = buildPresetConfig(presetId, prev.resolution);
      resetCustomizationParams();
      applyCustomization(cfg.parameters);
      return cfg;
    });
    setIsDirty(true);
  }, [editingPreset, config.presetId]);

  /** Reset preset to its original built-in defaults, removing any user override. */
  const handleResetToOriginal = useCallback(() => {
    const presetId = editingPreset || config.presetId || "professional";
    // Remove the saved override
    if (presetId && !presetId.startsWith("custom-")) {
      resetPresetOverride(presetId);
    }
    setConfig((prev) => {
      // Rebuild without override (since we just deleted it)
      const cfg = buildPresetConfig(presetId, prev.resolution);
      resetCustomizationParams();
      applyCustomization(cfg.parameters);
      return cfg;
    });
    setIsDirty(true);
  }, [editingPreset, config.presetId]);

  // ── Default zoom ──

  const handleDefaultZoomChange = useCallback((zoom: ZoomPreset) => {
    setDefaultZoom(zoom);
    saveDefaultZoom(zoom);
  }, []);

  // ── Time-of-day preset assignment ──

  const handleTimePresetChange = useCallback((slot: keyof TimePresetConfig, presetId: string) => {
    setTimePresets((prev) => {
      const next = { ...prev, [slot]: presetId };
      saveTimePresets(next);
      return next;
    });
  }, []);

  // ── Bubble config ──

  const handleBubbleChange = useCallback((update: Partial<BubbleConfig>) => {
    setBubble((prev) => {
      const next = { ...prev, ...update };
      saveBubbleConfig(next);
      // Notify App.tsx to update live bubble position
      window.dispatchEvent(new CustomEvent("bubbleConfigChange", { detail: next }));
      return next;
    });
  }, []);

  // ── Calibration mode ──
  // Enables drag/scroll positioning on the avatar so the user can
  // dial in the exact zoom coordinates for each customizer tab.

  const [calibrationMode, setCalibrationMode] = useState(false);
  const [livePos, setLivePos] = useState<{ scale: number; x: number; y: number } | null>(null);
  const [lockedValues, setLockedValues] = useState<
    Record<string, { scale: number; x: number; y: number }>
  >({});

  // Toggle calibration on/off
  const toggleCalibration = useCallback(() => {
    setCalibrationMode((prev) => {
      const next = !prev;
      setCustomizerZoomDebug(next);
      return next;
    });
  }, []);

  // Poll avatar position while in calibration mode
  useEffect(() => {
    if (!calibrationMode) return;
    const interval = setInterval(() => {
      const pos = getAvatarPosition();
      if (pos) setLivePos(pos);
    }, 100);
    return () => clearInterval(interval);
  }, [calibrationMode]);

  // Lock current position for the active tab
  const lockForTab = useCallback(() => {
    const pos = getAvatarPosition();
    if (!pos) return;
    setCustomizerZoomEntry(activeTab, pos);
    setLockedValues((prev) => ({ ...prev, [activeTab]: pos }));
  }, [activeTab]);

  // Copy all locked values as code (for pasting back into source)
  const copyAllLocked = useCallback(() => {
    const lines = Object.entries(lockedValues)
      .map(([k, v]) => `  ${k}: { scale: ${v.scale.toFixed(4)}, x: ${v.x}, y: ${v.y} },`)
      .join("\n");
    const code = `// Calibrated zoom values\n{\n${lines}\n}`;
    navigator.clipboard.writeText(code);
  }, [lockedValues]);

  const handleExport = useCallback(() => {
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `argent-avatar-${config.presetId || "custom"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [config]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string) as AvatarConfig;
        if (imported.parameters) {
          resetCustomizationParams();
          applyCustomization(imported.parameters);
          setConfig((prev) => ({
            ...imported,
            resolution: imported.resolution ?? prev.resolution,
            modelPath: getModelPathForResolution(imported.resolution ?? prev.resolution),
          }));
          setIsDirty(true);
        }
      } catch (err) {
        console.error("[AvatarCustomizer] Import failed:", err);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  // ── Mirror L→R for eyes ──

  const mirrorEyesLtoR = useCallback(() => {
    const eyeGroup = PARAMETER_REGISTRY.find((g) => g.key === "eyes");
    if (!eyeGroup) return;

    setConfig((prev) => {
      const next = { ...prev, presetId: null as string | null, parameters: { ...prev.parameters } };
      const updates: Record<string, number> = {};

      const mirrorMap: Record<string, string> = {
        PupilPickerL: "PupilPickerR",
        PupilHueL_NEW: "PupilHueR_NEW",
        PupilSaturationLNew: "PupilSaturationRNew",
        PupilBrightnessLNEW: "PupilBrightnessRNEW",
        IrisMainLHue: "IrisMainRHue",
        IrisMainSaturationL: "IrisMainSaturationR",
        IrisMainBrightnessL: "IrisMainBrightnessR",
        IrisLowerHueL: "IrisLowerHueR",
        IrisLowerSaturationL: "IrisLowerSaturationR",
        IrisLowerBrightnessL: "IrisLowerBrightnessR",
        IrisOuterHueL: "IrisOuterHueR",
        IrisOuterSaturationL: "IrisOuterSaturationR",
        IrisOuterBrightnessL: "IrisOuterBrightnessR",
        ScleraHueL: "ScleraHueR",
        ScleraDarknessL: "ScleraDarknessR",
        LashesBrightnessL: "LashesBrightnessR",
      };

      for (const [lId, rId] of Object.entries(mirrorMap)) {
        const val = prev.parameters[lId] ?? 0;
        next.parameters[rId] = val;
        updates[rId] = val;
      }

      applyCustomization(updates);
      return next;
    });
    setIsDirty(true);
  }, []);

  // ── Resolve display name ──

  const currentPresetName = (() => {
    const pid = editingPreset || config.presetId;
    if (!pid) return "Custom";
    const builtin = PRESETS.find((p) => p.id === pid);
    if (builtin) return builtin.name;
    const custom = customPresets.find((p) => p.id === pid);
    if (custom) return custom.name;
    return pid;
  })();

  const currentPresetHasOverride = (() => {
    const pid = editingPreset || config.presetId;
    return pid ? hasPresetOverride(pid) : false;
  })();

  // ── Render ──

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleSave}
          disabled={!isDirty}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 disabled:bg-white/5 disabled:text-white/20 text-purple-400 rounded-lg text-sm font-medium transition-all"
          title="Save current look — also updates the preset so time-of-day switching uses your version"
        >
          <Save className="w-3.5 h-3.5" />
          Save
        </button>
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 rounded-lg text-sm transition-all"
          title="Reset to last saved state"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
        {currentPresetHasOverride && (
          <button
            onClick={handleResetToOriginal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs transition-all"
            title="Revert this preset back to its original factory defaults"
          >
            <Trash2 className="w-3 h-3" />
            Original
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 rounded-lg text-xs transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Export
        </button>
        <button
          onClick={handleImport}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 rounded-lg text-xs transition-all"
        >
          <Upload className="w-3.5 h-3.5" />
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* Current preset indicator */}
      <div className="text-xs text-white/40">
        Current: {currentPresetName}
        {currentPresetHasOverride && <span className="text-purple-400 ml-1">(customized)</span>}
        {" | "}
        {RESOLUTION_OPTIONS.find((r) => r.value === config.resolution)?.label ?? "4K"}
        {isDirty && <span className="text-yellow-400 ml-2">(unsaved)</span>}
      </div>

      {/* Sub-tab navigation */}
      <div className="flex flex-wrap gap-1">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              activeTab === tab.key
                ? "bg-purple-500/30 text-purple-300"
                : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70"
            }`}
          >
            {tab.label}
            {calibrationMode && lockedValues[tab.key] && (
              <span className="text-green-400 ml-1">*</span>
            )}
          </button>
        ))}
      </div>

      {/* Calibration debug panel */}
      {calibrationMode && (
        <div className="bg-green-900/30 border border-green-500/30 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-green-400 text-xs font-bold uppercase tracking-wide">
              Calibrating: {SUB_TABS.find((t) => t.key === activeTab)?.label}
            </div>
            <button
              onClick={toggleCalibration}
              className="px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-xs"
            >
              Exit
            </button>
          </div>

          {/* Position sliders */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs w-14">Left/Right</span>
              <input
                type="range"
                min={-800}
                max={800}
                step={1}
                value={livePos?.x ?? 0}
                onChange={(e) => {
                  const x = Number(e.target.value);
                  const cur = getAvatarPosition();
                  if (cur) setAvatarPosition({ ...cur, x });
                }}
                className="flex-1 h-1.5 accent-green-500 cursor-pointer"
              />
              <span className="font-mono text-green-300 text-xs w-12 text-right">
                {livePos?.x ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs w-14">Up/Down</span>
              <input
                type="range"
                min={-3000}
                max={1000}
                step={1}
                value={livePos?.y ?? 0}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  const cur = getAvatarPosition();
                  if (cur) setAvatarPosition({ ...cur, y });
                }}
                className="flex-1 h-1.5 accent-green-500 cursor-pointer"
              />
              <span className="font-mono text-green-300 text-xs w-12 text-right">
                {livePos?.y ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs w-14">Zoom</span>
              <input
                type="range"
                min={0.01}
                max={0.8}
                step={0.001}
                value={livePos?.scale ?? 0.084}
                onChange={(e) => {
                  const scale = Number(e.target.value);
                  const cur = getAvatarPosition();
                  if (cur) setAvatarPosition({ ...cur, scale });
                }}
                className="flex-1 h-1.5 accent-green-500 cursor-pointer"
              />
              <span className="font-mono text-green-300 text-xs w-12 text-right">
                {livePos?.scale.toFixed(3) ?? "0.084"}
              </span>
            </div>
          </div>

          {/* Lock button */}
          <button
            onClick={lockForTab}
            className="w-full py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg text-sm font-medium transition-all"
          >
            Lock for "{SUB_TABS.find((t) => t.key === activeTab)?.label}"
          </button>

          {/* Locked values summary */}
          {Object.keys(lockedValues).length > 0 && (
            <div className="space-y-1">
              <div className="text-white/40 text-xs font-medium">Locked positions:</div>
              {Object.entries(lockedValues).map(([k, v]) => (
                <div key={k} className="font-mono text-[10px] text-white/50 flex justify-between">
                  <span className="text-green-300">{k}</span>
                  <span>
                    s:{v.scale.toFixed(3)} x:{v.x} y:{v.y}
                  </span>
                </div>
              ))}
              <button
                onClick={copyAllLocked}
                className="w-full mt-2 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded text-xs font-medium transition-all"
              >
                Copy All Values to Clipboard
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab content */}
      <div className="space-y-3">
        {activeTab === "presets" && (
          <PresetGrid
            presets={PRESETS}
            customPresets={customPresets}
            activePreset={config.presetId}
            onSelect={applyPreset}
            onSaveCustom={handleSaveCustomPreset}
            onDeleteCustom={handleDeleteCustomPreset}
          />
        )}

        {activeTab === "settings" && (
          <div className="space-y-4">
            <SettingsPanel
              resolution={config.resolution}
              onResolutionChange={handleResolutionChange}
              defaultZoom={defaultZoom}
              onDefaultZoomChange={handleDefaultZoomChange}
              timePresets={timePresets}
              onTimePresetChange={handleTimePresetChange}
              allPresets={[...PRESETS, ...customPresets]}
              bubble={bubble}
              onBubbleChange={handleBubbleChange}
            />
            {/* Calibration tool */}
            <div className="border-t border-white/10 pt-4">
              <div className="text-xs text-white/40 font-medium uppercase tracking-wide mb-2">
                Zoom Calibration
              </div>
              <div className="text-xs text-white/30 mb-3">
                Calibrate the zoom position for each customizer tab. Drag the avatar and scroll to
                resize, then lock the position.
              </div>
              <button
                onClick={toggleCalibration}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-all ${
                  calibrationMode
                    ? "bg-red-500/20 hover:bg-red-500/30 text-red-400"
                    : "bg-green-500/10 hover:bg-green-500/20 text-green-400"
                }`}
              >
                {calibrationMode ? "Exit Calibration Mode" : "Enter Calibration Mode"}
              </button>
            </div>
          </div>
        )}

        {activeTab === "eyes" && (
          <div className="space-y-3">
            <button
              onClick={mirrorEyesLtoR}
              className="w-full py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg text-xs font-medium transition-all"
            >
              Mirror Left Eye → Right Eye
            </button>
            <ParamGroupPanel
              group={PARAMETER_REGISTRY.find((g) => g.key === "eyes")!}
              values={config.parameters}
              onChange={handleParamChange}
            />
          </div>
        )}

        {activeTab !== "presets" &&
          activeTab !== "settings" &&
          activeTab !== "eyes" &&
          (() => {
            if (activeTab === "hairOptions") {
              const hairOpts = PARAMETER_REGISTRY.find((g) => g.key === "hairOptions");
              const hairLen = PARAMETER_REGISTRY.find((g) => g.key === "hairLength");
              return (
                <div className="space-y-4">
                  {hairOpts && (
                    <ParamGroupPanel
                      group={hairOpts}
                      values={config.parameters}
                      onChange={handleParamChange}
                    />
                  )}
                  {hairLen && (
                    <>
                      <div className="text-xs text-white/40 font-medium uppercase tracking-wide pt-2">
                        Hair Length
                      </div>
                      <ParamGroupPanel
                        group={hairLen}
                        values={config.parameters}
                        onChange={handleParamChange}
                      />
                    </>
                  )}
                </div>
              );
            }
            if (activeTab === "head") {
              const head = PARAMETER_REGISTRY.find((g) => g.key === "head");
              const brows = PARAMETER_REGISTRY.find((g) => g.key === "brows");
              return (
                <div className="space-y-4">
                  {head && (
                    <ParamGroupPanel
                      group={head}
                      values={config.parameters}
                      onChange={handleParamChange}
                    />
                  )}
                  {brows && (
                    <>
                      <div className="text-xs text-white/40 font-medium uppercase tracking-wide pt-2">
                        Brows
                      </div>
                      <ParamGroupPanel
                        group={brows}
                        values={config.parameters}
                        onChange={handleParamChange}
                      />
                    </>
                  )}
                </div>
              );
            }

            const group = PARAMETER_REGISTRY.find((g) => g.key === activeTab);
            if (!group) return null;
            return (
              <ParamGroupPanel
                group={group}
                values={config.parameters}
                onChange={handleParamChange}
              />
            );
          })()}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────

const ZOOM_OPTIONS: { value: ZoomPreset; label: string; icon: string }[] = [
  { value: "full", label: "Full Body", icon: "🧍" },
  { value: "portrait", label: "Portrait", icon: "👤" },
  { value: "face", label: "Face Close-up", icon: "📷" },
];

const TIME_SLOT_LABELS: { slot: keyof TimePresetConfig; label: string; icon: string }[] = [
  { slot: "morning", label: "Morning (5am–5pm)", icon: "🌅" },
  { slot: "evening", label: "Evening (5pm–10pm)", icon: "🌇" },
  { slot: "night", label: "Night (10pm–5am)", icon: "🌃" },
];

function SettingsPanel({
  resolution,
  onResolutionChange,
  defaultZoom,
  onDefaultZoomChange,
  timePresets,
  onTimePresetChange,
  allPresets,
  bubble,
  onBubbleChange,
}: {
  resolution: AvatarResolution;
  onResolutionChange: (r: AvatarResolution) => void;
  defaultZoom: ZoomPreset;
  onDefaultZoomChange: (z: ZoomPreset) => void;
  timePresets: TimePresetConfig;
  onTimePresetChange: (slot: keyof TimePresetConfig, presetId: string) => void;
  allPresets: PresetDef[];
  bubble: BubbleConfig;
  onBubbleChange: (update: Partial<BubbleConfig>) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Time-of-day preset assignment */}
      <div className="text-xs text-white/40 font-medium uppercase tracking-wide">
        Time of Day Outfits
      </div>
      <div className="text-xs text-white/30 mb-2">
        Choose which preset the avatar wears during each time period.
      </div>
      <div className="space-y-2">
        {TIME_SLOT_LABELS.map(({ slot, label, icon }) => (
          <div key={slot} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
            <span className="text-base">{icon}</span>
            <span className="text-white/70 text-xs flex-1 min-w-0">{label}</span>
            <select
              value={timePresets[slot]}
              onChange={(e) => onTimePresetChange(slot, e.target.value)}
              className="bg-white/10 text-white rounded px-2 py-1 text-xs border border-white/10 focus:border-purple-400 focus:outline-none w-32"
            >
              {allPresets.map((p) => (
                <option key={p.id} value={p.id} className="bg-gray-900">
                  {p.icon} {p.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Default zoom */}
      <div className="text-xs text-white/40 font-medium uppercase tracking-wide pt-2">Display</div>
      <div className="space-y-2">
        <div className="text-xs text-white/60">Default View</div>
        <div className="text-xs text-white/30 mb-2">
          The zoom level used when the dashboard loads and after switching presets.
        </div>
        <div className="flex gap-2">
          {ZOOM_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onDefaultZoomChange(opt.value)}
              className={`flex-1 p-3 rounded-xl text-center transition-all ${
                defaultZoom === opt.value
                  ? "bg-purple-500/20 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                  : "bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20"
              }`}
            >
              <div className="text-lg mb-1">{opt.icon}</div>
              <div className="text-white font-medium text-xs">{opt.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Bubble (dock head) position */}
      <div className="text-xs text-white/40 font-medium uppercase tracking-wide pt-2">
        Dock Head Position
      </div>
      <div className="text-xs text-white/30 mb-2">
        Adjust the avatar head position in the bottom-left dock widget.
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-white/50 text-xs w-14">Left/Right</span>
          <input
            type="range"
            min={-300}
            max={300}
            step={5}
            value={bubble.offsetX}
            onChange={(e) => onBubbleChange({ offsetX: Number(e.target.value) })}
            className="flex-1 h-1.5 accent-purple-500 cursor-pointer"
          />
          <span className="font-mono text-white/40 text-xs w-10 text-right">{bubble.offsetX}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/50 text-xs w-14">Up/Down</span>
          <input
            type="range"
            min={0}
            max={1200}
            step={10}
            value={bubble.offsetY}
            onChange={(e) => onBubbleChange({ offsetY: Number(e.target.value) })}
            className="flex-1 h-1.5 accent-purple-500 cursor-pointer"
          />
          <span className="font-mono text-white/40 text-xs w-10 text-right">{bubble.offsetY}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/50 text-xs w-14">Zoom</span>
          <input
            type="range"
            min={0.05}
            max={0.5}
            step={0.001}
            value={bubble.scale}
            onChange={(e) => onBubbleChange({ scale: Number(e.target.value) })}
            className="flex-1 h-1.5 accent-purple-500 cursor-pointer"
          />
          <span className="font-mono text-white/40 text-xs w-10 text-right">
            {bubble.scale.toFixed(3)}
          </span>
        </div>
      </div>

      {/* Resolution */}
      <div className="text-xs text-white/40 font-medium uppercase tracking-wide pt-2">
        Rendering
      </div>
      <div className="space-y-2">
        <div className="text-xs text-white/60">Texture Resolution</div>
        <div className="text-xs text-white/30 mb-2">
          Higher resolution = sharper textures but slower loading. Requires page refresh to apply.
        </div>
        <div className="flex gap-2">
          {RESOLUTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onResolutionChange(opt.value)}
              className={`flex-1 p-3 rounded-xl text-center transition-all ${
                resolution === opt.value
                  ? "bg-purple-500/20 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                  : "bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20"
              }`}
            >
              <div className="text-white font-medium text-sm">{opt.label}</div>
              <div className="text-white/40 text-xs mt-1">{opt.size}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PresetGrid({
  presets,
  customPresets,
  activePreset,
  onSelect,
  onSaveCustom,
  onDeleteCustom,
}: {
  presets: PresetDef[];
  customPresets: CustomPresetSlot[];
  activePreset: string | null;
  onSelect: (p: PresetDef) => void;
  onSaveCustom: (slotIndex: number) => void;
  onDeleteCustom: (slotIndex: number) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Built-in presets */}
      <div className="text-xs text-white/40 font-medium uppercase tracking-wide">
        Built-in Presets
      </div>
      <div className="grid grid-cols-2 gap-3">
        {presets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onSelect(preset)}
            className={`p-4 rounded-xl text-left transition-all ${
              activePreset === preset.id
                ? "bg-purple-500/20 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                : "bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20"
            }`}
          >
            <div className="text-2xl mb-2">{preset.icon}</div>
            <div className="text-white font-medium text-sm">
              {preset.name}
              {hasPresetOverride(preset.id) && (
                <span className="text-purple-400 text-[10px] ml-1.5">yours</span>
              )}
            </div>
            <div className="text-white/40 text-xs mt-1">{preset.description}</div>
          </button>
        ))}
      </div>

      {/* Custom preset slots */}
      <div className="text-xs text-white/40 font-medium uppercase tracking-wide pt-2">
        Your Custom Presets
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((slotIndex) => {
          const saved = customPresets.find((p) => p.slotIndex === slotIndex);
          if (saved) {
            return (
              <div
                key={slotIndex}
                className={`p-4 rounded-xl text-left transition-all relative ${
                  activePreset === saved.id
                    ? "bg-purple-500/20 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                    : "bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20"
                }`}
              >
                <button onClick={() => onSelect(saved)} className="w-full text-left">
                  <div className="text-2xl mb-2">{saved.icon}</div>
                  <div className="text-white font-medium text-sm">{saved.name}</div>
                  <div className="text-white/40 text-xs mt-1">{saved.description}</div>
                </button>
                <div className="flex gap-1 mt-2">
                  <button
                    onClick={() => onSaveCustom(slotIndex)}
                    className="flex items-center gap-1 px-2 py-1 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 rounded text-xs transition-all"
                  >
                    <Save className="w-3 h-3" />
                    Overwrite
                  </button>
                  <button
                    onClick={() => onDeleteCustom(slotIndex)}
                    className="flex items-center gap-1 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded text-xs transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          }

          return (
            <button
              key={slotIndex}
              onClick={() => onSaveCustom(slotIndex)}
              className="p-4 rounded-xl text-left transition-all bg-white/[0.02] border border-dashed border-white/10 hover:bg-white/5 hover:border-white/20"
            >
              <div className="text-2xl mb-2 opacity-30">{slotIndex === 0 ? "🎨" : "✨"}</div>
              <div className="text-white/40 font-medium text-sm">Custom {slotIndex + 1}</div>
              <div className="text-white/30 text-xs mt-1">Save current look here</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ParamGroupPanel({
  group,
  values,
  onChange,
}: {
  group: ParamGroup;
  values: Record<string, number>;
  onChange: (id: string, value: number) => void;
}) {
  return (
    <div className="space-y-2">
      {group.params.map((param) => (
        <ParamControl
          key={param.id}
          param={param}
          value={values[param.id] ?? param.default ?? 0}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function ParamControl({
  param,
  value,
  onChange,
}: {
  param: ParamDef;
  value: number;
  onChange: (id: string, value: number) => void;
}) {
  switch (param.type) {
    case "picker":
      return (
        <div className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
          <span className="text-white/70 text-xs flex-1 min-w-0 truncate">{param.name}</span>
          <select
            value={Math.round(value)}
            onChange={(e) => onChange(param.id, Number(e.target.value))}
            className="bg-white/10 text-white rounded px-2 py-1 text-xs border border-white/10 focus:border-purple-400 focus:outline-none w-20"
          >
            {Array.from({ length: (param.max ?? 10) + 1 }, (_, i) => (
              <option key={i} value={i} className="bg-gray-900">
                {i === 0 ? "Off" : `Style ${i}`}
              </option>
            ))}
          </select>
        </div>
      );

    case "toggle":
      return (
        <div className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
          <span className="text-white/70 text-xs flex-1 min-w-0 truncate">{param.name}</span>
          <button
            onClick={() => onChange(param.id, value > 0.5 ? 0 : 1)}
            className={`w-10 h-5 rounded-full transition-all relative ${
              value > 0.5 ? "bg-purple-500" : "bg-white/20"
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                value > 0.5 ? "left-5" : "left-0.5"
              }`}
            />
          </button>
        </div>
      );

    case "slider":
    case "hsb":
    default:
      return (
        <div className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
          <span className="text-white/70 text-xs w-28 min-w-0 truncate" title={param.name}>
            {param.name}
          </span>
          <input
            type="range"
            min={param.min ?? -1}
            max={param.max ?? 1}
            step={param.step ?? 0.01}
            value={value}
            onChange={(e) => onChange(param.id, Number(e.target.value))}
            className="flex-1 h-1.5 accent-purple-500 cursor-pointer"
          />
          <span className="text-white/40 text-xs w-10 text-right font-mono">
            {value.toFixed(2)}
          </span>
        </div>
      );
  }
}
