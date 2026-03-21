import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
/**
 * os_docs tool — Lets the agent search and read ArgentOS internal documentation.
 *
 * Resolves docs from the package root (docs/ and docs/argent/), giving the agent
 * structured access to architecture docs, patterns, and reference material that
 * ships with its own operating system.
 */
import type { AnyAgentTool } from "./common.js";
import { resolveArgentDocsPath } from "../docs-path.js";
import { readStringParam } from "./common.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/** Recursively collect all .md files under a directory. */
function collectMarkdownFiles(dir: string, prefix = ""): { relPath: string; absPath: string }[] {
  const results: { relPath: string; absPath: string }[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, .git, assets, images
      if (["node_modules", ".git", "assets", "images", "scripts"].includes(entry.name)) continue;
      results.push(...collectMarkdownFiles(abs, rel));
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))) {
      results.push({ relPath: rel, absPath: abs });
    }
  }
  return results;
}

/** Extract the first heading or first non-empty line as a title. */
function extractTitle(content: string): string {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
    return trimmed;
  }
  return "(untitled)";
}

/** Extract the description line after the title (first non-heading, non-empty line). */
function extractDescription(content: string): string {
  let pastTitle = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (pastTitle) continue;
      continue;
    }
    if (trimmed.startsWith("# ") && !pastTitle) {
      pastTitle = true;
      continue;
    }
    if (
      pastTitle &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith(">") &&
      !trimmed.startsWith("|") &&
      !trimmed.startsWith("-")
    ) {
      return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
    }
    // Also accept blockquote as description
    if (pastTitle && trimmed.startsWith("> ")) {
      const desc = trimmed.slice(2).trim();
      return desc.length > 120 ? `${desc.slice(0, 117)}...` : desc;
    }
    if (pastTitle) continue;
  }
  return "";
}

export function createOsDocsTool(): AnyAgentTool {
  return {
    label: "OS Docs",
    name: "os_docs",
    description: [
      "Search and read ArgentOS internal documentation — architecture, patterns, tools, and reference.",
      "",
      "Actions:",
      "- list: Show all available docs with titles",
      "- read: Read a specific document by name or path",
      "- search: Search across all docs for a keyword/phrase",
      "",
      "Examples:",
      "  os_docs action=list                           → List all docs",
      '  os_docs action=read doc="MINION_PATTERN"      → Read the minion pattern doc',
      '  os_docs action=read doc="argent/SIS_ARCHITECTURE" → Read SIS doc',
      '  os_docs action=search query="task handoff"    → Search for "task handoff" across docs',
      "",
      "Use this when you need to understand your own operating environment,",
      "architecture patterns, or how internal systems work.",
    ].join("\n"),
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("read"), Type.Literal("search")]),
      doc: Type.Optional(Type.String({ description: "Document name or path (for read action)" })),
      query: Type.Optional(Type.String({ description: "Search query (for search action)" })),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      // Resolve docs directory from the package root
      const docsDir = await resolveArgentDocsPath({
        argv1: process.argv[1],
        cwd: process.cwd(),
        moduleUrl: import.meta.url,
      });

      if (!docsDir) {
        return textResult("Error: Could not resolve ArgentOS docs directory.");
      }

      // Resolve the package-root docs (not workspace docs)
      // docs-path.ts checks workspace first, then package root.
      // We want the package root docs always, so resolve from package root directly.
      const allFiles = collectMarkdownFiles(docsDir);

      if (allFiles.length === 0) {
        return textResult(`No documentation files found at ${docsDir}`);
      }

      switch (action) {
        case "list": {
          const lines = [
            `# ArgentOS Documentation (${allFiles.length} files)`,
            `Location: ${docsDir}`,
            "",
          ];
          // Group by directory
          const byDir = new Map<string, typeof allFiles>();
          for (const file of allFiles) {
            const dir = path.dirname(file.relPath);
            const group = dir === "." ? "(root)" : dir;
            if (!byDir.has(group)) byDir.set(group, []);
            byDir.get(group)!.push(file);
          }
          for (const [dir, files] of [...byDir.entries()].sort()) {
            lines.push(`## ${dir}`, "");
            for (const file of files.sort((a, b) => a.relPath.localeCompare(b.relPath))) {
              try {
                const content = fs.readFileSync(file.absPath, "utf-8");
                const title = extractTitle(content);
                const desc = extractDescription(content);
                const descSuffix = desc ? ` — ${desc}` : "";
                lines.push(`- **${file.relPath}**: ${title}${descSuffix}`);
              } catch {
                lines.push(`- **${file.relPath}**: (unreadable)`);
              }
            }
            lines.push("");
          }
          return textResult(lines.join("\n"));
        }

        case "read": {
          const doc = readStringParam(params, "doc", { required: true });

          // Try exact match first, then fuzzy
          let match = allFiles.find((f) => f.relPath === doc);
          if (!match) match = allFiles.find((f) => f.relPath === `${doc}.md`);
          if (!match) match = allFiles.find((f) => f.relPath === `argent/${doc}.md`);
          if (!match) match = allFiles.find((f) => f.relPath.toLowerCase() === doc.toLowerCase());
          if (!match)
            match = allFiles.find((f) => f.relPath.toLowerCase() === `${doc.toLowerCase()}.md`);
          if (!match)
            match = allFiles.find((f) => f.relPath.toLowerCase().includes(doc.toLowerCase()));

          if (!match) {
            const suggestions = allFiles
              .filter((f) => {
                const name = path.basename(f.relPath).toLowerCase();
                return doc
                  .toLowerCase()
                  .split(/[\s_-]+/)
                  .some((word) => name.includes(word));
              })
              .slice(0, 5)
              .map((f) => f.relPath);
            const hint =
              suggestions.length > 0
                ? `\n\nDid you mean one of:\n${suggestions.map((s) => `  - ${s}`).join("\n")}`
                : `\n\nAvailable docs: ${allFiles.map((f) => f.relPath).join(", ")}`;
            return textResult(`Document not found: "${doc}"${hint}`);
          }

          try {
            const content = fs.readFileSync(match.absPath, "utf-8");
            return textResult(`# ${match.relPath}\n\n${content}`);
          } catch (err) {
            return textResult(`Error reading ${match.relPath}: ${err}`);
          }
        }

        case "search": {
          const query = readStringParam(params, "query", { required: true });
          const queryLower = query.toLowerCase();
          const queryWords = queryLower.split(/\s+/).filter(Boolean);

          const results: { relPath: string; title: string; matches: string[] }[] = [];

          for (const file of allFiles) {
            try {
              const content = fs.readFileSync(file.absPath, "utf-8");
              const contentLower = content.toLowerCase();

              // Check if all query words appear
              if (!queryWords.every((word) => contentLower.includes(word))) continue;

              const title = extractTitle(content);
              const lines = content.split("\n");
              const matchLines: string[] = [];

              for (let i = 0; i < lines.length; i++) {
                if (queryWords.some((word) => lines[i].toLowerCase().includes(word))) {
                  const context = lines[i].trim();
                  if (context && matchLines.length < 3) {
                    matchLines.push(
                      `  L${i + 1}: ${context.length > 100 ? `${context.slice(0, 97)}...` : context}`,
                    );
                  }
                }
              }

              results.push({ relPath: file.relPath, title, matches: matchLines });
            } catch {
              // skip unreadable files
            }
          }

          if (results.length === 0) {
            return textResult(`No docs matching "${query}". Try broader terms or use action=list.`);
          }

          const lines = [
            `# Search: "${query}" (${results.length} match${results.length === 1 ? "" : "es"})`,
            "",
          ];
          for (const result of results) {
            lines.push(`## ${result.relPath} — ${result.title}`);
            lines.push(...result.matches);
            lines.push("");
          }
          lines.push('Use os_docs action=read doc="<path>" to read the full document.');
          return textResult(lines.join("\n"));
        }

        default:
          return textResult(`Unknown action: ${action}. Use list, read, or search.`);
      }
    },
  };
}
