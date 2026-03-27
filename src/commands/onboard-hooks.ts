import type { ArgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { formatCliCommand } from "../cli/command-format.js";
import { buildWorkspaceHookStatus } from "../hooks/hooks-status.js";

export async function setupInternalHooks(
  cfg: ArgentConfig,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<ArgentConfig> {
  await prompter.note(
    [
      "Hooks let Argent react automatically when important events happen.",
      "Example: save session context to memory when you issue /new.",
      "",
      "Learn more: https://docs.argent.ai/hooks",
    ].join("\n"),
    "Argent hooks",
  );

  // Discover available hooks using the hook discovery system
  const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  const report = buildWorkspaceHookStatus(workspaceDir, { config: cfg });

  // Show every eligible hook so users can opt in during onboarding.
  const eligibleHooks = report.hooks.filter((h) => h.eligible);

  if (eligibleHooks.length === 0) {
    await prompter.note(
      "No ready-to-enable hooks were found. You can wire them in later from the hooks menu.",
      "Argent hooks",
    );
    return cfg;
  }

  const toEnable = await prompter.multiselect({
    message: "Which hooks should Argent bring online?",
    options: [
      { value: "__skip__", label: "Skip for now" },
      ...eligibleHooks.map((hook) => ({
        value: hook.name,
        label: `${hook.emoji ?? "🔗"} ${hook.name}`,
        hint: hook.description,
      })),
    ],
  });

  const selected = toEnable.filter((name) => name !== "__skip__");
  if (selected.length === 0) {
    return cfg;
  }

  // Enable selected hooks using the new entries config format
  const entries = { ...cfg.hooks?.internal?.entries };
  for (const name of selected) {
    entries[name] = { enabled: true };
  }

  const next: ArgentConfig = {
    ...cfg,
    hooks: {
      ...cfg.hooks,
      internal: {
        enabled: true,
        entries,
      },
    },
  };

  await prompter.note(
    [
      `Argent enabled ${selected.length} hook${selected.length > 1 ? "s" : ""}: ${selected.join(", ")}`,
      "",
      "You can manage hooks later with:",
      `  ${formatCliCommand("argent hooks list")}`,
      `  ${formatCliCommand("argent hooks enable <name>")}`,
      `  ${formatCliCommand("argent hooks disable <name>")}`,
    ].join("\n"),
    "Argent hooks",
  );

  return next;
}
