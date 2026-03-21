import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { getPluginToolMeta, resolvePluginTools } from "../plugins/tools.js";
import "./test-helpers/fast-core-tools.js";
import { createArgentTools } from "./argent-tools.js";
import {
  filterPublicCorePluginTools,
  resolvePublicCorePluginRuntimeGate,
} from "./public-core-tools.js";

type TempPlugin = { dir: string; file: string; id: string };

const tempDirs: string[] = [];
const EMPTY_PLUGIN_SCHEMA = { type: "object", additionalProperties: false, properties: {} };

function makeTempDir() {
  const dir = path.join(os.tmpdir(), `argent-public-core-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writePlugin(params: { id: string; body: string }): TempPlugin {
  const dir = makeTempDir();
  const file = path.join(dir, `${params.id}.js`);
  fs.writeFileSync(file, params.body, "utf-8");
  fs.writeFileSync(
    path.join(dir, "argent.plugin.json"),
    JSON.stringify(
      {
        id: params.id,
        configSchema: EMPTY_PLUGIN_SCHEMA,
      },
      null,
      2,
    ),
    "utf-8",
  );
  return { dir, file, id: params.id };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("createArgentTools public-core surface", () => {
  it("keeps the core spine and removes business and hold tools by default", () => {
    const config = {
      distribution: {
        surfaceProfile: "public-core",
      },
    } satisfies ArgentConfig;

    const toolNames = new Set(createArgentTools({ config }).map((tool) => tool.name));

    expect(toolNames.has("memory_recall")).toBe(true);
    expect(toolNames.has("tasks")).toBe(true);
    expect(toolNames.has("visual_presence")).toBe(true);
    expect(toolNames.has("intent_tool")).toBe(false);
    expect(toolNames.has("workforce_setup_tool")).toBe(false);
    expect(toolNames.has("jobs_tool")).toBe(false);
    expect(toolNames.has("plugin_builder")).toBe(false);
    expect(toolNames.has("service_keys")).toBe(false);
  });

  it("can opt power-user tools back in without re-enabling business tools", () => {
    const config = {
      distribution: {
        surfaceProfile: "public-core",
        publicCore: {
          includePowerUserTools: true,
          alsoAllowTools: ["service_keys"],
        },
      },
    } satisfies ArgentConfig;

    const toolNames = new Set(createArgentTools({ config }).map((tool) => tool.name));

    expect(toolNames.has("plugin_builder")).toBe(true);
    expect(toolNames.has("family")).toBe(true);
    expect(toolNames.has("service_keys")).toBe(true);
    expect(toolNames.has("intent_tool")).toBe(false);
    expect(toolNames.has("workforce_setup_tool")).toBe(false);
  });

  it("does not let additive overrides punch through the business boundary", () => {
    const config = {
      distribution: {
        surfaceProfile: "public-core",
        publicCore: {
          alsoAllowTools: ["intent_tool", "jobs_tool", "service_keys"],
        },
      },
    } satisfies ArgentConfig;

    const toolNames = new Set(createArgentTools({ config }).map((tool) => tool.name));

    expect(toolNames.has("intent_tool")).toBe(false);
    expect(toolNames.has("jobs_tool")).toBe(false);
    expect(toolNames.has("service_keys")).toBe(true);
  });

  it("blocks extension plugin tools unless the plugin is explicitly allowlisted", () => {
    const plugin = writePlugin({
      id: "demo-plugin",
      body: `
export default { register(api) {
  api.registerTool({
    name: "demo_plugin_tool",
    description: "demo plugin tool",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "ok" }] };
    },
  });
} }
`,
    });

    const baseConfig = {
      plugins: {
        load: { paths: [plugin.file] },
        allow: [plugin.id],
      },
    } satisfies ArgentConfig;

    const resolvedTools = resolvePluginTools({
      context: {
        config: baseConfig,
        workspaceDir: plugin.dir,
      },
    });
    expect(resolvedTools.map((tool) => tool.name)).toContain("demo_plugin_tool");

    const blockedToolNames = new Set(
      filterPublicCorePluginTools({
        tools: resolvedTools,
        gate: resolvePublicCorePluginRuntimeGate({
          ...baseConfig,
          distribution: {
            surfaceProfile: "public-core",
          },
        }),
        getPluginId: (tool) => getPluginToolMeta(tool)?.pluginId,
        getToolName: (tool) => tool.name,
      }).map((tool) => tool.name),
    );
    expect(blockedToolNames.has("demo_plugin_tool")).toBe(false);

    const allowedToolNames = new Set(
      filterPublicCorePluginTools({
        tools: resolvedTools,
        gate: resolvePublicCorePluginRuntimeGate({
          ...baseConfig,
          distribution: {
            surfaceProfile: "public-core",
            publicCore: {
              allowPlugins: [plugin.id],
            },
          },
        }),
        getPluginId: (tool) => getPluginToolMeta(tool)?.pluginId,
        getToolName: (tool) => tool.name,
      }).map((tool) => tool.name),
    );
    expect(allowedToolNames.has("demo_plugin_tool")).toBe(true);
  });

  it("lets public-core deny tool names remove allowlisted plugin tools", () => {
    const plugin = writePlugin({
      id: "demo-plugin",
      body: `
export default { register(api) {
  api.registerTool({
    name: "demo_plugin_tool",
    description: "demo plugin tool",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "ok" }] };
    },
  });
} }
`,
    });

    const baseConfig = {
      plugins: {
        load: { paths: [plugin.file] },
        allow: [plugin.id],
      },
    } satisfies ArgentConfig;
    const resolvedTools = resolvePluginTools({
      context: {
        config: baseConfig,
        workspaceDir: plugin.dir,
      },
    });
    const toolNames = new Set(
      filterPublicCorePluginTools({
        tools: resolvedTools,
        gate: resolvePublicCorePluginRuntimeGate({
          ...baseConfig,
          distribution: {
            surfaceProfile: "public-core",
            publicCore: {
              allowPlugins: [plugin.id],
              denyTools: ["demo_plugin_tool"],
            },
          },
        }),
        getPluginId: (tool) => getPluginToolMeta(tool)?.pluginId,
        getToolName: (tool) => tool.name,
      }).map((tool) => tool.name),
    );

    expect(toolNames.has("demo_plugin_tool")).toBe(false);
  });
});
