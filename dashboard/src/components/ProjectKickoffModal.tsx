import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useGateway } from "../hooks/useGateway";

interface ProjectKickoffModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export type SpecForgeFormData = {
  title: string;
  problem: string;
  users: string;
  successCriteria: string;
  constraints: string;
  scope: string;
};

export function ProjectKickoffModal({ isOpen, onClose }: ProjectKickoffModalProps) {
  const { request } = useGateway();

  const [formData, setFormData] = useState<SpecForgeFormData>({
    title: "",
    problem: "",
    users: "",
    successCriteria: "",
    constraints: "",
    scope: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingSuggestion, setLoadingSuggestion] = useState<keyof SpecForgeFormData | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        title: "",
        problem: "",
        users: "",
        successCriteria: "",
        constraints: "",
        scope: "",
      });
      setIsSubmitting(false);
      setLoadingSuggestion(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleAskArgent = async (field: keyof SpecForgeFormData) => {
    setLoadingSuggestion(field);
    try {
      const response = await request<{ suggestion: string }>("specforge.suggest", {
        field,
        currentData: formData,
      });
      if (response && response.suggestion) {
        setFormData((prev) => ({ ...prev, [field]: response.suggestion }));
      }
    } catch (err) {
      console.error(`Failed to get suggestion for ${field}:`, err);
    } finally {
      setLoadingSuggestion(null);
    }
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) return;
    setIsSubmitting(true);
    try {
      await request("specforge.kickoff", { data: formData });
      onClose();
    } catch (err) {
      console.error("Failed to submit SpecForge kickoff:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderField = (
    field: keyof SpecForgeFormData,
    label: string,
    placeholder: string,
    rows: number = 3,
  ) => (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm font-medium text-white/80">{label}</label>
        <button
          onClick={() => handleAskArgent(field)}
          disabled={loadingSuggestion !== null}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 rounded-md transition-colors disabled:opacity-50"
        >
          {loadingSuggestion === field ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          Ask Argent
        </button>
      </div>
      {rows === 1 ? (
        <input
          type="text"
          value={formData[field]}
          onChange={(e) => setFormData((prev) => ({ ...prev, [field]: e.target.value }))}
          placeholder={placeholder}
          className="w-full bg-gray-900/60 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-colors"
        />
      ) : (
        <textarea
          value={formData[field]}
          onChange={(e) => setFormData((prev) => ({ ...prev, [field]: e.target.value }))}
          placeholder={placeholder}
          rows={rows}
          className="w-full bg-gray-900/60 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-colors resize-y leading-relaxed"
        />
      )}
    </div>
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="bg-gray-800 border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-white/5 bg-gray-800/80 backdrop-blur z-10 sticky top-0">
              <div>
                <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  SpecForge Kickoff
                </h2>
                <p className="text-sm text-white/50 mt-0.5">
                  Define your project parameters collaboratively.
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/70 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="p-6 overflow-y-auto min-h-[300px] flex-1">
              <div className="space-y-6">
                {renderField("title", "Project Title", "e.g., Unified Payment Gateway", 1)}
                {renderField(
                  "problem",
                  "Problem Statement",
                  "What is the core problem this project solves?",
                  3,
                )}
                {renderField(
                  "users",
                  "Target Users",
                  "Who will use this? Describe the user personas.",
                  2,
                )}
                {renderField(
                  "successCriteria",
                  "Success Criteria",
                  "What does 'done' look like? List measurable goals.",
                  3,
                )}
                {renderField(
                  "constraints",
                  "Constraints",
                  "Are there technical, timeline, or resource limitations?",
                  2,
                )}
                {renderField(
                  "scope",
                  "Scope boundaries",
                  "What is strictly out of scope for the initial delivery?",
                  3,
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-white/5 bg-gray-800/80 backdrop-blur sticky bottom-0 z-10 flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-white/60 hover:text-white/80 transition-colors rounded-lg hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !formData.title.trim()}
                className={`px-6 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
                  !formData.title.trim()
                    ? "bg-purple-500/30 text-white/30 cursor-not-allowed"
                    : "bg-purple-500 hover:bg-purple-400 text-white shadow-lg shadow-purple-500/20"
                }`}
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Save & Initialize Project
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
