/**
 * Plugin Builder Tool
 *
 * Gives the agent a structured workflow for creating, managing, and extending
 * its own capabilities through plugins:
 * - plan: Describe what you want to build, get architecture guidance
 * - scaffold: Write manifest + index.ts for a new plugin
 * - validate: Check scaffolded files are syntactically valid
 * - activate: Add to config and enable
 * - list: List all plugins with status
 * - get: Get plugin details + source
 * - enable/disable: Toggle plugin state
 * - delete: Remove plugin files + config entry
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import { loadConfig, readConfigFileSnapshot, writeConfigFile } from "../../config/io.js";
import { loadArgentPlugins } from "../../plugins/loader.js";
import { resolveConfigDir } from "../../utils.js";
import { type AnyAgentTool, readStringParam } from "./common.js";

// ============================================================================
// Constants
// ============================================================================

const PLUGIN_ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;

function resolveExtensionsDir(): string {
  return path.join(resolveConfigDir(), "extensions");
}

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

// ============================================================================
// Schema
// ============================================================================

const PluginBuilderSchema = Type.Object({
  action: Type.Union([
    Type.Literal("plan"),
    Type.Literal("scaffold"),
    Type.Literal("validate"),
    Type.Literal("activate"),
    Type.Literal("list"),
    Type.Literal("get"),
    Type.Literal("enable"),
    Type.Literal("disable"),
    Type.Literal("delete"),
    Type.Literal("list_keys"),
  ]),
  pluginId: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  tools: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        description: Type.String(),
        code: Type.String(),
      }),
    ),
  ),
  hooks: Type.Optional(
    Type.Array(
      Type.Object({
        event: Type.String(),
        code: Type.String(),
      }),
    ),
  ),
  gatewayMethods: Type.Optional(
    Type.Array(
      Type.Object({
        method: Type.String(),
        code: Type.String(),
      }),
    ),
  ),
  commands: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        description: Type.String(),
        code: Type.String(),
      }),
    ),
  ),
  configSchema: Type.Optional(Type.Any()),
  goal: Type.Optional(Type.String()),
});

// ============================================================================
// Helpers
// ============================================================================

function validatePluginId(id: string): string | null {
  if (!PLUGIN_ID_REGEX.test(id)) {
    return `Invalid plugin ID "${id}". Must match ^[a-z0-9][a-z0-9-]*$ (lowercase alphanumeric and hyphens, starting with alphanumeric).`;
  }
  if (id.length > 64) {
    return `Plugin ID "${id}" is too long (max 64 characters).`;
  }
  return null;
}

function resolvePluginDir(pluginId: string): string {
  return path.join(resolveExtensionsDir(), pluginId);
}

function generateManifest(params: {
  pluginId: string;
  name?: string;
  description?: string;
  configSchema?: unknown;
}): string {
  const manifest: Record<string, unknown> = {
    id: params.pluginId,
  };
  if (params.name) {
    manifest.name = params.name;
  }
  if (params.description) {
    manifest.description = params.description;
  }
  manifest.version = "1.0.0";
  manifest.configSchema = params.configSchema ?? {
    type: "object",
    additionalProperties: false,
    properties: {},
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

function generateIndexTs(params: {
  pluginId: string;
  name?: string;
  description?: string;
  tools?: Array<{ name: string; description: string; code: string }>;
  hooks?: Array<{ event: string; code: string }>;
  gatewayMethods?: Array<{ method: string; code: string }>;
  commands?: Array<{ name: string; description: string; code: string }>;
}): string {
  const lines: string[] = [];

  lines.push(`import type { ArgentPluginDefinition } from "argent/plugin-sdk";`);
  lines.push(``);

  // Generate tool factory functions
  if (params.tools?.length) {
    lines.push(`import { Type } from "@sinclair/typebox";`);
    lines.push(``);
    for (const tool of params.tools) {
      lines.push(`function create${pascalCase(tool.name)}Tool() {`);
      lines.push(`  return {`);
      lines.push(`    name: ${JSON.stringify(tool.name)},`);
      lines.push(`    label: ${JSON.stringify(pascalCase(tool.name))},`);
      lines.push(`    description: ${JSON.stringify(tool.description)},`);
      lines.push(`    parameters: Type.Object({}),`);
      lines.push(`    execute: async (_toolCallId: string, _args: unknown) => {`);
      lines.push(`      ${tool.code}`);
      lines.push(`    },`);
      lines.push(`  };`);
      lines.push(`}`);
      lines.push(``);
    }
  }

  lines.push(`const plugin: ArgentPluginDefinition = {`);
  lines.push(`  id: ${JSON.stringify(params.pluginId)},`);
  if (params.name) {
    lines.push(`  name: ${JSON.stringify(params.name)},`);
  }
  if (params.description) {
    lines.push(`  description: ${JSON.stringify(params.description)},`);
  }
  lines.push(`  version: "1.0.0",`);
  lines.push(`  register: (api) => {`);

  // Register tools
  if (params.tools?.length) {
    for (const tool of params.tools) {
      lines.push(`    api.registerTool(create${pascalCase(tool.name)}Tool());`);
    }
  }

  // Register hooks
  if (params.hooks?.length) {
    for (const hook of params.hooks) {
      lines.push(`    api.on(${JSON.stringify(hook.event)}, async (event, ctx) => {`);
      lines.push(`      ${hook.code}`);
      lines.push(`    });`);
    }
  }

  // Register gateway methods
  if (params.gatewayMethods?.length) {
    for (const gm of params.gatewayMethods) {
      lines.push(
        `    api.registerGatewayMethod(${JSON.stringify(gm.method)}, async (params, ctx) => {`,
      );
      lines.push(`      ${gm.code}`);
      lines.push(`    });`);
    }
  }

  // Register commands
  if (params.commands?.length) {
    for (const cmd of params.commands) {
      lines.push(`    api.registerCommand({`);
      lines.push(`      name: ${JSON.stringify(cmd.name)},`);
      lines.push(`      description: ${JSON.stringify(cmd.description)},`);
      lines.push(`      execute: async (args, ctx) => {`);
      lines.push(`        ${cmd.code}`);
      lines.push(`      },`);
      lines.push(`    });`);
    }
  }

  lines.push(`  },`);
  lines.push(`};`);
  lines.push(``);
  lines.push(`export default plugin;`);
  lines.push(``);

  return lines.join("\n");
}

function pascalCase(input: string): string {
  return input
    .split(/[-_]/)
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : ""))
    .join("");
}

// ============================================================================
// List Keys Action
// ============================================================================

function handleListKeys(): string {
  try {
    const serviceKeysPath = path.join(process.env.HOME || "", ".argentos", "service-keys.json");

    if (!fs.existsSync(serviceKeysPath)) {
      return "No API keys configured yet. Add keys in the dashboard under Settings > API Keys.";
    }

    const serviceKeysData = JSON.parse(fs.readFileSync(serviceKeysPath, "utf-8"));
    const keys = (serviceKeysData.keys || []) as Array<{
      id: string;
      variable: string;
      value: string;
      enabled?: boolean;
      service?: string;
      category?: string;
    }>;

    if (keys.length === 0) {
      return "No API keys configured yet. Add keys in the dashboard under Settings > API Keys.";
    }

    const enabledKeys = keys.filter((k) => k.enabled !== false);
    const lines: string[] = [`Available API Keys (${enabledKeys.length} enabled):\n`];

    // Group by category
    const grouped = enabledKeys.reduce(
      (acc, key) => {
        const cat = key.category || "Other";
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(key);
        return acc;
      },
      {} as Record<string, typeof keys>,
    );

    for (const [category, categoryKeys] of Object.entries(grouped)) {
      lines.push(`## ${category}`);
      for (const key of categoryKeys) {
        const service = key.service ? ` (${key.service})` : "";
        lines.push(`  - ${key.variable}${service}`);
      }
      lines.push("");
    }

    lines.push("To use these keys in your plugin:");
    lines.push(
      "1. Read from ~/.argentos/service-keys.json (keys may be encrypted with enc:v1: prefix)",
    );
    lines.push("2. Use the resolveKey helper pattern with decryptIfNeeded (see below)");
    lines.push("");
    lines.push("⚠️  IMPORTANT: API keys in service-keys.json are AES-256-GCM encrypted.");
    lines.push("Always decrypt with decryptIfNeeded() before using them:");
    lines.push("");
    lines.push("```typescript");
    lines.push('import { createDecipheriv } from "node:crypto";');
    lines.push('import { execSync } from "node:child_process";');
    lines.push("");
    lines.push("function decryptIfNeeded(val: string): string {");
    lines.push('  if (!val.startsWith("enc:v1:")) return val;');
    lines.push("  try {");
    lines.push("    const masterKeyHex = execSync(");
    lines.push(`      'security find-generic-password -s "ArgentOS-MasterKey" -a "ArgentOS" -w',`);
    lines.push('      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },');
    lines.push("    ).trim();");
    lines.push('    const key = Buffer.from(masterKeyHex, "hex");');
    lines.push('    const parts = val.slice(7).split(":");');
    lines.push("    if (parts.length !== 3) return val;");
    lines.push("    const [ivHex, authTagHex, cipherHex] = parts;");
    lines.push(
      '    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex!, "hex"));',
    );
    lines.push('    decipher.setAuthTag(Buffer.from(authTagHex!, "hex"));');
    lines.push('    return decipher.update(cipherHex!, "hex", "utf8") + decipher.final("utf8");');
    lines.push("  } catch { return val; }");
    lines.push("}");
    lines.push("```");

    return lines.join("\n");
  } catch (error) {
    return `Error reading API keys: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Plan Action
// ============================================================================

function handlePlan(goal: string | undefined): string {
  const goalText = goal ? `\nGoal: ${goal}\n` : "";

  // Get available API keys
  const keysInfo = handleListKeys();

  return `# Plugin Builder — Planning Phase
${goalText}
## Available API Keys

${keysInfo}

## Available Plugin API Surface

When a plugin's \`register(api)\` function is called, it receives an \`ArgentPluginApi\` with:

### Registration Methods
- **api.registerTool(tool)** — Add a new agent tool (name, description, parameters, execute)
- **api.registerHook(events, handler)** / **api.on(hookName, handler)** — Register lifecycle hooks
- **api.registerGatewayMethod(method, handler)** — Add a custom gateway WebSocket method
- **api.registerCommand(cmd)** — Add a command that bypasses the LLM agent
- **api.registerChannel(registration)** — Register a new messaging channel
- **api.registerService(service)** — Register a background service
- **api.registerHttpRoute({ path, handler })** — Add HTTP endpoint to the gateway
- **api.registerProvider(provider)** — Register a model provider
- **api.registerCli(registrar)** — Register CLI commands

### Available Hook Events
- \`before_agent_start\` — Before the agent begins processing
- \`agent_end\` — After the agent finishes
- \`before_compaction\` / \`after_compaction\` — Around context compaction
- \`message_received\` — When a message arrives
- \`message_sending\` / \`message_sent\` — Around outbound messages
- \`before_tool_call\` / \`after_tool_call\` — Around tool execution
- \`tool_result_persist\` — When a tool result is being stored
- \`session_start\` / \`session_end\` — Session lifecycle
- \`gateway_start\` / \`gateway_stop\` — Gateway lifecycle

### Plugin Context
- \`api.config\` — Full ArgentConfig
- \`api.pluginConfig\` — Plugin-specific config (from config.plugins.entries.<id>.config)
- \`api.logger\` — Scoped logger
- \`api.runtime\` — Plugin runtime utilities
- \`api.resolvePath(input)\` — Resolve ~ and relative paths

## Plugin Structure

A plugin consists of two files in \`~/.argentos/extensions/<plugin-id>/\`:

1. **argent.plugin.json** — Manifest with id, name, description, version, configSchema
2. **index.ts** — Entry point that exports an \`ArgentPluginDefinition\`

## Suggested Workflow

1. Use \`plan\` (this action) to understand the API surface
2. Design the plugin structure — decide which tools/hooks/commands to register
3. Use \`scaffold\` to write the manifest and index.ts
4. Use \`validate\` to check the scaffolded files
5. Use \`activate\` to add to config and enable
6. Restart the gateway to load the new plugin

## Next Step

Call scaffold with pluginId, name, description, and the tools/hooks/commands/gatewayMethods you want to register.`;
}

// ============================================================================
// Scaffold Action
// ============================================================================

async function handleScaffold(params: Record<string, unknown>): Promise<string> {
  const pluginId = readStringParam(params, "pluginId", { required: true });
  const name = readStringParam(params, "name");
  const description = readStringParam(params, "description");

  const idError = validatePluginId(pluginId);
  if (idError) {
    return `Error: ${idError}`;
  }

  const pluginDir = resolvePluginDir(pluginId);

  // Check if already exists
  if (fs.existsSync(pluginDir)) {
    return `Error: Plugin directory already exists at ${pluginDir}. Delete the existing plugin first with action "delete", then scaffold again.`;
  }

  // Parse optional arrays
  const tools = params.tools as
    | Array<{ name: string; description: string; code: string }>
    | undefined;
  const hooks = params.hooks as Array<{ event: string; code: string }> | undefined;
  const gatewayMethods = params.gatewayMethods as
    | Array<{ method: string; code: string }>
    | undefined;
  const commands = params.commands as
    | Array<{ name: string; description: string; code: string }>
    | undefined;
  const configSchema = params.configSchema as Record<string, unknown> | undefined;

  // Generate files
  const manifestContent = generateManifest({ pluginId, name, description, configSchema });
  const indexContent = generateIndexTs({
    pluginId,
    name,
    description,
    tools,
    hooks,
    gatewayMethods,
    commands,
  });

  // Write files
  await fs.promises.mkdir(pluginDir, { recursive: true, mode: 0o755 });
  await fs.promises.writeFile(path.join(pluginDir, "argent.plugin.json"), manifestContent, "utf-8");
  await fs.promises.writeFile(path.join(pluginDir, "index.ts"), indexContent, "utf-8");

  const parts = [`Scaffolded plugin "${pluginId}" at ${pluginDir}/`];
  parts.push(`  - argent.plugin.json (manifest)`);
  parts.push(`  - index.ts (entry point)`);
  if (tools?.length) {
    parts.push(`  - ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`);
  }
  if (hooks?.length) {
    parts.push(`  - ${hooks.length} hook(s): ${hooks.map((h) => h.event).join(", ")}`);
  }
  if (gatewayMethods?.length) {
    parts.push(
      `  - ${gatewayMethods.length} gateway method(s): ${gatewayMethods.map((g) => g.method).join(", ")}`,
    );
  }
  if (commands?.length) {
    parts.push(`  - ${commands.length} command(s): ${commands.map((c) => c.name).join(", ")}`);
  }
  parts.push(``);
  parts.push(`Next steps: Use "validate" to check the files, then "activate" to enable.`);

  return parts.join("\n");
}

// ============================================================================
// Validate Action
// ============================================================================

async function handleValidate(params: Record<string, unknown>): Promise<string> {
  const pluginId = readStringParam(params, "pluginId", { required: true });

  const idError = validatePluginId(pluginId);
  if (idError) {
    return `Error: ${idError}`;
  }

  const pluginDir = resolvePluginDir(pluginId);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check directory exists
  if (!fs.existsSync(pluginDir)) {
    return `Error: Plugin directory not found at ${pluginDir}. Use "scaffold" first.`;
  }

  // Check manifest
  const manifestPath = path.join(pluginDir, "argent.plugin.json");
  if (!fs.existsSync(manifestPath)) {
    errors.push("Missing argent.plugin.json manifest file.");
  } else {
    try {
      const raw = await fs.promises.readFile(manifestPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (!parsed.id || typeof parsed.id !== "string") {
        errors.push("Manifest missing required 'id' field.");
      } else if (parsed.id !== pluginId) {
        errors.push(`Manifest id "${parsed.id}" doesn't match plugin directory "${pluginId}".`);
      }

      if (!parsed.configSchema || typeof parsed.configSchema !== "object") {
        errors.push(
          "Manifest missing required 'configSchema' field (must be a JSON Schema object).",
        );
      }
    } catch (err) {
      errors.push(
        `Failed to parse manifest JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Check index.ts
  const indexPath = path.join(pluginDir, "index.ts");
  if (!fs.existsSync(indexPath)) {
    errors.push("Missing index.ts entry point.");
  } else {
    try {
      const source = await fs.promises.readFile(indexPath, "utf-8");

      if (!source.includes("export default") && !source.includes("export {")) {
        warnings.push(
          "index.ts may not have a default export. Plugins should export an ArgentPluginDefinition or register function.",
        );
      }

      if (!source.includes("register")) {
        warnings.push("index.ts doesn't appear to contain a 'register' function.");
      }
    } catch (err) {
      errors.push(`Failed to read index.ts: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Build result
  if (errors.length === 0 && warnings.length === 0) {
    return `Validation passed for plugin "${pluginId}".\n\nAll checks OK. Use "activate" to add to config and enable.`;
  }

  const parts: string[] = [];
  if (errors.length > 0) {
    parts.push(`ERRORS (${errors.length}):`);
    for (const err of errors) {
      parts.push(`  - ${err}`);
    }
  }
  if (warnings.length > 0) {
    parts.push(`WARNINGS (${warnings.length}):`);
    for (const warn of warnings) {
      parts.push(`  - ${warn}`);
    }
  }

  const status = errors.length > 0 ? "FAILED" : "PASSED with warnings";
  return `Validation ${status} for plugin "${pluginId}".\n\n${parts.join("\n")}`;
}

// ============================================================================
// Activate Action
// ============================================================================

async function handleActivate(params: Record<string, unknown>): Promise<string> {
  const pluginId = readStringParam(params, "pluginId", { required: true });

  const idError = validatePluginId(pluginId);
  if (idError) {
    return `Error: ${idError}`;
  }

  const pluginDir = resolvePluginDir(pluginId);
  if (!fs.existsSync(pluginDir)) {
    return `Error: Plugin directory not found at ${pluginDir}. Use "scaffold" first.`;
  }

  // Read current config
  const snapshot = await readConfigFileSnapshot();
  const cfg: ArgentConfig = snapshot.valid ? { ...snapshot.config } : {};

  // Ensure plugins section exists
  if (!cfg.plugins) {
    cfg.plugins = {};
  }

  // Add extensions dir to load paths if not already present
  const extensionsDir = resolveExtensionsDir();
  const loadPaths = cfg.plugins.load?.paths ?? [];
  const normalizedPaths = loadPaths.map((p) => path.resolve(p));
  if (!normalizedPaths.includes(path.resolve(extensionsDir))) {
    cfg.plugins.load = {
      ...cfg.plugins.load,
      paths: [...loadPaths, extensionsDir],
    };
  }

  // Enable the plugin in entries
  const entries = cfg.plugins.entries ?? {};
  entries[pluginId] = {
    ...entries[pluginId],
    enabled: true,
  };
  cfg.plugins.entries = entries;

  // Write config
  await writeConfigFile(cfg);

  return `Plugin "${pluginId}" activated.\n\n- Added to config.plugins.entries with enabled: true\n- Extensions directory in load paths\n\nRestart the gateway to load the new plugin.`;
}

// ============================================================================
// List Action
// ============================================================================

function handleList(config?: ArgentConfig): string {
  const cfg = config ?? loadConfig();
  const registry = loadArgentPlugins({ config: cfg, mode: "validate", cache: false });
  const plugins = registry.plugins;

  if (plugins.length === 0) {
    return "No plugins found.";
  }

  const lines: string[] = [`Found ${plugins.length} plugin(s):\n`];

  for (const plugin of plugins) {
    const statusIcon =
      plugin.status === "loaded" ? "[ON]" : plugin.status === "disabled" ? "[OFF]" : "[ERR]";
    const counts: string[] = [];
    if (plugin.toolNames.length > 0) counts.push(`${plugin.toolNames.length} tools`);
    if (plugin.hookCount > 0) counts.push(`${plugin.hookCount} hooks`);
    if (plugin.gatewayMethods.length > 0)
      counts.push(`${plugin.gatewayMethods.length} gateway methods`);
    if (plugin.channelIds.length > 0) counts.push(`${plugin.channelIds.length} channels`);
    if (plugin.services.length > 0) counts.push(`${plugin.services.length} services`);
    if (plugin.commands.length > 0) counts.push(`${plugin.commands.length} commands`);

    const countsStr = counts.length > 0 ? ` (${counts.join(", ")})` : "";
    const origin = plugin.origin ? ` [${plugin.origin}]` : "";
    const version = plugin.version ? ` v${plugin.version}` : "";
    const error = plugin.error ? ` — ${plugin.error}` : "";

    lines.push(`${statusIcon} ${plugin.name}${version}${origin}${countsStr}${error}`);
    lines.push(`     ID: ${plugin.id} | Source: ${plugin.source}`);
  }

  return lines.join("\n");
}

// ============================================================================
// Get Action
// ============================================================================

async function handleGet(params: Record<string, unknown>, config?: ArgentConfig): Promise<string> {
  const pluginId = readStringParam(params, "pluginId", { required: true });

  const idError = validatePluginId(pluginId);
  if (idError) {
    return `Error: ${idError}`;
  }

  // Check registry first
  const cfg = config ?? loadConfig();
  const registry = loadArgentPlugins({ config: cfg, mode: "validate", cache: false });
  const plugin = registry.plugins.find((p) => p.id === pluginId);

  const parts: string[] = [];

  if (plugin) {
    parts.push(`Plugin: ${plugin.name} (${plugin.id})`);
    if (plugin.version) parts.push(`Version: ${plugin.version}`);
    if (plugin.description) parts.push(`Description: ${plugin.description}`);
    parts.push(`Status: ${plugin.status}`);
    parts.push(`Origin: ${plugin.origin}`);
    parts.push(`Source: ${plugin.source}`);
    parts.push(`Enabled: ${plugin.enabled}`);
    if (plugin.toolNames.length > 0) parts.push(`Tools: ${plugin.toolNames.join(", ")}`);
    if (plugin.hookCount > 0) parts.push(`Hooks: ${plugin.hookCount}`);
    if (plugin.gatewayMethods.length > 0)
      parts.push(`Gateway Methods: ${plugin.gatewayMethods.join(", ")}`);
    if (plugin.channelIds.length > 0) parts.push(`Channels: ${plugin.channelIds.join(", ")}`);
    if (plugin.error) parts.push(`Error: ${plugin.error}`);
  }

  // Try to read source files from extensions dir
  const pluginDir = resolvePluginDir(pluginId);
  if (fs.existsSync(pluginDir)) {
    const manifestPath = path.join(pluginDir, "argent.plugin.json");
    const indexPath = path.join(pluginDir, "index.ts");

    if (fs.existsSync(manifestPath)) {
      const manifestContent = await fs.promises.readFile(manifestPath, "utf-8");
      parts.push(``);
      parts.push(`--- argent.plugin.json ---`);
      parts.push(manifestContent.trim());
    }

    if (fs.existsSync(indexPath)) {
      const indexContent = await fs.promises.readFile(indexPath, "utf-8");
      parts.push(``);
      parts.push(`--- index.ts ---`);
      parts.push(indexContent.trim());
    }
  } else if (!plugin) {
    return `Plugin "${pluginId}" not found in registry or extensions directory.`;
  }

  return parts.join("\n");
}

// ============================================================================
// Enable / Disable Actions
// ============================================================================

async function handleEnableDisable(
  params: Record<string, unknown>,
  enable: boolean,
): Promise<string> {
  const pluginId = readStringParam(params, "pluginId", { required: true });

  const idError = validatePluginId(pluginId);
  if (idError) {
    return `Error: ${idError}`;
  }

  const snapshot = await readConfigFileSnapshot();
  const cfg: ArgentConfig = snapshot.valid ? { ...snapshot.config } : {};

  if (!cfg.plugins) {
    cfg.plugins = {};
  }
  const entries = cfg.plugins.entries ?? {};
  entries[pluginId] = {
    ...entries[pluginId],
    enabled: enable,
  };
  cfg.plugins.entries = entries;

  await writeConfigFile(cfg);

  const action = enable ? "enabled" : "disabled";
  return `Plugin "${pluginId}" ${action}.\n\nRestart the gateway for changes to take effect.`;
}

// ============================================================================
// Delete Action
// ============================================================================

async function handleDelete(
  params: Record<string, unknown>,
  config?: ArgentConfig,
): Promise<string> {
  const pluginId = readStringParam(params, "pluginId", { required: true });

  const idError = validatePluginId(pluginId);
  if (idError) {
    return `Error: ${idError}`;
  }

  // Check that this is a global-origin plugin (only delete from extensions dir)
  const cfg = config ?? loadConfig();
  const registry = loadArgentPlugins({ config: cfg, mode: "validate", cache: false });
  const plugin = registry.plugins.find((p) => p.id === pluginId);

  if (plugin && plugin.origin !== "global") {
    return `Error: Cannot delete "${pluginId}" — it has origin "${plugin.origin}". Only global-origin plugins (installed in ~/.argentos/extensions/) can be deleted with this tool.`;
  }

  const pluginDir = resolvePluginDir(pluginId);
  let filesDeleted = false;

  if (fs.existsSync(pluginDir)) {
    await fs.promises.rm(pluginDir, { recursive: true, force: true });
    filesDeleted = true;
  }

  // Remove config entry
  const snapshot = await readConfigFileSnapshot();
  const writeCfg: ArgentConfig = snapshot.valid ? { ...snapshot.config } : {};
  let configUpdated = false;

  if (writeCfg.plugins?.entries?.[pluginId]) {
    delete writeCfg.plugins.entries[pluginId];
    await writeConfigFile(writeCfg);
    configUpdated = true;
  }

  if (!filesDeleted && !configUpdated) {
    return `Plugin "${pluginId}" not found. No files or config entries to remove.`;
  }

  const parts: string[] = [`Plugin "${pluginId}" deleted.`];
  if (filesDeleted) parts.push(`  - Removed directory: ${pluginDir}`);
  if (configUpdated) parts.push(`  - Removed config entry`);
  parts.push(``);
  parts.push(`Restart the gateway for changes to take effect.`);

  return parts.join("\n");
}

// ============================================================================
// Tool Factory
// ============================================================================

export function createPluginBuilderTool(options?: { config?: ArgentConfig }): AnyAgentTool {
  return {
    label: "Plugin Builder",
    name: "plugin_builder",
    description: `Create, manage, and extend agent capabilities through plugins.

ACTIONS:
- list_keys: List available API keys from service-keys.json
- plan: Get architecture guidance for building a plugin (optional: goal)
- scaffold: Create plugin files (requires: pluginId; optional: name, description, tools, hooks, gatewayMethods, commands, configSchema)
- validate: Check scaffolded plugin files (requires: pluginId)
- activate: Add plugin to config and enable (requires: pluginId)
- list: List all plugins with status
- get: Get plugin details and source (requires: pluginId)
- enable: Enable a disabled plugin (requires: pluginId)
- disable: Disable a plugin (requires: pluginId)
- delete: Remove a global plugin's files and config (requires: pluginId)

WORKFLOW:
1. plan — Understand the API surface and design the plugin
2. scaffold — Generate manifest + index.ts in ~/.argentos/extensions/<pluginId>/
3. validate — Verify files are well-formed
4. activate — Add to config and enable
5. Restart gateway to load the new plugin

PLUGIN ID RULES:
- Lowercase alphanumeric and hyphens only (e.g. "hello-world", "my-plugin")
- Must start with a letter or number

EXAMPLES:
- Plan: { "action": "plan", "goal": "A plugin that adds a weather lookup tool" }
- Scaffold: { "action": "scaffold", "pluginId": "weather", "name": "Weather", "description": "Weather lookup", "tools": [{ "name": "weather_lookup", "description": "Look up weather", "code": "return { content: [{ type: 'text', text: 'Sunny, 72F' }] };" }] }
- List: { "action": "list" }
- Get: { "action": "get", "pluginId": "weather" }`,
    parameters: PluginBuilderSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "plan": {
          const goal = readStringParam(params, "goal");
          return textResult(handlePlan(goal));
        }

        case "list_keys":
          return textResult(handleListKeys());

        case "scaffold":
          return textResult(await handleScaffold(params));

        case "validate":
          return textResult(await handleValidate(params));

        case "activate":
          return textResult(await handleActivate(params));

        case "list":
          return textResult(handleList(options?.config));

        case "get":
          return textResult(await handleGet(params, options?.config));

        case "enable":
          return textResult(await handleEnableDisable(params, true));

        case "disable":
          return textResult(await handleEnableDisable(params, false));

        case "delete":
          return textResult(await handleDelete(params, options?.config));

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
