import type { Command } from "commander";
import { createMarketplaceTool } from "../agents/tools/marketplace-tool.js";
import { defaultRuntime } from "../runtime.js";
import { runCommandWithRuntime } from "./cli-utils.js";

function marketplaceResultLines(result: unknown): string[] {
  if (!result || typeof result !== "object") {
    return [];
  }

  const typed = result as {
    content?: Array<{ type?: string; text?: unknown }>;
    details?: unknown;
  };

  const content = Array.isArray(typed.content) ? typed.content : [];
  const lines = content
    .filter((entry) => entry?.type === "text")
    .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
    .filter(Boolean);
  if (lines.length > 0) {
    return lines;
  }

  if (typed.details === undefined) {
    return [];
  }
  if (typeof typed.details === "string") {
    return typed.details.trim() ? [typed.details] : [];
  }
  try {
    return [JSON.stringify(typed.details, null, 2)];
  } catch {
    return [String(typed.details)];
  }
}

async function runMarketplaceAction(
  action: "search" | "details" | "install",
  args: Record<string, unknown>,
) {
  const tool = createMarketplaceTool();
  const result = await tool.execute("cli", { action, ...args });
  const lines = marketplaceResultLines(result);
  if (lines.length > 0) {
    defaultRuntime.log(lines.join("\n"));
  }
}

export function registerMarketplaceCli(program: Command) {
  const marketplace = program
    .command("marketplace")
    .description("Browse and install packages from the ArgentOS Marketplace");

  marketplace
    .command("search")
    .description("Browse or search marketplace packages")
    .argument("[query]", "Search query")
    .option("-c, --category <category>", "Filter by category")
    .option("-l, --limit <limit>", "Max results", (value) => Number.parseInt(value, 10))
    .action(async (query: string | undefined, opts: { category?: string; limit?: number }) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await runMarketplaceAction("search", {
          query,
          category: opts.category,
          limit: opts.limit,
        });
      });
    });

  marketplace
    .command("details")
    .description("Show package details")
    .argument("<packageId>", "Package ID")
    .action(async (packageId: string) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await runMarketplaceAction("details", { packageId });
      });
    });

  marketplace
    .command("install")
    .description("Download and install a marketplace package")
    .argument("<packageId>", "Package ID")
    .action(async (packageId: string) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await runMarketplaceAction("install", { packageId });
      });
    });
}
