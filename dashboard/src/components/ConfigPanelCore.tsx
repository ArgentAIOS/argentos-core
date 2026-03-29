/**
 * ConfigPanelCore.tsx — Slim settings panel for the public argentos-core repo.
 *
 * Exports the same `ConfigPanel` + `useConfig` symbols as the full Business
 * ConfigPanel so that App.tsx can import from a bridge file without changes.
 */

import { motion, AnimatePresence } from "framer-motion";
import { Settings, X, Shield, BookOpen, User, Palette } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useGateway } from "../hooks/useGateway";
import { processTextForSpeech, defaultPatternHandlers } from "../utils/textToSpeech";

// ── Types (mirror the Business ConfigPanel exports) ────────────────────────

export interface DictionaryEntry {
  id: string;
  term: string;
  replacement: string;
  enabled: boolean;
}

export interface PatternState {
  name: string;
  enabled: boolean;
}

export interface ConfigData {
  dictionary: DictionaryEntry[];
  patterns: PatternState[];
  apiKeys: Record<string, string>;
}

type CoreTabType = "agent" | "safety" | "appearance" | "dictionary";

// ── Persistence ────────────────────────────────────────────────────────────

const STORAGE_KEY = "argent-config";

const defaultConfig: ConfigData = {
  dictionary: [
    { id: "1", term: "COMEX", replacement: "Coe-Mex", enabled: true },
    { id: "2", term: "oz", replacement: "ounces", enabled: true },
    { id: "3", term: "SGE", replacement: "Shanghai Gold Exchange", enabled: true },
    { id: "5", term: "API", replacement: "A P I", enabled: true },
  ],
  patterns: defaultPatternHandlers.map((h) => ({ name: h.name, enabled: h.enabled })),
  apiKeys: {},
};

function loadConfig(): ConfigData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...defaultConfig, ...JSON.parse(stored) };
  } catch {
    /* ignore */
  }
  return defaultConfig;
}

function saveConfig(config: ConfigData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}

// ── Tab definitions ────────────────────────────────────────────────────────

const TABS: { id: CoreTabType; label: string; icon: typeof Settings }[] = [
  { id: "agent", label: "Agent", icon: User },
  { id: "safety", label: "Safety Rules", icon: Shield },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "dictionary", label: "Dictionary", icon: BookOpen },
];

// ── Sub-panels ─────────────────────────────────────────────────────────────

function AgentTab({ gatewayRequest }: { gatewayRequest?: ConfigPanelProps["gatewayRequest"] }) {
  const [agentName, setAgentName] = useState("");
  const [model, setModel] = useState("");
  const gateway = useGateway();

  useEffect(() => {
    const req = gatewayRequest ?? gateway.request;
    if (!req) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await req<{ agentName?: string; model?: string }>("getConfig");
        if (!cancelled) {
          setAgentName(cfg?.agentName ?? "Argent");
          setModel(cfg?.model ?? "");
        }
      } catch {
        /* gateway unavailable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gatewayRequest, gateway.request]);

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1">Agent Name</label>
        <input
          type="text"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
          placeholder="Argent"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1">Model</label>
        <input
          type="text"
          value={model}
          readOnly
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/50 cursor-not-allowed"
        />
        <p className="text-xs text-white/40 mt-1">Model selection is read-only in Core.</p>
      </div>
    </div>
  );
}

function SafetyTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-white/60">
        Safety rules constrain agent behavior through monotonic policy inheritance. The full Safety
        Rules editor is available in ArgentOS Business.
      </p>
      <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
        <h4 className="text-sm font-medium text-white/80 flex items-center gap-2">
          <Shield className="w-4 h-4 text-yellow-400/80" />
          Core Safety Defaults
        </h4>
        <ul className="text-sm text-white/50 space-y-1 list-disc list-inside">
          <li>Agent cannot modify its own safety rules</li>
          <li>Human approval required for destructive actions</li>
          <li>Escalation on repeated failures</li>
          <li>No access to secrets without explicit grant</li>
        </ul>
      </div>
    </div>
  );
}

function AppearanceTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-white/60">
        Avatar and visual identity customization. The full Appearance editor (AEVP particle system,
        Live2D, identity presets) is available in ArgentOS Business.
      </p>
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs text-white/40">Placeholder — appearance controls coming soon.</p>
      </div>
    </div>
  );
}

function DictionaryTab({
  config,
  onChange,
}: {
  config: ConfigData;
  onChange: (config: ConfigData) => void;
}) {
  const [newTerm, setNewTerm] = useState("");
  const [newReplacement, setNewReplacement] = useState("");

  const addEntry = () => {
    const term = newTerm.trim();
    const replacement = newReplacement.trim();
    if (!term || !replacement) return;
    const entry: DictionaryEntry = {
      id: String(Date.now()),
      term,
      replacement,
      enabled: true,
    };
    const updated = { ...config, dictionary: [...config.dictionary, entry] };
    onChange(updated);
    setNewTerm("");
    setNewReplacement("");
  };

  const removeEntry = (id: string) => {
    onChange({ ...config, dictionary: config.dictionary.filter((d) => d.id !== id) });
  };

  const toggleEntry = (id: string) => {
    onChange({
      ...config,
      dictionary: config.dictionary.map((d) => (d.id === id ? { ...d, enabled: !d.enabled } : d)),
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/60">
        Custom pronunciation replacements applied before text-to-speech.
      </p>

      {/* Add new entry */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newTerm}
          onChange={(e) => setNewTerm(e.target.value)}
          placeholder="Term"
          className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
        />
        <input
          type="text"
          value={newReplacement}
          onChange={(e) => setNewReplacement(e.target.value)}
          placeholder="Replacement"
          className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          onKeyDown={(e) => e.key === "Enter" && addEntry()}
        />
        <button
          onClick={addEntry}
          className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 text-sm transition-colors"
        >
          Add
        </button>
      </div>

      {/* Entry list */}
      <div className="space-y-1">
        {config.dictionary.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 group"
          >
            <button
              onClick={() => toggleEntry(entry.id)}
              className={`w-3 h-3 rounded-full border ${entry.enabled ? "bg-green-400 border-green-400" : "border-white/30"}`}
            />
            <span
              className={`text-sm flex-1 ${entry.enabled ? "text-white/80" : "text-white/30 line-through"}`}
            >
              {entry.term} &rarr; {entry.replacement}
            </span>
            <button
              onClick={() => removeEntry(entry.id)}
              className="text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
            >
              &times;
            </button>
          </div>
        ))}
        {config.dictionary.length === 0 && (
          <p className="text-xs text-white/30 text-center py-4">No dictionary entries.</p>
        )}
      </div>
    </div>
  );
}

// ── ConfigPanel (Core) ─────────────────────────────────────────────────────

interface ConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  requestedTab?: string | null;
  onRequestedTabHandled?: () => void;
  gatewayRequest?: <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ) => Promise<T>;
  // Accept (and ignore) Business-only props so the bridge works without type errors
  [key: string]: unknown;
}

export function ConfigPanel({
  isOpen,
  onClose,
  requestedTab,
  onRequestedTabHandled,
  gatewayRequest,
}: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<CoreTabType>("agent");
  const [config, setConfig] = useState<ConfigData>(loadConfig);

  useEffect(() => {
    if (!isOpen || !requestedTab) return;
    const tab = requestedTab as CoreTabType;
    if (TABS.some((t) => t.id === tab)) {
      setActiveTab(tab);
    }
    onRequestedTabHandled?.();
  }, [isOpen, requestedTab, onRequestedTabHandled]);

  const handleConfigChange = useCallback((updated: ConfigData) => {
    setConfig(updated);
    saveConfig(updated);
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="fixed top-0 right-0 bottom-0 w-[480px] z-50 flex flex-col bg-black/80 backdrop-blur-2xl border-l border-white/10 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-white/60" />
              <h2 className="text-lg font-semibold text-white/90">Settings</h2>
              <span className="text-[10px] uppercase tracking-wider text-white/30 bg-white/5 px-1.5 py-0.5 rounded">
                Core
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 px-4 py-2 border-b border-white/5 overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:text-white/70 hover:bg-white/5"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {activeTab === "agent" && <AgentTab gatewayRequest={gatewayRequest} />}
            {activeTab === "safety" && <SafetyTab />}
            {activeTab === "appearance" && <AppearanceTab />}
            {activeTab === "dictionary" && (
              <DictionaryTab config={config} onChange={handleConfigChange} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── useConfig hook (matches Business export) ───────────────────────────────

export function useConfig() {
  const [config, setConfig] = useState<ConfigData>(loadConfig);

  useEffect(() => {
    const handleStorage = () => setConfig(loadConfig());
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const applyDictionary = useCallback(
    (text: string) => {
      const handlers = defaultPatternHandlers.map((handler) => {
        const state = config.patterns?.find((p) => p.name === handler.name);
        return { ...handler, enabled: state?.enabled ?? handler.enabled };
      });
      return processTextForSpeech(text, config.dictionary, handlers);
    },
    [config],
  );

  return { config, applyDictionary };
}
