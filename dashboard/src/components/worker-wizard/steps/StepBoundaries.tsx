import { Shield, AlertTriangle, Sparkles, Loader2 } from "lucide-react";
import { useState } from "react";
import type { WizardState } from "../types";
import { TagInput } from "../shared/TagInput";

interface StepBoundariesProps {
  state: WizardState;
  onChange: (state: WizardState) => void;
  parentNeverDo?: string[];
  parentAllowedActions?: string[];
  parentRequiresHumanApproval?: string[];
  parentObjective?: string;
  roleName?: string;
  gatewayRequest?: <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ) => Promise<T>;
}

export function StepBoundaries({
  state,
  onChange,
  parentNeverDo = [],
  parentAllowedActions = [],
  parentRequiresHumanApproval = [],
  parentObjective,
  roleName,
  gatewayRequest,
}: StepBoundariesProps) {
  const b = state.boundaries;
  const [suggesting, setSuggesting] = useState(false);

  function update(patch: Partial<typeof b>) {
    onChange({ ...state, boundaries: { ...b, ...patch } });
  }

  function updateEscalation(patch: Partial<typeof b.escalation>) {
    onChange({
      ...state,
      boundaries: { ...b, escalation: { ...b.escalation, ...patch } },
    });
  }

  function toggleAllowedAction(action: string) {
    const current = b.allowedActions;
    if (current.includes(action)) {
      update({ allowedActions: current.filter((a) => a !== action) });
    } else {
      update({ allowedActions: [...current, action] });
    }
  }

  async function suggestForRole() {
    if (!gatewayRequest || !roleName || suggesting) {
      return;
    }
    setSuggesting(true);
    try {
      const response = await gatewayRequest<{ text?: string; response?: string }>(
        "chat",
        {
          message: `[WIZARD_ASSIST] Suggest intent boundaries for a "${roleName}" agent.
Return ONLY a JSON object (no markdown fences) with these fields:
- objective: string (1-2 sentences)
- neverDo: string[] (5-7 hard prohibitions)
- allowedActions: string[] (5-8 permitted actions using snake_case)
- requiresHumanApproval: string[] (2-4 actions needing approval)
- escalation: { sentimentThreshold: number (0-1), maxAttempts: number (1-10), alwaysEscalate: string[] }`,
          systemHint:
            "You are an AI workforce configuration assistant. Return ONLY valid JSON, no explanation.",
        },
        { timeoutMs: 30000 },
      );

      const text = response?.text || response?.response || "";
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.objective) {
          update({
            objective: parsed.objective,
            neverDo: [...new Set([...parentNeverDo, ...(parsed.neverDo || [])])],
            allowedActions: parsed.allowedActions || [],
            requiresHumanApproval: [
              ...new Set([...parentRequiresHumanApproval, ...(parsed.requiresHumanApproval || [])]),
            ],
            escalation: parsed.escalation
              ? {
                  sentimentThreshold: parsed.escalation.sentimentThreshold ?? 0.3,
                  maxAttempts: parsed.escalation.maxAttempts ?? 3,
                  alwaysEscalate: parsed.escalation.alwaysEscalate ?? [],
                }
              : b.escalation,
          });
        }
      }
    } catch {
      // Suggestion failed silently
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div className="space-y-5 max-h-[55vh] overflow-y-auto pr-1 custom-scrollbar">
      {/* Inherited objective context */}
      {parentObjective && (
        <div className="p-2.5 rounded-lg border border-white/5 bg-white/[0.02]">
          <p className="text-white/20 text-[10px] uppercase tracking-wider font-medium mb-1">
            Inherited Objective
          </p>
          <p className="text-white/30 text-xs italic truncate">{parentObjective}</p>
        </div>
      )}

      {/* Mission */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-white/60 text-xs font-medium">
            <Shield className="w-3 h-3 inline mr-1" />
            Mission Objective
          </label>
          {gatewayRequest && roleName && roleName !== "custom" && (
            <button
              onClick={suggestForRole}
              disabled={suggesting}
              className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 disabled:text-white/20 transition-colors"
            >
              {suggesting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              Suggest for {roleName}
            </button>
          )}
        </div>
        <textarea
          value={b.objective}
          onChange={(e) => update({ objective: e.target.value })}
          placeholder="What is this agent's primary purpose?"
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:border-purple-500/50 focus:outline-none resize-none"
        />
      </div>

      {/* Rules section */}
      <div className="space-y-4">
        <h3 className="text-white/50 text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 text-red-400" />
          Rules & Constraints
        </h3>

        <TagInput
          label="Never Do (hard prohibitions)"
          tags={b.neverDo}
          onChange={(neverDo) => update({ neverDo })}
          placeholder="e.g. delete databases"
          locked={parentNeverDo}
          accentColor="red"
        />

        {/* Allowed Actions: checkbox subset mode when parent has items */}
        {parentAllowedActions.length > 0 ? (
          <div>
            <label className="text-white/60 text-xs font-medium block mb-1.5">
              Allowed Actions{" "}
              <span className="text-white/20 font-normal">(select from parent allowlist)</span>
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {parentAllowedActions.map((action) => {
                const checked = b.allowedActions.includes(action);
                return (
                  <button
                    key={action}
                    onClick={() => toggleAllowedAction(action)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-all ${
                      checked
                        ? "bg-cyan-600/20 text-cyan-300 border border-cyan-500/30"
                        : "bg-white/5 text-white/30 border border-white/5 hover:border-white/10"
                    }`}
                  >
                    <div
                      className={`w-3 h-3 rounded border flex items-center justify-center ${
                        checked ? "border-cyan-400 bg-cyan-500/20" : "border-white/20"
                      }`}
                    >
                      {checked && <div className="w-1.5 h-1.5 rounded-sm bg-cyan-400" />}
                    </div>
                    {action}
                  </button>
                );
              })}
            </div>
            <p className="text-white/15 text-[10px]">
              Agent can only use actions from the parent allowlist (subset narrowing)
            </p>
          </div>
        ) : (
          <TagInput
            label="Allowed Actions"
            tags={b.allowedActions}
            onChange={(allowedActions) => update({ allowedActions })}
            placeholder="e.g. create_ticket"
            accentColor="cyan"
          />
        )}

        <TagInput
          label="Requires Human Approval"
          tags={b.requiresHumanApproval}
          onChange={(requiresHumanApproval) => update({ requiresHumanApproval })}
          placeholder="e.g. production_deploy"
          locked={parentRequiresHumanApproval}
          accentColor="amber"
        />
      </div>

      {/* Escalation section */}
      <div className="space-y-3">
        <h3 className="text-white/50 text-xs font-medium uppercase tracking-wider">
          Escalation Thresholds
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-white/40 text-[10px] block mb-1">
              Sentiment Threshold: {b.escalation.sentimentThreshold.toFixed(1)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={b.escalation.sentimentThreshold}
              onChange={(e) => updateEscalation({ sentimentThreshold: parseFloat(e.target.value) })}
              className="w-full accent-purple-500"
            />
            <div className="flex justify-between text-[9px] text-white/20">
              <span>Sensitive</span>
              <span>Tolerant</span>
            </div>
          </div>

          <div>
            <label className="text-white/40 text-[10px] block mb-1">
              Max Attempts: {b.escalation.maxAttempts}
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={b.escalation.maxAttempts}
              onChange={(e) => updateEscalation({ maxAttempts: parseInt(e.target.value) })}
              className="w-full accent-purple-500"
            />
            <div className="flex justify-between text-[9px] text-white/20">
              <span>1</span>
              <span>10</span>
            </div>
          </div>
        </div>

        <TagInput
          label="Always Escalate (trigger keywords)"
          tags={b.escalation.alwaysEscalate}
          onChange={(alwaysEscalate) => updateEscalation({ alwaysEscalate })}
          placeholder="e.g. security_incident"
          accentColor="amber"
        />
      </div>
    </div>
  );
}
