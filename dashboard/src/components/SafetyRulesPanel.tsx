import { Plus, Trash2, Shield, Save, AlertTriangle } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface SafetyRulesState {
  enabled: boolean;
  runtimeMode: "off" | "advisory" | "enforce";
  neverDo: string[];
  requiresHumanApproval: string[];
}

const CAUTIOUS_PRESETS = {
  relaxed: {
    label: "Relaxed",
    desc: "Acts freely, asks only for dangerous operations",
    runtimeMode: "advisory" as const,
  },
  balanced: {
    label: "Balanced",
    desc: "Asks for sensitive actions, acts freely otherwise",
    runtimeMode: "advisory" as const,
  },
  strict: {
    label: "Strict",
    desc: "Asks before most actions, enforces all rules",
    runtimeMode: "enforce" as const,
  },
};

export default function SafetyRulesPanel() {
  const [rules, setRules] = useState<SafetyRulesState>({
    enabled: false,
    runtimeMode: "advisory",
    neverDo: [],
    requiresHumanApproval: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newNeverDo, setNewNeverDo] = useState("");
  const [newApproval, setNewApproval] = useState("");

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/intent");
      if (res.ok) {
        const data = await res.json();
        const global = data?.globalPolicy || {};
        setRules({
          enabled: data?.enabled ?? false,
          runtimeMode: data?.runtimeMode ?? "advisory",
          neverDo: global.neverDo || [],
          requiresHumanApproval: global.requiresHumanApproval || [],
        });
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const saveRules = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/settings/intent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: rules.enabled,
          runtimeMode: rules.runtimeMode,
          globalPolicy: {
            neverDo: rules.neverDo,
            requiresHumanApproval: rules.requiresHumanApproval,
          },
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {}
    setSaving(false);
  };

  const addNeverDo = () => {
    const val = newNeverDo.trim();
    if (val && !rules.neverDo.includes(val)) {
      setRules((r) => ({ ...r, neverDo: [...r.neverDo, val] }));
      setNewNeverDo("");
    }
  };

  const addApproval = () => {
    const val = newApproval.trim();
    if (val && !rules.requiresHumanApproval.includes(val)) {
      setRules((r) => ({ ...r, requiresHumanApproval: [...r.requiresHumanApproval, val] }));
      setNewApproval("");
    }
  };

  if (loading) {
    return <div className="p-6 text-white/40">Loading safety rules...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-blue-400" />
          <div>
            <h3 className="text-white font-semibold text-lg">Safety Rules</h3>
            <p className="text-white/40 text-sm">Control what your agent can and cannot do.</p>
          </div>
        </div>
        <button
          onClick={() => setRules((r) => ({ ...r, enabled: !r.enabled }))}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            rules.enabled
              ? "bg-green-500/20 text-green-400 border border-green-500/30"
              : "bg-white/5 text-white/40 border border-white/10"
          }`}
        >
          {rules.enabled ? "Enabled" : "Disabled"}
        </button>
      </div>

      {!rules.enabled && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
          <p className="text-yellow-200/80 text-sm">
            Safety rules are disabled. Your agent will operate without behavioral constraints.
            Enable to set boundaries on what your agent should never do and what requires your
            approval.
          </p>
        </div>
      )}

      {rules.enabled && (
        <>
          {/* Cautiousness Level */}
          <div className="bg-white/5 rounded-xl p-4">
            <label className="text-white/60 text-xs uppercase tracking-wider font-medium">
              How cautious should your agent be?
            </label>
            <div className="grid grid-cols-3 gap-2 mt-3">
              {Object.entries(CAUTIOUS_PRESETS).map(([key, preset]) => {
                const isActive =
                  (key === "strict" && rules.runtimeMode === "enforce") ||
                  (key === "balanced" && rules.runtimeMode === "advisory") ||
                  (key === "relaxed" && rules.runtimeMode === "off");
                return (
                  <button
                    key={key}
                    onClick={() =>
                      setRules((r) => ({
                        ...r,
                        runtimeMode:
                          key === "strict" ? "enforce" : key === "balanced" ? "advisory" : "off",
                      }))
                    }
                    className={`p-3 rounded-lg text-left transition-all ${
                      isActive
                        ? "bg-blue-500/15 border border-blue-500/30"
                        : "bg-white/5 border border-white/10 hover:border-white/20"
                    }`}
                  >
                    <div
                      className={`text-sm font-medium ${isActive ? "text-blue-300" : "text-white/70"}`}
                    >
                      {preset.label}
                    </div>
                    <div className="text-xs text-white/40 mt-1">{preset.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Never Do */}
          <div className="bg-white/5 rounded-xl p-4">
            <label className="text-white/60 text-xs uppercase tracking-wider font-medium">
              What should your agent never do?
            </label>
            <p className="text-white/30 text-xs mt-1 mb-3">
              These actions are always blocked, regardless of context.
            </p>
            <div className="space-y-2">
              {rules.neverDo.map((rule, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
                >
                  <span className="text-red-300 text-sm flex-1">{rule}</span>
                  <button
                    onClick={() =>
                      setRules((r) => ({ ...r, neverDo: r.neverDo.filter((_, j) => j !== i) }))
                    }
                    className="text-white/30 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={newNeverDo}
                  onChange={(e) => setNewNeverDo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addNeverDo()}
                  placeholder="e.g., delete files without asking"
                  className="flex-1 bg-gray-800 text-white/80 text-sm rounded-lg px-3 py-2 border border-white/10 focus:outline-none focus:border-red-500/50 placeholder-white/20"
                />
                <button
                  onClick={addNeverDo}
                  className="bg-red-500/20 text-red-400 px-3 rounded-lg hover:bg-red-500/30 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Requires Approval */}
          <div className="bg-white/5 rounded-xl p-4">
            <label className="text-white/60 text-xs uppercase tracking-wider font-medium">
              What requires your approval?
            </label>
            <p className="text-white/30 text-xs mt-1 mb-3">
              Your agent will ask before taking these actions.
            </p>
            <div className="space-y-2">
              {rules.requiresHumanApproval.map((rule, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2"
                >
                  <span className="text-yellow-300 text-sm flex-1">{rule}</span>
                  <button
                    onClick={() =>
                      setRules((r) => ({
                        ...r,
                        requiresHumanApproval: r.requiresHumanApproval.filter((_, j) => j !== i),
                      }))
                    }
                    className="text-white/30 hover:text-yellow-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={newApproval}
                  onChange={(e) => setNewApproval(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addApproval()}
                  placeholder="e.g., sending messages on my behalf"
                  className="flex-1 bg-gray-800 text-white/80 text-sm rounded-lg px-3 py-2 border border-white/10 focus:outline-none focus:border-yellow-500/50 placeholder-white/20"
                />
                <button
                  onClick={addApproval}
                  className="bg-yellow-500/20 text-yellow-400 px-3 rounded-lg hover:bg-yellow-500/30 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center justify-between">
            <p className="text-white/30 text-xs">
              Upgrade to <span className="text-purple-400">ArgentOS Business</span> for departments,
              industry packs, simulation gates, and full governance.
            </p>
            <button
              onClick={saveRules}
              disabled={saving}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                saved
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : "bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
              }`}
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : saved ? "Saved!" : "Save Rules"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
