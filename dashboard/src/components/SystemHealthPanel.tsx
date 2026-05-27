import { RefreshCw, Cpu, Thermometer, Server, Brain, AlertCircle } from "lucide-react";
import { useSystemHealth, type SystemHealthSnapshot } from "../hooks/useSystemHealth";

// HANDOFF-system-health-panel.md M1 — read-only system health surface.
// M2 adds rule-based suggestions, M3 adds AI-tuned ones. The panel is
// deliberately diagnostic-only at this stage: surface state, no actions.

function ThermalBadge({ thermal }: { thermal: SystemHealthSnapshot["thermal"] }) {
  const colorByInterpretation: Record<string, string> = {
    cool: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    mild: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    moderate: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    throttling: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    severe: "bg-red-500/20 text-red-300 border-red-500/40",
    unknown: "bg-white/10 text-white/60 border-white/20",
  };
  const cls = colorByInterpretation[thermal.interpretation] || colorByInterpretation.unknown;
  return (
    <span className={`px-2 py-0.5 rounded-md border text-xs font-medium ${cls}`}>
      {thermal.interpretation}
    </span>
  );
}

function RuntimeRow({
  label,
  reachable,
  activeModels,
  loadedModels,
}: {
  label: string;
  reachable: boolean;
  activeModels?: string[];
  loadedModels: string[];
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`w-2 h-2 rounded-full ${reachable ? "bg-emerald-400" : "bg-white/20"}`}
          aria-hidden
        />
        <span className="text-white/80 text-sm">{label}</span>
      </div>
      <div className="text-right text-xs text-white/50 min-w-0 max-w-[60%] truncate">
        {!reachable
          ? "not reachable"
          : activeModels && activeModels.length > 0
            ? `${activeModels[0]} (warm)${loadedModels.length > 1 ? ` +${loadedModels.length - 1}` : ""}`
            : loadedModels.length > 0
              ? `${loadedModels.length} model${loadedModels.length === 1 ? "" : "s"} registered`
              : "no models"}
      </div>
    </div>
  );
}

export default function SystemHealthPanel() {
  const { snapshot, loading, error, refresh, lastRefreshedAt } = useSystemHealth();

  return (
    <div className="bg-gray-800/40 rounded-xl border border-white/5 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          <h3 className="text-white/90 font-medium text-sm">System Health</h3>
          {snapshot?.cached ? (
            <span className="text-[10px] text-white/30 uppercase tracking-wider">cached</span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshedAt ? (
            <span className="text-[11px] text-white/40">
              {lastRefreshedAt.toLocaleTimeString()}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-white/10 text-white/50 hover:text-white/80 hover:border-white/20 disabled:text-white/20 disabled:border-white/5 transition-all text-[11px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Failed to load system snapshot</div>
            <div className="text-red-300/70">{error}</div>
          </div>
        </div>
      ) : null}

      {!snapshot && !error ? (
        <div className="text-white/40 text-sm italic">Probing system…</div>
      ) : null}

      {snapshot ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <section className="bg-gray-900/40 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-white/60 text-xs uppercase tracking-wider">
              <Cpu className="w-3.5 h-3.5" />
              Hardware
            </div>
            <div className="text-white/90 text-sm">{snapshot.hardware.chip}</div>
            <div className="text-white/50 text-xs">
              {snapshot.hardware.machineName} · {snapshot.hardware.chassis} ·{" "}
              {snapshot.hardware.memoryGb} GB
            </div>
            <div className="text-white/40 text-xs">
              {snapshot.hardware.cores.performance}P + {snapshot.hardware.cores.efficiency}E cores ·{" "}
              {snapshot.hardware.os.name} {snapshot.hardware.os.version}
            </div>
          </section>

          <section className="bg-gray-900/40 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/60 text-xs uppercase tracking-wider">
                <Thermometer className="w-3.5 h-3.5" />
                Thermal
              </div>
              <ThermalBadge thermal={snapshot.thermal} />
            </div>
            {snapshot.thermal.kernelTaskPercent !== null ? (
              <div className="text-white/90 text-sm">
                kernel_task {snapshot.thermal.kernelTaskPercent.toFixed(1)}%
              </div>
            ) : (
              <div className="text-white/90 text-sm">
                Load/core {snapshot.thermal.loadPerCore.toFixed(2)}
              </div>
            )}
            <div className="text-white/40 text-xs">
              indicator: {snapshot.thermal.indicator} · load1 {snapshot.thermal.load1}
            </div>
          </section>

          <section className="bg-gray-900/40 rounded-lg p-3">
            <div className="flex items-center gap-2 text-white/60 text-xs uppercase tracking-wider mb-1">
              <Server className="w-3.5 h-3.5" />
              Local LLM runtimes
            </div>
            <RuntimeRow
              label="Ollama"
              reachable={snapshot.runtimes.ollama.reachable}
              activeModels={snapshot.runtimes.ollama.activeModels}
              loadedModels={snapshot.runtimes.ollama.loadedModels}
            />
            <RuntimeRow
              label="LM Studio"
              reachable={snapshot.runtimes.lmStudio.reachable}
              loadedModels={snapshot.runtimes.lmStudio.loadedModels}
            />
            <RuntimeRow
              label="omlx"
              reachable={snapshot.runtimes.omlx.reachable}
              loadedModels={snapshot.runtimes.omlx.loadedModels}
            />
          </section>

          <section className="bg-gray-900/40 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-white/60 text-xs uppercase tracking-wider">
              <Brain className="w-3.5 h-3.5" />
              Consciousness kernel
            </div>
            <div className="text-white/90 text-sm">
              {snapshot.kernel.enabled ? snapshot.kernel.mode : "disabled"}
            </div>
            <div className="text-white/50 text-xs">
              model: {snapshot.kernel.localModel || "(not set)"}
            </div>
            <div className="text-white/40 text-xs">
              tick {Math.round(snapshot.kernel.tickMs / 1000)}s · idle-gate{" "}
              {snapshot.kernel.idleActivityGateMinutes}min
            </div>
          </section>
        </div>
      ) : null}

      <div className="text-[10px] text-white/30 italic">
        M1 — read-only diagnostic. Suggestions arrive in M2 (rules) and M3 (AI advisor).
      </div>
    </div>
  );
}
