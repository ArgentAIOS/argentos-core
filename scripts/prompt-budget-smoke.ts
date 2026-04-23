/**
 * prompt-budget smoke test — live diagnostic run.
 *
 * Exercises `buildAgentSystemPrompt` under ARGENT_PROMPT_BUDGET_LOG=1 with a
 * representative "good morning" setup (fresh chat, full prompt mode, memory
 * tools available, docs on, a handful of context files). Prints per-injector
 * lines and the summary so the operator can eyeball the breakdown without
 * spinning up the gateway + real agent loop.
 *
 * Run:
 *   ARGENT_PROMPT_BUDGET_LOG=1 bun scripts/prompt-budget-smoke.ts
 *
 * This is a one-off utility — feel free to tweak the params to reproduce a
 * specific turn.
 */

import { buildAgentSystemPrompt } from "../src/agents/system-prompt.js";
import { runWithPromptBudget } from "../src/argent-agent/prompt-budget.js";

async function main() {
  process.env.ARGENT_PROMPT_BUDGET_LOG = "1";

  const toolNames = [
    "read",
    "write",
    "edit",
    "apply_patch",
    "grep",
    "find",
    "ls",
    "exec",
    "process",
    "web_search",
    "web_fetch",
    "browser",
    "canvas",
    "nodes",
    "scheduled_tasks",
    "cron",
    "message",
    "gateway",
    "agents_list",
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "session_status",
    "image",
    "memory_recall",
    "memory_store",
    "memory_timeline",
    "memory_search",
    "memory_get",
    "memory_categories",
    "memory_forget",
    "personal_skill",
    "runtime_services",
    "os_docs",
    "visual_presence",
  ];

  // Representative context files — size roughly matches what gets injected
  // into a fresh "good morning" turn per the operator's report.
  const contextFiles = [
    { path: "SOUL.md", content: "x".repeat(1800) },
    { path: "IDENTITY.md", content: "x".repeat(900) },
    { path: "USER.md", content: "x".repeat(1200) },
    { path: "TOOLS.md", content: "x".repeat(2000) },
    { path: "HEARTBEAT.md", content: "x".repeat(1500) },
    { path: "CONTEMPLATION.md", content: "x".repeat(2200) },
    { path: "RECENT_MEMORY.md", content: "x".repeat(12000) },
    { path: "IDENTITY_CONTEXT.md", content: "x".repeat(4000) },
    { path: "RECENT_CONTEMPLATION.md", content: "x".repeat(4500) },
    { path: "SIS_CONTEXT.md", content: "x".repeat(2000) },
    { path: "RECENT_CHANNEL_CONVERSATIONS.md", content: "x".repeat(3200) },
    { path: "LIVE_INBOX_LEDGER.md", content: "x".repeat(2500) },
    { path: "KERNEL_CONTINUITY.md", content: "x".repeat(1800) },
    { path: "SESSION_SNAPSHOT.md", content: "x".repeat(2200) },
    { path: "TTS_POLICY.md", content: "x".repeat(400) },
  ];

  const { result: prompt, tracker } = await runWithPromptBudget(async () => {
    return buildAgentSystemPrompt({
      workspaceDir: "/Users/sem/argent",
      toolNames,
      toolSummaries: {},
      contextFiles,
      skillsPrompt:
        "<available_skills>\n" +
        "  <skill>\n    <name>demo-a</name>\n    <description>example 1</description>\n  </skill>\n".repeat(
          20,
        ) +
        "</available_skills>",
      heartbeatPrompt: "You are Argent, alive and learning.",
      docsPath: "/Users/sem/argent/docs",
      ttsHint: "Use natural conversational tone for voice.",
      ownerNumbers: ["+12145551212"],
      promptMode: "full",
      memoryCitationsMode: "on",
      userTimezone: "America/Chicago",
      modelAliasLines: ["sonnet -> anthropic/claude-3-5-sonnet"],
      extraSystemPrompt:
        "Intent hint: focus on helpful action.\n\nCross-channel: recent Telegram thread 412 chars...",
      workspaceNotes: ["Reminder: commit your changes in this workspace after edits."],
      runtimeInfo: {
        agentId: "main",
        host: "argent-studio",
        os: "Darwin 24.1.0",
        arch: "arm64",
        node: "v22.22.0",
        model: "ollama/qwen3-30b-a3b-instruct",
        defaultModel: "ollama/qwen3-30b-a3b-instruct",
        channel: "dashboard",
        capabilities: [],
      },
    });
  });

  tracker.logSummary({
    model: "ollama/qwen3-30b-a3b-instruct",
    totalChars: prompt.length,
  });
  // eslint-disable-next-line no-console
  console.log(
    `\n[smoke] system-prompt total chars=${prompt.length} tokens≈${Math.ceil(prompt.length / 4)}`,
  );

  // eslint-disable-next-line no-console
  console.log("\n[smoke] top 5 injectors by chars:");
  const sorted = [...tracker.getEntries()]
    .filter((e) => e.name !== "system-prompt-total")
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 5);
  for (const e of sorted) {
    // eslint-disable-next-line no-console
    console.log(
      `  ${e.name.padEnd(40)} ${String(e.chars).padStart(6)} chars  ${String(e.tokens).padStart(5)} tok`,
    );
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
