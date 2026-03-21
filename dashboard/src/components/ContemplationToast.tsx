/**
 * Contemplation Toast — shows background thoughts from heartbeat wakeups.
 *
 * Renders a subtle notification when the agent surfaces something interesting
 * during a heartbeat cycle. Includes mood-driven avatar state + optional TTS.
 */

import { motion, AnimatePresence } from "framer-motion";
import { Brain, X } from "lucide-react";
import { useEffect, useState, useCallback, useRef } from "react";
import type { MoodName } from "../lib/moodSystem";
import { parseMoodName } from "../lib/moodSystem";

export interface ContemplationEvent {
  text: string;
  mood: MoodName | null;
  significance: "normal" | "high";
  source: string;
  timestamp: string;
}

interface ContemplationToastProps {
  /** Callback when a wakeup arrives — parent can trigger TTS + avatar mood */
  onWakeup?: (event: ContemplationEvent) => void;
  /** Whether the user has enabled background notifications (Settings toggle) */
  enabled?: boolean;
}

const TOAST_DURATION_MS = 12000; // Auto-dismiss after 12 seconds
const MAX_TEXT_LENGTH = 200;

export function ContemplationToast({ onWakeup, enabled = true }: ContemplationToastProps) {
  const [toast, setToast] = useState<ContemplationEvent | null>(null);
  const [visible, setVisible] = useState(false);

  // Store callback in ref so the SSE connection doesn't tear down on every render
  const onWakeupRef = useRef(onWakeup);
  onWakeupRef.current = onWakeup;

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => setToast(null), 300); // Wait for exit animation
  }, []);

  // Connect to SSE endpoint — only depends on `enabled`, not callback identity
  useEffect(() => {
    if (!enabled) return;

    const eventSource = new EventSource("/api/contemplation/events");

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "contemplation_wakeup") {
          const mood = data.mood ? parseMoodName(data.mood) : null;
          const contemplation: ContemplationEvent = {
            text:
              data.text?.length > MAX_TEXT_LENGTH
                ? data.text.slice(0, MAX_TEXT_LENGTH) + "..."
                : data.text,
            mood,
            significance: data.significance || "normal",
            source: data.source || "heartbeat",
            timestamp: data.timestamp,
          };
          setToast(contemplation);
          setVisible(true);
          onWakeupRef.current?.(contemplation);
        }
      } catch (e) {
        console.error("[Contemplation] Failed to parse event:", e);
      }
    };

    eventSource.onerror = () => {
      // Reconnection is automatic with EventSource
    };

    return () => eventSource.close();
  }, [enabled]);

  // Auto-dismiss timer
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(dismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [visible, dismiss]);

  return (
    <AnimatePresence>
      {visible && toast && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed top-4 right-4 z-[150] max-w-sm"
        >
          <div
            className={`bg-[#1a1a2e]/95 backdrop-blur-md border rounded-xl p-4 shadow-2xl ${
              toast.significance === "high"
                ? "border-amber-500/40 shadow-amber-500/10"
                : "border-white/10"
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center ${
                    toast.significance === "high" ? "bg-amber-500/20" : "bg-purple-500/20"
                  }`}
                >
                  <Brain
                    className={`w-3.5 h-3.5 ${
                      toast.significance === "high" ? "text-amber-400" : "text-purple-400"
                    }`}
                  />
                </div>
                <span className="text-white/40 text-xs font-medium">thinking quietly...</span>
                {toast.mood && (
                  <span className="text-white/30 text-[10px] bg-white/5 px-1.5 py-0.5 rounded">
                    {toast.mood}
                  </span>
                )}
              </div>
              <button
                onClick={dismiss}
                className="text-white/20 hover:text-white/50 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Content */}
            <p className="text-white/80 text-sm leading-relaxed">{toast.text}</p>

            {/* Timestamp */}
            <div className="mt-2 text-white/20 text-[10px]">
              {new Date(toast.timestamp).toLocaleTimeString()}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
