import { useState } from "react";
import type { MoodName } from "../lib/moodSystem";
import { Live2DAvatar, setMood, getAvatarPosition } from "./Live2DAvatar";

type AvatarState = "idle" | "thinking" | "working" | "success" | "error";

interface AvatarPreviewPaneProps {
  avatarState: AvatarState;
  avatarMood?: MoodName;
}

const moodButtons: { mood: MoodName; emoji: string; label: string }[] = [
  { mood: "neutral", emoji: "😐", label: "Neutral" },
  { mood: "happy", emoji: "😊", label: "Happy" },
  { mood: "excited", emoji: "🤩", label: "Excited" },
  { mood: "sad", emoji: "😢", label: "Sad" },
  { mood: "frustrated", emoji: "😤", label: "Frustrated" },
  { mood: "proud", emoji: "😎", label: "Proud" },
  { mood: "focused", emoji: "🧐", label: "Focused" },
  { mood: "embarrassed", emoji: "😳", label: "Embarrassed" },
  { mood: "loving", emoji: "🥰", label: "Loving" },
];

export function AvatarPreviewPane({ avatarState, avatarMood }: AvatarPreviewPaneProps) {
  const [viewMode, setViewMode] = useState<"full" | "bubble">("full");
  const [zoomPreset, setZoomPreset] = useState<"full" | "portrait" | "face">("full");
  const [activeMoodTest, setActiveMoodTest] = useState<MoodName | null>(null);

  const handleMoodTest = (mood: MoodName) => {
    setActiveMoodTest(mood);
    setMood(mood);
  };

  const pos = getAvatarPosition();

  const isBubble = viewMode === "bubble";

  return (
    <div className="w-[420px] flex-shrink-0 border-l border-white/10 bg-gray-950/80 flex flex-col">
      {/* Preview header */}
      <div className="px-4 py-3 border-b border-white/5">
        <div className="text-white/70 text-xs font-semibold uppercase tracking-wider">
          Live Preview
        </div>
      </div>

      {/* Avatar display */}
      <div className="flex-1 flex items-center justify-center bg-gray-950 relative overflow-hidden min-h-0">
        {isBubble ? (
          <Live2DAvatar
            state={avatarState}
            mood={activeMoodTest ?? avatarMood}
            width={200}
            height={200}
            mode="bubble"
          />
        ) : (
          <Live2DAvatar
            state={avatarState}
            mood={activeMoodTest ?? avatarMood}
            width={400}
            height={550}
            mode="full"
            zoomPreset={zoomPreset}
          />
        )}
      </div>

      {/* Controls */}
      <div className="px-4 py-3 border-t border-white/5 space-y-3">
        {/* View mode toggles */}
        <div>
          <div className="text-white/40 text-[10px] font-semibold uppercase tracking-wider mb-1.5">
            View Mode
          </div>
          <div className="flex gap-1.5">
            {(["full", "portrait", "face"] as const).map((preset) => (
              <button
                key={preset}
                onClick={() => {
                  setViewMode("full");
                  setZoomPreset(preset);
                }}
                className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-all ${
                  viewMode === "full" && zoomPreset === preset
                    ? "bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/30"
                    : "bg-white/5 text-white/50 hover:bg-white/10"
                }`}
              >
                {preset === "full" ? "Full Body" : preset === "portrait" ? "Portrait" : "Face"}
              </button>
            ))}
            <button
              onClick={() => setViewMode("bubble")}
              className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-all ${
                viewMode === "bubble"
                  ? "bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/30"
                  : "bg-white/5 text-white/50 hover:bg-white/10"
              }`}
            >
              Bubble
            </button>
          </div>
        </div>

        {/* Mood test strip */}
        <div>
          <div className="text-white/40 text-[10px] font-semibold uppercase tracking-wider mb-1.5">
            Test Mood
          </div>
          <div className="flex flex-wrap gap-1">
            {moodButtons.map((m) => (
              <button
                key={m.mood}
                onClick={() => handleMoodTest(m.mood)}
                title={m.label}
                className={`w-8 h-8 rounded-lg text-base flex items-center justify-center transition-all ${
                  activeMoodTest === m.mood
                    ? "bg-purple-500/20 ring-1 ring-purple-500/40 scale-110"
                    : "bg-white/5 hover:bg-white/10"
                }`}
              >
                {m.emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Position readout */}
        {pos && (
          <div className="text-white/30 text-[10px] font-mono">
            pos: x={pos.x.toFixed(0)} y={pos.y.toFixed(0)} scale={pos.scale.toFixed(4)}
          </div>
        )}
      </div>
    </div>
  );
}
