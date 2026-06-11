import { CheckCircle } from "lucide-react";
import { WIZARD_STEPS, STEP_LABELS, type WizardStep } from "../types";

interface StepIndicatorProps {
  currentStep: WizardStep;
}

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  const currentIndex = WIZARD_STEPS.indexOf(currentStep);

  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {WIZARD_STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
                i < currentIndex
                  ? "bg-purple-600 text-white"
                  : i === currentIndex
                    ? "bg-purple-600/20 border-2 border-purple-500 text-purple-400"
                    : "bg-white/5 border border-white/10 text-white/30"
              }`}
            >
              {i < currentIndex ? <CheckCircle className="w-4 h-4" /> : i + 1}
            </div>
            <span
              className={`text-[10px] font-medium ${
                i <= currentIndex ? "text-purple-400" : "text-white/20"
              }`}
            >
              {STEP_LABELS[step]}
            </span>
          </div>
          {i < WIZARD_STEPS.length - 1 && (
            <div
              className={`w-6 h-0.5 mb-4 transition-all duration-300 ${
                i < currentIndex ? "bg-purple-600" : "bg-white/10"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
