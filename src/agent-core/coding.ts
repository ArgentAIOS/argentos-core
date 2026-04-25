/**
 * Explicit re-exports from @mariozechner/pi-coding-agent.
 *
 * All pi-coding-agent types, classes, and functions should be imported
 * from here rather than directly from the upstream package. This gives
 * ArgentOS a single seam to swap the dependency.
 */
export {
  /**
   * @deprecated Prefer Argent-native `createArgentAgentSession` + `ArgentAgentSession`.
   */
  AgentSession,
  /**
   * @deprecated Prefer `ArgentSessionManager`.
   */
  SessionManager,
  /**
   * @deprecated Prefer `ArgentSettingsManager`.
   */
  SettingsManager,
  /**
   * @deprecated Prefer `ARGENT_SESSION_VERSION`.
   */
  CURRENT_SESSION_VERSION,
  /**
   * @deprecated Prefer `argentCreateReadTool`.
   */
  createReadTool,
  /**
   * @deprecated Prefer `argentCreateWriteTool`.
   */
  createWriteTool,
  /**
   * @deprecated Prefer `argentCreateEditTool`.
   */
  createEditTool,
  /**
   * @deprecated Prefer `argentCreateBashTool`.
   */
  createBashTool,
  /**
   * @deprecated Prefer `argentLoadSkillsFromDir`.
   */
  loadSkillsFromDir,
  /**
   * @deprecated Prefer `argentLoadSkills`.
   */
  loadSkills,
  /**
   * @deprecated Prefer `argentFormatSkillsForPrompt`.
   */
  formatSkillsForPrompt,
  /**
   * @deprecated Prefer Argent-native compaction/token estimation path.
   */
  estimateTokens,
  /**
   * @deprecated Prefer Argent-native compaction/summary path.
   */
  generateSummary,
  /**
   * @deprecated Prefer `argentBuildSessionContext`.
   */
  buildSessionContext,
} from "@mariozechner/pi-coding-agent";
export type {
  /**
   * @deprecated Prefer `ArgentSkill`.
   */
  Skill,
  /**
   * @deprecated Prefer `ArgentExtensionAPI`.
   */
  ExtensionAPI,
  /**
   * @deprecated Prefer `ArgentExtensionContext`.
   */
  ExtensionContext,
  /**
   * @deprecated Prefer `ArgentFileOperations`.
   */
  FileOperations,
  /**
   * @deprecated Prefer `ArgentToolDefinition`.
   */
  ToolDefinition,
  /**
   * @deprecated Prefer `ArgentContextEvent`.
   */
  ContextEvent,
} from "@mariozechner/pi-coding-agent";

/**
 * Argent-native Pi-compatible skills system.
 * These match the exact shapes from pi-coding-agent's skills module.
 *
 * When Pi is removed, these replace the Pi versions exported above.
 * Named with "Argent" prefix to avoid conflicts with Pi's exports.
 */
export {
  loadSkillsFromDir as argentLoadSkillsFromDir,
  loadSkills as argentLoadSkills,
  formatSkillsForPrompt as argentFormatSkillsForPrompt,
  type Skill as ArgentSkill,
  type SkillFrontmatter as ArgentSkillFrontmatter,
  type LoadSkillsResult as ArgentLoadSkillsResult,
  type LoadSkillsFromDirOptions as ArgentLoadSkillsFromDirOptions,
  type LoadSkillsOptions as ArgentLoadSkillsOptions,
  type ResourceDiagnostic as ArgentResourceDiagnostic,
} from "../argent-agent/skills.js";

/**
 * Argent-native Pi-compatible extension types.
 * These match the shapes from pi-coding-agent's extension system.
 */
export {
  CURRENT_SESSION_VERSION as ARGENT_SESSION_VERSION,
  type ToolDefinition as ArgentToolDefinition,
  type ToolInfo as ArgentToolInfo,
  type ExtensionContext as ArgentExtensionContext,
  type ExtensionCommandContext as ArgentExtensionCommandContext,
  type ExtensionAPI as ArgentExtensionAPI,
  type RegisteredCommand as ArgentRegisteredCommand,
  type ExtensionShortcut as ArgentExtensionShortcut,
  type ExtensionFlag as ArgentExtensionFlag,
  type ProviderConfig as ArgentProviderConfig,
  type ProviderModelConfig as ArgentProviderModelConfig,
  type ContextEvent as ArgentContextEvent,
  type ContextEventResult as ArgentContextEventResult,
  type FileOperations as ArgentFileOperations,
  type ExtensionFactory as ArgentExtensionFactory,
  type LoadedExtension as ArgentLoadedExtension,
} from "../argent-agent/extension-types.js";

/**
 * Argent-native OAuth types.
 */
export type {
  OAuthCredentials as ArgentOAuthCredentials,
  OAuthProvider as ArgentOAuthProvider,
} from "../argent-agent/oauth-types.js";

/**
 * Argent-native session manager.
 * Tree-structured append-only JSONL storage — a ground-up reimplementation
 * of Pi's SessionManager with O(1) entry lookups and cleaner compaction.
 */
export {
  ArgentSessionManager,
  buildSessionContext as argentBuildSessionContext,
  SESSION_FORMAT_VERSION as ARGENT_SESSION_FORMAT_VERSION,
  type SessionHeader as ArgentSessionHeader,
  type SessionMessageEntry as ArgentSessionMessageEntry,
  type ThinkingLevelChangeEntry as ArgentThinkingLevelChangeEntry,
  type ModelChangeEntry as ArgentModelChangeEntry,
  type CompactionEntry as ArgentCompactionEntry,
  type BranchSummaryEntry as ArgentBranchSummaryEntry,
  type CustomEntry as ArgentSessionCustomEntry,
  type CustomMessageEntry as ArgentCustomMessageEntry,
  type LabelEntry as ArgentLabelEntry,
  type SessionInfoEntry as ArgentSessionInfoEntry,
  type SessionEntry as ArgentSessionManagerEntry,
  type SessionContext as ArgentSessionContext,
  type SessionInfo as ArgentSessionInfo,
  type SessionTreeNode as ArgentSessionTreeNode,
} from "../argent-agent/session-manager.js";

/**
 * Argent-native file tool factories.
 * These are ground-up reimplementations of Pi's createReadTool, createWriteTool,
 * createEditTool, and createBashTool with cleaner error handling and
 * pluggable operations for sandboxed/remote execution.
 */
export {
  createReadTool as argentCreateReadTool,
  createWriteTool as argentCreateWriteTool,
  createEditTool as argentCreateEditTool,
  createBashTool as argentCreateBashTool,
  createCodingTools as argentCreateCodingTools,
  codingTools as argentCodingTools,
  readTool as argentReadTool,
  type ReadOperations as ArgentReadOperations,
  type ReadToolOptions as ArgentReadToolOptions,
  type WriteOperations as ArgentWriteOperations,
  type WriteToolOptions as ArgentWriteToolOptions,
  type EditOperations as ArgentEditOperations,
  type EditToolOptions as ArgentEditToolOptions,
  type BashOperations as ArgentBashOperations,
  type BashToolOptions as ArgentBashToolOptions,
} from "../argent-agent/file-tools.js";

/**
 * Legacy Pi-compatible default tool exports.
 *
 * Pi 0.70 replaced the old prebuilt defaults with `createCodingTools(cwd)`.
 * Keep Argent's public seam stable by exposing our equivalent defaults here.
 */
export { codingTools, readTool } from "../argent-agent/file-tools.js";

/**
 * Argent-native settings manager.
 * Two-layer config persistence (global + project) with type-safe getters/setters.
 */
export {
  ArgentSettingsManager,
  type Settings as ArgentSettings,
  type CompactionSettings as ArgentCompactionSettings,
  type BranchSummarySettings as ArgentBranchSummarySettings,
  type RetrySettings as ArgentRetrySettings,
  type TerminalSettings as ArgentTerminalSettings,
  type ImageSettings as ArgentImageSettings,
  type ThinkingBudgetsSettings as ArgentThinkingBudgetsSettings,
  type MarkdownSettings as ArgentMarkdownSettings,
  type PackageSource as ArgentPackageSource,
  type ThinkingLevel as ArgentThinkingLevel,
} from "../argent-agent/settings-manager.js";

/**
 * Argent-native agent session interface.
 * The orchestration surface: agent loop + session persistence + tool management.
 */
export type {
  AgentSession as ArgentAgentSession,
  AgentSessionAgent as ArgentAgentSessionAgent,
  AgentSessionEvent as ArgentAgentSessionEvent,
  AgentSessionEventListener as ArgentAgentSessionEventListener,
  AgentSessionConfig as ArgentAgentSessionConfig,
  CreateAgentSessionOptions as ArgentCreateAgentSessionOptions,
  CreateAgentSessionResult as ArgentCreateAgentSessionResult,
  PromptOptions as ArgentPromptOptions,
  SessionCompactionResult as ArgentSessionCompactionResult,
  ModelCycleResult as ArgentModelCycleResult,
  ContextUsage as ArgentContextUsage,
  SessionStats as ArgentSessionStats,
  PromptTemplate as ArgentPromptTemplate,
  BashResult as ArgentBashResult,
} from "../argent-agent/agent-session.js";

/**
 * Argent-native createAgentSession factory.
 * Bootstraps a full AgentSession by wiring agent loop + session + tools + events.
 */
export {
  createArgentAgentSession,
  createArgentAgentSession as createAgentSession,
} from "../argent-agent/create-agent-session.js";
