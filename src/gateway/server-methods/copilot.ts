import type { GatewayRequestHandlers } from "./types.js";
import {
  getCopilotAccessMode,
  readCopilotState,
  setCopilotAccessMode,
  type CopilotAccessMode,
  type CopilotDomain,
} from "../../agents/copilot-state.js";
import { getAgentFamily } from "../../data/agent-family.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

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

function readString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function readDomain(params: Record<string, unknown>): CopilotDomain {
  const domain = readString(params, "domain") as CopilotDomain | undefined;
  if (!domain || !COPILOT_DOMAINS.includes(domain)) {
    throw new Error(`domain must be one of: ${COPILOT_DOMAINS.join(", ")}`);
  }
  return domain;
}

function readMode(params: Record<string, unknown>): CopilotAccessMode {
  const mode = readString(params, "mode") as CopilotAccessMode | undefined;
  if (!mode || !["off", "assist-draft", "assist-propose", "assist-live-limited"].includes(mode)) {
    throw new Error("mode must be one of: off, assist-draft, assist-propose, assist-live-limited");
  }
  return mode;
}

export const copilotHandlers: GatewayRequestHandlers = {
  "copilot.overview": async ({ respond }) => {
    try {
      const state = await readCopilotState();
      respond(
        true,
        {
          domains: COPILOT_DOMAINS.map((domain) => ({
            domain,
            mode: state.accessModes[domain] ?? "assist-draft",
          })),
          intentHistoryCount: state.intentHistory.length,
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          error instanceof Error ? error.message : "failed to load copilot overview",
        ),
      );
    }
  },
  "copilot.mode.get": async ({ params, respond }) => {
    try {
      const domain = readDomain(params);
      const mode = await getCopilotAccessMode(domain);
      respond(true, { domain, mode }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "invalid copilot.mode.get request",
        ),
      );
    }
  },
  "copilot.mode.set": async ({ params, respond }) => {
    try {
      const domain = readDomain(params);
      const mode = readMode(params);
      await setCopilotAccessMode(domain, mode);
      respond(true, { domain, mode }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "invalid copilot.mode.set request",
        ),
      );
    }
  },
  "copilot.workforce.overview": async ({ respond }) => {
    try {
      const storage = await getStorageAdapter();
      const [templates, assignments, runs, members] = await Promise.all([
        storage.jobs.listTemplates(),
        storage.jobs.listAssignments(),
        storage.jobs.listRuns({ limit: 120 }),
        getAgentFamily()
          .then((family) => family.listMembers())
          .catch(() => []),
      ]);
      const now = Date.now();
      respond(
        true,
        {
          templatesCount: templates.length,
          assignmentsCount: assignments.length,
          enabledAssignmentsCount: assignments.filter((item) => item.enabled).length,
          dueNowCount: assignments.filter(
            (item) => typeof item.nextRunAt === "number" && item.nextRunAt <= now,
          ).length,
          runningCount: runs.filter((item) => item.status === "running").length,
          blockedCount: runs.filter((item) => item.status === "blocked").length,
          workersCount: members.length,
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          error instanceof Error ? error.message : "failed to load copilot workforce overview",
        ),
      );
    }
  },
  "copilot.observability.overview": async ({ params, respond }) => {
    try {
      const horizonDays = Math.max(
        1,
        Math.min(30, Math.floor(readNumber(params, "horizonDays") ?? 7)),
      );
      const storage = await getStorageAdapter();
      const since = Date.now() - horizonDays * 24 * 60 * 60 * 1000;
      const runs = await storage.jobs.listRuns({ limit: 300 });
      const recent = runs.filter((run) => run.startedAt >= since);
      respond(
        true,
        {
          horizonDays,
          totalRuns: recent.length,
          running: recent.filter((run) => run.status === "running").length,
          completed: recent.filter((run) => run.status === "completed").length,
          blocked: recent.filter((run) => run.status === "blocked").length,
          failed: recent.filter((run) => run.status === "failed").length,
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          error instanceof Error ? error.message : "failed to load copilot observability overview",
        ),
      );
    }
  },
  "copilot.run.story": async ({ params, respond }) => {
    try {
      const runId = readString(params, "runId");
      if (!runId) {
        throw new Error("runId is required");
      }
      const storage = await getStorageAdapter();
      const run = (await storage.jobs.listRuns({ limit: 250 })).find((item) => item.id === runId);
      if (!run) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `run not found: ${runId}`),
        );
        return;
      }
      const [assignment, template, context, events, assignmentRuns] = await Promise.all([
        storage.jobs.getAssignment(run.assignmentId),
        storage.jobs.getTemplate(run.templateId),
        storage.jobs.getContextForTask(run.taskId),
        storage.jobs.listEvents({ limit: 120 }),
        storage.jobs.listRuns({ assignmentId: run.assignmentId, limit: 12 }),
      ]);
      const linkedEvents = events.filter((event) => {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const metadata = (event.metadata ?? {}) as Record<string, unknown>;
        return (
          payload.runId === run.id ||
          payload.assignmentId === run.assignmentId ||
          metadata.runId === run.id ||
          metadata.assignmentId === run.assignmentId
        );
      });
      respond(
        true,
        {
          run,
          assignment,
          template,
          task: context?.task ?? null,
          assignmentRuns,
          events: linkedEvents,
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "invalid copilot.run.story request",
        ),
      );
    }
  },
};
