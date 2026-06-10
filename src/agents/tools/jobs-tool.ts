import { Type } from "@sinclair/typebox";
import type { JobExecutionMode } from "../../data/types.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import { type AnyAgentTool, readStringParam } from "./common.js";

const JobsToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("template_create"),
    Type.Literal("template_list"),
    Type.Literal("assignment_create"),
    Type.Literal("assignment_list"),
    Type.Literal("assignment_update"),
    Type.Literal("runs"),
  ]),
  templateId: Type.Optional(Type.String()),
  assignmentId: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  rolePrompt: Type.Optional(Type.String()),
  sop: Type.Optional(Type.String()),
  successDefinition: Type.Optional(Type.String()),
  defaultMode: Type.Optional(Type.Union([Type.Literal("simulate"), Type.Literal("live")])),
  executionMode: Type.Optional(Type.Union([Type.Literal("simulate"), Type.Literal("live")])),
  agentId: Type.Optional(Type.String()),
  cadenceMinutes: Type.Optional(Type.Number()),
  enabled: Type.Optional(Type.Boolean()),
  nextRunAt: Type.Optional(Type.Number()),
  toolsAllow: Type.Optional(Type.Array(Type.String())),
  toolsDeny: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
  limit: Type.Optional(Type.Number()),
});

function toMode(raw: unknown, fallback: JobExecutionMode): JobExecutionMode {
  return raw === "live" ? "live" : fallback;
}

function formatMode(mode: JobExecutionMode): string {
  return mode === "live" ? "LIVE" : "SIMULATE";
}

export function createJobsTool(): AnyAgentTool {
  return {
    type: "function",
    name: "jobs_tool",
    description:
      "Create and manage role-based jobs (templates, assignments, runs) with simulate/live execution mode.",
    parameters: JobsToolSchema,
    strict: true,
    async execute(args) {
      const action = readStringParam(args, "action");
      const storage = await getStorageAdapter();

      if (action === "template_create") {
        const name = readStringParam(args, "name").trim();
        const rolePrompt = readStringParam(args, "rolePrompt").trim();
        if (!name || !rolePrompt) {
          return { content: [{ type: "text", text: "name and rolePrompt are required." }] };
        }
        const template = await storage.jobs.createTemplate({
          name,
          description: readStringParam(args, "description").trim() || undefined,
          rolePrompt,
          sop: readStringParam(args, "sop").trim() || undefined,
          successDefinition: readStringParam(args, "successDefinition").trim() || undefined,
          defaultMode: toMode((args as Record<string, unknown>).defaultMode, "simulate"),
          toolsAllow: Array.isArray((args as Record<string, unknown>).toolsAllow)
            ? ((args as Record<string, unknown>).toolsAllow as string[])
            : undefined,
          toolsDeny: Array.isArray((args as Record<string, unknown>).toolsDeny)
            ? ((args as Record<string, unknown>).toolsDeny as string[])
            : undefined,
          tags: Array.isArray((args as Record<string, unknown>).tags)
            ? ((args as Record<string, unknown>).tags as string[])
            : undefined,
        });
        return {
          content: [
            {
              type: "text",
              text: `Created job template ${template.id}\nName: ${template.name}\nDefault mode: ${formatMode(template.defaultMode)}`,
            },
          ],
        };
      }

      if (action === "template_list") {
        const templates = await storage.jobs.listTemplates();
        if (templates.length === 0) {
          return { content: [{ type: "text", text: "No job templates found." }] };
        }
        const lines = templates.map(
          (t) => `- [${t.id.slice(0, 8)}] ${t.name} (${formatMode(t.defaultMode)})`,
        );
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      if (action === "assignment_create") {
        const templateId = readStringParam(args, "templateId").trim();
        const agentId = readStringParam(args, "agentId").trim();
        if (!templateId || !agentId) {
          return {
            content: [{ type: "text", text: "templateId and agentId are required." }],
          };
        }
        const defaultTemplate = await storage.jobs.getTemplate(templateId);
        const assignment = await storage.jobs.createAssignment({
          templateId,
          agentId,
          title: readStringParam(args, "title").trim() || undefined,
          cadenceMinutes:
            typeof (args as Record<string, unknown>).cadenceMinutes === "number"
              ? ((args as Record<string, unknown>).cadenceMinutes as number)
              : undefined,
          executionMode: toMode(
            (args as Record<string, unknown>).executionMode,
            defaultTemplate?.defaultMode ?? "simulate",
          ),
          enabled:
            typeof (args as Record<string, unknown>).enabled === "boolean"
              ? ((args as Record<string, unknown>).enabled as boolean)
              : undefined,
          nextRunAt:
            typeof (args as Record<string, unknown>).nextRunAt === "number"
              ? ((args as Record<string, unknown>).nextRunAt as number)
              : undefined,
        });
        return {
          content: [
            {
              type: "text",
              text: `Created assignment ${assignment.id}\nTitle: ${assignment.title}\nAgent: ${assignment.agentId}\nMode: ${formatMode(assignment.executionMode)}\nCadence: ${assignment.cadenceMinutes} minutes`,
            },
          ],
        };
      }

      if (action === "assignment_list") {
        const agentId = readStringParam(args, "agentId").trim();
        const assignments = await storage.jobs.listAssignments({
          agentId: agentId || undefined,
        });
        if (assignments.length === 0) {
          return { content: [{ type: "text", text: "No job assignments found." }] };
        }
        const lines = assignments.map(
          (a) =>
            `- [${a.id.slice(0, 8)}] ${a.title} → ${a.agentId} | ${a.enabled ? "enabled" : "disabled"} | ${formatMode(a.executionMode)} | every ${a.cadenceMinutes}m`,
        );
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      if (action === "assignment_update") {
        const assignmentId = readStringParam(args, "assignmentId").trim();
        if (!assignmentId) {
          return { content: [{ type: "text", text: "assignmentId is required." }] };
        }
        const updated = await storage.jobs.updateAssignment(assignmentId, {
          enabled:
            typeof (args as Record<string, unknown>).enabled === "boolean"
              ? ((args as Record<string, unknown>).enabled as boolean)
              : undefined,
          cadenceMinutes:
            typeof (args as Record<string, unknown>).cadenceMinutes === "number"
              ? ((args as Record<string, unknown>).cadenceMinutes as number)
              : undefined,
          executionMode:
            typeof (args as Record<string, unknown>).executionMode === "string"
              ? toMode((args as Record<string, unknown>).executionMode, "simulate")
              : undefined,
          nextRunAt:
            typeof (args as Record<string, unknown>).nextRunAt === "number"
              ? ((args as Record<string, unknown>).nextRunAt as number)
              : undefined,
          title: readStringParam(args, "title").trim() || undefined,
        });
        if (!updated) {
          return { content: [{ type: "text", text: `Assignment not found: ${assignmentId}` }] };
        }
        return {
          content: [
            {
              type: "text",
              text: `Updated assignment ${updated.id}\nTitle: ${updated.title}\nEnabled: ${updated.enabled}\nMode: ${formatMode(updated.executionMode)}\nCadence: ${updated.cadenceMinutes} minutes`,
            },
          ],
        };
      }

      if (action === "runs") {
        const assignmentId = readStringParam(args, "assignmentId").trim();
        const limit =
          typeof (args as Record<string, unknown>).limit === "number"
            ? Math.max(1, Math.floor((args as Record<string, unknown>).limit as number))
            : 20;
        const runs = await storage.jobs.listRuns({
          assignmentId: assignmentId || undefined,
          limit,
        });
        if (runs.length === 0) {
          return { content: [{ type: "text", text: "No job runs found." }] };
        }
        const lines = runs.map(
          (run) =>
            `- [${run.id.slice(0, 8)}] ${run.status} | task=${run.taskId.slice(0, 8)} | mode=${formatMode(run.executionMode)} | ${new Date(run.startedAt).toISOString()}`,
        );
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      return { content: [{ type: "text", text: `Unsupported action: ${action}` }] };
    },
  };
}
