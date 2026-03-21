/**
 * Doc Panel CLI
 *
 * Push files to the dashboard doc panel, list documents, search.
 *
 * Usage:
 *   argent doc-panel <file> [title] [--tags t1,t2] [--type markdown|code|data|html]
 *   argent doc-panel list [--json]
 *   argent doc-panel search <query> [--json]
 */

import type { Command } from "commander";

export function registerDocPanelCli(program: Command) {
  const cmd = program
    .command("doc-panel")
    .description("Push files to dashboard doc panel")
    .argument("[file]", "File to push")
    .argument("[title]", "Document title (auto-detected if omitted)")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--type <type>", "Document type: markdown, code, data, html (auto-detected)")
    .option("--json", "JSON output")
    .action(
      async (
        file: string | undefined,
        title: string | undefined,
        opts: Record<string, string | boolean | undefined>,
      ) => {
        if (!file) {
          cmd.help();
          return;
        }
        const { pushDocument } = await import("../commands/doc-panel.js");
        try {
          const result = await pushDocument(
            file,
            title,
            opts.tags as string | undefined,
            opts.type as string | undefined,
          );
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const tags = result.tags?.length ? ` [${result.tags.join(", ")}]` : "";
            console.log(`Pushed "${result.title}" → DocPanel (${result.id})${tags}`);
          }
        } catch (err) {
          console.error(`Error: ${err instanceof Error ? err.message : err}`);
          process.exitCode = 1;
        }
      },
    );

  cmd
    .command("list")
    .description("List all documents in the doc panel")
    .option("--json", "JSON output")
    .action(async (opts: { json?: boolean }) => {
      const { listDocuments } = await import("../commands/doc-panel.js");
      try {
        await listDocuments(opts.json);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  cmd
    .command("search")
    .description("Search documents in the doc panel")
    .argument("<query>", "Search query")
    .option("--json", "JSON output")
    .action(async (query: string, opts: { json?: boolean }) => {
      const { searchDocuments } = await import("../commands/doc-panel.js");
      try {
        await searchDocuments(query, opts.json);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });
}
