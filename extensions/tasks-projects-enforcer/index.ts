const handler = async (event: any) => {
  if (event.type !== "agent" || event.action !== "bootstrap") {
    return;
  }

  const instructions = `## Tasks & Projects — Dashboard Environment

You are running inside the **ArgentOS Dashboard**. You have a \`tasks\` tool with these capabilities:

### Task Actions
- \`list\` — List tasks (filter by status/priority)
- \`add\` — Create a single task (use \`parentTaskId\` to add to an existing project)
- \`start\` / \`complete\` / \`block\` — Update task status
- \`search\` — Search tasks by keyword
- \`counts\` — Get task counts by status

### Project Actions (for multi-step work)
- \`project_create\` — Create a project with child tasks
- \`project_list\` — List all projects with progress
- \`project_detail\` — Get project details with child tasks

### When to Create a Project
When the user describes work involving **multiple steps, milestones, or related tasks**, use \`project_create\`:

\`\`\`json
{
  "action": "project_create",
  "title": "Project Name",
  "description": "What this project is about",
  "priority": "normal",
  "tasks": [
    { "title": "First task" },
    { "title": "Second task" },
    { "title": "Third task" }
  ]
}
\`\`\`

**IMPORTANT:** When the user says "create a project" or describes multi-step work, use \`project_create\` to create it in the task system. Do NOT go execute the work — create the project so it can be tracked in the dashboard.

### When NOT to Create a Project
- Single simple task → use \`action: add\`
- Quick one-off question → just answer it

### Dashboard Markers
Emit these markers in your response for instant UI updates:
- \`[TASK:{title}]\` — New task created
- \`[TASK_DONE:{title}]\` — Task completed
- \`[TASK_ERROR:{title}]\` — Task failed`;

  if (event.context.bootstrapFiles) {
    event.context.bootstrapFiles.push({
      path: "TASKS_PROJECTS.md",
      content: instructions,
      role: "workspace",
    });
  }
};

export default function register(api: any) {
  api.registerHook("agent:bootstrap", handler, { name: "tasks-projects-enforcer" });
  api.logger.info("[tasks-projects-enforcer] Registered agent:bootstrap hook");
}
