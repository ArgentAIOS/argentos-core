import { Globe, Building2, Bot, ChevronDown } from "lucide-react";
import type { WizardState } from "../types";

interface HierarchyDiagramProps {
  state: WizardState;
  globalObjective?: string;
  departmentObjective?: string;
  compact?: boolean;
}

export function HierarchyDiagram({
  state,
  globalObjective,
  departmentObjective,
  compact = false,
}: HierarchyDiagramProps) {
  const deptId =
    state.department.mode === "existing" ? state.department.existingId : state.department.newId;
  const deptObj =
    state.department.mode === "new" ? state.department.newObjective : departmentObjective;

  return (
    <div className={`flex flex-col items-center gap-1 ${compact ? "text-xs" : "text-sm"}`}>
      {/* Global */}
      <div
        className={`w-full rounded-lg border border-white/10 bg-white/5 ${compact ? "p-2" : "p-3"}`}
      >
        <div className="flex items-center gap-2 mb-1">
          <Globe className={`${compact ? "w-3 h-3" : "w-4 h-4"} text-cyan-400`} />
          <span className="text-cyan-400 font-medium">Global</span>
        </div>
        {globalObjective && <p className="text-white/40 text-xs truncate">{globalObjective}</p>}
      </div>

      <ChevronDown className="w-4 h-4 text-white/20" />

      {/* Department */}
      <div
        className={`w-full rounded-lg border ${
          deptId
            ? "border-purple-500/30 bg-purple-600/10"
            : "border-white/10 bg-white/5 border-dashed"
        } ${compact ? "p-2" : "p-3"}`}
      >
        <div className="flex items-center gap-2 mb-1">
          <Building2 className={`${compact ? "w-3 h-3" : "w-4 h-4"} text-purple-400`} />
          <span className="text-purple-400 font-medium">{deptId || "Department"}</span>
          {state.department.mode === "new" && deptId && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-600/20 text-purple-300">
              new
            </span>
          )}
        </div>
        {deptObj && <p className="text-white/40 text-xs truncate">{deptObj}</p>}
      </div>

      <ChevronDown className="w-4 h-4 text-white/20" />

      {/* Agent */}
      <div
        className={`w-full rounded-lg border ${
          state.identity.agentId
            ? "border-amber-500/30 bg-amber-600/10"
            : "border-white/10 bg-white/5 border-dashed"
        } ${compact ? "p-2" : "p-3"}`}
      >
        <div className="flex items-center gap-2 mb-1">
          <Bot className={`${compact ? "w-3 h-3" : "w-4 h-4"} text-amber-400`} />
          <span className="text-amber-400 font-medium">
            {state.identity.emoji ? `${state.identity.emoji} ` : ""}
            {state.identity.displayName || "Agent"}
          </span>
        </div>
        {state.boundaries.objective && (
          <p className="text-white/40 text-xs truncate">{state.boundaries.objective}</p>
        )}
      </div>
    </div>
  );
}
