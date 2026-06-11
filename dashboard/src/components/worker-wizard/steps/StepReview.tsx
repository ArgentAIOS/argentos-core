import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import type { IntentDepartmentConfig } from "../../../../../src/config/types.intent";
import type { WizardState, ValidationResult, ValidationIssue } from "../types";
import { HierarchyDiagram } from "../shared/HierarchyDiagram";

interface StepReviewProps {
  state: WizardState;
  validation: ValidationResult;
  departments: Record<string, IntentDepartmentConfig>;
  globalObjective?: string;
  validating: boolean;
}

function SeverityIcon({ severity }: { severity: ValidationIssue["severity"] }) {
  if (severity === "error") {
    return <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
  }
  return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />;
}

export function StepReview({
  state,
  validation,
  departments,
  globalObjective,
  validating,
}: StepReviewProps) {
  const deptId =
    state.department.mode === "existing" ? state.department.existingId : state.department.newId;
  const role = state.identity.role === "custom" ? state.identity.customRole : state.identity.role;

  return (
    <div className="grid grid-cols-2 gap-4 max-h-[55vh] overflow-y-auto pr-1">
      {/* Left: Summary */}
      <div className="space-y-3">
        <h3 className="text-white/50 text-xs font-medium uppercase tracking-wider">Summary</h3>

        <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2.5">
          <Row
            label="Agent"
            value={`${state.identity.emoji || "🤖"} ${state.identity.displayName}`}
          />
          <Row label="ID" value={state.identity.agentId} mono />
          <Row label="Role" value={role || "—"} />
          <Row label="Team" value={state.identity.team || "—"} />
          <div className="h-px bg-white/5" />
          <Row label="Department" value={deptId || "—"} />
          <Row
            label="Dept Mode"
            value={
              state.department.mode === "new" ? (
                <span className="text-purple-300">Create new</span>
              ) : (
                "Join existing"
              )
            }
          />
          <div className="h-px bg-white/5" />
          <Row label="Objective" value={state.boundaries.objective || "—"} truncate />
          <Row label="Never Do" value={`${state.boundaries.neverDo.length} rules`} />
          <Row label="Allowed" value={`${state.boundaries.allowedActions.length} actions`} />
          <Row
            label="Approval Req."
            value={`${state.boundaries.requiresHumanApproval.length} items`}
          />
          <div className="h-px bg-white/5" />
          <Row
            label="Simulation"
            value={
              state.simulation.enabled ? (
                <span
                  className={
                    state.simulation.mode === "enforce" ? "text-red-300" : "text-amber-300"
                  }
                >
                  {state.simulation.mode} ({Math.round(state.simulation.minPassRate * 100)}%)
                </span>
              ) : (
                <span className="text-white/30">Disabled</span>
              )
            }
          />
        </div>
      </div>

      {/* Right: Hierarchy + Validation */}
      <div className="space-y-3">
        <h3 className="text-white/50 text-xs font-medium uppercase tracking-wider">Hierarchy</h3>
        <HierarchyDiagram
          state={state}
          globalObjective={globalObjective}
          departmentObjective={
            state.department.mode === "existing"
              ? departments[state.department.existingId]?.objective
              : undefined
          }
          compact
        />

        <h3 className="text-white/50 text-xs font-medium uppercase tracking-wider mt-4">
          Validation
        </h3>

        {validating ? (
          <div className="flex items-center gap-2 text-white/30 text-sm py-4">
            <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            Validating...
          </div>
        ) : validation.valid ? (
          <div className="flex items-center gap-2 text-green-400 text-sm p-3 rounded-lg border border-green-500/20 bg-green-600/5">
            <CheckCircle className="w-4 h-4" />
            All checks passed
          </div>
        ) : (
          <div className="space-y-1.5">
            {validation.issues.map((issue, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 text-xs p-2 rounded-lg border ${
                  issue.severity === "error"
                    ? "border-red-500/20 bg-red-600/5 text-red-300"
                    : "border-amber-500/20 bg-amber-600/5 text-amber-300"
                }`}
              >
                <SeverityIcon severity={issue.severity} />
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-white/30 text-xs flex-shrink-0">{label}</span>
      <span
        className={`text-white text-xs text-right ${mono ? "font-mono" : ""} ${truncate ? "truncate max-w-[180px]" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
