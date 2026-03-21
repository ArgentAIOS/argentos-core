import { motion, AnimatePresence } from "framer-motion";
import { Mic, Volume2, Settings, X, RefreshCw, User } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

// Voice definitions
export const voices = {
  jessica: { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", desc: "Playful, bright, warm" },
  lily: { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", desc: "Velvety, refined" },
  aria: { id: "9BWtsMINqrJLrRacOk9x", name: "Aria", desc: "Warm, expressive" },
  sarah: { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", desc: "Soft, calm" },
  charlie: { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", desc: "Casual, conversational" },
  george: { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", desc: "Warm British" },
} as const;

export type Voice = keyof typeof voices;

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: "audioinput" | "audiooutput";
}

interface AudioDeviceSelectorProps {
  selectedInput?: string;
  selectedOutput?: string;
  selectedVoice?: Voice;
  activeVoiceLabel?: string;
  voiceSelectionLocked?: boolean;
  onInputChange?: (deviceId: string) => void;
  onOutputChange?: (deviceId: string) => void;
  onVoiceChange?: (voice: Voice) => void;
}

const STORAGE_KEY_INPUT = "argent-audio-input";
const STORAGE_KEY_OUTPUT = "argent-audio-output";

function describeMediaError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return "Microphone access was denied. Allow Argent in macOS Privacy > Microphone.";
    }
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      return "No audio devices are available on this Mac right now.";
    }
    if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      return "Audio hardware is busy in another app. Close other capture apps and retry.";
    }
    return `${err.name}: ${err.message || "Audio device error"}`;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return "Unable to load audio devices.";
}

export function AudioDeviceSelector({
  selectedInput,
  selectedOutput,
  selectedVoice = "jessica",
  activeVoiceLabel,
  voiceSelectionLocked = false,
  onInputChange,
  onOutputChange,
  onVoiceChange,
}: AudioDeviceSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<string | null>(null);

  // Load devices
  const loadDevices = useCallback(
    async ({ bootstrapPermission = false } = {}) => {
      // enumerateDevices is available on secure contexts (including localhost).
      // Do NOT request microphone permission on mount; that should only happen on explicit mic usage.
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.warn("[Audio] MediaDevices enumerateDevices API not available");
        setDeviceStatus("Audio device APIs are unavailable in this webview.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setDeviceStatus(null);
      try {
        const enumerateAudio = async () => {
          const devices = await navigator.mediaDevices.enumerateDevices();

          const audioInputs = devices
            .filter((d) => d.kind === "audioinput" && d.deviceId)
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
              kind: "audioinput" as const,
            }));

          const audioOutputs = devices
            .filter((d) => d.kind === "audiooutput" && d.deviceId)
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Speaker ${d.deviceId.slice(0, 8)}`,
              kind: "audiooutput" as const,
            }));

          return { audioInputs, audioOutputs };
        };

        let { audioInputs, audioOutputs } = await enumerateAudio();

        if (
          bootstrapPermission &&
          audioInputs.length === 0 &&
          navigator.mediaDevices.getUserMedia
        ) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((track) => track.stop());
            ({ audioInputs, audioOutputs } = await enumerateAudio());
          } catch (err) {
            setDeviceStatus(describeMediaError(err));
          }
        }

        setInputs(audioInputs);
        setOutputs(audioOutputs);

        if (bootstrapPermission && audioInputs.length === 0) {
          setDeviceStatus(
            (current) =>
              current ??
              "No microphones are currently visible to the dashboard. Verify macOS input device and permissions.",
          );
        }

        // If no selection, try to load from storage or use default
        if (!selectedInput && audioInputs.length > 0) {
          const stored = localStorage.getItem(STORAGE_KEY_INPUT);
          const deviceExists = audioInputs.some((d) => d.deviceId === stored);
          onInputChange?.(deviceExists && stored ? stored : audioInputs[0].deviceId);
        }

        if (!selectedOutput && audioOutputs.length > 0) {
          const stored = localStorage.getItem(STORAGE_KEY_OUTPUT);
          const deviceExists = audioOutputs.some((d) => d.deviceId === stored);
          onOutputChange?.(deviceExists && stored ? stored : audioOutputs[0].deviceId);
        }
      } catch (err) {
        console.error("[Audio] Failed to enumerate devices:", err);
        setDeviceStatus(describeMediaError(err));
      } finally {
        setLoading(false);
      }
    },
    [selectedInput, selectedOutput, onInputChange, onOutputChange],
  );

  // Load devices on mount
  useEffect(() => {
    void loadDevices();

    // Listen for device changes (only if API is available)
    if (navigator.mediaDevices) {
      const handleDeviceChange = () => {
        void loadDevices();
      };
      navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
      return () => {
        navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
      };
    }
  }, [loadDevices]);

  const handleInputChange = (deviceId: string) => {
    localStorage.setItem(STORAGE_KEY_INPUT, deviceId);
    onInputChange?.(deviceId);
  };

  const handleOutputChange = async (deviceId: string) => {
    // Test that we can actually use this output device
    try {
      const testAudio = new Audio();
      if ("setSinkId" in testAudio) {
        await (testAudio as any).setSinkId(deviceId);
        console.log("[AudioSettings] Verified output device:", deviceId);
      }
    } catch (err) {
      console.warn("[AudioSettings] Could not set output device:", err);
    }

    localStorage.setItem(STORAGE_KEY_OUTPUT, deviceId);
    onOutputChange?.(deviceId);
  };

  // Get current device labels for display
  const currentInputLabel =
    inputs.find((d) => d.deviceId === selectedInput)?.label || "Select mic...";
  const currentOutputLabel =
    outputs.find((d) => d.deviceId === selectedOutput)?.label || "Select speaker...";

  // Shorten label for display
  const shortenLabel = (label: string) => {
    if (label.length <= 20) return label;
    return label.slice(0, 18) + "...";
  };

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => {
          setIsOpen(true);
          void loadDevices({ bootstrapPermission: true });
        }}
        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/70 transition-all"
        title="Audio settings"
      >
        <Settings className="w-5 h-5" />
      </button>

      {/* Modal */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setIsOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 rounded-2xl p-4 w-[380px] max-w-[90vw] max-h-[75vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <h3 className="text-white font-semibold text-base">Audio Settings</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => void loadDevices({ bootstrapPermission: true })}
                    disabled={loading}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 disabled:opacity-50"
                    title="Refresh devices"
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                  </button>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-white/50"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Scrollable content - compact layout */}
              <div className="overflow-y-auto flex-1 pr-2 -mr-2 space-y-3">
                {/* Voice selection - 3 columns, compact */}
                <div>
                  <label className="flex items-center gap-2 text-white/70 text-xs font-medium mb-2">
                    <User className="w-3.5 h-3.5 text-purple-400" />
                    Voice
                  </label>
                  {voiceSelectionLocked && (
                    <div className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200/90">
                      Voice is pinned by the current chat agent.
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-1.5">
                    {Object.entries(voices).map(([key, voice]) => (
                      <button
                        key={key}
                        onClick={() => {
                          if (voiceSelectionLocked) return;
                          onVoiceChange?.(key as Voice);
                        }}
                        disabled={voiceSelectionLocked}
                        className={`text-left px-2 py-1.5 rounded-lg transition-all ${
                          selectedVoice === key
                            ? "bg-purple-500/30 text-purple-300 border border-purple-500/50"
                            : "bg-white/5 text-white/70 border border-white/10 hover:bg-white/10"
                        } ${voiceSelectionLocked ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        <div className="text-xs font-medium">{voice.name}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Microphone input */}
                <div>
                  <label className="flex items-center gap-2 text-white/70 text-xs font-medium mb-2">
                    <Mic className="w-3.5 h-3.5 text-purple-400" />
                    Microphone
                  </label>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {inputs.length === 0 ? (
                      <div className="py-2 space-y-2">
                        <div className="text-white/40 text-xs">No microphones found</div>
                        {deviceStatus && (
                          <div className="text-amber-300/80 text-[11px] leading-relaxed">
                            {deviceStatus}
                          </div>
                        )}
                        <button
                          onClick={() => void loadDevices({ bootstrapPermission: true })}
                          className="px-2 py-1 text-[11px] rounded-md bg-purple-500/20 text-purple-300 hover:bg-purple-500/30"
                        >
                          Retry device detection
                        </button>
                      </div>
                    ) : (
                      inputs.map((device) => (
                        <button
                          key={device.deviceId}
                          onClick={() => handleInputChange(device.deviceId)}
                          className={`w-full text-left px-3 py-2 rounded-lg transition-all ${
                            selectedInput === device.deviceId
                              ? "bg-purple-500/30 text-purple-300 border border-purple-500/50"
                              : "bg-white/5 text-white/70 border border-white/10 hover:bg-white/10"
                          }`}
                        >
                          <div className="text-xs truncate">{device.label}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Speaker output */}
                <div>
                  <label className="flex items-center gap-2 text-white/70 text-xs font-medium mb-2">
                    <Volume2 className="w-3.5 h-3.5 text-purple-400" />
                    Speaker
                    <button
                      onClick={async () => {
                        if (!selectedOutput) return;
                        try {
                          // Create a test beep using AudioContext
                          const audioCtx = new AudioContext();
                          const oscillator = audioCtx.createOscillator();
                          const gainNode = audioCtx.createGain();

                          oscillator.connect(gainNode);
                          gainNode.connect(audioCtx.destination);

                          oscillator.frequency.value = 440;
                          oscillator.type = "sine";
                          gainNode.gain.value = 0.3;

                          // Try to route to selected device
                          if ("setSinkId" in audioCtx) {
                            await (audioCtx as any).setSinkId(selectedOutput);
                            console.log("[Test] AudioContext sinkId set to:", selectedOutput);
                          }

                          oscillator.start();
                          oscillator.stop(audioCtx.currentTime + 0.3);

                          console.log("[Test] Playing test tone on:", selectedOutput);
                        } catch (err) {
                          console.error("[Test] Failed:", err);
                        }
                      }}
                      className="ml-auto px-2 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded hover:bg-purple-500/30"
                    >
                      Test
                    </button>
                  </label>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {outputs.length === 0 ? (
                      <div className="py-2 space-y-2">
                        <div className="text-white/40 text-xs">No speakers found</div>
                        {deviceStatus && (
                          <div className="text-amber-300/80 text-[11px] leading-relaxed">
                            {deviceStatus}
                          </div>
                        )}
                      </div>
                    ) : (
                      outputs.map((device) => (
                        <button
                          key={device.deviceId}
                          onClick={() => handleOutputChange(device.deviceId)}
                          className={`w-full text-left px-3 py-2 rounded-lg transition-all ${
                            selectedOutput === device.deviceId
                              ? "bg-purple-500/30 text-purple-300 border border-purple-500/50"
                              : "bg-white/5 text-white/70 border border-white/10 hover:bg-white/10"
                          }`}
                        >
                          <div className="text-xs truncate">{device.label}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Current selection summary - compact */}
              <div className="mt-3 pt-3 border-t border-white/10 flex-shrink-0">
                <div className="text-white/40 text-xs flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    <span className="text-white/60">
                      {activeVoiceLabel || voices[selectedVoice]?.name || "Jessica"}
                    </span>
                  </span>
                  <span className="truncate max-w-[140px]" title={currentInputLabel}>
                    🎤 {shortenLabel(currentInputLabel)}
                  </span>
                  <span className="truncate max-w-[140px]" title={currentOutputLabel}>
                    🔊 {shortenLabel(currentOutputLabel)}
                  </span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Hook for using audio devices
export function useAudioDevices() {
  const [inputDeviceId, setInputDeviceId] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY_INPUT) || "",
  );
  const [outputDeviceId, setOutputDeviceId] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY_OUTPUT) || "",
  );

  return {
    inputDeviceId,
    outputDeviceId,
    setInputDeviceId,
    setOutputDeviceId,
  };
}
