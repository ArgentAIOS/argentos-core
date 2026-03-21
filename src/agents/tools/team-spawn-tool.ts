/**
 * Team Spawn Tool
 *
 * Creates a coordinated team of agent sessions with shared task lists
 * and dependency-aware task management.
 *
 * Unlike sessions_spawn (hub-and-spoke, isolated), team_spawn creates
 * a mesh of workers that can message each other, claim tasks, and
 * auto-unblock when dependencies resolve.
 */

import { Type } from "@sinclair/typebox";
import crypto from "node:crypto";
import type { TaskPriority } from "../../data/types.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AnyAgentTool } from "./common.js";
import { loadConfig } from "../../config/config.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import {
  isSubagentSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import { normalizeDeliveryContext } from "../../utils/delivery-context.js";
import { jsonResult, readStringParam } from "./common.js";
import {
  resolveDisplaySessionKey,
  resolveInternalSessionKey,
  resolveMainSessionAlias,
} from "./sessions-helpers.js";
import { spawnSubagentSession } from "./sessions-spawn-helpers.js";
import { buildTeamMemberSystemPrompt } from "./team-prompts.js";

const TeamSpawnSchema = Type.Object({
  name: Type.String({ description: "Team name" }),
  members: Type.Array(
    Type.Object({
      label: Type.String({ description: 'Role label: "researcher", "coder", etc.' }),
      task: Type.String({ description: "Initial instruction for this member" }),
      model: Type.Optional(Type.String({ description: "Model override for this member" })),
    }),
    { minItems: 1, maxItems: 10 },
  ),
  tasks: Type.Optional(
    Type.Array(
      Type.Object({
        title: Type.String(),
        description: Type.Optional(Type.String()),
        assignTo: Type.Optional(
          Type.String({ description: "Label of team member to assign this task to" }),
        ),
        dependsOn: Type.Optional(
          Type.Array(Type.String(), {
            description: "Titles of prerequisite tasks (resolved to IDs after creation)",
          }),
        ),
        priority: Type.Optional(
          Type.Union([
            Type.Literal("urgent"),
            Type.Literal("high"),
            Type.Literal("normal"),
            Type.Literal("low"),
            Type.Literal("background"),
          ]),
        ),
      }),
    ),
  ),
});

export function createTeamSpawnTool(opts?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  sandboxed?: boolean;
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_spawn",
    description: `Spawn a coordinated team of agent sessions with shared tasks and dependency management.

Use this instead of sessions_spawn when work requires COORDINATION between multiple agents:
- Multiple tasks with dependencies (A must finish before B starts)
- Workers that need to message each other
- Tasks that should be claimed dynamically from a shared pool

For single isolated background tasks, use sessions_spawn instead.

SCHEMA:
- name: Team name (string)
- members: Array of { label, task, model? } — each spawns a worker session
- tasks: Optional array of { title, description?, assignTo?, dependsOn?, priority? }
  - assignTo: label of a team member
  - dependsOn: array of task TITLES (resolved to IDs after creation)
  - Tasks with dependencies start as 'blocked' and auto-unblock when deps complete

EXAMPLE:
{
  "name": "research-team",
  "members": [
    { "label": "researcher", "task": "Research MiniMax M2.5 capabilities" },
    { "label": "writer", "task": "Write a summary of the research findings" }
  ],
  "tasks": [
    { "title": "Research phase", "assignTo": "researcher" },
    { "title": "Write summary", "assignTo": "writer", "dependsOn": ["Research phase"] }
  ]
}`,
    parameters: TeamSpawnSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const teamName = readStringParam(params, "name", { required: true });
      const members = params.members as Array<{
        label: string;
        task: string;
        model?: string;
      }>;
      const taskDefs = params.tasks as
        | Array<{
            title: string;
            description?: string;
            assignTo?: string;
            dependsOn?: string[];
            priority?: TaskPriority;
          }>
        | undefined;

      // Validate caller is not a subagent
      const requesterSessionKey = opts?.agentSessionKey;
      if (typeof requesterSessionKey === "string" && isSubagentSessionKey(requesterSessionKey)) {
        return jsonResult({
          status: "forbidden",
          error: "team_spawn is not allowed from sub-agent sessions",
        });
      }

      const cfg = loadConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);
      const requesterInternalKey = requesterSessionKey
        ? resolveInternalSessionKey({ key: requesterSessionKey, alias, mainKey })
        : alias;
      const requesterDisplayKey = resolveDisplaySessionKey({
        key: requesterInternalKey,
        alias,
        mainKey,
      });
      const requesterOrigin = normalizeDeliveryContext({
        channel: opts?.agentChannel,
        accountId: opts?.agentAccountId,
        to: opts?.agentTo,
        threadId: opts?.agentThreadId,
      });
      const requesterAgentId = normalizeAgentId(
        opts?.requesterAgentIdOverride ?? parseAgentSessionKey(requesterInternalKey)?.agentId,
      );

      // Initialize storage adapter (PG/dual/sqlite based on storage config)
      const storage = await getStorageAdapter();

      // 1. Create team record
      const team = await storage.teams.create({
        name: teamName,
        leadSessionKey: requesterInternalKey,
      });

      // 2. Register lead as member
      await storage.teams.addMember(team.id, {
        sessionKey: requesterInternalKey,
        role: "lead",
        label: "lead",
        status: "active",
        joinedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      // 3. Pre-generate session keys for all members so prompts have real keys
      const memberKeys = members.map((member) => ({
        label: member.label,
        childSessionKey: `agent:${requesterAgentId}:subagent:${crypto.randomUUID()}`,
      }));

      // Build full teammate list (lead + all workers) before spawning
      const fullTeammateList: Array<{
        label: string;
        sessionKey: string;
        role: string;
      }> = [
        { label: "lead", sessionKey: requesterInternalKey, role: "lead" },
        ...memberKeys.map((mk) => ({
          label: mk.label,
          sessionKey: mk.childSessionKey,
          role: "worker",
        })),
      ];

      // Spawn each worker with full team context
      const spawnedMembers: Array<{
        label: string;
        sessionKey: string;
        runId: string;
        error?: string;
      }> = [];

      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const memberKey = memberKeys[i];

        const memberPrompt = buildTeamMemberSystemPrompt({
          teamId: team.id,
          teamName,
          role: "worker",
          label: member.label,
          sessionKey: memberKey.childSessionKey,
          teammates: fullTeammateList,
          task: member.task,
        });

        const result = await spawnSubagentSession({
          task: member.task,
          label: member.label,
          modelOverride: member.model,
          extraSystemPrompt: memberPrompt,
          childSessionKey: memberKey.childSessionKey,
          requesterSessionKey,
          requesterInternalKey,
          requesterDisplayKey,
          requesterOrigin,
          requesterAgentIdOverride: opts?.requesterAgentIdOverride,
          groupId: opts?.agentGroupId,
          groupChannel: opts?.agentGroupChannel,
          groupSpace: opts?.agentGroupSpace,
          cleanup: "keep",
        });

        if (result.ok) {
          spawnedMembers.push({
            label: member.label,
            sessionKey: result.childSessionKey,
            runId: result.runId,
          });

          // Register as team member
          await storage.teams.addMember(team.id, {
            sessionKey: result.childSessionKey,
            role: "worker",
            label: member.label,
            status: "active",
            joinedAt: Date.now(),
            lastActiveAt: Date.now(),
          });
        } else {
          spawnedMembers.push({
            label: member.label,
            sessionKey: result.childSessionKey ?? memberKey.childSessionKey,
            runId: result.runId ?? "unknown",
            error: result.error,
          });
        }
      }

      // 4. Create tasks if provided
      const createdTasks: Array<{
        id: string;
        title: string;
        status: string;
        assignee?: string;
        dependsOn?: string[];
      }> = [];

      if (taskDefs && taskDefs.length > 0) {
        // Build label→sessionKey map for assignTo resolution
        const labelToKey = new Map<string, string>();
        for (const m of spawnedMembers) {
          if (!m.error) {
            labelToKey.set(m.label.toLowerCase(), m.sessionKey);
          }
        }

        // First pass: create all tasks (no deps yet) to get IDs
        const titleToId = new Map<string, string>();
        const taskIds: string[] = [];

        for (const td of taskDefs) {
          const assigneeKey = td.assignTo ? labelToKey.get(td.assignTo.toLowerCase()) : undefined;

          const task = await storage.tasks.create({
            title: td.title,
            description: td.description,
            priority: td.priority || "normal",
            source: "agent",
            assignee: assigneeKey,
            teamId: team.id,
            agentId: requesterAgentId,
          });

          titleToId.set(td.title.toLowerCase(), task.id);
          taskIds.push(task.id);

          createdTasks.push({
            id: task.id,
            title: td.title,
            status: task.status,
            assignee: assigneeKey,
          });
        }

        // Second pass: resolve dependsOn titles → IDs and update
        for (let i = 0; i < taskDefs.length; i++) {
          const td = taskDefs[i];
          if (!td.dependsOn || td.dependsOn.length === 0) continue;

          const depIds: string[] = [];
          for (const depTitle of td.dependsOn) {
            const depId = titleToId.get(depTitle.toLowerCase());
            if (depId) {
              depIds.push(depId);
            }
          }

          if (depIds.length > 0) {
            await storage.tasks.update(taskIds[i], {
              dependsOn: depIds,
              status: "blocked",
            });
            createdTasks[i].status = "blocked";
            createdTasks[i].dependsOn = depIds;
          }
        }
      }

      // 5. Build response
      const memberSummary = spawnedMembers.map((m) => ({
        label: m.label,
        sessionKey: m.sessionKey,
        status: m.error ? "error" : "spawned",
        error: m.error,
      }));

      const taskSummary = createdTasks.map((t) => ({
        id: t.id.slice(0, 8),
        title: t.title,
        status: t.status,
        assignee: t.assignee,
        dependsOn: t.dependsOn?.map((d) => d.slice(0, 8)),
      }));

      return jsonResult({
        status: "created",
        teamId: team.id,
        teamName,
        members: memberSummary,
        tasks: taskSummary,
      });
    },
  };
}
