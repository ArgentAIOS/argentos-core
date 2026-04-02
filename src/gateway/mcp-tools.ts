/**
 * MCP Tool Definitions — All tools exposed by the ArgentOS MCP server.
 *
 * Separated from mcp-http.ts (transport layer) to keep files focused and
 * under the 500-700 LOC guideline.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryType } from "../memory/memu-types.js";
import { loadConfig } from "../config/config.js";
import { fetchWithSsrFGuard } from "../infra/net/fetch-guard.js";

type TransportMap = Map<string, unknown>;
const MCP_LOCAL_ENDPOINT_POLICY = {
  allowedHostnames: ["127.0.0.1", "localhost"],
  hostnameAllowlist: ["127.0.0.1", "localhost"],
};

/** Check if a tool should be registered based on the allowedTools config. */
function ok(name: string, allowed?: string[]): boolean {
  return !allowed || allowed.includes(name);
}

/** Map a 1-10 numeric significance to the MemU Significance enum. */
function toSignificance(n: number): "routine" | "noteworthy" | "important" | "core" {
  if (n >= 8) return "core";
  if (n >= 6) return "important";
  if (n >= 4) return "noteworthy";
  return "routine";
}

// ============================================================================
// Tool registration
// ============================================================================

export function registerMcpTools(
  mcp: McpServer,
  allowedTools: string[] | undefined,
  transports: TransportMap,
): void {
  // ---- Memory recall ----
  if (ok("memory_recall", allowedTools)) {
    mcp.tool(
      "memory_recall",
      "Search the agent's persistent memory (MemU). Returns memories matching the query, ranked by relevance.",
      {
        query: z.string().describe("Search query — natural language or keywords"),
        limit: z.number().optional().describe("Maximum results (default 10)"),
        type: z
          .string()
          .optional()
          .describe("Filter by memory type: profile, event, knowledge, behavior, skill, etc."),
      },
      async (params) => {
        const { getStorageAdapter } = await import("../data/storage-factory.js");
        const adapter = await getStorageAdapter();
        const limit = params.limit ?? 10;
        const fetchLimit = params.type ? limit * 3 : limit;
        let results = await adapter.memory.searchByKeyword(params.query, fetchLimit);
        if (params.type) results = results.filter((r) => r.item.memoryType === params.type);
        results = results.slice(0, limit);

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No memories found for "${params.query}"` }],
          };
        }
        const formatted = results
          .map(
            (r, i) =>
              `[${i + 1}] (${r.item.memoryType}, sig=${r.item.significance}, score=${r.score.toFixed(2)}) ${r.item.summary.slice(0, 500)}`,
          )
          .join("\n");
        return {
          content: [
            { type: "text" as const, text: `Found ${results.length} memories:\n\n${formatted}` },
          ],
        };
      },
    );
  }

  // ---- Memory store ----
  if (ok("memory_store", allowedTools)) {
    mcp.tool(
      "memory_store",
      "Store a new memory in the agent's persistent memory (MemU).",
      {
        content: z.string().describe("The memory content to store"),
        type: z
          .enum(["profile", "event", "knowledge", "behavior", "skill", "tool", "self", "episode"])
          .optional()
          .describe("Memory type (default: knowledge)"),
        significance: z.number().optional().describe("Importance 1-10 (default 5)"),
        entities: z.array(z.string()).optional().describe("People, places, or things referenced"),
      },
      async (params) => {
        const { getStorageAdapter } = await import("../data/storage-factory.js");
        const adapter = await getStorageAdapter();
        const item = await adapter.memory.createItem({
          memoryType: (params.type as MemoryType) ?? "knowledge",
          summary: params.content,
          significance: toSignificance(params.significance ?? 5),
          extra: params.entities?.length ? { entities: params.entities } : undefined,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Memory stored (id=${item.id}, type=${item.memoryType}).`,
            },
          ],
        };
      },
    );
  }

  // ---- Knowledge search ----
  if (ok("knowledge_search", allowedTools)) {
    mcp.tool(
      "knowledge_search",
      "Search the agent's knowledge base (RAG library). Returns ingested documents and knowledge items.",
      {
        query: z.string().describe("Search query — natural language or keywords"),
        limit: z.number().optional().describe("Maximum results (default 10)"),
        collection: z.string().optional().describe("Filter by knowledge collection name"),
      },
      async (params) => {
        const { getStorageAdapter } = await import("../data/storage-factory.js");
        const adapter = await getStorageAdapter();
        const limit = params.limit ?? 10;
        const fetchLimit = Math.max(limit * 4, 30);
        const results = await adapter.memory.searchByKeyword(params.query, fetchLimit);
        let hits = results.filter((r) => r.item.memoryType === "knowledge");
        if (params.collection) {
          const col = params.collection.toLowerCase();
          hits = hits.filter((r) => {
            const extra = r.item.extra as Record<string, unknown> | null;
            const itemCol = (extra?.collection as string) ?? (extra?.collectionTag as string) ?? "";
            return itemCol.toLowerCase() === col;
          });
        }
        hits = hits.slice(0, limit);

        if (hits.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No knowledge found for "${params.query}"` }],
          };
        }
        const formatted = hits
          .map((r, i) => {
            const extra = r.item.extra as Record<string, unknown> | null;
            const source = (extra?.sourceFile as string) ?? (extra?.collection as string) ?? "";
            return `[${i + 1}] (score=${r.score.toFixed(2)}${source ? `, source=${source}` : ""}) ${r.item.summary.slice(0, 600)}`;
          })
          .join("\n\n");
        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${hits.length} knowledge items:\n\n${formatted}`,
            },
          ],
        };
      },
    );
  }

  // ---- Tasks list ----
  if (ok("tasks_list", allowedTools)) {
    mcp.tool(
      "tasks_list",
      "List tasks from the agent's task system.",
      {
        status: z
          .enum(["pending", "in_progress", "blocked", "completed", "failed", "cancelled"])
          .optional()
          .describe("Filter by status"),
        limit: z.number().optional().describe("Maximum results (default 20)"),
      },
      async (params) => {
        const { getStorageAdapter } = await import("../data/storage-factory.js");
        const adapter = await getStorageAdapter();
        const tasks = await adapter.tasks.list({
          status: params.status,
          limit: params.limit ?? 20,
        });
        if (tasks.length === 0)
          return { content: [{ type: "text" as const, text: "No tasks found." }] };
        const formatted = tasks
          .map((t) => `- [${t.status}] ${t.title} (id=${t.id}, priority=${t.priority})`)
          .join("\n");
        return { content: [{ type: "text" as const, text: `Tasks:\n\n${formatted}` }] };
      },
    );
  }

  // ---- Tasks create ----
  if (ok("tasks_create", allowedTools)) {
    mcp.tool(
      "tasks_create",
      "Create a new task in the agent's task system.",
      {
        title: z.string().describe("Task title"),
        description: z.string().optional().describe("Task description"),
        priority: z
          .enum(["urgent", "high", "normal", "low", "background"])
          .optional()
          .describe("Priority level (default: normal)"),
      },
      async (params) => {
        const { getStorageAdapter } = await import("../data/storage-factory.js");
        const adapter = await getStorageAdapter();
        const task = await adapter.tasks.create({
          title: params.title,
          description: params.description,
          priority: params.priority ?? "normal",
          source: "user",
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Task created: "${task.title}" (id=${task.id}, priority=${task.priority})`,
            },
          ],
        };
      },
    );
  }

  // ---- Agent status ----
  if (ok("agent_status", allowedTools)) {
    mcp.tool(
      "agent_status",
      "Get the current status of the ArgentOS agent, including local model health.",
      {},
      async () => {
        const config = loadConfig();
        const agentName = config.agents?.defaults?.name ?? "Argent";
        const model = config.agents?.defaults?.model?.primary ?? "unknown";

        // Probe local LLM (LM Studio default port)
        const localEndpoints = [
          { name: "LM Studio", url: "http://127.0.0.1:1234/v1/models" },
          { name: "Ollama", url: "http://127.0.0.1:11434/api/tags" },
        ];
        const localStatus: string[] = [];
        for (const ep of localEndpoints) {
          try {
            const { response, release } = await fetchWithSsrFGuard({
              url: ep.url,
              timeoutMs: 2000,
              policy: MCP_LOCAL_ENDPOINT_POLICY,
            });
            try {
              localStatus.push(`${ep.name}: UP (${response.status})`);
            } finally {
              await release();
            }
          } catch {
            localStatus.push(`${ep.name}: DOWN`);
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Agent: ${agentName}`,
                `Model: ${model}`,
                `Gateway: running on port ${config.gateway?.port ?? 18789}`,
                `MCP sessions: ${transports.size} active`,
                ``,
                `Local Models:`,
                ...localStatus.map((s) => `  ${s}`),
              ].join("\n"),
            },
          ],
        };
      },
    );
  }

  // ===========================================================================
  // Operations tools
  // ===========================================================================

  // ---- Family list ----
  if (ok("family_list", allowedTools)) {
    mcp.tool(
      "family_list",
      "List all family agents in the ArgentOS system with their name, role, team, status, and live presence.",
      {},
      async () => {
        const { getAgentFamily } = await import("../data/agent-family.js");
        const family = await getAgentFamily();
        const members = await family.listMembers();

        if (members.length === 0) {
          return { content: [{ type: "text" as const, text: "No family agents registered." }] };
        }

        const formatted = members
          .map(
            (m) =>
              `- ${m.name} (id=${m.id}, role=${m.role}, team=${m.team ?? "unassigned"}, status=${m.status}, alive=${m.alive})`,
          )
          .join("\n");
        return {
          content: [
            { type: "text" as const, text: `Family agents (${members.length}):\n\n${formatted}` },
          ],
        };
      },
    );
  }

  // ---- Projects list ----
  if (ok("projects_list", allowedTools)) {
    mcp.tool(
      "projects_list",
      "List all projects with task counts and completion progress.",
      {
        status: z
          .enum(["pending", "in_progress", "blocked", "completed", "failed", "cancelled"])
          .optional()
          .describe("Filter by project status"),
        limit: z.number().optional().describe("Maximum results (default 20)"),
      },
      async (params) => {
        const { getDataAPI } = await import("../data/index.js");
        const api = await getDataAPI();
        const projects = await api.listProjects({
          status: params.status,
          limit: params.limit ?? 20,
        });

        if (projects.length === 0) {
          return { content: [{ type: "text" as const, text: "No projects found." }] };
        }

        const formatted = projects
          .map((p) => {
            const pct = p.taskCount > 0 ? Math.round((p.completedCount / p.taskCount) * 100) : 0;
            return `- [${p.project.status}] ${p.project.title} (id=${p.project.id}, ${p.completedCount}/${p.taskCount} tasks, ${pct}% complete, priority=${p.project.priority})`;
          })
          .join("\n");
        return {
          content: [
            { type: "text" as const, text: `Projects (${projects.length}):\n\n${formatted}` },
          ],
        };
      },
    );
  }

  // ---- Project detail ----
  if (ok("project_detail", allowedTools)) {
    mcp.tool(
      "project_detail",
      "Get a project with all its child tasks, showing completion status for each.",
      {
        id: z.string().describe("Project ID"),
      },
      async (params) => {
        const { getDataAPI } = await import("../data/index.js");
        const api = await getDataAPI();
        const project = await api.getProjectWithChildren(params.id);

        if (!project) {
          return { content: [{ type: "text" as const, text: `Project not found: ${params.id}` }] };
        }

        const pct =
          project.taskCount > 0
            ? Math.round((project.completedCount / project.taskCount) * 100)
            : 0;
        const header = `Project: ${project.project.title}\nStatus: ${project.project.status} | Priority: ${project.project.priority}\nProgress: ${project.completedCount}/${project.taskCount} tasks (${pct}%)`;

        const taskLines = project.tasks
          .map(
            (t) =>
              `  - [${t.status}] ${t.title} (priority=${t.priority}${t.assignee ? `, assignee=${t.assignee}` : ""})`,
          )
          .join("\n");

        const desc = project.project.description
          ? `\nDescription: ${project.project.description}`
          : "";
        return {
          content: [{ type: "text" as const, text: `${header}${desc}\n\nTasks:\n${taskLines}` }],
        };
      },
    );
  }

  // ---- Project create ----
  if (ok("project_create", allowedTools)) {
    mcp.tool(
      "project_create",
      "Create a new project with child tasks.",
      {
        title: z.string().describe("Project title"),
        description: z.string().optional().describe("Project description"),
        priority: z
          .enum(["urgent", "high", "normal", "low", "background"])
          .optional()
          .describe("Priority (default: normal)"),
        tasks: z
          .array(
            z.object({
              title: z.string().describe("Task title"),
              description: z.string().optional().describe("Task description"),
              priority: z
                .enum(["urgent", "high", "normal", "low", "background"])
                .optional()
                .describe("Task priority"),
            }),
          )
          .describe("Child tasks to create with the project"),
      },
      async (params) => {
        const { getDataAPI } = await import("../data/index.js");
        const api = await getDataAPI();
        const project = await api.createProject({
          title: params.title,
          description: params.description,
          priority: params.priority ?? "normal",
          source: "user",
          tasks: params.tasks.map((t) => ({
            title: t.title,
            description: t.description,
            priority: t.priority ?? "normal",
            source: "user" as const,
          })),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Project created: "${project.project.title}" (id=${project.project.id}) with ${project.taskCount} tasks.`,
            },
          ],
        };
      },
    );
  }

  // ---- Schedules list ----
  if (ok("schedules_list", allowedTools)) {
    mcp.tool(
      "schedules_list",
      "List all cron schedules and recurring jobs configured in ArgentOS.",
      {
        includeDisabled: z
          .boolean()
          .optional()
          .describe("Include disabled schedules (default: false)"),
      },
      async (params) => {
        const { loadCronStore, resolveCronStorePath } = await import("../cron/store.js");
        const config = loadConfig();
        const storePath = resolveCronStorePath(config.cron?.store);
        const store = await loadCronStore(storePath);

        let jobs = store.jobs;
        if (!params.includeDisabled) {
          jobs = jobs.filter((j) => j.enabled !== false);
        }

        if (jobs.length === 0) {
          return { content: [{ type: "text" as const, text: "No schedules found." }] };
        }

        const formatted = jobs
          .map((j) => {
            const sched = j.schedule;
            const schedStr =
              (sched?.cron ?? sched?.intervalMinutes)
                ? `every ${sched.intervalMinutes}m`
                : (sched?.at ?? "unknown");
            const agent = j.agentId ?? "default";
            const enabled = j.enabled !== false ? "on" : "off";
            return `- [${enabled}] ${j.name} (id=${j.id}, schedule=${schedStr}, agent=${agent})\n    ${j.description ?? ""}`;
          })
          .join("\n");
        return {
          content: [{ type: "text" as const, text: `Schedules (${jobs.length}):\n\n${formatted}` }],
        };
      },
    );
  }

  // ---- Jobs list ----
  if (ok("jobs_list", allowedTools)) {
    mcp.tool(
      "jobs_list",
      "List workforce job assignments and their recent runs.",
      {
        agentId: z.string().optional().describe("Filter by agent ID"),
        limit: z.number().optional().describe("Maximum results (default 20)"),
      },
      async (params) => {
        const { getStorageAdapter } = await import("../data/storage-factory.js");
        const adapter = await getStorageAdapter();

        if (!adapter.jobs) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Job system not available (requires PostgreSQL backend).",
              },
            ],
          };
        }

        const assignments = await adapter.jobs.listAssignments({
          agentId: params.agentId,
          enabled: true,
        });

        if (assignments.length === 0) {
          return { content: [{ type: "text" as const, text: "No job assignments found." }] };
        }

        const limited = assignments.slice(0, params.limit ?? 20);
        const formatted = await Promise.all(
          limited.map(async (a) => {
            const runs = await adapter.jobs.listRuns({ assignmentId: a.id, limit: 3 });
            const lastRun = runs[0];
            const runInfo = lastRun
              ? ` | last run: ${lastRun.status} at ${new Date(lastRun.startedAt).toISOString()}`
              : " | no runs yet";
            return `- ${a.title} (id=${a.id}, agent=${a.agentId}, cadence=${a.cadenceMinutes}m, mode=${a.executionMode}${runInfo})`;
          }),
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Job assignments (${assignments.length}):\n\n${formatted.join("\n")}`,
            },
          ],
        };
      },
    );
  }

  // ===========================================================================
  // Agent conversation
  // ===========================================================================

  // ---- Group chat ----
  if (ok("group_chat", allowedTools)) {
    mcp.tool(
      "group_chat",
      "Send a message to multiple ArgentOS agents and collect all their responses. Use for team briefings, multi-perspective analysis, or coordinating across agents. Specify agent IDs or a team name (e.g. 'dev-team', 'think-tank').",
      {
        message: z.string().describe("The message to send to all agents"),
        agentIds: z
          .array(z.string())
          .optional()
          .describe("Specific agent IDs to include (e.g. ['forge', 'anvil', 'scout'])"),
        team: z
          .string()
          .optional()
          .describe("Team name to message all members of (e.g. 'dev-team', 'think-tank')"),
        thinking: z
          .enum(["off", "low", "medium", "high"])
          .optional()
          .describe("Thinking depth (default: off)"),
      },
      async (params) => {
        if (!params.agentIds?.length && !params.team) {
          return { content: [{ type: "text" as const, text: "Provide either agentIds or team." }] };
        }

        let targetIds = params.agentIds ?? [];

        // Resolve team members if team specified
        if (params.team) {
          const { getAgentFamily } = await import("../data/agent-family.js");
          const family = await getAgentFamily();
          const members = await family.listMembers();
          const teamMembers = members
            .filter((m) => m.team?.toLowerCase() === params.team!.toLowerCase())
            .map((m) => m.id);
          targetIds = [...new Set([...targetIds, ...teamMembers])];
        }

        if (targetIds.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `No agents found for team "${params.team}".` },
            ],
          };
        }

        const { randomUUID } = await import("node:crypto");
        const { agentCommand } = await import("../commands/agent.js");
        const { createDefaultDeps } = await import("../cli/deps.js");
        const { defaultRuntime } = await import("../runtime.js");
        const { resolveAgentMainSessionKey } = await import("../config/sessions.js");
        const cfg = loadConfig();
        const deps = createDefaultDeps();

        const responses: string[] = [];
        for (const agentId of targetIds) {
          const sessionKey = resolveAgentMainSessionKey({ cfg, agentId });
          try {
            const result = await agentCommand(
              {
                message: params.message,
                agentId,
                sessionKey,
                thinking: params.thinking ?? "off",
                runId: `mcp-group-${randomUUID()}`,
              },
              defaultRuntime,
              deps,
            );
            const payloads = (result as { payloads?: Array<{ text?: string }> })?.payloads ?? [];
            const text = payloads
              .map((p) => p.text)
              .filter(Boolean)
              .join("\n\n");
            responses.push(`## ${agentId}\n\n${text || "(no response)"}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            responses.push(`## ${agentId}\n\nError: ${msg}`);
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Group chat with ${targetIds.length} agents:\n\n${responses.join("\n\n---\n\n")}`,
            },
          ],
        };
      },
    );
  }

  // ---- Think Tank ----
  if (ok("think_tank", allowedTools)) {
    mcp.tool(
      "think_tank",
      "Convene the Think Tank — send a topic to all four panelists (Dario, Sam, Elon, Jensen) for multi-perspective debate. Each runs their full pipeline with their unique provider and personality. Returns all perspectives.",
      {
        topic: z.string().describe("The debate topic or question for the panel"),
        panelists: z
          .array(z.string())
          .optional()
          .describe("Specific panelists (default: all four). Options: dario, sam, elon, jensen"),
        thinking: z
          .enum(["off", "low", "medium", "high"])
          .optional()
          .describe("Thinking depth (default: low)"),
      },
      async (params) => {
        const panel = params.panelists?.length
          ? params.panelists
          : ["dario", "sam", "elon", "jensen"];
        const { randomUUID } = await import("node:crypto");
        const { agentCommand } = await import("../commands/agent.js");
        const { createDefaultDeps } = await import("../cli/deps.js");
        const { defaultRuntime } = await import("../runtime.js");
        const { resolveAgentMainSessionKey } = await import("../config/sessions.js");
        const cfg = loadConfig();
        const deps = createDefaultDeps();

        const responses: string[] = [];
        for (const agentId of panel) {
          const sessionKey = resolveAgentMainSessionKey({ cfg, agentId });
          try {
            const result = await agentCommand(
              {
                message: `[THINK_TANK DEBATE]\n\nTopic: ${params.topic}\n\nProvide your perspective based on your expertise and worldview. Be direct, opinionated, and specific.`,
                agentId,
                sessionKey,
                thinking: params.thinking ?? "low",
                runId: `mcp-tank-${randomUUID()}`,
              },
              defaultRuntime,
              deps,
            );
            const payloads = (result as { payloads?: Array<{ text?: string }> })?.payloads ?? [];
            const text = payloads
              .map((p) => p.text)
              .filter(Boolean)
              .join("\n\n");
            responses.push(
              `## ${agentId.charAt(0).toUpperCase() + agentId.slice(1)}\n\n${text || "(no response)"}`,
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            responses.push(
              `## ${agentId.charAt(0).toUpperCase() + agentId.slice(1)}\n\nError: ${msg}`,
            );
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Think Tank — ${panel.length} panelists on "${params.topic}":\n\n${responses.join("\n\n---\n\n")}`,
            },
          ],
        };
      },
    );
  }

  // ---- Agent chat ----
  if (ok("agent_chat", allowedTools)) {
    mcp.tool(
      "agent_chat",
      "Send a message to a specific ArgentOS agent and get their response. Talk directly to Argent, Forge, Quill, or any registered family agent.",
      {
        message: z.string().describe("The message to send to the agent"),
        agentId: z.string().describe("Agent ID to talk to (e.g. 'argent', 'forge', 'quill')"),
        thinking: z
          .enum(["off", "low", "medium", "high"])
          .optional()
          .describe("Thinking depth (default: off)"),
      },
      async (params) => {
        const { randomUUID } = await import("node:crypto");
        const { agentCommand } = await import("../commands/agent.js");
        const { createDefaultDeps } = await import("../cli/deps.js");
        const { defaultRuntime } = await import("../runtime.js");
        const { resolveAgentMainSessionKey } = await import("../config/sessions.js");

        const cfg = loadConfig();
        const sessionKey = resolveAgentMainSessionKey({ cfg, agentId: params.agentId });

        try {
          const result = await agentCommand(
            {
              message: params.message,
              agentId: params.agentId,
              sessionKey,
              thinking: params.thinking ?? "off",
              runId: `mcp-${randomUUID()}`,
            },
            defaultRuntime,
            createDefaultDeps(),
          );

          const payloads = (result as { payloads?: Array<{ text?: string }> })?.payloads ?? [];
          const text = payloads
            .map((p) => p.text)
            .filter(Boolean)
            .join("\n\n");

          if (!text) {
            return {
              content: [{ type: "text" as const, text: `[${params.agentId}] (no text response)` }],
            };
          }

          return { content: [{ type: "text" as const, text: `[${params.agentId}]:\n\n${text}` }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [
              { type: "text" as const, text: `Error talking to ${params.agentId}: ${msg}` },
            ],
          };
        }
      },
    );
  }
}
