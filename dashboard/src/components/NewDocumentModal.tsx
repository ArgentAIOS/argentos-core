import { motion, AnimatePresence } from "framer-motion";
import { FileText, Code, Database, FolderPlus, X } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

type DocType = "markdown" | "code" | "data";

interface NewDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (doc: {
    title: string;
    description: string;
    type: DocType;
    language?: string;
    folder?: string;
  }) => void;
  existingFolders: string[];
}

const LANGUAGES = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Rust",
  "Go",
  "HTML",
  "CSS",
  "JSON",
  "YAML",
  "SQL",
  "Shell",
] as const;

const TYPE_OPTIONS: { value: DocType; label: string; icon: typeof FileText }[] = [
  { value: "markdown", label: "Document", icon: FileText },
  { value: "code", label: "Code", icon: Code },
  { value: "data", label: "Data", icon: Database },
];

export function NewDocumentModal({
  isOpen,
  onClose,
  onCreate,
  existingFolders,
}: NewDocumentModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<DocType>("markdown");
  const [language, setLanguage] = useState<string>("TypeScript");
  const [folder, setFolder] = useState<string>("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Reset form state when the modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle("");
      setDescription("");
      setType("markdown");
      setLanguage("TypeScript");
      setFolder("");
      setIsCreatingFolder(false);
      setNewFolderName("");
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleFolderChange = useCallback((value: string) => {
    if (value === "__new__") {
      setIsCreatingFolder(true);
      setNewFolderName("");
      setFolder("");
    } else {
      setIsCreatingFolder(false);
      setNewFolderName("");
      setFolder(value);
    }
  }, []);

  const handleCreate = useCallback(() => {
    if (!title.trim()) return;

    const resolvedFolder = isCreatingFolder ? newFolderName.trim() : folder;

    onCreate({
      title: title.trim(),
      description: description.trim(),
      type,
      language: type === "code" ? language : undefined,
      folder: resolvedFolder || undefined,
    });
  }, [title, description, type, language, folder, isCreatingFolder, newFolderName, onCreate]);

  const canCreate = title.trim().length > 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="bg-gray-800 border border-white/10 rounded-2xl p-6 w-[480px] max-w-[90vw] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white font-semibold text-lg">New Document</h2>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/70 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Title */}
            <div className="mb-4">
              <label className="block text-sm text-white/60 mb-1.5">
                Title <span className="text-purple-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled document"
                autoFocus
                className="w-full bg-gray-900/60 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-colors"
              />
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="block text-sm text-white/60 mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                rows={3}
                className="w-full bg-gray-900/60 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-colors resize-none"
              />
            </div>

            {/* Type — Segmented Control */}
            <div className="mb-4">
              <label className="block text-sm text-white/60 mb-1.5">Type</label>
              <div className="flex bg-gray-900/60 border border-white/10 rounded-lg p-1 gap-1">
                {TYPE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isActive = type === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setType(opt.value)}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                        isActive
                          ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                          : "text-white/50 hover:text-white/70 hover:bg-white/5 border border-transparent"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Language — shown only when type is "code" */}
            <AnimatePresence>
              {type === "code" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="mb-4">
                    <label className="block text-sm text-white/60 mb-1.5">Language</label>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full bg-gray-900/60 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-colors appearance-none cursor-pointer"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "right 12px center",
                      }}
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang} value={lang} className="bg-gray-800 text-white">
                          {lang}
                        </option>
                      ))}
                    </select>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Folder */}
            <div className="mb-6">
              <label className="block text-sm text-white/60 mb-1.5">Folder</label>
              {!isCreatingFolder ? (
                <select
                  value={folder}
                  onChange={(e) => handleFolderChange(e.target.value)}
                  className="w-full bg-gray-900/60 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-colors appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right 12px center",
                  }}
                >
                  <option value="" className="bg-gray-800 text-white">
                    No folder
                  </option>
                  {existingFolders.map((f) => (
                    <option key={f} value={f} className="bg-gray-800 text-white">
                      {f}
                    </option>
                  ))}
                  <option value="__new__" className="bg-gray-800 text-purple-400">
                    New Folder...
                  </option>
                </select>
              ) : (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <FolderPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-400" />
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="Folder name"
                      autoFocus
                      className="w-full bg-gray-900/60 border border-purple-500/30 rounded-lg pl-9 pr-3 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-colors"
                    />
                  </div>
                  <button
                    onClick={() => {
                      setIsCreatingFolder(false);
                      setNewFolderName("");
                      setFolder("");
                    }}
                    className="px-3 py-2 text-sm text-white/50 hover:text-white/70 hover:bg-white/5 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-white/60 hover:text-white/80 transition-colors rounded-lg hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!canCreate}
                className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
                  canCreate
                    ? "bg-purple-500 hover:bg-purple-400 text-white shadow-lg shadow-purple-500/20"
                    : "bg-purple-500/30 text-white/30 cursor-not-allowed"
                }`}
              >
                Create
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
