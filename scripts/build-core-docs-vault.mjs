#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const docsRoot = path.join(root, "docs");
const defaultVaultRoot = path.join(docsRoot, "obsidian-vault", "ArgentOS Core Docs");
const checkMode = process.argv.includes("--check");
const vaultRoot = checkMode
  ? fs.mkdtempSync(path.join(os.tmpdir(), "argent-core-docs-vault-"))
  : defaultVaultRoot;
const mirrorRoot = path.join(vaultRoot, "90 - Public Docs Mirror", "docs");

const EXCLUDED_DIRS = new Set([".i18n", "archive", "debug", "obsidian-vault", "research"]);
const EXCLUDED_FILES = new Set(["CLAUDE.md"]);
const EXCLUDED_PATHS = new Set([
  "platforms/mac/release.md",
  "platforms/mac/signing.md",
  "plugins/building-plugins.md",
  "reference/AGENTS.default.md",
  "reference/RELEASING.md",
]);
const EXCLUDED_PREFIXES = ["reference/templates/"];
const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);

function fail(message) {
  console.error(`docs:vault: ${message}`);
  process.exit(1);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${content.trimEnd()}\n`, "utf8");
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function isMarkdownFile(file) {
  return MARKDOWN_EXTENSIONS.has(path.extname(file));
}

function shouldSkip(relPath) {
  const normalized = relPath.split(path.sep).join("/");
  if (EXCLUDED_PATHS.has(normalized)) {
    return true;
  }
  if (EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  const parts = relPath.split(path.sep);
  if (parts.some((part) => EXCLUDED_DIRS.has(part))) {
    return true;
  }
  return EXCLUDED_FILES.has(path.basename(relPath));
}

function walk(dir, base = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(base, fullPath);
    if (shouldSkip(relPath)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...walk(fullPath, base));
      continue;
    }
    if (entry.isFile() && isMarkdownFile(entry.name)) {
      files.push(relPath);
    }
  }
  return files.toSorted((a, b) => a.localeCompare(b));
}

function walkAllFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(base, fullPath);
    if (entry.isDirectory()) {
      files.push(...walkAllFiles(fullPath, base));
      continue;
    }
    if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files.toSorted((a, b) => a.localeCompare(b));
}

function parseTitle(content, relPath) {
  const titleMatch = content.match(/\ntitle:\s*["']?([^"'\n]+)["']?\n/);
  if (titleMatch?.[1]) {
    return titleMatch[1].trim();
  }
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) {
    return headingMatch[1].trim();
  }
  return path
    .basename(relPath, path.extname(relPath))
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseSummary(content) {
  const match = content.match(/\nsummary:\s*["']?([^"'\n]+)["']?\n/);
  return match?.[1]?.trim() || null;
}

function toVaultLink(relPath, label) {
  return `[${label}](<90 - Public Docs Mirror/docs/${relPath.replaceAll("\\", "/")}>)`;
}

function linkIfExists(files, relPath, label) {
  const found = files.get(relPath);
  return found ? toVaultLink(found.relPath, label) : label;
}

function sectionIndex(files, title, description, prefixes) {
  const matches = [...files.values()].filter((doc) =>
    prefixes.some((prefix) => doc.relPath === prefix || doc.relPath.startsWith(`${prefix}/`)),
  );
  const lines = [`# ${title}`, "", description, ""];
  if (matches.length === 0) {
    lines.push("_No docs found for this section._");
  } else {
    for (const doc of matches) {
      const summary = doc.summary ? ` - ${doc.summary}` : "";
      lines.push(`- ${toVaultLink(doc.relPath, doc.title)}${summary}`);
    }
  }
  return lines.join("\n");
}

function generatedAtForDocs() {
  try {
    const value = execFileSync(
      "git",
      ["log", "-1", "--format=%cI", "--", "docs", ":(exclude)docs/obsidian-vault"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (value) {
      return value;
    }
  } catch {
    // Keep generated vault checks stable outside a git checkout.
  }
  return "1970-01-01T00:00:00.000Z";
}

function compactJsonArray(array) {
  return `[${array.map((entry) => JSON.stringify(entry)).join(", ")}]`;
}

function replacePrettyArray(json, key, array) {
  const prettyArray = JSON.stringify(array, null, 2)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return json.replace(
    `    "${key}": ${prettyArray.trimStart()}`,
    `    "${key}": ${compactJsonArray(array)}`,
  );
}

function formatManifest(manifest) {
  let json = JSON.stringify(manifest, null, 2);
  json = replacePrettyArray(json, "directories", manifest.excludes.directories);
  json = replacePrettyArray(json, "files", manifest.excludes.files);
  json = replacePrettyArray(json, "prefixes", manifest.excludes.prefixes);
  return json;
}

function compareDirs(actualRoot, expectedRoot) {
  const actualFiles = new Set(walkAllFiles(actualRoot));
  const expectedFiles = new Set(walkAllFiles(expectedRoot));
  const diffs = [];

  for (const relPath of expectedFiles) {
    const relativePath = String(relPath);
    const actualPath = path.join(actualRoot, relativePath);
    const expectedPath = path.join(expectedRoot, relativePath);
    if (!actualFiles.has(relPath)) {
      diffs.push(`missing ${relativePath}`);
      continue;
    }
    const actual = fs.readFileSync(actualPath, "utf8");
    const expected = fs.readFileSync(expectedPath, "utf8");
    if (actual !== expected) {
      diffs.push(`changed ${relativePath}`);
    }
  }
  for (const relPath of actualFiles) {
    const relativePath = String(relPath);
    if (!expectedFiles.has(relPath)) {
      diffs.push(`extra ${relativePath}`);
    }
  }

  return diffs;
}

if (!fs.existsSync(docsRoot)) {
  fail("missing docs directory. Run from repo root.");
}

fs.rmSync(vaultRoot, { recursive: true, force: true });
ensureDir(mirrorRoot);

const docs = new Map();
for (const relPath of walk(docsRoot)) {
  const src = path.join(docsRoot, relPath);
  const dest = path.join(mirrorRoot, relPath);
  const content = fs.readFileSync(src, "utf8");
  copyFile(src, dest);
  docs.set(relPath, {
    relPath,
    title: parseTitle(content, relPath),
    summary: parseSummary(content),
  });
}

writeFile(
  path.join(vaultRoot, ".obsidian", "app.json"),
  JSON.stringify(
    {
      legacyEditor: false,
      livePreview: true,
      readableLineLength: false,
    },
    null,
    2,
  ),
);

writeFile(
  path.join(vaultRoot, "Home.md"),
  [
    "# ArgentOS Core Docs",
    "",
    "This is the generated public Core documentation vault that ships with ArgentOS Core.",
    "",
    "Use it as the local source of truth for operator help, setup questions, troubleshooting, and Core feature navigation. It intentionally excludes private planning notes, debug handoffs, archives, research dumps, and agent-only CLAUDE guidance.",
    "",
    "## Quick paths",
    "",
    `- ${linkIfExists(docs, "install/index.md", "Install ArgentOS")}`,
    `- ${linkIfExists(docs, "install/updating.md", "Update ArgentOS")}`,
    `- ${linkIfExists(docs, "cli/index.md", "CLI reference")}`,
    `- ${linkIfExists(docs, "gateway/index.md", "Gateway")}`,
    `- ${linkIfExists(docs, "channels/index.md", "Channels")}`,
    `- ${linkIfExists(docs, "providers/index.md", "Model providers")}`,
    `- ${linkIfExists(docs, "concepts/core-business-boundary.md", "Core and Business boundary")}`,
    "",
    "## Vault indexes",
    "",
    "- [[00 - Start Here/Agent Readme]]",
    "- [[00 - Start Here/Vault Map]]",
    "- [[01 - Install and Update/Index]]",
    "- [[02 - CLI/Index]]",
    "- [[03 - Providers/Index]]",
    "- [[04 - Workflows/Index]]",
    "- [[05 - Concepts/Index]]",
    "- [[06 - Channels/Index]]",
    "- [[07 - Gateway/Index]]",
    "",
    "## Generation",
    "",
    "This vault is generated from the public `docs/` tree with `pnpm docs:vault`. Do not put private notes in this folder.",
  ].join("\n"),
);

writeFile(
  path.join(vaultRoot, "00 - Start Here", "Agent Readme.md"),
  [
    "# Agent Readme",
    "",
    "When an operator asks how ArgentOS works, how to install a channel, how to configure a provider, how to update, or how to troubleshoot Core behavior, start in this vault.",
    "",
    "Rules for agent use:",
    "",
    "- Treat this vault as Core documentation, not private development memory.",
    "- Prefer exact docs links from the mirror when answering operator questions.",
    "- If the operator asks about worker agents, job boards, workforce governance, or organization approvals, point to Business licensing rather than assuming the feature belongs in Core.",
    "- If a Core feature appears blocked by a Business gate, check [[90 - Public Docs Mirror/docs/concepts/core-business-boundary.md]].",
    "- If the vault does not answer the question, say what is missing and suggest the closest doc section.",
  ].join("\n"),
);

writeFile(
  path.join(vaultRoot, "00 - Start Here", "Vault Map.md"),
  [
    "# Vault Map",
    "",
    `Generated from ${docs.size} public Core docs files.`,
    "",
    "## Primary indexes",
    "",
    "- [[01 - Install and Update/Index]]",
    "- [[02 - CLI/Index]]",
    "- [[03 - Providers/Index]]",
    "- [[04 - Workflows/Index]]",
    "- [[05 - Concepts/Index]]",
    "- [[06 - Channels/Index]]",
    "- [[07 - Gateway/Index]]",
    "",
    "## Full mirror",
    "",
    "The complete copied source docs live under [[90 - Public Docs Mirror/docs/index.md]].",
  ].join("\n"),
);

const sections = [
  {
    file: "01 - Install and Update/Index.md",
    title: "Install and Update",
    description: "Installer, update rail, migration, uninstall, and platform setup docs.",
    prefixes: ["install", "platforms"],
  },
  {
    file: "02 - CLI/Index.md",
    title: "CLI",
    description: "Command-line reference for `argent` and related Core operations.",
    prefixes: ["cli"],
  },
  {
    file: "03 - Providers/Index.md",
    title: "Providers",
    description: "Model provider configuration, routing, and provider-specific setup.",
    prefixes: ["providers", "bedrock.md", "perplexity.md", "brave-search.md", "pi.md", "pi-dev.md"],
  },
  {
    file: "04 - Workflows/Index.md",
    title: "Workflows",
    description: "Operator workflows, automation, hooks, plugins, skills, and connectors.",
    prefixes: ["workflows", "automation", "plugins", "plugin.md", "tools", "hooks.md", "hooks"],
  },
  {
    file: "05 - Concepts/Index.md",
    title: "Concepts",
    description:
      "Core architecture, sessions, memory, routing, OAuth, models, and product boundaries.",
    prefixes: ["concepts"],
  },
  {
    file: "06 - Channels/Index.md",
    title: "Channels",
    description: "Channel setup and troubleshooting for messaging surfaces.",
    prefixes: ["channels"],
  },
  {
    file: "07 - Gateway/Index.md",
    title: "Gateway",
    description: "Gateway configuration, network model, health, pairing, API, and diagnostics.",
    prefixes: ["gateway", "network.md", "logging.md"],
  },
];

for (const section of sections) {
  writeFile(
    path.join(vaultRoot, section.file),
    sectionIndex(docs, section.title, section.description, section.prefixes),
  );
}

writeFile(
  path.join(vaultRoot, "manifest.json"),
  formatManifest({
    name: "ArgentOS Core Docs",
    generatedBy: "scripts/build-core-docs-vault.mjs",
    source: "docs/",
    generatedAt: generatedAtForDocs(docs),
    documents: docs.size,
    excludes: {
      directories: [...EXCLUDED_DIRS].toSorted(),
      files: [...EXCLUDED_FILES].toSorted(),
      paths: [...EXCLUDED_PATHS].toSorted(),
      prefixes: [...EXCLUDED_PREFIXES].toSorted(),
    },
  }),
);

console.log(`docs:vault: generated ${docs.size} docs at ${path.relative(root, vaultRoot)}`);

if (checkMode) {
  const diffs = compareDirs(defaultVaultRoot, vaultRoot);
  fs.rmSync(vaultRoot, { recursive: true, force: true });
  if (diffs.length > 0) {
    console.error("docs:vault: generated Obsidian vault is out of sync.");
    for (const diff of diffs.slice(0, 50)) {
      console.error(`  - ${diff}`);
    }
    if (diffs.length > 50) {
      console.error(`  ... ${diffs.length - 50} more`);
    }
    console.error("docs:vault: run `pnpm docs:vault` and stage the generated vault changes.");
    process.exit(1);
  }
  console.log("docs:vault: check passed");
}
