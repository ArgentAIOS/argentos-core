import type { Command } from "commander";
import { createMarketplaceTool } from "../agents/tools/marketplace-tool.js";
import { defaultRuntime } from "../runtime.js";
import { runCommandWithRuntime } from "./cli-utils.js";

async function runMarketplaceAction(
  action: "search" | "details" | "install",
  args: Record<string, unknown>,
) {
  const tool = createMarketplaceTool();
  const result = await tool.execute("cli", { action, ...args });
  const lines = result.content
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .filter(Boolean);
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
