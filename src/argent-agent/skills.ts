/**
 * Argent Agent — Skills System
 *
 * Pi-compatible skill discovery, loading, and formatting.
 * Matches the exact shapes from the legacy upstream coding-agent skill types.
 *
 * Skills are Markdown files with optional YAML frontmatter that provide
 * reusable prompt snippets the agent can invoke.
 *
 * @module argent-agent/skills
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { basename, extname, join, resolve } from "path";

// ============================================================================
// Types
// ============================================================================

/** Parsed YAML frontmatter from a skill file */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  "disable-model-invocation"?: boolean;
  [key: string]: unknown;
}

/** A loaded skill definition */
export interface Skill {
  /** Skill name (from frontmatter or filename) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Absolute path to the skill file */
  filePath: string;
  /** Directory containing the skill */
  baseDir: string;
  /** Source identifier (e.g., "bundled", "project", "global") */
  source: string;
  /** If true, skill can only be invoked explicitly via /skill:name */
  disableModelInvocation: boolean;
}

/** Diagnostic from skill loading (warnings, errors) */
export interface ResourceDiagnostic {
  level: "warning" | "error";
  message: string;
  filePath?: string;
}

/** Result from loading skills */
export interface LoadSkillsResult {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
}

/** Options for loadSkillsFromDir */
export interface LoadSkillsFromDirOptions {
  /** Directory to scan for skills */
  dir: string;
  /** Source identifier for these skills */
  source: string;
}

/** Options for loadSkills */
export interface LoadSkillsOptions {
  /** Working directory for project-local skills. Default: process.cwd() */
  cwd?: string;
  /** Agent config directory for global skills. Default: ~/.argentos/skills */
  agentDir?: string;
  /** Explicit skill paths (files or directories) */
  skillPaths?: string[];
  /** Include default skills directories. Default: true */
  includeDefaults?: boolean;
}

// ============================================================================
// Frontmatter Parsing
// ============================================================================

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse simple YAML frontmatter from a skill file.
 * Handles key: value pairs (no nested objects or arrays).
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const [, yamlBlock, body] = match;
  const frontmatter: SkillFrontmatter = {};

  if (yamlBlock) {
    for (const line of yamlBlock.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;

      const key = trimmed.slice(0, colonIdx).trim();
      let value: string | boolean = trimmed.slice(colonIdx + 1).trim();

      // Strip quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Parse booleans
      if (value === "true") {
        frontmatter[key] = true;
      } else if (value === "false") {
        frontmatter[key] = false;
      } else {
        frontmatter[key] = value;
      }
    }
  }

  return { frontmatter, body: body ?? "" };
}

// ============================================================================
// Loading
// ============================================================================

/**
 * Load a single skill from a file path.
 */
function loadSkillFile(
  filePath: string,
  baseDir: string,
  source: string,
): { skill?: Skill; diagnostic?: ResourceDiagnostic } {
  try {
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter } = parseFrontmatter(content);

    const nameFromFile = basename(filePath, extname(filePath));
    const name = (frontmatter.name as string) ?? nameFromFile;
    const description = (frontmatter.description as string) ?? "";
    const disableModelInvocation = frontmatter["disable-model-invocation"] === true;

    return {
      skill: { name, description, filePath, baseDir, source, disableModelInvocation },
    };
  } catch (err) {
    return {
      diagnostic: {
        level: "warning",
        message: `Failed to load skill: ${err instanceof Error ? err.message : String(err)}`,
        filePath,
      },
    };
  }
}

/**
 * Load skills from a directory.
 *
 * Discovery rules:
 * - direct .md children in the root
 * - recursive SKILL.md under subdirectories
 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
  const { dir, source } = options;
  const skills: Skill[] = [];
  const diagnostics: ResourceDiagnostic[] = [];

  const resolvedDir = resolve(dir);

  let entries: string[];
  try {
    entries = readdirSync(resolvedDir);
  } catch {
    return { skills, diagnostics };
  }

  for (const entry of entries) {
    const fullPath = join(resolvedDir, entry);

    try {
      const stat = statSync(fullPath);

      if (stat.isFile() && entry.endsWith(".md")) {
        // Direct .md child
        const result = loadSkillFile(fullPath, resolvedDir, source);
        if (result.skill) skills.push(result.skill);
        if (result.diagnostic) diagnostics.push(result.diagnostic);
      } else if (stat.isDirectory()) {
        // Check for SKILL.md inside subdirectory
        const skillMdPath = join(fullPath, "SKILL.md");
        try {
          statSync(skillMdPath);
          const result = loadSkillFile(skillMdPath, fullPath, source);
          if (result.skill) skills.push(result.skill);
          if (result.diagnostic) diagnostics.push(result.diagnostic);
        } catch {
          // No SKILL.md in this subdirectory — skip
        }
      }
    } catch {
      // Skip entries we can't stat
    }
  }

  return { skills, diagnostics };
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation diagnostics.
 */
export function loadSkills(options?: LoadSkillsOptions): LoadSkillsResult {
  const cwd = options?.cwd ?? process.cwd();
  const agentDir = options?.agentDir ?? join(homedir(), ".argentos", "skills");
  const includeDefaults = options?.includeDefaults ?? true;
  const skills: Skill[] = [];
  const diagnostics: ResourceDiagnostic[] = [];

  // Load from default locations
  if (includeDefaults) {
    // Global skills
    const globalResult = loadSkillsFromDir({ dir: agentDir, source: "global" });
    skills.push(...globalResult.skills);
    diagnostics.push(...globalResult.diagnostics);

    // Project-local skills (.argentos/skills/ in cwd)
    const projectDir = join(cwd, ".argentos", "skills");
    const projectResult = loadSkillsFromDir({ dir: projectDir, source: "project" });
    skills.push(...projectResult.skills);
    diagnostics.push(...projectResult.diagnostics);
  }

  // Load from explicit paths
  if (options?.skillPaths) {
    for (const skillPath of options.skillPaths) {
      const resolved = resolve(skillPath);
      try {
        const stat = statSync(resolved);
        if (stat.isDirectory()) {
          const result = loadSkillsFromDir({ dir: resolved, source: "explicit" });
          skills.push(...result.skills);
          diagnostics.push(...result.diagnostics);
        } else if (stat.isFile() && resolved.endsWith(".md")) {
          const result = loadSkillFile(resolved, resolve(skillPath, ".."), "explicit");
          if (result.skill) skills.push(result.skill);
          if (result.diagnostic) diagnostics.push(result.diagnostic);
        }
      } catch {
        diagnostics.push({
          level: "warning",
          message: `Skill path not found: ${skillPath}`,
          filePath: resolved,
        });
      }
    }
  }

  return { skills, diagnostics };
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format skills for inclusion in a system prompt.
 * Uses XML format per Agent Skills standard.
 * See: https://agentskills.io/integrate-skills
 *
 * Skills with disableModelInvocation=true are excluded from the prompt
 * (they can only be invoked explicitly via /skill:name commands).
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  const invocable = skills.filter((s) => !s.disableModelInvocation);
  if (invocable.length === 0) return "";

  const lines: string[] = ["<agent-skills>"];

  for (const skill of invocable) {
    lines.push(`  <skill name="${escapeXml(skill.name)}">`);
    if (skill.description) {
      lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    }
    lines.push(`  </skill>`);
  }

  lines.push("</agent-skills>");
  return lines.join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
