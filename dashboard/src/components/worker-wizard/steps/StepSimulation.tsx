import { FlaskConical, ToggleLeft, ToggleRight } from "lucide-react";
import type { WizardState } from "../types";
import { TagInput } from "../shared/TagInput";

interface StepSimulationProps {
  state: WizardState;
  onChange: (state: WizardState) => void;
}

export function StepSimulation({ state, onChange }: StepSimulationProps) {
  const sim = state.simulation;

  function update(patch: Partial<typeof sim>) {
    onChange({ ...state, simulation: { ...sim, ...patch } });
  }

  function updateScore(key: keyof typeof sim.minComponentScores, value: number) {
    onChange({
      ...state,
      simulation: {
        ...sim,
        minComponentScores: { ...sim.minComponentScores, [key]: value },
      },
    });
  }

  const scores = [
    { key: "objectiveAdherence" as const, label: "Objective Adherence", color: "text-cyan-400" },
    { key: "boundaryCompliance" as const, label: "Boundary Compliance", color: "text-red-400" },
    {
      key: "escalationCorrectness" as const,
      label: "Escalation Correctness",
      color: "text-amber-400",
    },
    { key: "outcomeQuality" as const, label: "Outcome Quality", color: "text-green-400" },
  ];

  return (
    <div className="space-y-5">
      {/* Toggle */}
      <div className="flex items-center justify-between p-4 rounded-lg border border-white/10 bg-white/5">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-5 h-5 text-purple-400" />
          <div>
            <p className="text-white font-medium text-sm">Simulation Gate</p>
            <p className="text-white/30 text-xs">Run test scenarios before deploying this agent</p>
          </div>
        </div>
        <button
          onClick={() => update({ enabled: !sim.enabled })}
          className="text-purple-400 hover:text-purple-300 transition-colors"
        >
          {sim.enabled ? (
            <ToggleRight className="w-8 h-8" />
          ) : (
            <ToggleLeft className="w-8 h-8 text-white/20" />
          )}
        </button>
      </div>

      {!sim.enabled ? (
        <div className="text-center py-8 text-white/20 text-sm">
          Simulation gate is optional. You can enable it later in the Intent Editor.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Mode */}
          <div className="flex gap-2">
            <button
              onClick={() => update({ mode: "warn" })}
              className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                sim.mode === "warn"
                  ? "border-amber-500/50 bg-amber-600/10 text-amber-300"
                  : "border-white/10 bg-white/5 text-white/40"
              }`}
            >
              Warn
            </button>
            <button
              onClick={() => update({ mode: "enforce" })}
              className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                sim.mode === "enforce"
                  ? "border-red-500/50 bg-red-600/10 text-red-300"
                  : "border-white/10 bg-white/5 text-white/40"
              }`}
            >
              Enforce
            </button>
          </div>

          {/* Min pass rate */}
          <div>
            <label className="text-white/40 text-xs block mb-1">
              Min Pass Rate: {Math.round(sim.minPassRate * 100)}%
            </label>
            <input
              type="range"
              min="0.5"
              max="1"
              step="0.05"
              value={sim.minPassRate}
              onChange={(e) => update({ minPassRate: parseFloat(e.target.value) })}
              className="w-full accent-purple-500"
            />
          </div>

          {/* Component score thresholds */}
          <div>
            <label className="text-white/50 text-xs font-medium uppercase tracking-wider block mb-3">
              Component Score Thresholds
            </label>
            <div className="space-y-2.5">
              {scores.map((s) => (
                <div key={s.key}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className={s.color}>{s.label}</span>
                    <span className="text-white/40">
                      {Math.round(sim.minComponentScores[s.key] * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="1"
                    step="0.05"
                    value={sim.minComponentScores[s.key]}
                    onChange={(e) => updateScore(s.key, parseFloat(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Report path */}
          <div>
            <label className="text-white/60 text-xs font-medium block mb-1.5">Report Path</label>
            <input
              type="text"
              value={sim.reportPath}
              onChange={(e) => update({ reportPath: e.target.value })}
              placeholder="Auto-generated if blank"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:border-purple-500/50 focus:outline-none font-mono"
            />
          </div>

          {/* Suites */}
          <TagInput
            label="Test Suite IDs (optional)"
            tags={sim.suites}
            onChange={(suites) => update({ suites })}
            placeholder="e.g. t1-support-scenarios"
          />
        </div>
      )}
    </div>
  );
}
