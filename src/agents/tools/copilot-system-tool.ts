import { Type } from "@sinclair/typebox";
import { getAgentFamily } from "../../data/agent-family.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import {
  getCopilotAccessMode,
  readCopilotState,
  setCopilotAccessMode,
  type CopilotAccessMode,
  type CopilotDomain,
} from "../copilot-state.js";
import { type AnyAgentTool, jsonResult, readNumberParam, readStringParam } from "./common.js";

const COPILOT_DOMAINS: CopilotDomain[] = [
  "intent",
  "workforce",
  "run-story",
  "tool-policy",
  "observability",
  "onboarding",
  "nudge-offtime",
  "memory-governance",
  "voice-presence",
  "department-org",
  "deployment",
];

const CopilotSystemToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("overview"),
    Type.Literal("domain_status"),
    Type.Literal("access_mode_get"),
    Type.Literal("access_mode_set"),
    Type.Literal("workforce_overview"),
    Type.Literal("run_story"),
    Type.Literal("tool_policy_preview"),
    Type.Literal("observability_overview"),
    Type.Literal("onboarding_plan"),
    Type.Literal("memory_governance_overview"),
    Type.Literal("voice_presence_overview"),
    Type.Literal("nudge_offtime_overview"),
    Type.Literal("department_org_overview"),
    Type.Literal("deployment_rollout_overview"),
  ]),
  domain: Type.Optional(Type.String()),
  mode: Type.Optional(
    Type.Union([
      Type.Literal("off"),
      Type.Literal("assist-draft"),
      Type.Literal("assist-propose"),
      Type.Literal("assist-live-limited"),
    ]),
  ),
  runId: Type.Optional(Type.String()),
  assignmentId: Type.Optional(Type.String()),
  templateId: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  companyName: Type.Optional(Type.String()),
  companyType: Type.Optional(Type.String()),
  departments: Type.Optional(Type.Array(Type.String())),
  riskPosture: Type.Optional(Type.String()),
  horizonDays: Type.Optional(Type.Number()),
  team: Type.Optional(Type.String()),
});

function assertDomain(raw: string | undefined): CopilotDomain {
  const value = (raw ?? "").trim() as CopilotDomain;
  if (!COPILOT_DOMAINS.includes(value)) {
    throw new Error(`invalid domain "${raw ?? ""}"`);
  }
  return value;
}

function summarizeRun(run: {
  id: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  metadata?: Record<string, unknown>;
}) {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    relationship: (run.metadata?.relationship as Record<string, unknown> | undefined) ?? null,
    review: (run.metadata?.review as Record<string, unknown> | undefined) ?? null,
  };
}

export function createCopilotSystemTool(): AnyAgentTool {
  return {
    label: "Copilot System",
    name: "copilot_system_tool",
    description:
      "Cross-domain Co-Pilot control plane for Workforce, Run Story, Tool Policy, Observability, and Onboarding. Includes governance access modes and operator-ready status views.",
    parameters: CopilotSystemToolSchema,
    async execute(_toolCallId, args) {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action");

      if (action === "overview") {
        const state = await readCopilotState();
        return jsonResult({
          domains: COPILOT_DOMAINS.map((domain) => ({
            domain,
            mode: state.accessModes[domain] ?? "assist-draft",
          })),
          notes:
            "Use domain_status for detailed capability mapping. Use access_mode_set to tighten or expand AI-assisted control per domain.",
        });
      }

      if (action === "domain_status") {
        const domain = assertDomain(readStringParam(params, "domain", { required: true }));
        const mode = await getCopilotAccessMode(domain);
        return jsonResult({
          domain,
          mode,
          lifecycle: ["inspect", "explain", "draft", "validate", "apply", "rollback", "audit"],
        });
      }

      if (action === "access_mode_get") {
        const domain = assertDomain(readStringParam(params, "domain", { required: true }));
        return jsonResult({ domain, mode: await getCopilotAccessMode(domain) });
      }

      if (action === "access_mode_set") {
        const domain = assertDomain(readStringParam(params, "domain", { required: true }));
        const mode = readStringParam(params, "mode", { required: true }) as CopilotAccessMode;
        if (!["off", "assist-draft", "assist-propose", "assist-live-limited"].includes(mode)) {
          throw new Error(`invalid mode "${mode}"`);
        }
        await setCopilotAccessMode(domain, mode);
        return jsonResult({ domain, mode });
      }

      if (action === "workforce_overview") {
        const storage = await getStorageAdapter();
        const [templates, assignments, runs, members] = await Promise.all([
          storage.jobs.listTemplates(),
          storage.jobs.listAssignments(),
          storage.jobs.listRuns({ limit: 100 }),
          getAgentFamily()
            .then((family) => family.listMembers())
            .catch(() => []),
        ]);
        const now = Date.now();
        return jsonResult({
          templatesCount: templates.length,
          assignmentsCount: assignments.length,
          enabledAssignmentsCount: assignments.filter((item) => item.enabled).length,
          dueNowCount: assignments.filter(
            (item) => typeof item.nextRunAt === "number" && item.nextRunAt <= now,
          ).length,
          runningCount: runs.filter((item) => item.status === "running").length,
          blockedCount: runs.filter((item) => item.status === "blocked").length,
          workersCount: members.length,
          workers: members.slice(0, 40).map((member) => ({
            id: member.id,
            name: member.name,
            role: member.role,
            team: member.team ?? null,
            status: member.status ?? null,
          })),
        });
      }

      if (action === "run_story") {
        const runId = readStringParam(params, "runId", { required: true });
        const storage = await getStorageAdapter();
        const run = (await storage.jobs.listRuns({ limit: 200 })).find((item) => item.id === runId);
        if (!run) {
          throw new Error(`run not found: ${runId}`);
        }
        const assignment = await storage.jobs.getAssignment(run.assignmentId);
        const template = await storage.jobs.getTemplate(run.templateId);
        const task = await storage.tasks.get(run.taskId);
        const events = await storage.jobs.listEvents({ limit: 80 });
        const linkedEvents = events.filter((event) => {
          const payload = event.payload;
          const metadata = event.metadata;
          return (
            payload?.runId === run.id ||
            payload?.assignmentId === run.assignmentId ||
            metadata?.runId === run.id ||
            metadata?.assignmentId === run.assignmentId
          );
        });
        const neighborRuns = await storage.jobs.listRuns({
          assignmentId: run.assignmentId,
          limit: 10,
        });
        return jsonResult({
          run: summarizeRun(run),
          assignment,
          template,
          task: task
            ? {
                id: task.id,
                status: task.status,
                metadata: task.metadata ?? null,
              }
            : null,
          neighborRuns: neighborRuns.map((item) => summarizeRun(item)),
          linkedEvents,
        });
      }

      if (action === "tool_policy_preview") {
        const storage = await getStorageAdapter();
        const assignmentId = readStringParam(params, "assignmentId");
        const templateId = readStringParam(params, "templateId");
        let assignment = null;
        let template = null;
        if (assignmentId) {
          assignment = await storage.jobs.getAssignment(assignmentId);
          if (assignment) {
            template = await storage.jobs.getTemplate(assignment.templateId);
          }
        } else if (templateId) {
          template = await storage.jobs.getTemplate(templateId);
        }
        if (!template) {
          throw new Error("tool policy preview requires assignmentId or templateId");
        }
        const effective = await storage.jobs.resolveSessionToolPolicyForAssignment({
          assignment:
            assignment ??
            ({
              id: "preview",
              templateId: template.id,
              agentId: readStringParam(params, "agentId") ?? "main",
              title: "preview",
              enabled: true,
              cadenceMinutes: 60,
              executionMode: template.defaultMode,
              deploymentStage: template.defaultStage ?? "simulate",
              promotionState: "draft",
              nextRunAt: null,
              metadata: {},
              createdAt: Date.now(),
              updatedAt: Date.now(),
            } as never),
          template,
        });
        return jsonResult({
          templateId: template.id,
          assignmentId: assignment?.id ?? null,
          toolsAllow: template.toolsAllow ?? [],
          toolsDeny: template.toolsDeny ?? [],
          effectiveAllow: effective.toolsAllow ?? [],
          effectiveDeny: effective.toolsDeny ?? [],
          deploymentStage: assignment?.deploymentStage ?? template.defaultStage ?? "simulate",
        });
      }

      if (action === "observability_overview") {
        const storage = await getStorageAdapter();
        const horizonDays = Math.max(
          1,
          Math.min(30, Math.floor(readNumberParam(params, "horizonDays") ?? 7)),
        );
        const since = Date.now() - horizonDays * 24 * 60 * 60 * 1000;
        const runs = await storage.jobs.listRuns({ limit: 300 });
        const recent = runs.filter((run) => run.startedAt >= since);
        return jsonResult({
          horizonDays,
          totalRuns: recent.length,
          byStatus: {
            running: recent.filter((run) => run.status === "running").length,
            completed: recent.filter((run) => run.status === "completed").length,
            blocked: recent.filter((run) => run.status === "blocked").length,
            failed: recent.filter((run) => run.status === "failed").length,
          },
          attentionNeeded: recent
            .filter((run) => run.status === "blocked" || run.status === "failed")
            .slice(0, 20)
            .map((run) => summarizeRun(run)),
        });
      }

      if (action === "onboarding_plan") {
        const companyName = readStringParam(params, "companyName") ?? "Your Company";
        const companyType = readStringParam(params, "companyType") ?? "General Business";
        const departments = ((params.departments as string[] | undefined) ?? []).filter(
          (item) => typeof item === "string",
        );
        const riskPosture = readStringParam(params, "riskPosture") ?? "balanced";
        return jsonResult({
          companyName,
          companyType,
          riskPosture,
          phases: [
            {
              phase: 1,
              title: "Company discovery",
              outputs: ["company intent draft", "autonomy boundaries", "approval policy baseline"],
            },
            {
              phase: 2,
              title: "Department shaping",
              outputs: [
                "department intent overrides",
                "worker role map",
                "tool policy allow/deny defaults",
              ],
              departments: departments.length > 0 ? departments : ["support", "ops", "sales"],
            },
            {
              phase: 3,
              title: "Simulation-first workforce bring-up",
              outputs: ["simulate-stage assignments", "run review cadence", "promotion checklist"],
            },
            {
              phase: 4,
              title: "Controlled production rollout",
              outputs: ["shadow then limited-live promotions", "rollback playbook", "audit trail"],
            },
          ],
        });
      }

      if (action === "memory_governance_overview") {
        const storage = await getStorageAdapter();
        const stats = await storage.memory.getStats();
        const lessons = await storage.memory.listLessons({ limit: 20 });
        const reflections = await storage.memory.listReflections({ limit: 20 });
        return jsonResult({
          stats,
          lessonSample: lessons.map((item) => ({
            id: item.id,
            lesson: item.lesson,
            confidence: item.confidence,
            createdAt: item.createdAt,
          })),
          reflectionSample: reflections.map((item) => ({
            id: item.id,
            triggerType: item.triggerType,
            createdAt: item.createdAt,
          })),
          recommendations: [
            "Promote recurring high-confidence lessons to operator-reviewed policy.",
            "Prune low-signal reflections that repeat without new evidence.",
            "Tag critical memory categories by department for retrieval quality.",
          ],
        });
      }

      if (action === "voice_presence_overview") {
        const state = await readCopilotState();
        return jsonResult({
          mode: state.accessModes["voice-presence"] ?? "assist-draft",
          checks: [
            "Confirm exactly one TTS path is active for chat and PTT flows.",
            "Verify pre-ack and summary playback are both visible/audible where expected.",
            "Ensure replay/download controls match generated spoken summary.",
            "Validate voice identity mapping by channel/session.",
          ],
          target: "single identity, deterministic route selection, no fallback bleed-through",
        });
      }

      if (action === "nudge_offtime_overview") {
        return jsonResult({
          mode: await getCopilotAccessMode("nudge-offtime"),
          controls: {
            nudgeWeight: "operator-tunable",
            cooldownWindow: "operator-tunable",
            conflictResolution: "highest-priority nudge wins, others deferred",
          },
          recommendations: [
            "Track which nudges resulted in concrete operator-facing outcomes.",
            "Detect conflicting nudges by overlap in objective and time window.",
            "Expose nudge effectiveness trend over 7/30 day horizons.",
          ],
        });
      }

      if (action === "department_org_overview") {
        const teamFilter = readStringParam(params, "team");
        const family = await getAgentFamily()
          .then((v) => v.listMembers())
          .catch(() => []);
        const filtered = teamFilter
          ? family.filter(
              (member) => (member.team ?? "").toLowerCase() === teamFilter.toLowerCase(),
            )
          : family;
        return jsonResult({
          teamFilter: teamFilter ?? null,
          members: filtered.map((member) => ({
            id: member.id,
            name: member.name,
            role: member.role,
            team: member.team ?? null,
            status: member.status ?? null,
          })),
          suggestedStructure: [
            "Define explicit department owners for support, engineering, operations.",
            "Attach escalation routes per worker role.",
            "Map assignment coverage to departments to avoid ownership gaps.",
          ],
        });
      }

      if (action === "deployment_rollout_overview") {
        const storage = await getStorageAdapter();
        const assignments = await storage.jobs.listAssignments();
        const byStage = {
          simulate: assignments.filter((a) => (a.deploymentStage ?? "simulate") === "simulate")
            .length,
          shadow: assignments.filter((a) => a.deploymentStage === "shadow").length,
          "limited-live": assignments.filter((a) => a.deploymentStage === "limited-live").length,
          live: assignments.filter((a) => a.deploymentStage === "live").length,
        };
        return jsonResult({
          assignmentsTotal: assignments.length,
          byStage,
          rolloutGuidance: [
            "Require review notes before promotion to the next stage.",
            "Promote only when blocked/failed ratio is within tolerance.",
            "Keep rollback-ready snapshots for intent and assignment config.",
          ],
        });
      }

      throw new Error(`unsupported action: ${action}`);
    },
  };
}
