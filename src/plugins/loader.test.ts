import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadArgentPlugins } from "./loader.js";

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {},
}));

type TempPlugin = { dir: string; file: string; id: string };

const tempDirs: string[] = [];
const prevBundledDir = process.env.ARGENT_BUNDLED_PLUGINS_DIR;
const prevStateDir = process.env.ARGENT_STATE_DIR;
const prevOrgId = process.env.ARGENT_ORG_ID;
const EMPTY_PLUGIN_SCHEMA = { type: "object", additionalProperties: false, properties: {} };

function makeTempDir() {
  const dir = path.join(os.tmpdir(), `argent-plugin-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writePlugin(params: {
  id: string;
  body: string;
  dir?: string;
  filename?: string;
}): TempPlugin {
  const dir = params.dir ?? makeTempDir();
  const filename = params.filename ?? `${params.id}.js`;
  const file = path.join(dir, filename);
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
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
  if (prevBundledDir === undefined) {
    delete process.env.ARGENT_BUNDLED_PLUGINS_DIR;
  } else {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = prevBundledDir;
  }
  if (prevStateDir === undefined) {
    delete process.env.ARGENT_STATE_DIR;
  } else {
    process.env.ARGENT_STATE_DIR = prevStateDir;
  }
  if (prevOrgId === undefined) {
    delete process.env.ARGENT_ORG_ID;
  } else {
    process.env.ARGENT_ORG_ID = prevOrgId;
  }
});

describe("loadArgentPlugins", () => {
  it("disables bundled plugins by default", () => {
    const bundledDir = makeTempDir();
    writePlugin({
      id: "bundled",
      body: `export default { id: "bundled", register() {} };`,
      dir: bundledDir,
      filename: "bundled.ts",
    });
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = bundledDir;

    const registry = loadArgentPlugins({
      cache: false,
      config: {
        plugins: {
          allow: ["bundled"],
        },
      },
    });

    const bundled = registry.plugins.find((entry) => entry.id === "bundled");
    expect(bundled?.status).toBe("disabled");

    const enabledRegistry = loadArgentPlugins({
      cache: false,
      config: {
        plugins: {
          allow: ["bundled"],
          entries: {
            bundled: { enabled: true },
          },
        },
      },
    });

    const enabled = enabledRegistry.plugins.find((entry) => entry.id === "bundled");
    expect(enabled?.status).toBe("loaded");
  });

  it("loads bundled telegram plugin when enabled", () => {
    const bundledDir = makeTempDir();
    writePlugin({
      id: "telegram",
      body: `export default { id: "telegram", register(api) {
  api.registerChannel({
    plugin: {
      id: "telegram",
      meta: {
        id: "telegram",
        label: "Telegram",
        selectionLabel: "Telegram",
        docsPath: "/channels/telegram",
        blurb: "telegram channel"
      },
      capabilities: { chatTypes: ["direct"] },
      config: {
        listAccountIds: () => [],
        resolveAccount: () => ({ accountId: "default" })
      },
      outbound: { deliveryMode: "direct" }
    }
  });
} };`,
      dir: bundledDir,
      filename: "telegram.ts",
    });
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = bundledDir;

    const registry = loadArgentPlugins({
      cache: false,
      config: {
        plugins: {
          allow: ["telegram"],
          entries: {
            telegram: { enabled: true },
          },
        },
      },
    });

    const telegram = registry.plugins.find((entry) => entry.id === "telegram");
    expect(telegram?.status).toBe("loaded");
    expect(registry.channels.some((entry) => entry.plugin.id === "telegram")).toBe(true);
  });

  it("enables bundled memory plugin when selected by slot", () => {
    const bundledDir = makeTempDir();
    writePlugin({
      id: "memory-core",
      body: `export default { id: "memory-core", kind: "memory", register() {} };`,
      dir: bundledDir,
      filename: "memory-core.ts",
    });
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = bundledDir;

    const registry = loadArgentPlugins({
      cache: false,
      config: {
        plugins: {
          slots: {
            memory: "memory-core",
          },
        },
      },
    });

    const memory = registry.plugins.find((entry) => entry.id === "memory-core");
    expect(memory?.status).toBe("loaded");
  });

  it("preserves package.json metadata for bundled memory plugins", () => {
    const bundledDir = makeTempDir();
    const pluginDir = path.join(bundledDir, "memory-core");
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(
      path.join(pluginDir, "package.json"),
      JSON.stringify({
        name: "@argent/memory-core",
        version: "1.2.3",
        description: "Memory plugin package",
        argent: { extensions: ["./index.ts"] },
      }),
      "utf-8",
    );
    writePlugin({
      id: "memory-core",
      body: `export default { id: "memory-core", kind: "memory", name: "Memory (Core)", register() {} };`,
      dir: pluginDir,
      filename: "index.ts",
    });

    process.env.ARGENT_BUNDLED_PLUGINS_DIR = bundledDir;

    const registry = loadArgentPlugins({
      cache: false,
      config: {
        plugins: {
          slots: {
            memory: "memory-core",
          },
        },
      },
    });

    const memory = registry.plugins.find((entry) => entry.id === "memory-core");
    expect(memory?.status).toBe("loaded");
    expect(memory?.origin).toBe("bundled");
    expect(memory?.name).toBe("Memory (Core)");
    expect(memory?.version).toBe("1.2.3");
  });
  it("loads plugins from config paths", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const plugin = writePlugin({
      id: "allowed",
      body: `export default { id: "allowed", register(api) { api.registerGatewayMethod("allowed.ping", ({ respond }) => respond(true, { ok: true })); } };`,
    });

    const registry = loadArgentPlugins({
      cache: false,
      workspaceDir: plugin.dir,
      config: {
        plugins: {
          load: { paths: [plugin.file] },
          allow: ["allowed"],
        },
      },
    });

    const loaded = registry.plugins.find((entry) => entry.id === "allowed");
    expect(loaded?.status).toBe("loaded");
    expect(Object.keys(registry.gatewayHandlers)).toContain("allowed.ping");
  });

  it("surfaces manifest marketplace metadata on plugin records", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const plugin = writePlugin({
      id: "metadata-plugin",
      body: `export default { id: "metadata-plugin", register() {} };`,
    });
    fs.writeFileSync(
      path.join(plugin.dir, "argent.plugin.json"),
      JSON.stringify(
        {
          id: "metadata-plugin",
          configSchema: EMPTY_PLUGIN_SCHEMA,
          capabilities: [{ id: "meet.status", status: "implemented" }],
          permissions: [{ id: "browser", level: "control" }],
          runtimeSurfaces: ["plugin-tool", "browser"],
          nativeDependencies: [{ id: "audio-bridge", required: false }],
          setupChecks: [{ id: "oauth-token" }],
          oauthProviders: [{ id: "google" }],
          installNotes: ["Configure OAuth before live actions."],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const registry = loadArgentPlugins({
      cache: false,
      workspaceDir: plugin.dir,
      config: {
        plugins: {
          load: { paths: [plugin.file] },
          allow: ["metadata-plugin"],
        },
      },
    });

    const loaded = registry.plugins.find((entry) => entry.id === "metadata-plugin");
    expect(loaded?.capabilities).toEqual([{ id: "meet.status", status: "implemented" }]);
    expect(loaded?.permissions).toEqual([{ id: "browser", level: "control" }]);
    expect(loaded?.runtimeSurfaces).toEqual(["plugin-tool", "browser"]);
    expect(loaded?.nativeDependencies).toEqual([{ id: "audio-bridge", required: false }]);
    expect(loaded?.setupChecks).toEqual([{ id: "oauth-token" }]);
    expect(loaded?.oauthProviders).toEqual([{ id: "google" }]);
    expect(loaded?.installNotes).toEqual(["Configure OAuth before live actions."]);
  });

  it("denylist disables plugins even if allowed", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const plugin = writePlugin({
      id: "blocked",
      body: `export default { id: "blocked", register() {} };`,
    });

    const registry = loadArgentPlugins({
      cache: false,
      workspaceDir: plugin.dir,
      config: {
        plugins: {
          load: { paths: [plugin.file] },
          allow: ["blocked"],
          deny: ["blocked"],
        },
      },
    });

    const blocked = registry.plugins.find((entry) => entry.id === "blocked");
    expect(blocked?.status).toBe("disabled");
  });

  it("fails fast on invalid plugin config", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const plugin = writePlugin({
      id: "configurable",
      body: `export default { id: "configurable", register() {} };`,
    });

    const registry = loadArgentPlugins({
      cache: false,
      workspaceDir: plugin.dir,
      config: {
        plugins: {
          load: { paths: [plugin.file] },
          entries: {
            configurable: {
              config: "nope" as unknown as Record<string, unknown>,
            },
          },
        },
      },
    });

    const configurable = registry.plugins.find((entry) => entry.id === "configurable");
    expect(configurable?.status).toBe("error");
    expect(registry.diagnostics.some((d) => d.level === "error")).toBe(true);
  });

  it("registers channel plugins", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const plugin = writePlugin({
      id: "channel-demo",
      body: `export default { id: "channel-demo", register(api) {
  api.registerChannel({
    plugin: {
      id: "demo",
      meta: {
        id: "demo",
        label: "Demo",
        selectionLabel: "Demo",
        docsPath: "/channels/demo",
        blurb: "demo channel"
      },
      capabilities: { chatTypes: ["direct"] },
      config: {
        listAccountIds: () => [],
        resolveAccount: () => ({ accountId: "default" })
      },
      outbound: { deliveryMode: "direct" }
    }
  });
} };`,
    });

    const registry = loadArgentPlugins({
      cache: false,
      workspaceDir: plugin.dir,
      config: {
        plugins: {
          load: { paths: [plugin.file] },
          allow: ["channel-demo"],
        },
      },
    });

    const channel = registry.channels.find((entry) => entry.plugin.id === "demo");
    expect(channel).toBeDefined();
  });

  it("registers http handlers", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const plugin = writePlugin({
      id: "http-demo",
      body: `export default { id: "http-demo", register(api) {
  api.registerHttpHandler(async () => false);
} };`,
    });

    const registry = loadArgentPlugins({
      cache: false,
      workspaceDir: plugin.dir,
      config: {
        plugins: {
          load: { paths: [plugin.file] },
          allow: ["http-demo"],
        },
      },
    });

    const handler = registry.httpHandlers.find((entry) => entry.pluginId === "http-demo");
    expect(handler).toBeDefined();
    const httpPlugin = registry.plugins.find((entry) => entry.id === "http-demo");
    expect(httpPlugin?.httpHandlers).toBe(1);
  });

  it("registers http routes", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const plugin = writePlugin({
      id: "http-route-demo",
      body: `export default { id: "http-route-demo", register(api) {
  api.registerHttpRoute({ path: "/demo", handler: async (_req, res) => { res.statusCode = 200; res.end("ok"); } });
} };`,
    });

    const registry = loadArgentPlugins({
      cache: false,
      workspaceDir: plugin.dir,
      config: {
        plugins: {
          load: { paths: [plugin.file] },
          allow: ["http-route-demo"],
        },
      },
    });

    const route = registry.httpRoutes.find((entry) => entry.pluginId === "http-route-demo");
    expect(route).toBeDefined();
    expect(route?.path).toBe("/demo");
    const httpPlugin = registry.plugins.find((entry) => entry.id === "http-route-demo");
    expect(httpPlugin?.httpHandlers).toBe(1);
  });

  it("respects explicit disable in config", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const plugin = writePlugin({
      id: "config-disable",
      body: `export default { id: "config-disable", register() {} };`,
    });

    const registry = loadArgentPlugins({
      cache: false,
      config: {
        plugins: {
          load: { paths: [plugin.file] },
          entries: {
            "config-disable": { enabled: false },
          },
        },
      },
    });

    const disabled = registry.plugins.find((entry) => entry.id === "config-disable");
    expect(disabled?.status).toBe("disabled");
  });

  it("enforces memory slot selection", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const memoryA = writePlugin({
      id: "memory-a",
      body: `export default { id: "memory-a", kind: "memory", register() {} };`,
    });
    const memoryB = writePlugin({
      id: "memory-b",
      body: `export default { id: "memory-b", kind: "memory", register() {} };`,
    });

    const registry = loadArgentPlugins({
      cache: false,
      config: {
        plugins: {
          load: { paths: [memoryA.file, memoryB.file] },
          slots: { memory: "memory-b" },
        },
      },
    });

    const a = registry.plugins.find((entry) => entry.id === "memory-a");
    const b = registry.plugins.find((entry) => entry.id === "memory-b");
    expect(b?.status).toBe("loaded");
    expect(a?.status).toBe("disabled");
  });

  it("disables memory plugins when slot is none", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const memory = writePlugin({
      id: "memory-off",
      body: `export default { id: "memory-off", kind: "memory", register() {} };`,
    });

    const registry = loadArgentPlugins({
      cache: false,
      config: {
        plugins: {
          load: { paths: [memory.file] },
          slots: { memory: "none" },
        },
      },
    });

    const entry = registry.plugins.find((item) => item.id === "memory-off");
    expect(entry?.status).toBe("disabled");
  });

  it("prefers higher-precedence plugins with the same id", () => {
    const bundledDir = makeTempDir();
    writePlugin({
      id: "shadow",
      body: `export default { id: "shadow", register() {} };`,
      dir: bundledDir,
      filename: "shadow.js",
    });
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = bundledDir;

    const override = writePlugin({
      id: "shadow",
      body: `export default { id: "shadow", register() {} };`,
    });

    const registry = loadArgentPlugins({
      cache: false,
      config: {
        plugins: {
          load: { paths: [override.file] },
          entries: {
            shadow: { enabled: true },
          },
        },
      },
    });

    const entries = registry.plugins.filter((entry) => entry.id === "shadow");
    const loaded = entries.find((entry) => entry.status === "loaded");
    const overridden = entries.find((entry) => entry.status === "disabled");
    expect(loaded?.origin).toBe("config");
    expect(overridden?.origin).toBe("bundled");
  });

  it("keeps org-scoped plugins isolated per org", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const stateDir = makeTempDir();
    process.env.ARGENT_STATE_DIR = stateDir;

    const orgADir = path.join(stateDir, "orgs", "org-a", "extensions", "titanium-only");
    const orgBDir = path.join(stateDir, "orgs", "org-b", "extensions", "titanium-only");
    fs.mkdirSync(orgADir, { recursive: true });
    fs.mkdirSync(orgBDir, { recursive: true });
    fs.writeFileSync(
      path.join(orgADir, "index.js"),
      "module.exports = { register() {} };",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(orgBDir, "index.js"),
      "module.exports = { register() {} };",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(orgADir, "argent.plugin.json"),
      JSON.stringify({ id: "titanium-only", configSchema: EMPTY_PLUGIN_SCHEMA }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(orgBDir, "argent.plugin.json"),
      JSON.stringify({ id: "titanium-only", configSchema: EMPTY_PLUGIN_SCHEMA }),
      "utf-8",
    );
    fs.mkdirSync(path.join(stateDir, "orgs", "org-a"), { recursive: true });
    fs.mkdirSync(path.join(stateDir, "orgs", "org-b"), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "orgs", "org-a", "plugins.allowlist.json"),
      JSON.stringify({ allow: ["titanium-only"] }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(stateDir, "orgs", "org-b", "plugins.allowlist.json"),
      JSON.stringify({ allow: [] }),
      "utf-8",
    );

    process.env.ARGENT_ORG_ID = "org-a";
    const orgARegistry = loadArgentPlugins({ cache: false, config: {} });
    expect(orgARegistry.plugins.find((entry) => entry.id === "titanium-only")?.status).toBe(
      "loaded",
    );

    process.env.ARGENT_ORG_ID = "org-b";
    const orgBRegistry = loadArgentPlugins({ cache: false, config: {} });
    expect(orgBRegistry.plugins.find((entry) => entry.id === "titanium-only")?.status).toBe(
      "disabled",
    );
    expect(orgBRegistry.plugins.find((entry) => entry.id === "titanium-only")?.error).toContain(
      "organization allowlist",
    );
  });

  it("does not load org plugins when org scope is unset", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const stateDir = makeTempDir();
    process.env.ARGENT_STATE_DIR = stateDir;
    delete process.env.ARGENT_ORG_ID;

    const orgDir = path.join(stateDir, "orgs", "org-a", "extensions", "org-only");
    fs.mkdirSync(orgDir, { recursive: true });
    fs.writeFileSync(path.join(orgDir, "index.js"), "module.exports = { register() {} };", "utf-8");
    fs.writeFileSync(
      path.join(orgDir, "argent.plugin.json"),
      JSON.stringify({ id: "org-only", configSchema: EMPTY_PLUGIN_SCHEMA }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(stateDir, "orgs", "org-a", "plugins.allowlist.json"),
      JSON.stringify({ allow: ["org-only"] }),
      "utf-8",
    );

    const registry = loadArgentPlugins({ cache: false, config: {} });
    expect(registry.plugins.find((entry) => entry.id === "org-only")).toBeUndefined();
  });

  it("reports explicit manifest errors for org-scoped plugins", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const stateDir = makeTempDir();
    process.env.ARGENT_STATE_DIR = stateDir;
    process.env.ARGENT_ORG_ID = "org-a";

    const orgDir = path.join(stateDir, "orgs", "org-a", "extensions", "broken-org-plugin");
    fs.mkdirSync(orgDir, { recursive: true });
    fs.writeFileSync(path.join(orgDir, "index.js"), "module.exports = { register() {} };", "utf-8");
    fs.writeFileSync(
      path.join(stateDir, "orgs", "org-a", "plugins.allowlist.json"),
      JSON.stringify({ allow: ["broken-org-plugin"] }),
      "utf-8",
    );

    const registry = loadArgentPlugins({ cache: false, config: {} });
    expect(
      registry.diagnostics.some(
        (diag) =>
          diag.level === "error" &&
          diag.message.includes('org-scoped plugin "broken-org-plugin" manifest error'),
      ),
    ).toBe(true);
  });

  it("fails closed when org allowlist is missing", () => {
    process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const stateDir = makeTempDir();
    process.env.ARGENT_STATE_DIR = stateDir;
    process.env.ARGENT_ORG_ID = "org-a";

    const orgDir = path.join(stateDir, "orgs", "org-a", "extensions", "titanium-only");
    fs.mkdirSync(orgDir, { recursive: true });
    fs.writeFileSync(path.join(orgDir, "index.js"), "module.exports = { register() {} };", "utf-8");
    fs.writeFileSync(
      path.join(orgDir, "argent.plugin.json"),
      JSON.stringify({ id: "titanium-only", configSchema: EMPTY_PLUGIN_SCHEMA }),
      "utf-8",
    );

    const registry = loadArgentPlugins({ cache: false, config: {} });
    const titanium = registry.plugins.find((entry) => entry.id === "titanium-only");
    expect(titanium?.status).toBe("disabled");
    expect(titanium?.error).toContain("allowlist");
    expect(
      registry.diagnostics.some(
        (diag) => diag.level === "error" && diag.message.includes("org plugin allowlist missing"),
      ),
    ).toBe(true);
  });
});
