#!/usr/bin/env bun
/**
 * sync-docs.ts — Sync internal docs to the external docs site.
 *
 * Source of truth: docs/argent/ (ships with ArgentOS, read by os_docs tool)
 * Target: ../argent-docs/content/docs/ (Fumadocs site at docs.argent.ai)
 *
 * Usage:
 *   bun scripts/sync-docs.ts           # Sync all mapped docs
 *   bun scripts/sync-docs.ts --dry-run # Show what would change without writing
 *   bun scripts/sync-docs.ts --check   # Exit 1 if any docs are out of sync (CI mode)
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_DIR = path.join(ROOT, "docs", "argent");
const DOCS_SITE = path.resolve(ROOT, "..", "argent-docs");
const TARGET_DIR = path.join(DOCS_SITE, "content", "docs");

// ─── Mapping: source file → docs site location + metadata ───────────────────
//
// Each entry maps a file from docs/argent/ to a location in the docs site.
// title/description can be overridden; if omitted, extracted from the source.
// section is the docs site section (must match a directory in content/docs/).
// slug is the filename (without .mdx) in that section.

type DocMapping = {
  source: string; // filename in docs/argent/ (e.g., "MINION_PATTERN.md")
  section: string; // docs site section (e.g., "agents")
  slug: string; // output filename without extension (e.g., "minion-pattern")
  title?: string; // override title (extracted from source if omitted)
  description?: string; // override description (extracted from source if omitted)
};

const MAPPINGS: DocMapping[] = [
  {
    source: "MINION_PATTERN.md",
    section: "agents",
    slug: "minion-pattern",
  },
  {
    source: "SIS_ARCHITECTURE.md",
    section: "agents",
    slug: "sis-architecture",
    title: "Self-Improving System (SIS)",
    description:
      "How ArgentOS learns from its own behavior — lessons, patterns, and feedback loops.",
  },
  {
    source: "RALF_ANGEL.md",
    section: "agents",
    slug: "ralf-angel",
    title: "RALF + ANGEL",
    description: "Response Accountability Llama Framework and the ANGEL verification loop.",
  },
  {
    source: "ACCOUNTABILITY_SCORE.md",
    section: "agents",
    slug: "accountability-score",
    title: "Accountability Score",
    description:
      "How ArgentOS tracks agent reliability with a moving-target score, ratchet, and penalties.",
  },
  {
    source: "PROJECTS.md",
    section: "tasks",
    slug: "projects",
    title: "Projects",
    description:
      "Multi-step task grouping — project lifecycle, agent tools, and dashboard integration.",
  },
  {
    source: "MIGRATION.md",
    section: "start",
    slug: "migration",
    title: "Migration from OpenClaw",
    description: 'The "Bring Your Agent" migration guide from OpenClaw to ArgentOS.',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractTitle(content: string): string {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
  }
  return "Untitled";
}

function extractDescription(content: string): string {
  let pastTitle = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("# ") && !pastTitle) {
      pastTitle = true;
      continue;
    }
    if (pastTitle && trimmed.startsWith("> ")) {
      return trimmed.slice(2).trim();
    }
    if (
      pastTitle &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("|") &&
      !trimmed.startsWith("-") &&
      !trimmed.startsWith("```")
    ) {
      return trimmed.length > 150 ? `${trimmed.slice(0, 147)}...` : trimmed;
    }
  }
  return "";
}

/** Strip the first `# Title` heading (Fumadocs uses frontmatter title instead). */
function stripFirstHeading(content: string): string {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("# ")) {
      lines.splice(i, 1);
      // Also remove the blank line after the heading if present
      if (i < lines.length && lines[i].trim() === "") {
        lines.splice(i, 1);
      }
      break;
    }
  }
  return lines.join("\n");
}

/** Strip blockquote description line right after the title (already in frontmatter). */
function stripLeadingBlockquote(content: string): string {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    if (lines[i].trim().startsWith("> ")) {
      lines.splice(i, 1);
      if (i < lines.length && lines[i].trim() === "") {
        lines.splice(i, 1);
      }
      break;
    }
    break; // First non-empty line isn't a blockquote, stop
  }
  return lines.join("\n");
}

function generateMdx(mapping: DocMapping, sourceContent: string): string {
  const title = mapping.title || extractTitle(sourceContent);
  const description = mapping.description || extractDescription(sourceContent);

  // Strip the first heading and leading blockquote (they're in frontmatter now)
  let body = stripFirstHeading(sourceContent);
  body = stripLeadingBlockquote(body);

  // Escape any { } in the markdown that aren't in code blocks (MDX treats them as JSX)
  // Only escape outside of code fences and inline code
  const escapedBody = escapeJsxInMarkdown(body);

  const frontmatter = ["---", `title: ${title}`, `description: ${description}`, "---"].join("\n");

  return `${frontmatter}\n\n${escapedBody.trimStart()}`;
}

/** Escape lone { } outside of code blocks/spans for MDX compatibility. */
function escapeJsxInMarkdown(content: string): string {
  const lines = content.split("\n");
  let inCodeFence = false;
  const result: string[] = [];

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeFence = !inCodeFence;
      result.push(line);
      continue;
    }
    if (inCodeFence) {
      result.push(line);
      continue;
    }
    // Outside code fences: escape { and } that aren't in inline code
    // Simple heuristic: skip lines that are inside inline code spans
    result.push(escapeLineJsx(line));
  }
  return result.join("\n");
}

function escapeLineJsx(line: string): string {
  // Split by inline code spans (backticks), only escape outside them
  const parts = line.split(/(`[^`]*`)/g);
  return parts
    .map((part, i) => {
      // Odd indices are inside backticks
      if (i % 2 === 1) return part;
      // Even indices are outside — escape braces
      return part.replace(/\{/g, "\\{").replace(/\}/g, "\\}");
    })
    .join("");
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const checkMode = args.includes("--check");

if (!fs.existsSync(SOURCE_DIR)) {
  console.error(`Source directory not found: ${SOURCE_DIR}`);
  process.exit(1);
}

if (!fs.existsSync(TARGET_DIR)) {
  console.error(`Docs site not found: ${TARGET_DIR}`);
  console.error("Expected argent-docs repo at:", DOCS_SITE);
  process.exit(1);
}

let synced = 0;
let skipped = 0;
let outOfSync = 0;

console.log(`Source: ${SOURCE_DIR}`);
console.log(`Target: ${TARGET_DIR}`);
console.log(`Mode: ${checkMode ? "check" : dryRun ? "dry-run" : "sync"}\n`);

for (const mapping of MAPPINGS) {
  const sourcePath = path.join(SOURCE_DIR, mapping.source);
  const targetPath = path.join(TARGET_DIR, mapping.section, `${mapping.slug}.mdx`);

  if (!fs.existsSync(sourcePath)) {
    console.warn(`⚠  Source missing: ${mapping.source} (skipped)`);
    skipped++;
    continue;
  }

  const sourceContent = fs.readFileSync(sourcePath, "utf-8");
  const mdxContent = generateMdx(mapping, sourceContent);

  // Check if target exists and is different
  const targetExists = fs.existsSync(targetPath);
  const targetContent = targetExists ? fs.readFileSync(targetPath, "utf-8") : "";

  if (targetExists && targetContent === mdxContent) {
    console.log(`✓  ${mapping.source} → ${mapping.section}/${mapping.slug}.mdx (up to date)`);
    continue;
  }

  if (checkMode) {
    const status = targetExists ? "out of sync" : "missing";
    console.log(`✗  ${mapping.source} → ${mapping.section}/${mapping.slug}.mdx (${status})`);
    outOfSync++;
    continue;
  }

  if (dryRun) {
    const status = targetExists ? "would update" : "would create";
    console.log(`~  ${mapping.source} → ${mapping.section}/${mapping.slug}.mdx (${status})`);
    synced++;
    continue;
  }

  // Ensure target directory exists
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(targetPath, mdxContent);
  const status = targetExists ? "updated" : "created";
  console.log(`✓  ${mapping.source} → ${mapping.section}/${mapping.slug}.mdx (${status})`);
  synced++;
}

// Check for unmapped source files
const allSourceFiles = fs
  .readdirSync(SOURCE_DIR)
  .filter((f) => f.endsWith(".md") && f !== "INDEX.md" && f !== "CLAUDE.md");
const mappedFiles = new Set(MAPPINGS.map((m) => m.source));
const unmapped = allSourceFiles.filter((f) => !mappedFiles.has(f));

if (unmapped.length > 0) {
  console.log(`\n⚠  Unmapped docs (add to MAPPINGS in sync-docs.ts):`);
  for (const f of unmapped) {
    console.log(`   - ${f}`);
  }
}

// Check meta.json entries
if (!checkMode && !dryRun && synced > 0) {
  console.log(`\nReminder: Check that meta.json files include new pages:`);
  const sections = new Set(MAPPINGS.map((m) => m.section));
  for (const section of sections) {
    const metaPath = path.join(TARGET_DIR, section, "meta.json");
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const pages: string[] = meta.pages || [];
      const sectionMappings = MAPPINGS.filter((m) => m.section === section);
      for (const mapping of sectionMappings) {
        if (!pages.includes(mapping.slug)) {
          console.log(`   ⚠  Add "${mapping.slug}" to ${section}/meta.json pages array`);
        }
      }
    }
  }
}

console.log(
  `\nDone: ${synced} synced, ${skipped} skipped${checkMode ? `, ${outOfSync} out of sync` : ""}`,
);

if (checkMode && outOfSync > 0) {
  console.log(`\nRun "bun scripts/sync-docs.ts" to sync.`);
  process.exit(1);
}
