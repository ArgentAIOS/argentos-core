import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { useState, useEffect } from "react";
import type { IntentConfig, IntentDepartmentConfig } from "../../../../src/config/types.intent";
import type { WizardStep, WizardState, WorkerTemplate, ValidationResult } from "./types";
import { fetchLocalApi } from "../../utils/localApiFetch";
import { AIChatSidebar } from "./AIChatSidebar";
import { StepIndicator } from "./shared/StepIndicator";
import { StepBoundaries } from "./steps/StepBoundaries";
import { StepDepartment } from "./steps/StepDepartment";
import { StepDeploy } from "./steps/StepDeploy";
import { StepIdentity } from "./steps/StepIdentity";
import { StepReview } from "./steps/StepReview";
import { StepSimulation } from "./steps/StepSimulation";
import { WIZARD_STEPS, createDefaultState, buildIntentAgentConfig } from "./types";

interface WorkerWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenIntentEditor?: () => void;
  gatewayRequest: <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ) => Promise<T>;
}

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction > 0 ? -300 : 300,
    opacity: 0,
  }),
};

export function WorkerWizard({
  isOpen,
  onClose,
  onOpenIntentEditor,
  gatewayRequest,
}: WorkerWizardProps) {
  const [state, setState] = useState<WizardState>(createDefaultState);
  const [step, setStep] = useState<WizardStep>("identity");
  const [direction, setDirection] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Intent data from server
  const [intentConfig, setIntentConfig] = useState<IntentConfig>({});
  const [validation, setValidation] = useState<ValidationResult>({ valid: true, issues: [] });
  const [validating, setValidating] = useState(false);
  const [existingAgents, setExistingAgents] = useState<string[]>([]);

  // Reset state when wizard opens
  useEffect(() => {
    if (isOpen) {
      resetWizard();
    }
  }, [isOpen]);

  // Load intent config
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    fetchLocalApi("/api/settings/intent")
      .then((r) => r.json())
      .then((data) => {
        const intent = data?.intent ?? {};
        setIntentConfig(intent);
        setExistingAgents(Object.keys(intent.agents ?? {}));
      })
      .catch(() => {});
  }, [isOpen]);

  const departments: Record<string, IntentDepartmentConfig> = intentConfig.departments ?? {};
  const globalObjective = intentConfig.global?.objective;

  // Resolve effective parent policies: global + selected department merged
  const selectedDeptId =
    state.department.mode === "existing" ? state.department.existingId : state.department.newId;
  const selectedDeptConfig = selectedDeptId ? departments[selectedDeptId] : undefined;

  const parentNeverDo = [
    ...new Set([...(intentConfig.global?.neverDo ?? []), ...(selectedDeptConfig?.neverDo ?? [])]),
  ];
  const parentAllowedActions = (() => {
    const globalAllowed = intentConfig.global?.allowedActions ?? [];
    const deptAllowed = selectedDeptConfig?.allowedActions ?? [];
    return deptAllowed.length > 0 ? deptAllowed : globalAllowed;
  })();
  const parentRequiresHumanApproval = [
    ...new Set([
      ...(intentConfig.global?.requiresHumanApproval ?? []),
      ...(selectedDeptConfig?.requiresHumanApproval ?? []),
    ]),
  ];
  const parentObjective = selectedDeptConfig?.objective || globalObjective;

  const stepIndex = WIZARD_STEPS.indexOf(step);

  function goNext() {
    if (stepIndex >= WIZARD_STEPS.length - 1) {
      return;
    }
    setDirection(1);
    setStep(WIZARD_STEPS[stepIndex + 1]);
  }

  function goBack() {
    if (stepIndex <= 0) {
      return;
    }
    setDirection(-1);
    setStep(WIZARD_STEPS[stepIndex - 1]);
  }

  function applyTemplate(template: WorkerTemplate) {
    const next = createDefaultState();

    // Identity
    if (template.identity.role) {
      next.identity.role = template.identity.role;
    }
    if (template.identity.team) {
      next.identity.team = template.identity.team;
    }
    next.identity.displayName = state.identity.displayName || "";
    next.identity.agentId = state.identity.agentId || "";
    next.identity.emoji = state.identity.emoji || template.emoji;

    // Department
    if (template.department.mode) {
      next.department.mode = template.department.mode;
    }
    if (template.department.existingId) {
      next.department.existingId = template.department.existingId;
    }
    if (template.department.newId) {
      next.department.newId = template.department.newId;
    }
    if (template.department.newObjective) {
      next.department.newObjective = template.department.newObjective;
    }

    // Boundaries
    next.boundaries = { ...template.boundaries };

    // Simulation
    if (template.simulation.enabled !== undefined) {
      next.simulation.enabled = template.simulation.enabled;
    }
    if (template.simulation.mode) {
      next.simulation.mode = template.simulation.mode;
    }
    if (template.simulation.minPassRate !== undefined) {
      next.simulation.minPassRate = template.simulation.minPassRate;
    }
    if (template.simulation.minComponentScores) {
      next.simulation.minComponentScores = {
        ...next.simulation.minComponentScores,
        ...template.simulation.minComponentScores,
      };
    }

    setState(next);
  }

  // Validate on review step
  useEffect(() => {
    if (step !== "review") {
      return;
    }
    void validateState();
  }, [step]);

  async function validateState() {
    setValidating(true);
    const issues: ValidationResult["issues"] = [];

    // Client-side checks
    if (!state.identity.agentId) {
      issues.push({ field: "agentId", message: "Agent ID is required", severity: "error" });
    } else if (!/^[a-z0-9-]+$/.test(state.identity.agentId)) {
      issues.push({
        field: "agentId",
        message: "Agent ID must be lowercase letters, numbers, and hyphens",
        severity: "error",
      });
    }

    if (existingAgents.includes(state.identity.agentId)) {
      issues.push({
        field: "agentId",
        message: `Agent "${state.identity.agentId}" already exists`,
        severity: "error",
      });
    }

    if (!state.identity.displayName) {
      issues.push({ field: "displayName", message: "Display name is required", severity: "error" });
    }

    const deptId =
      state.department.mode === "existing" ? state.department.existingId : state.department.newId;
    if (!deptId) {
      issues.push({ field: "department", message: "Department is required", severity: "error" });
    }

    if (!state.boundaries.objective) {
      issues.push({
        field: "objective",
        message: "Mission objective is recommended",
        severity: "warning",
      });
    }

    if (state.boundaries.neverDo.length === 0 && state.boundaries.allowedActions.length === 0) {
      issues.push({
        field: "boundaries",
        message: "Consider adding at least one rule",
        severity: "warning",
      });
    }

    // ── Monotonic inheritance checks ──────────────────────────────────
    // Resolve effective parent policies: global + department merged
    const deptConfig = deptId ? departments[deptId] : undefined;
    const globalNeverDo = intentConfig.global?.neverDo ?? [];
    const deptNeverDo = deptConfig?.neverDo ?? [];
    const allParentNeverDo = [...new Set([...globalNeverDo, ...deptNeverDo])];

    const globalAllowed = intentConfig.global?.allowedActions ?? [];
    const deptAllowed = deptConfig?.allowedActions ?? [];
    // Parent allowedActions: department narrows global; if dept has none, use global
    const effectiveParentAllowed = deptAllowed.length > 0 ? deptAllowed : globalAllowed;

    const globalApproval = intentConfig.global?.requiresHumanApproval ?? [];
    const deptApproval = deptConfig?.requiresHumanApproval ?? [];
    const allParentApproval = [...new Set([...globalApproval, ...deptApproval])];

    // neverDo: agent must include ALL parent neverDo (additive only)
    const missingNeverDo = allParentNeverDo.filter((r) => !state.boundaries.neverDo.includes(r));
    if (missingNeverDo.length > 0) {
      issues.push({
        field: "neverDo",
        message: `Missing inherited neverDo rules: ${missingNeverDo.join(", ")}`,
        severity: "error",
      });
    }

    // allowedActions: agent must be a SUBSET of parent (can only narrow)
    if (effectiveParentAllowed.length > 0) {
      const parentSet = new Set(effectiveParentAllowed);
      const extraActions = state.boundaries.allowedActions.filter((a) => !parentSet.has(a));
      if (extraActions.length > 0) {
        issues.push({
          field: "allowedActions",
          message: `Actions not in parent allowlist: ${extraActions.join(", ")}`,
          severity: "warning",
        });
      }
    }

    // requiresHumanApproval: agent must include ALL parent items (additive only)
    const missingApproval = allParentApproval.filter(
      (r) => !state.boundaries.requiresHumanApproval.includes(r),
    );
    if (missingApproval.length > 0) {
      issues.push({
        field: "requiresHumanApproval",
        message: `Missing inherited approval requirements: ${missingApproval.join(", ")}`,
        severity: "error",
      });
    }

    // Escalation: agent thresholds should be stricter than parent
    const parentEscalation = {
      ...intentConfig.global?.escalation,
      ...deptConfig?.escalation,
    };
    if (
      parentEscalation.maxAttemptsBeforeEscalation !== undefined &&
      state.boundaries.escalation.maxAttempts > parentEscalation.maxAttemptsBeforeEscalation
    ) {
      issues.push({
        field: "escalation",
        message: `Max attempts (${state.boundaries.escalation.maxAttempts}) exceeds parent limit (${parentEscalation.maxAttemptsBeforeEscalation})`,
        severity: "warning",
      });
    }
    if (
      parentEscalation.sentimentThreshold !== undefined &&
      state.boundaries.escalation.sentimentThreshold < parentEscalation.sentimentThreshold
    ) {
      issues.push({
        field: "escalation",
        message: `Sentiment threshold (${state.boundaries.escalation.sentimentThreshold}) is more lenient than parent (${parentEscalation.sentimentThreshold})`,
        severity: "warning",
      });
    }

    // Server-side validation via preview
    try {
      const intentCopy = JSON.parse(JSON.stringify(intentConfig));
      if (!intentCopy.agents) {
        intentCopy.agents = {};
      }
      const { policy, simulation } = buildIntentAgentConfig(state);
      intentCopy.agents[state.identity.agentId] = { ...policy, simulationGate: simulation };

      if (state.department.mode === "new" && deptId) {
        if (!intentCopy.departments) {
          intentCopy.departments = {};
        }
        intentCopy.departments[deptId] = { objective: state.department.newObjective };
      }

      const res = await fetchLocalApi("/api/settings/intent/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: intentCopy }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.errors) {
          for (const err of data.errors) {
            issues.push({ field: "intent", message: String(err), severity: "error" });
          }
        }
      }
    } catch {
      // Preview endpoint may not exist — skip
    }

    setValidation({
      valid: issues.filter((i) => i.severity === "error").length === 0,
      issues,
    });
    setValidating(false);
  }

  function canProceed(): boolean {
    switch (step) {
      case "identity":
        return !!state.identity.agentId && !!state.identity.displayName;
      case "department": {
        const deptId =
          state.department.mode === "existing"
            ? state.department.existingId
            : state.department.newId;
        return !!deptId;
      }
      case "boundaries":
        return true;
      case "simulation":
        return true;
      case "review":
        return validation.valid && !validating;
      default:
        return false;
    }
  }

  function resetWizard() {
    setState(createDefaultState());
    setStep("identity");
    setDirection(1);
    setValidation({ valid: true, issues: [] });
  }

  function renderStep() {
    switch (step) {
      case "identity":
        return <StepIdentity state={state} onChange={setState} onApplyTemplate={applyTemplate} />;
      case "department":
        return (
          <StepDepartment
            state={state}
            onChange={setState}
            departments={departments}
            globalObjective={globalObjective}
          />
        );
      case "boundaries":
        return (
          <StepBoundaries
            state={state}
            onChange={setState}
            parentNeverDo={parentNeverDo}
            parentAllowedActions={parentAllowedActions}
            parentRequiresHumanApproval={parentRequiresHumanApproval}
            parentObjective={parentObjective}
            roleName={
              state.identity.role === "custom" ? state.identity.customRole : state.identity.role
            }
            gatewayRequest={gatewayRequest}
          />
        );
      case "simulation":
        return <StepSimulation state={state} onChange={setState} />;
      case "review":
        return (
          <StepReview
            state={state}
            validation={validation}
            departments={departments}
            globalObjective={globalObjective}
            validating={validating}
          />
        );
      case "deploy":
        return (
          <StepDeploy
            state={state}
            gatewayRequest={gatewayRequest}
            onDone={onClose}
            onCreateAnother={() => {
              resetWizard();
            }}
            onOpenIntentEditor={() => {
              onClose();
              onOpenIntentEditor?.();
            }}
          />
        );
      default:
        return null;
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && step !== "deploy") {
              onClose();
            }
          }}
        >
          <div className="flex gap-0 max-h-[90vh]">
            {/* Main wizard panel */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className={`bg-[#0d0d1a] border border-white/10 rounded-2xl shadow-2xl flex flex-col ${
                sidebarOpen ? "w-[600px]" : "w-[640px]"
              } max-h-[85vh]`}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-5 pb-3">
                <h2 className="text-lg font-semibold text-white">New Worker</h2>
                <div className="flex items-center gap-2">
                  {step !== "deploy" && (
                    <button
                      onClick={() => setSidebarOpen(!sidebarOpen)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        sidebarOpen
                          ? "bg-purple-600/20 text-purple-400"
                          : "text-white/30 hover:text-white/50 hover:bg-white/5"
                      }`}
                      title="AI Assistant"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    disabled={step === "deploy"}
                    className="p-1.5 text-white/30 hover:text-white/60 disabled:opacity-30 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Step indicator */}
              <div className="px-6">
                <StepIndicator currentStep={step} />
              </div>

              {/* Step content */}
              <div className="flex-1 min-h-0 px-6 overflow-y-auto">
                <div className="relative min-h-[300px]">
                  <AnimatePresence mode="wait" custom={direction}>
                    <motion.div
                      key={step}
                      custom={direction}
                      variants={slideVariants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                    >
                      {renderStep()}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              {/* Navigation */}
              {step !== "deploy" && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
                  <button
                    onClick={goBack}
                    disabled={stepIndex === 0}
                    className="flex items-center gap-1 text-white/40 hover:text-white/70 disabled:opacity-20 text-sm transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button
                    onClick={goNext}
                    disabled={!canProceed()}
                    className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-white/10 disabled:text-white/30 text-white font-medium rounded-lg transition-colors text-sm"
                  >
                    {step === "review" ? "Deploy" : "Continue"}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </motion.div>

            {/* AI Sidebar */}
            <AnimatePresence>
              {sidebarOpen && step !== "deploy" && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 320, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <AIChatSidebar
                    state={state}
                    currentStep={step}
                    gatewayRequest={gatewayRequest}
                    onApplySuggestion={(patch) => {
                      setState((prev) => ({ ...prev, ...patch }));
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
