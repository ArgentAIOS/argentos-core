/**
 * Argent Agent — Settings Manager
 *
 * Two-layer config persistence (global + project) with type-safe getters/setters.
 * Argent-native implementation matching Pi's SettingsManager API.
 *
 * Settings are stored as JSON in two locations:
 *   Global:  ~/.argentos/settings.json
 *   Project: <cwd>/.argentos/settings.json
 *
 * Project settings override global settings. Runtime overrides (via applyOverrides)
 * take highest precedence but are NOT persisted.
 *
 * @module argent-agent/settings-manager
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

// ============================================================================
// Settings Schema
// ============================================================================

export interface CompactionSettings {
  enabled?: boolean;
  reserveTokens?: number;
  keepRecentTokens?: number;
}

export interface BranchSummarySettings {
  reserveTokens?: number;
}

export interface RetrySettings {
  enabled?: boolean;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface TerminalSettings {
  showImages?: boolean;
  clearOnShrink?: boolean;
}

export interface ImageSettings {
  autoResize?: boolean;
  blocked?: boolean;
}

export interface ThinkingBudgetsSettings {
  [level: string]: number | undefined;
}

export interface MarkdownSettings {
  codeBlockIndent?: string;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface PackageSource {
  name: string;
  path?: string;
  version?: string;
}

export interface Settings {
  lastChangelogVersion?: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: ThinkingLevel;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  theme?: string;
  compaction?: CompactionSettings;
  branchSummary?: BranchSummarySettings;
  retry?: RetrySettings;
  hideThinkingBlock?: boolean;
  shellPath?: string;
  quietStartup?: boolean;
  shellCommandPrefix?: string;
  collapseChangelog?: boolean;
  packages?: PackageSource[];
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
  enableSkillCommands?: boolean;
  terminal?: TerminalSettings;
  images?: ImageSettings;
  enabledModels?: string[];
  doubleEscapeAction?: "fork" | "tree" | "none";
  thinkingBudgets?: ThinkingBudgetsSettings;
  editorPaddingX?: number;
  autocompleteMaxVisible?: number;
  showHardwareCursor?: boolean;
  markdown?: MarkdownSettings;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULTS = {
  compaction: {
    enabled: true,
    reserveTokens: 10_000,
    keepRecentTokens: 4_000,
  },
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
  },
  branchSummary: {
    reserveTokens: 10_000,
  },
} satisfies {
  compaction: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
  retry: { enabled: boolean; maxRetries: number; baseDelayMs: number; maxDelayMs: number };
  branchSummary: { reserveTokens: number };
};

// ============================================================================
// Settings Manager
// ============================================================================

export class ArgentSettingsManager {
  private globalSettings: Settings = {};
  private projectSettings: Settings = {};
  private runtimeOverrides: Partial<Settings> = {};
  private globalPath: string;
  private projectPath: string | null;

  private constructor(globalPath: string, projectPath: string | null) {
    this.globalPath = globalPath;
    this.projectPath = projectPath;
  }

  // ==========================================================================
  // Static Factories
  // ==========================================================================

  static create(cwd?: string, agentDir?: string): ArgentSettingsManager {
    const globalDir = agentDir ?? join(homedir(), ".argentos");
    const globalPath = join(globalDir, "settings.json");
    const projectDir = cwd ? join(resolve(cwd), ".argentos") : null;
    const projectPath = projectDir ? join(projectDir, "settings.json") : null;

    const sm = new ArgentSettingsManager(globalPath, projectPath);
    sm.reload();
    return sm;
  }

  static inMemory(settings?: Partial<Settings>): ArgentSettingsManager {
    const sm = new ArgentSettingsManager("", null);
    if (settings) {
      sm.globalSettings = { ...settings };
    }
    return sm;
  }

  // ==========================================================================
  // Core
  // ==========================================================================

  /** Reload settings from disk. */
  reload(): void {
    this.globalSettings = loadJson(this.globalPath);
    this.projectSettings = this.projectPath ? loadJson(this.projectPath) : {};
  }

  /** Get merged settings (global < project < runtime overrides). */
  private merged(): Settings {
    return deepMerge(deepMerge(this.globalSettings, this.projectSettings), this.runtimeOverrides);
  }

  /** Get global settings (no project or runtime overrides). */
  getGlobalSettings(): Settings {
    return { ...this.globalSettings };
  }

  /** Get project settings only. */
  getProjectSettings(): Settings {
    return { ...this.projectSettings };
  }

  /** Apply non-persistent runtime overrides. */
  applyOverrides(overrides: Partial<Settings>): void {
    this.runtimeOverrides = deepMerge(this.runtimeOverrides, overrides);
  }

  // ==========================================================================
  // Changelog
  // ==========================================================================

  getLastChangelogVersion(): string | undefined {
    return this.merged().lastChangelogVersion;
  }

  setLastChangelogVersion(version: string): void {
    this.globalSettings.lastChangelogVersion = version;
    this._saveGlobal();
  }

  // ==========================================================================
  // Default Model / Provider
  // ==========================================================================

  getDefaultProvider(): string | undefined {
    return this.merged().defaultProvider;
  }
  getDefaultModel(): string | undefined {
    return this.merged().defaultModel;
  }

  setDefaultProvider(provider: string): void {
    this.globalSettings.defaultProvider = provider;
    this._saveGlobal();
  }

  setDefaultModel(modelId: string): void {
    this.globalSettings.defaultModel = modelId;
    this._saveGlobal();
  }

  setDefaultModelAndProvider(provider: string, modelId: string): void {
    this.globalSettings.defaultProvider = provider;
    this.globalSettings.defaultModel = modelId;
    this._saveGlobal();
  }

  // ==========================================================================
  // Message Modes
  // ==========================================================================

  getSteeringMode(): "all" | "one-at-a-time" {
    return this.merged().steeringMode ?? "all";
  }
  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this.globalSettings.steeringMode = mode;
    this._saveGlobal();
  }

  getFollowUpMode(): "all" | "one-at-a-time" {
    return this.merged().followUpMode ?? "all";
  }
  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this.globalSettings.followUpMode = mode;
    this._saveGlobal();
  }

  // ==========================================================================
  // Theme
  // ==========================================================================

  getTheme(): string | undefined {
    return this.merged().theme;
  }
  setTheme(theme: string): void {
    this.globalSettings.theme = theme;
    this._saveGlobal();
  }

  // ==========================================================================
  // Thinking Levels
  // ==========================================================================

  getDefaultThinkingLevel(): ThinkingLevel | undefined {
    return this.merged().defaultThinkingLevel;
  }

  setDefaultThinkingLevel(level: ThinkingLevel): void {
    this.globalSettings.defaultThinkingLevel = level;
    this._saveGlobal();
  }

  getThinkingBudgets(): ThinkingBudgetsSettings | undefined {
    return this.merged().thinkingBudgets;
  }

  // ==========================================================================
  // Compaction
  // ==========================================================================

  getCompactionEnabled(): boolean {
    return this.merged().compaction?.enabled ?? DEFAULTS.compaction.enabled;
  }

  setCompactionEnabled(enabled: boolean): void {
    if (!this.globalSettings.compaction) this.globalSettings.compaction = {};
    this.globalSettings.compaction.enabled = enabled;
    this._saveGlobal();
  }

  getCompactionReserveTokens(): number {
    return this.merged().compaction?.reserveTokens ?? DEFAULTS.compaction.reserveTokens;
  }

  getCompactionKeepRecentTokens(): number {
    return this.merged().compaction?.keepRecentTokens ?? DEFAULTS.compaction.keepRecentTokens;
  }

  getCompactionSettings(): { enabled: boolean; reserveTokens: number; keepRecentTokens: number } {
    const m = this.merged();
    return {
      enabled: m.compaction?.enabled ?? DEFAULTS.compaction.enabled,
      reserveTokens: m.compaction?.reserveTokens ?? DEFAULTS.compaction.reserveTokens,
      keepRecentTokens: m.compaction?.keepRecentTokens ?? DEFAULTS.compaction.keepRecentTokens,
    };
  }

  // ==========================================================================
  // Branch Summary
  // ==========================================================================

  getBranchSummarySettings(): { reserveTokens: number } {
    return {
      reserveTokens:
        this.merged().branchSummary?.reserveTokens ?? DEFAULTS.branchSummary.reserveTokens,
    };
  }

  // ==========================================================================
  // Retry
  // ==========================================================================

  getRetryEnabled(): boolean {
    return this.merged().retry?.enabled ?? DEFAULTS.retry.enabled;
  }

  setRetryEnabled(enabled: boolean): void {
    if (!this.globalSettings.retry) this.globalSettings.retry = {};
    this.globalSettings.retry.enabled = enabled;
    this._saveGlobal();
  }

  getRetrySettings(): {
    enabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  } {
    const m = this.merged();
    return {
      enabled: m.retry?.enabled ?? DEFAULTS.retry.enabled,
      maxRetries: m.retry?.maxRetries ?? DEFAULTS.retry.maxRetries,
      baseDelayMs: m.retry?.baseDelayMs ?? DEFAULTS.retry.baseDelayMs,
      maxDelayMs: m.retry?.maxDelayMs ?? DEFAULTS.retry.maxDelayMs,
    };
  }

  // ==========================================================================
  // Display Settings
  // ==========================================================================

  getHideThinkingBlock(): boolean {
    return this.merged().hideThinkingBlock ?? false;
  }
  setHideThinkingBlock(hide: boolean): void {
    this.globalSettings.hideThinkingBlock = hide;
    this._saveGlobal();
  }

  getShowImages(): boolean {
    return this.merged().terminal?.showImages ?? true;
  }
  setShowImages(show: boolean): void {
    if (!this.globalSettings.terminal) this.globalSettings.terminal = {};
    this.globalSettings.terminal.showImages = show;
    this._saveGlobal();
  }

  getClearOnShrink(): boolean {
    return this.merged().terminal?.clearOnShrink ?? false;
  }
  setClearOnShrink(enabled: boolean): void {
    if (!this.globalSettings.terminal) this.globalSettings.terminal = {};
    this.globalSettings.terminal.clearOnShrink = enabled;
    this._saveGlobal();
  }

  getShowHardwareCursor(): boolean {
    return this.merged().showHardwareCursor ?? false;
  }
  setShowHardwareCursor(enabled: boolean): void {
    this.globalSettings.showHardwareCursor = enabled;
    this._saveGlobal();
  }

  // ==========================================================================
  // Shell
  // ==========================================================================

  getShellPath(): string | undefined {
    return this.merged().shellPath;
  }
  setShellPath(path: string | undefined): void {
    this.globalSettings.shellPath = path;
    this._saveGlobal();
  }

  getShellCommandPrefix(): string | undefined {
    return this.merged().shellCommandPrefix;
  }
  setShellCommandPrefix(prefix: string | undefined): void {
    this.globalSettings.shellCommandPrefix = prefix;
    this._saveGlobal();
  }

  getQuietStartup(): boolean {
    return this.merged().quietStartup ?? false;
  }
  setQuietStartup(quiet: boolean): void {
    this.globalSettings.quietStartup = quiet;
    this._saveGlobal();
  }

  // ==========================================================================
  // Changelog Display
  // ==========================================================================

  getCollapseChangelog(): boolean {
    return this.merged().collapseChangelog ?? false;
  }
  setCollapseChangelog(collapse: boolean): void {
    this.globalSettings.collapseChangelog = collapse;
    this._saveGlobal();
  }

  // ==========================================================================
  // Resources (packages, extensions, skills, prompts, themes)
  // ==========================================================================

  getPackages(): PackageSource[] {
    return this.merged().packages ?? [];
  }
  setPackages(packages: PackageSource[]): void {
    this.globalSettings.packages = packages;
    this._saveGlobal();
  }
  setProjectPackages(packages: PackageSource[]): void {
    this.projectSettings.packages = packages;
    this._saveProject();
  }

  getExtensionPaths(): string[] {
    return this.merged().extensions ?? [];
  }
  setExtensionPaths(paths: string[]): void {
    this.globalSettings.extensions = paths;
    this._saveGlobal();
  }
  setProjectExtensionPaths(paths: string[]): void {
    this.projectSettings.extensions = paths;
    this._saveProject();
  }

  getSkillPaths(): string[] {
    return this.merged().skills ?? [];
  }
  setSkillPaths(paths: string[]): void {
    this.globalSettings.skills = paths;
    this._saveGlobal();
  }
  setProjectSkillPaths(paths: string[]): void {
    this.projectSettings.skills = paths;
    this._saveProject();
  }

  getPromptTemplatePaths(): string[] {
    return this.merged().prompts ?? [];
  }
  setPromptTemplatePaths(paths: string[]): void {
    this.globalSettings.prompts = paths;
    this._saveGlobal();
  }
  setProjectPromptTemplatePaths(paths: string[]): void {
    this.projectSettings.prompts = paths;
    this._saveProject();
  }

  getThemePaths(): string[] {
    return this.merged().themes ?? [];
  }
  setThemePaths(paths: string[]): void {
    this.globalSettings.themes = paths;
    this._saveGlobal();
  }
  setProjectThemePaths(paths: string[]): void {
    this.projectSettings.themes = paths;
    this._saveProject();
  }

  getEnableSkillCommands(): boolean {
    return this.merged().enableSkillCommands ?? true;
  }
  setEnableSkillCommands(enabled: boolean): void {
    this.globalSettings.enableSkillCommands = enabled;
    this._saveGlobal();
  }

  // ==========================================================================
  // Image Settings
  // ==========================================================================

  getImageAutoResize(): boolean {
    return this.merged().images?.autoResize ?? true;
  }
  setImageAutoResize(enabled: boolean): void {
    if (!this.globalSettings.images) this.globalSettings.images = {};
    this.globalSettings.images.autoResize = enabled;
    this._saveGlobal();
  }

  getBlockImages(): boolean {
    return this.merged().images?.blocked ?? false;
  }
  setBlockImages(blocked: boolean): void {
    if (!this.globalSettings.images) this.globalSettings.images = {};
    this.globalSettings.images.blocked = blocked;
    this._saveGlobal();
  }

  // ==========================================================================
  // Model Filtering
  // ==========================================================================

  getEnabledModels(): string[] | undefined {
    return this.merged().enabledModels;
  }
  setEnabledModels(patterns: string[] | undefined): void {
    this.globalSettings.enabledModels = patterns;
    this._saveGlobal();
  }

  // ==========================================================================
  // UI Behavior
  // ==========================================================================

  getDoubleEscapeAction(): "fork" | "tree" | "none" {
    return this.merged().doubleEscapeAction ?? "fork";
  }
  setDoubleEscapeAction(action: "fork" | "tree" | "none"): void {
    this.globalSettings.doubleEscapeAction = action;
    this._saveGlobal();
  }

  getEditorPaddingX(): number {
    return this.merged().editorPaddingX ?? 2;
  }
  setEditorPaddingX(padding: number): void {
    this.globalSettings.editorPaddingX = padding;
    this._saveGlobal();
  }

  getAutocompleteMaxVisible(): number {
    return this.merged().autocompleteMaxVisible ?? 10;
  }
  setAutocompleteMaxVisible(maxVisible: number): void {
    this.globalSettings.autocompleteMaxVisible = maxVisible;
    this._saveGlobal();
  }

  getCodeBlockIndent(): string {
    return this.merged().markdown?.codeBlockIndent ?? "  ";
  }

  // ==========================================================================
  // Internal — Persistence
  // ==========================================================================

  private _saveGlobal(): void {
    saveJson(this.globalPath, this.globalSettings);
  }

  private _saveProject(): void {
    if (this.projectPath) {
      saveJson(this.projectPath, this.projectSettings);
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function loadJson(path: string): Settings {
  if (!path) return {};
  try {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return {};
    return JSON.parse(raw) as Settings;
  } catch {
    return {};
  }
}

function saveJson(path: string, data: Settings): void {
  if (!path) return;
  try {
    const dir = resolve(path, "..");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
  } catch {
    // Silently fail on write errors (read-only filesystem, permissions, etc.)
  }
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base } as T;
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (val === undefined) continue;
    const current = result[key];
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      result[key] = deepMerge(current as object, val as Partial<object>) as T[keyof T];
    } else {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}
