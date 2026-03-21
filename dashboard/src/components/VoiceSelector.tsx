import { motion } from "framer-motion";
import { useState } from "react";

export type Voice = "jessica" | "lily";

export const voices: Record<Voice, { name: string; id: string; description: string }> = {
  jessica: {
    name: "Jessica",
    id: "cgSgspJ2msm6clMCkdW9",
    description: "Playful, bright, warm",
  },
  lily: {
    name: "Lily",
    id: "pFZP5JQG7iQjIQuC4Bku",
    description: "Velvety, refined",
  },
};

interface VoiceSelectorProps {
  value?: Voice;
  onChange?: (voice: Voice) => void;
}

export function VoiceSelector({ value, onChange }: VoiceSelectorProps) {
  const [selected, setSelected] = useState<Voice>(value || "jessica");

  const handleSelect = (voice: Voice) => {
    setSelected(voice);
    onChange?.(voice);
  };

  return (
    <div className="flex gap-2">
      {(Object.keys(voices) as Voice[]).map((voice) => (
        <motion.button
          key={voice}
          onClick={() => handleSelect(voice)}
          className={`px-4 py-2 rounded-lg text-sm transition-all relative ${
            selected === voice
              ? "bg-purple-500/20 text-purple-300"
              : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60"
          }`}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {selected === voice && (
            <motion.div
              layoutId="voice-indicator"
              className="absolute inset-0 bg-purple-500/20 rounded-lg"
              initial={false}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
          <span className="relative z-10">{voices[voice].name}</span>
        </motion.button>
      ))}
    </div>
  );
}
