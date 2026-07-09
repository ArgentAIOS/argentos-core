import { User } from "lucide-react";
import type { WizardState, RolePreset, WorkerTemplate } from "../types";
import { WORKER_TEMPLATES } from "../types";

interface StepIdentityProps {
  state: WizardState;
  onChange: (state: WizardState) => void;
  onApplyTemplate: (template: WorkerTemplate) => void;
}

const ROLE_OPTIONS: { value: RolePreset; label: string }[] = [
  { value: "tier_1_support", label: "Tier 1 Support" },
  { value: "tier_2_support", label: "Tier 2 Support" },
  { value: "developer", label: "Developer" },
  { value: "analyst", label: "Analyst" },
  { value: "researcher", label: "Researcher" },
  { value: "project_manager", label: "Project Manager" },
  { value: "custom", label: "Custom" },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function StepIdentity({ state, onChange, onApplyTemplate }: StepIdentityProps) {
  const id = state.identity;

  function update(patch: Partial<typeof id>) {
    const next = { ...id, ...patch };
    if (patch.displayName !== undefined && !id.agentId) {
      next.agentId = slugify(patch.displayName);
    }
    onChange({ ...state, identity: next });
  }

  return (
    <div className="space-y-6">
      {/* Template cards */}
      <div>
        <label className="text-white/60 text-xs font-medium block mb-2">Quick Start Template</label>
        <div className="grid grid-cols-2 gap-2">
          {WORKER_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onApplyTemplate(t)}
              className="text-left p-3 rounded-lg border border-white/10 bg-white/5 hover:border-purple-500/40 hover:bg-purple-600/5 transition-all group"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{t.emoji}</span>
                <span className="text-white font-medium text-sm group-hover:text-purple-300 transition-colors">
                  {t.label}
                </span>
              </div>
              <p className="text-white/30 text-xs">{t.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="h-px bg-white/5" />

      {/* Identity fields */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="text-white/60 text-xs font-medium block mb-1.5">Display Name</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
            <input
              type="text"
              value={id.displayName}
              onChange={(e) => update({ displayName: e.target.value })}
              placeholder="e.g. Support Agent Alpha"
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-white text-sm placeholder-white/20 focus:border-purple-500/50 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="text-white/60 text-xs font-medium block mb-1.5">Agent ID</label>
          <input
            type="text"
            value={id.agentId}
            onChange={(e) =>
              onChange({ ...state, identity: { ...id, agentId: slugify(e.target.value) } })
            }
            placeholder="auto-generated"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:border-purple-500/50 focus:outline-none font-mono"
          />
          {id.agentId && <p className="text-white/20 text-[10px] mt-1 font-mono">{id.agentId}</p>}
        </div>

        <div>
          <label className="text-white/60 text-xs font-medium block mb-1.5">Emoji</label>
          <input
            type="text"
            value={id.emoji}
            onChange={(e) => update({ emoji: e.target.value.slice(0, 2) })}
            placeholder="🤖"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm text-center placeholder-white/20 focus:border-purple-500/50 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-white/60 text-xs font-medium block mb-1.5">Role</label>
          <select
            value={id.role}
            onChange={(e) => update({ role: e.target.value as RolePreset })}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-purple-500/50 focus:outline-none"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value} className="bg-gray-900">
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-white/60 text-xs font-medium block mb-1.5">Team</label>
          <input
            type="text"
            value={id.team}
            onChange={(e) => update({ team: e.target.value })}
            placeholder="e.g. MSP Team"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:border-purple-500/50 focus:outline-none"
          />
        </div>
      </div>

      {id.role === "custom" && (
        <div>
          <label className="text-white/60 text-xs font-medium block mb-1.5">Custom Role</label>
          <input
            type="text"
            value={id.customRole}
            onChange={(e) => update({ customRole: e.target.value })}
            placeholder="e.g. compliance_officer"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:border-purple-500/50 focus:outline-none font-mono"
          />
        </div>
      )}
    </div>
  );
}
