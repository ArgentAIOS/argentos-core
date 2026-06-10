import { CheckCircle, Loader2, XCircle, Plus, Settings, FlaskConical } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import type { WizardState } from "../types";
import { fetchLocalApi } from "../../../utils/localApiFetch";
import { buildIntentAgentConfig } from "../types";

type DeployPhase =
  | "idle"
  | "provisioning"
  | "updating-agents"
  | "saving-intent"
  | "generating-docs"
  | "done"
  | "error";

interface DeployStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

interface StepDeployProps {
  state: WizardState;
  gatewayRequest: <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ) => Promise<T>;
  onDone: () => void;
  onCreateAnother: () => void;
  onOpenIntentEditor?: () => void;
}

export function StepDeploy({
  state,
  gatewayRequest,
  onDone,
  onCreateAnother,
  onOpenIntentEditor,
}: StepDeployProps) {
  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [steps, setSteps] = useState<DeployStep[]>([]);
  const [error, setError] = useState("");
  const deployStarted = useRef(false);

  function updateStep(id: string, patch: Partial<DeployStep>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  useEffect(() => {
    if (deployStarted.current) {
      return;
    }
    deployStarted.current = true;
    void deploy();
  }, []);

  async function deploy() {
    const deploySteps: DeployStep[] = [
      { id: "provision", label: "Provision agent directory", status: "pending" },
      { id: "agents-list", label: "Update agents.list", status: "pending" },
      { id: "intent", label: "Save intent configuration", status: "pending" },
      { id: "docs", label: "Generate alignment docs", status: "pending" },
    ];
    setSteps(deploySteps);

    const agentId = state.identity.agentId;
    const deptId =
      state.department.mode === "existing" ? state.department.existingId : state.department.newId;

    try {
      // 1. Provision agent via family.register
      setPhase("provisioning");
      updateStep("provision", { status: "running" });
      try {
        await gatewayRequest("family.register", {
          agentId,
          name: state.identity.displayName,
          role: state.identity.role === "custom" ? state.identity.customRole : state.identity.role,
          team: state.identity.team,
        });
      } catch (e) {
        // If agent already exists, treat as success
        if (!(e instanceof Error && /already exists/i.test(e.message))) {
          throw e;
        }
      }
      updateStep("provision", { status: "done", detail: `~/.argentos/agents/${agentId}/` });

      // 2. Update agents.list
      setPhase("updating-agents");
      updateStep("agents-list", { status: "running" });
      try {
        const res = await fetchLocalApi("/api/settings/agent/raw-config");
        const cfg = await res.json();
        const list: string[] = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : [];
        if (!list.includes(agentId)) {
          list.push(agentId);
          await fetchLocalApi("/api/settings/agent/raw-config", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agents: { ...cfg?.agents, list } }),
          });
        }
      } catch (e) {
        // Non-fatal — agent might already be registered
        console.warn("agents.list update:", e instanceof Error ? e.message : e);
      }
      updateStep("agents-list", { status: "done" });

      // 3. Save intent config (department + agent policies)
      setPhase("saving-intent");
      updateStep("intent", { status: "running" });

      // Load current intent
      const intentRes = await fetchLocalApi("/api/settings/intent");
      const intentData = await intentRes.json();
      const intent = intentData?.intent ?? {};

      // Add department if new
      if (state.department.mode === "new" && deptId) {
        const depts = intent.departments ?? {};
        if (!depts[deptId]) {
          depts[deptId] = { objective: state.department.newObjective };
          intent.departments = depts;
        }
      }

      // Add agent intent
      const { policy, simulation } = buildIntentAgentConfig(state);
      const agents = intent.agents ?? {};
      agents[agentId] = { ...policy, simulationGate: simulation };
      intent.agents = agents;

      // Ensure intent is enabled
      if (!intent.enabled) {
        intent.enabled = true;
      }

      // Validate via preview
      try {
        const previewRes = await fetchLocalApi("/api/settings/intent/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent }),
        });
        if (!previewRes.ok) {
          const data = await previewRes.json().catch(() => ({}));
          console.warn("Intent preview warning:", data);
        }
      } catch {
        // Preview is optional
      }

      // Save
      const saveRes = await fetchLocalApi("/api/settings/intent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      if (!saveRes.ok) {
        const data = await saveRes.json().catch(() => ({}));
        throw new Error(data?.error || `Failed to save intent (${saveRes.status})`);
      }
      updateStep("intent", { status: "done" });

      // 4. Generate alignment docs (AI-generated with static fallback)
      setPhase("generating-docs");
      updateStep("docs", { status: "running" });
      try {
        const role =
          state.identity.role === "custom" ? state.identity.customRole : state.identity.role;

        // Try AI-generated docs first
        let soulContent: string | undefined;
        let identityContent: string | undefined;

        try {
          const aiResponse = await gatewayRequest<{ text?: string; response?: string }>(
            "chat",
            {
              message: `[WIZARD_ASSIST] Generate alignment documents for a new agent worker.

Agent: ${state.identity.displayName} (${agentId})
Role: ${role}
Team: ${state.identity.team || "default"}
Department: ${deptId}
Objective: ${state.boundaries.objective || "Not specified"}
Never Do: ${state.boundaries.neverDo.join(", ") || "None specified"}
Allowed Actions: ${state.boundaries.allowedActions.join(", ") || "None specified"}

Generate TWO documents separated by "---SPLIT---":

1. SOUL.md — Core values, decision-making framework, ethical guidelines, and behavioral principles specific to this role. Include role-specific values (not generic). 3-4 sections.

2. IDENTITY.md — Agent persona definition including name, role, team, communication style, expertise areas, and personality traits appropriate for the role.

Output format: [SOUL.md content]---SPLIT---[IDENTITY.md content]`,
              systemHint:
                "Generate agent alignment documents. Be specific to the role, not generic. Output raw markdown, no code fences.",
            },
            { timeoutMs: 45000 },
          );

          const aiText = aiResponse?.text || aiResponse?.response || "";
          if (aiText.includes("---SPLIT---")) {
            const [soul, identity] = aiText.split("---SPLIT---");
            if (soul?.trim()) {
              soulContent = soul.trim();
            }
            if (identity?.trim()) {
              identityContent = identity.trim();
            }
          }
        } catch {
          // AI generation failed, fall through to static templates
        }

        // Static fallback
        if (!soulContent) {
          soulContent = `# SOUL.md

You are ${state.identity.displayName}, a ${role} agent in the ${state.identity.team || "default"} team.

## Core Values
- Execute your role with precision and reliability
- Escalate when uncertain or when boundaries require it
- Maintain transparency in all actions

## Decision Framework
1. Safety and compliance first
2. User satisfaction second
3. Efficiency third

## Boundaries
${state.boundaries.neverDo.length > 0 ? state.boundaries.neverDo.map((r) => `- Never: ${r}`).join("\n") : "- Follow all organizational policies"}
`;
        }

        if (!identityContent) {
          identityContent = `# IDENTITY.md

Name: ${state.identity.displayName}
ID: ${agentId}
Role: ${role}
Team: ${state.identity.team}
Emoji: ${state.identity.emoji || "🤖"}
Department: ${deptId}
Objective: ${state.boundaries.objective || "As defined by department policy"}
`;
        }

        await gatewayRequest("agents.files.set", {
          agentId,
          path: "SOUL.md",
          content: soulContent,
        }).catch(() => {});

        await gatewayRequest("agents.files.set", {
          agentId,
          path: "IDENTITY.md",
          content: identityContent,
        }).catch(() => {});
      } catch {
        // Non-fatal
      }
      updateStep("docs", { status: "done" });

      setPhase("done");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error && e.message ? e.message : "Deployment failed");
      // Mark current running step as error
      setSteps((prev) => prev.map((s) => (s.status === "running" ? { ...s, status: "error" } : s)));
    }
  }

  return (
    <div className="space-y-6">
      {/* Progress steps */}
      <div className="space-y-2">
        {steps.map((s) => (
          <div
            key={s.id}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
              s.status === "running"
                ? "border-purple-500/30 bg-purple-600/5"
                : s.status === "done"
                  ? "border-green-500/20 bg-green-600/5"
                  : s.status === "error"
                    ? "border-red-500/20 bg-red-600/5"
                    : "border-white/5 bg-white/[0.02]"
            }`}
          >
            {s.status === "running" && (
              <Loader2 className="w-4 h-4 text-purple-400 animate-spin flex-shrink-0" />
            )}
            {s.status === "done" && (
              <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
            )}
            {s.status === "error" && <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
            {s.status === "pending" && (
              <div className="w-4 h-4 rounded-full border border-white/10 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <span className={`text-sm ${s.status === "done" ? "text-white/60" : "text-white"}`}>
                {s.label}
              </span>
              {s.detail && <p className="text-white/20 text-xs font-mono truncate">{s.detail}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Error */}
      {phase === "error" && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-red-300 text-sm p-3 rounded-lg border border-red-500/20 bg-red-600/5">
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
          <div className="flex justify-center">
            <button
              onClick={() => {
                setPhase("idle");
                setError("");
                deployStarted.current = false;
                void deploy();
              }}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Success */}
      {phase === "done" && (
        <div className="text-center space-y-4 pt-2">
          <div className="w-16 h-16 rounded-2xl bg-green-600/20 flex items-center justify-center mx-auto">
            <span className="text-3xl">{state.identity.emoji || "🤖"}</span>
          </div>
          <div>
            <h3 className="text-white text-lg font-semibold">{state.identity.displayName}</h3>
            <p className="text-white/40 text-sm">deployed successfully</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <button
              onClick={onCreateAnother}
              className="flex items-center gap-1.5 px-4 py-2 border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 text-sm rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Another
            </button>
            {onOpenIntentEditor && (
              <button
                onClick={onOpenIntentEditor}
                className="flex items-center gap-1.5 px-4 py-2 border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 text-sm rounded-lg transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                Intent Editor
              </button>
            )}
            {state.simulation.enabled && (
              <button
                onClick={onDone}
                className="flex items-center gap-1.5 px-4 py-2 border border-purple-500/30 bg-purple-600/10 hover:bg-purple-600/20 text-purple-300 text-sm rounded-lg transition-colors"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                Run Simulation
              </button>
            )}
            <button
              onClick={onDone}
              className="flex items-center gap-1.5 px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
