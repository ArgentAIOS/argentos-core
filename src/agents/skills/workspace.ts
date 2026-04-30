import fs from "node:fs";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import type {
  ParsedSkillFrontmatter,
  SkillEligibilityContext,
  SkillCommandSpec,
  SkillEntry,
  SkillMatchCandidate,
  SkillSnapshot,
} from "./types.js";
import { loadSkillsFromDir, type Skill } from "../../agent-core/coding.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { resolveBundledSkillsDir } from "./bundled-dir.js";
import { shouldIncludeSkill } from "./config.js";
import {
  parseFrontmatter,
  resolveArgentMetadata,
  resolveSkillInvocationPolicy,
} from "./frontmatter.js";
import { resolvePluginSkillDirs } from "./plugin-skills.js";
import { serializeByKey } from "./serialize.js";

const fsp = fs.promises;
const skillsLogger = createSubsystemLogger("skills");
const skillCommandDebugOnce = new Set<string>();
const categoryDescriptionCache = new Map<string, string | undefined>();
const SKILL_MATCH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "this",
  "to",
  "use",
  "we",
  "what",
  "when",
  "where",
  "with",
  "you",
  "your",
]);

function debugSkillCommandOnce(
  messageKey: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  if (skillCommandDebugOnce.has(messageKey)) {
    return;
  }
  skillCommandDebugOnce.add(messageKey);
  skillsLogger.debug(message, meta);
}

function filterSkillEntries(
  entries: SkillEntry[],
  config?: ArgentConfig,
  skillFilter?: string[],
  eligibility?: SkillEligibilityContext,
): SkillEntry[] {
  let filtered = entries.filter((entry) => shouldIncludeSkill({ entry, config, eligibility }));
  // If skillFilter is provided, only include skills in the filter list.
  if (skillFilter !== undefined) {
    const normalized = skillFilter.map((entry) => String(entry).trim()).filter(Boolean);
    const label = normalized.length > 0 ? normalized.join(", ") : "(none)";
    console.log(`[skills] Applying skill filter: ${label}`);
    filtered =
      normalized.length > 0
        ? filtered.filter((entry) => normalized.includes(entry.skill.name))
        : [];
    console.log(`[skills] After filter: ${filtered.map((entry) => entry.skill.name).join(", ")}`);
  }
  return filtered;
}

const SKILL_COMMAND_MAX_LENGTH = 32;
const SKILL_COMMAND_FALLBACK = "skill";
// Discord command descriptions must be ≤100 characters
const SKILL_COMMAND_DESCRIPTION_MAX_LENGTH = 100;

function sanitizeSkillCommandName(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const trimmed = normalized.slice(0, SKILL_COMMAND_MAX_LENGTH);
  return trimmed || SKILL_COMMAND_FALLBACK;
}

function resolveUniqueSkillCommandName(base: string, used: Set<string>): string {
  const normalizedBase = base.toLowerCase();
  if (!used.has(normalizedBase)) {
    return base;
  }
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `_${index}`;
    const maxBaseLength = Math.max(1, SKILL_COMMAND_MAX_LENGTH - suffix.length);
    const trimmedBase = base.slice(0, maxBaseLength);
    const candidate = `${trimmedBase}${suffix}`;
    const candidateKey = candidate.toLowerCase();
    if (!used.has(candidateKey)) {
      return candidate;
    }
  }
  const fallback = `${base.slice(0, Math.max(1, SKILL_COMMAND_MAX_LENGTH - 2))}_x`;
  return fallback;
}

function loadSkillEntries(
  workspaceDir: string,
  opts?: {
    config?: ArgentConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
  },
): SkillEntry[] {
  const loadSkills = (params: { dir: string; source: string }): Skill[] => {
    const loaded = loadSkillsFromDir(params);
    if (Array.isArray(loaded)) {
      return loaded;
    }
    if (
      loaded &&
      typeof loaded === "object" &&
      "skills" in loaded &&
      Array.isArray((loaded as { skills?: unknown }).skills)
    ) {
      return (loaded as { skills: Skill[] }).skills;
    }
    return [];
  };

  const managedSkillsDir = opts?.managedSkillsDir ?? path.join(CONFIG_DIR, "skills");
  const workspaceSkillsDir = path.join(workspaceDir, "skills");
  const bundledSkillsDir = opts?.bundledSkillsDir ?? resolveBundledSkillsDir();
  const extraDirsRaw = opts?.config?.skills?.load?.extraDirs ?? [];
  const extraDirs = extraDirsRaw
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter(Boolean);
  const pluginSkillDirs = resolvePluginSkillDirs({
    workspaceDir,
    config: opts?.config,
  });
  const mergedExtraDirs = [...extraDirs, ...pluginSkillDirs];

  const bundledSkills = bundledSkillsDir
    ? loadSkills({
        dir: bundledSkillsDir,
        source: "argent-bundled",
      })
    : [];
  const extraSkills = mergedExtraDirs.flatMap((dir) => {
    const resolved = resolveUserPath(dir);
    return loadSkills({
      dir: resolved,
      source: "argent-extra",
    });
  });
  const managedSkills = loadSkills({
    dir: managedSkillsDir,
    source: "argent-managed",
  });
  const workspaceSkills = loadSkills({
    dir: workspaceSkillsDir,
    source: "argent-workspace",
  });

  const merged = new Map<string, Skill>();
  // Precedence: extra < bundled < managed < workspace
  for (const skill of extraSkills) {
    merged.set(skill.name, skill);
  }
  for (const skill of bundledSkills) {
    merged.set(skill.name, skill);
  }
  for (const skill of managedSkills) {
    merged.set(skill.name, skill);
  }
  for (const skill of workspaceSkills) {
    merged.set(skill.name, skill);
  }

  const skillEntries: SkillEntry[] = Array.from(merged.values()).map((skill) => {
    let frontmatter: ParsedSkillFrontmatter = {};
    try {
      const raw = fs.readFileSync(skill.filePath, "utf-8");
      frontmatter = parseFrontmatter(raw);
    } catch {
      // ignore malformed skills
    }
    return {
      skill,
      frontmatter,
      metadata: resolveArgentMetadata(frontmatter),
      invocation: resolveSkillInvocationPolicy(frontmatter),
    };
  });
  return skillEntries;
}

function tokenizeSkillMatchInput(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !SKILL_MATCH_STOPWORDS.has(part));
}

function toSkillSourceLabel(entry: { skill: { source?: string } }): string {
  const raw = String(entry.skill.source ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "generic";
  if (raw.includes("workspace")) return "workspace";
  if (raw.includes("managed")) return "managed";
  if (raw.includes("bundled")) return "system";
  return raw;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function splitPathParts(filePath: string): string[] {
  return filePath.split(/[\\/]+/g).filter(Boolean);
}

function resolveSkillCategoryParts(skill: Skill): string[] {
  const parts = splitPathParts(skill.filePath);
  const skillsIndex = parts.lastIndexOf("skills");
  if (skillsIndex !== -1) {
    return parts.slice(skillsIndex + 1, Math.max(skillsIndex + 1, parts.length - 2));
  }
  const hermesIndex = parts.indexOf("hermes");
  if (hermesIndex !== -1) {
    return parts.slice(hermesIndex, Math.max(hermesIndex, parts.length - 2));
  }
  const communityIndex = parts.indexOf("community");
  if (communityIndex !== -1) {
    return parts.slice(communityIndex, Math.max(communityIndex, parts.length - 2));
  }
  return [];
}

function resolveSkillCategoryDir(skill: Skill, categoryParts: string[]): string | undefined {
  if (categoryParts.length === 0) {
    return undefined;
  }
  const skillPathParts = splitPathParts(skill.filePath);
  const skillsIndex = skillPathParts.lastIndexOf("skills");
  const fallbackCategoryStart = ["hermes", "community"]
    .map((part) => skillPathParts.indexOf(part))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0];
  const categoryStart = skillsIndex !== -1 ? skillsIndex + 1 : (fallbackCategoryStart ?? -1);
  if (categoryStart === -1) {
    return undefined;
  }
  const prefix = skill.filePath.startsWith(path.sep) ? path.sep : "";
  return path.join(prefix, ...skillPathParts.slice(0, categoryStart), ...categoryParts);
}

function resolveSkillCategory(skill: Skill): { key: string; label: string; parts: string[] } {
  const parts = resolveSkillCategoryParts(skill);
  if (parts.length === 0) {
    return { key: "general", label: "general", parts };
  }
  const label = parts.join("/");
  return { key: label, label, parts };
}

function readCategoryDescription(skill: Skill, categoryParts: string[]): string | undefined {
  if (categoryParts.length === 0) {
    return undefined;
  }
  const categoryDir = resolveSkillCategoryDir(skill, categoryParts);
  if (!categoryDir) {
    return undefined;
  }
  const descriptionPath = path.join(categoryDir, "DESCRIPTION.md");
  if (categoryDescriptionCache.has(descriptionPath)) {
    return categoryDescriptionCache.get(descriptionPath);
  }
  let description: string | undefined;
  try {
    const raw = fs.readFileSync(descriptionPath, "utf-8");
    const frontmatter = parseFrontmatter(raw);
    description =
      typeof frontmatter.description === "string" && frontmatter.description.trim()
        ? frontmatter.description.trim()
        : undefined;
  } catch {
    description = undefined;
  }
  categoryDescriptionCache.set(descriptionPath, description);
  return description;
}

function formatSkillEntriesForPrompt(entries: SkillEntry[]): string {
  const visible = entries.filter((entry) => entry.invocation?.disableModelInvocation !== true);
  if (visible.length === 0) {
    return "";
  }

  const grouped = new Map<string, { label: string; description?: string; skills: Skill[] }>();
  for (const entry of visible) {
    const category = resolveSkillCategory(entry.skill);
    const existing =
      grouped.get(category.key) ??
      ({
        label: category.label,
        description: readCategoryDescription(entry.skill, category.parts),
        skills: [],
      } satisfies { label: string; description?: string; skills: Skill[] });
    existing.skills.push(entry.skill);
    grouped.set(category.key, existing);
  }

  const lines = [
    "",
    "",
    "The following skills provide specialized instructions for specific tasks.",
    "Skills are grouped by category. Use the read tool to load a skill's file when the task matches, overlaps with, or is partially covered by its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
  ];

  for (const [key, group] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const description = group.description ? ` description="${escapeXml(group.description)}"` : "";
    lines.push(`  <category name="${escapeXml(group.label)}"${description}>`);
    for (const skill of group.skills.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push("    <skill>");
      lines.push(`      <name>${escapeXml(skill.name)}</name>`);
      lines.push(`      <description>${escapeXml(skill.description ?? "")}</description>`);
      lines.push(`      <location>${escapeXml(skill.filePath)}</location>`);
      lines.push("    </skill>");
    }
    lines.push("  </category>");
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}

export function matchSkillCandidatesForPrompt(params: {
  prompt: string;
  entries?: SkillEntry[];
  resolvedSkills?: Skill[];
  limit?: number;
}): SkillMatchCandidate[] {
  const queryTerms = new Set(tokenizeSkillMatchInput(params.prompt));
  if (queryTerms.size === 0) {
    return [];
  }

  const entries =
    params.entries ??
    (params.resolvedSkills ?? []).map(
      (skill): SkillEntry => ({
        skill,
        frontmatter: {},
      }),
    );

  const candidates = entries
    .map((entry) => {
      const haystackTerms = new Set(
        tokenizeSkillMatchInput(
          [
            entry.skill.name,
            entry.skill.description ?? "",
            entry.metadata?.primaryEnv ?? "",
            entry.skill.filePath ?? "",
          ]
            .filter(Boolean)
            .join(" "),
        ),
      );
      const overlap = [...queryTerms].filter((term) => haystackTerms.has(term));
      const exactName = tokenizeSkillMatchInput(entry.skill.name);
      const nameOverlap = exactName.filter((term) => queryTerms.has(term));
      const score = overlap.length * 1.5 + nameOverlap.length * 2.5;
      if (score <= 0) return null;
      const reasons: string[] = [];
      if (nameOverlap.length > 0) {
        reasons.push(`name:${nameOverlap.join(",")}`);
      }
      const descOverlap = overlap.filter((term) => !nameOverlap.includes(term));
      if (descOverlap.length > 0) {
        reasons.push(`context:${descOverlap.join(",")}`);
      }
      return {
        name: entry.skill.name,
        source: toSkillSourceLabel(entry),
        kind: "generic",
        score: Math.round(score * 100) / 100,
        reasons,
      } satisfies SkillMatchCandidate;
    })
    .filter((candidate): candidate is SkillMatchCandidate => Boolean(candidate))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return candidates.slice(0, Math.max(1, params.limit ?? 5));
}

export function buildWorkspaceSkillSnapshot(
  workspaceDir: string,
  opts?: {
    config?: ArgentConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
    entries?: SkillEntry[];
    /** If provided, only include skills with these names */
    skillFilter?: string[];
    eligibility?: SkillEligibilityContext;
    snapshotVersion?: number;
  },
): SkillSnapshot {
  const skillEntries = opts?.entries ?? loadSkillEntries(workspaceDir, opts);
  const eligible = filterSkillEntries(
    skillEntries,
    opts?.config,
    opts?.skillFilter,
    opts?.eligibility,
  );
  const promptEntries = eligible.filter(
    (entry) => entry.invocation?.disableModelInvocation !== true,
  );
  const resolvedSkills = promptEntries.map((entry) => entry.skill);
  const remoteNote = opts?.eligibility?.remote?.note?.trim();
  const prompt = [remoteNote, formatSkillEntriesForPrompt(promptEntries)]
    .filter(Boolean)
    .join("\n");
  return {
    prompt,
    skills: eligible.map((entry) => ({
      name: entry.skill.name,
      primaryEnv: entry.metadata?.primaryEnv,
    })),
    resolvedSkills,
    version: opts?.snapshotVersion,
  };
}

export function buildWorkspaceSkillsPrompt(
  workspaceDir: string,
  opts?: {
    config?: ArgentConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
    entries?: SkillEntry[];
    /** If provided, only include skills with these names */
    skillFilter?: string[];
    eligibility?: SkillEligibilityContext;
  },
): string {
  const skillEntries = opts?.entries ?? loadSkillEntries(workspaceDir, opts);
  const eligible = filterSkillEntries(
    skillEntries,
    opts?.config,
    opts?.skillFilter,
    opts?.eligibility,
  );
  const promptEntries = eligible.filter(
    (entry) => entry.invocation?.disableModelInvocation !== true,
  );
  const remoteNote = opts?.eligibility?.remote?.note?.trim();
  return [remoteNote, formatSkillEntriesForPrompt(promptEntries)].filter(Boolean).join("\n");
}

export function resolveSkillsPromptForRun(params: {
  skillsSnapshot?: SkillSnapshot;
  entries?: SkillEntry[];
  config?: ArgentConfig;
  workspaceDir: string;
}): string {
  const snapshotPrompt = params.skillsSnapshot?.prompt?.trim();
  if (snapshotPrompt) {
    return snapshotPrompt;
  }
  if (params.entries && params.entries.length > 0) {
    const prompt = buildWorkspaceSkillsPrompt(params.workspaceDir, {
      entries: params.entries,
      config: params.config,
    });
    return prompt.trim() ? prompt : "";
  }
  return "";
}

// QW-2: Skill entry cache (Project Tony Stark — latency reduction)
const skillEntryCache = new Map<string, { entries: SkillEntry[]; cachedAt: number }>();
const SKILL_CACHE_TTL_MS = 60_000;

export function loadWorkspaceSkillEntries(
  workspaceDir: string,
  opts?: {
    config?: ArgentConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
  },
): SkillEntry[] {
  const cacheKey = workspaceDir;
  const cached = skillEntryCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < SKILL_CACHE_TTL_MS) {
    return cached.entries;
  }
  const entries = loadSkillEntries(workspaceDir, opts);
  skillEntryCache.set(cacheKey, { entries, cachedAt: Date.now() });
  return entries;
}

/** Clear skill entry cache (e.g. after config reload or skill install). */
export function clearSkillEntryCache(): void {
  skillEntryCache.clear();
}

export async function syncSkillsToWorkspace(params: {
  sourceWorkspaceDir: string;
  targetWorkspaceDir: string;
  config?: ArgentConfig;
  managedSkillsDir?: string;
  bundledSkillsDir?: string;
}) {
  const sourceDir = resolveUserPath(params.sourceWorkspaceDir);
  const targetDir = resolveUserPath(params.targetWorkspaceDir);
  if (sourceDir === targetDir) {
    return;
  }

  await serializeByKey(`syncSkills:${targetDir}`, async () => {
    const targetSkillsDir = path.join(targetDir, "skills");

    const entries = loadSkillEntries(sourceDir, {
      config: params.config,
      managedSkillsDir: params.managedSkillsDir,
      bundledSkillsDir: params.bundledSkillsDir,
    });

    await fsp.rm(targetSkillsDir, { recursive: true, force: true });
    await fsp.mkdir(targetSkillsDir, { recursive: true });

    for (const entry of entries) {
      const dest = path.join(targetSkillsDir, entry.skill.name);
      try {
        await fsp.cp(entry.skill.baseDir, dest, {
          recursive: true,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        console.warn(`[skills] Failed to copy ${entry.skill.name} to sandbox: ${message}`);
      }
    }
  });
}

export function filterWorkspaceSkillEntries(
  entries: SkillEntry[],
  config?: ArgentConfig,
): SkillEntry[] {
  return filterSkillEntries(entries, config);
}

export function buildWorkspaceSkillCommandSpecs(
  workspaceDir: string,
  opts?: {
    config?: ArgentConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
    entries?: SkillEntry[];
    skillFilter?: string[];
    eligibility?: SkillEligibilityContext;
    reservedNames?: Set<string>;
  },
): SkillCommandSpec[] {
  const skillEntries = opts?.entries ?? loadSkillEntries(workspaceDir, opts);
  const eligible = filterSkillEntries(
    skillEntries,
    opts?.config,
    opts?.skillFilter,
    opts?.eligibility,
  );
  const userInvocable = eligible.filter((entry) => entry.invocation?.userInvocable !== false);
  const used = new Set<string>();
  for (const reserved of opts?.reservedNames ?? []) {
    used.add(reserved.toLowerCase());
  }

  const specs: SkillCommandSpec[] = [];
  for (const entry of userInvocable) {
    const rawName = entry.skill.name;
    const base = sanitizeSkillCommandName(rawName);
    if (base !== rawName) {
      debugSkillCommandOnce(
        `sanitize:${rawName}:${base}`,
        `Sanitized skill command name "${rawName}" to "/${base}".`,
        { rawName, sanitized: `/${base}` },
      );
    }
    const unique = resolveUniqueSkillCommandName(base, used);
    if (unique !== base) {
      debugSkillCommandOnce(
        `dedupe:${rawName}:${unique}`,
        `De-duplicated skill command name for "${rawName}" to "/${unique}".`,
        { rawName, deduped: `/${unique}` },
      );
    }
    used.add(unique.toLowerCase());
    const rawDescription = entry.skill.description?.trim() || rawName;
    const description =
      rawDescription.length > SKILL_COMMAND_DESCRIPTION_MAX_LENGTH
        ? rawDescription.slice(0, SKILL_COMMAND_DESCRIPTION_MAX_LENGTH - 1) + "…"
        : rawDescription;
    const dispatch = (() => {
      const kindRaw = (
        entry.frontmatter?.["command-dispatch"] ??
        entry.frontmatter?.["command_dispatch"] ??
        ""
      )
        .trim()
        .toLowerCase();
      if (!kindRaw) {
        return undefined;
      }
      if (kindRaw !== "tool") {
        return undefined;
      }

      const toolName = (
        entry.frontmatter?.["command-tool"] ??
        entry.frontmatter?.["command_tool"] ??
        ""
      ).trim();
      if (!toolName) {
        debugSkillCommandOnce(
          `dispatch:missingTool:${rawName}`,
          `Skill command "/${unique}" requested tool dispatch but did not provide command-tool. Ignoring dispatch.`,
          { skillName: rawName, command: unique },
        );
        return undefined;
      }

      const argModeRaw = (
        entry.frontmatter?.["command-arg-mode"] ??
        entry.frontmatter?.["command_arg_mode"] ??
        ""
      )
        .trim()
        .toLowerCase();
      const argMode = !argModeRaw || argModeRaw === "raw" ? "raw" : null;
      if (!argMode) {
        debugSkillCommandOnce(
          `dispatch:badArgMode:${rawName}:${argModeRaw}`,
          `Skill command "/${unique}" requested tool dispatch but has unknown command-arg-mode. Falling back to raw.`,
          { skillName: rawName, command: unique, argMode: argModeRaw },
        );
      }

      return { kind: "tool", toolName, argMode: "raw" } as const;
    })();

    specs.push({
      name: unique,
      skillName: rawName,
      description,
      ...(dispatch ? { dispatch } : {}),
    });
  }
  return specs;
}
