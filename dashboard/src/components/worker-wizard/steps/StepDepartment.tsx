import { Building2, Plus, ArrowRight } from "lucide-react";
import type { IntentDepartmentConfig } from "../../../../../src/config/types.intent";
import type { WizardState, DepartmentChoice } from "../types";
import { HierarchyDiagram } from "../shared/HierarchyDiagram";

interface StepDepartmentProps {
  state: WizardState;
  onChange: (state: WizardState) => void;
  departments: Record<string, IntentDepartmentConfig>;
  globalObjective?: string;
}

function slugifyDept(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function StepDepartment({
  state,
  onChange,
  departments,
  globalObjective,
}: StepDepartmentProps) {
  const dept = state.department;
  const deptKeys = Object.keys(departments);

  function update(patch: Partial<DepartmentChoice>) {
    onChange({ ...state, department: { ...dept, ...patch } });
  }

  return (
    <div className="space-y-5">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => update({ mode: "existing" })}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${
            dept.mode === "existing"
              ? "border-purple-500/50 bg-purple-600/10 text-purple-300"
              : "border-white/10 bg-white/5 text-white/40 hover:text-white/60"
          }`}
        >
          <ArrowRight className="w-4 h-4" />
          Join Existing
        </button>
        <button
          onClick={() => update({ mode: "new" })}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${
            dept.mode === "new"
              ? "border-purple-500/50 bg-purple-600/10 text-purple-300"
              : "border-white/10 bg-white/5 text-white/40 hover:text-white/60"
          }`}
        >
          <Plus className="w-4 h-4" />
          Create New
        </button>
      </div>

      {dept.mode === "existing" ? (
        <div className="space-y-3">
          {deptKeys.length === 0 ? (
            <div className="text-center py-6 text-white/30 text-sm">
              No departments configured yet.{" "}
              <button
                onClick={() => update({ mode: "new" })}
                className="text-purple-400 hover:text-purple-300"
              >
                Create one
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {deptKeys.map((key) => {
                const d = departments[key];
                const selected = dept.existingId === key;
                return (
                  <button
                    key={key}
                    onClick={() => update({ existingId: key })}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      selected
                        ? "border-purple-500/50 bg-purple-600/10"
                        : "border-white/10 bg-white/5 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Building2
                        className={`w-4 h-4 ${selected ? "text-purple-400" : "text-white/30"}`}
                      />
                      <span
                        className={`font-medium text-sm ${selected ? "text-purple-300" : "text-white/70"}`}
                      >
                        {key}
                      </span>
                    </div>
                    {d?.objective && (
                      <p className="text-white/30 text-xs mt-1 ml-6 truncate">{d.objective}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-white/60 text-xs font-medium block mb-1.5">Department ID</label>
            <input
              type="text"
              value={dept.newId}
              onChange={(e) => update({ newId: slugifyDept(e.target.value) })}
              placeholder="e.g. msp-support"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:border-purple-500/50 focus:outline-none font-mono"
            />
          </div>
          <div>
            <label className="text-white/60 text-xs font-medium block mb-1.5">Objective</label>
            <textarea
              value={dept.newObjective}
              onChange={(e) => update({ newObjective: e.target.value })}
              placeholder="What is this department's primary mission?"
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:border-purple-500/50 focus:outline-none resize-none"
            />
          </div>
          <p className="text-white/20 text-xs flex items-center gap-1">
            <Building2 className="w-3 h-3" />
            Inherits all global policies automatically
          </p>
        </div>
      )}

      {/* Hierarchy preview */}
      <div>
        <label className="text-white/40 text-[10px] font-medium uppercase tracking-wider block mb-2">
          Hierarchy Preview
        </label>
        <HierarchyDiagram
          state={state}
          globalObjective={globalObjective}
          departmentObjective={
            dept.mode === "existing" ? departments[dept.existingId]?.objective : undefined
          }
          compact
        />
      </div>
    </div>
  );
}
