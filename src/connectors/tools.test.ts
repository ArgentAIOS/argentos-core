import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import {
  connectorCommandToolName,
  createConnectorTools,
  getConnectorToolMeta,
  resolveConnectorServiceKeyEnv,
} from "./tools.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeRepoFixture(params: {
  root: string;
  tool: string;
  description?: string;
  permissions: Record<string, string>;
  connectorMeta?: Record<string, unknown>;
}) {
  const repoDir = path.join(params.root, params.tool);
  const harnessDir = path.join(repoDir, "agent-harness");
  fs.mkdirSync(harnessDir, { recursive: true });
  fs.writeFileSync(
    path.join(harnessDir, "pyproject.toml"),
    [
      "[project]",
      `name = "${params.tool}"`,
      'version = "0.1.0"',
      `description = "${params.description ?? `${params.tool} connector`}"`,
      'requires-python = ">=3.10"',
      "",
      "[project.scripts]",
      `${params.tool} = "cli_aos.fixture.cli:cli"`,
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(harnessDir, "permissions.json"),
    JSON.stringify(
      {
        tool: params.tool,
        backend: "fixture",
        permissions: params.permissions,
      },
      null,
      2,
    ),
  );
  if (params.connectorMeta) {
    fs.writeFileSync(
      path.join(repoDir, "connector.json"),
      JSON.stringify(params.connectorMeta, null, 2),
    );
  }
}

function writeBinaryFixture(params: { binDir: string; tool: string }) {
  const binaryPath = path.join(params.binDir, params.tool);
  fs.writeFileSync(
    binaryPath,
    [
      `#!${process.execPath}`,
      "const args = process.argv.slice(2);",
      'let mode = "";',
      "const preMode = [];",
      "while (args.length > 0) {",
      "  const head = args[0];",
      '  if (head === "--json") {',
      "    args.shift();",
      "    continue;",
      "  }",
      '  if (head === "--mode") {',
      "    args.shift();",
      '    mode = args.shift() ?? "";',
      "    break;",
      "  }",
      "  preMode.push(args.shift());",
      '  if (args.length > 0 && !String(args[0]).startsWith("--")) {',
      "    preMode.push(args.shift());",
      "  }",
      "}",
      "const command = args.shift();",
      "const subcommand = args.shift();",
      'if (command === "queue" && subcommand === "list") {',
      "  console.log(JSON.stringify({",
      "    ok: true,",
      "    data: {",
      "      mode,",
      "      argv: args,",
      "      preMode,",
      '      envValue: process.env.CONNECTOR_TEST_ENV ?? "",',
      "    },",
      "  }));",
      "  process.exit(0);",
      "}",
      'if (command === "queue" && subcommand === "close") {',
      '  console.log(JSON.stringify({ ok: false, error: { message: "close failed" } }));',
      "  process.exit(3);",
      "}",
      'console.log(JSON.stringify({ ok: false, error: { message: "unknown command" } }));',
      "process.exit(2);",
      "",
    ].join("\n"),
  );
  fs.chmodSync(binaryPath, 0o755);
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("createConnectorTools", () => {
  it("creates executable connector-backed tools from runnable adapters", async () => {
    const root = makeTempDir("connector-tools-root-");
    const binDir = makeTempDir("connector-tools-bin-");
    writeRepoFixture({
      root,
      tool: "aos-queue",
      description: "Agent-native queue connector",
      permissions: {
        "queue.list": "readonly",
        "queue.close": "write",
      },
    });
    writeBinaryFixture({ binDir, tool: "aos-queue" });
    vi.stubEnv("ARGENT_CONNECTOR_REPOS", root);
    vi.stubEnv("PATH", binDir);

    const tools = createConnectorTools();
    const listToolName = connectorCommandToolName("aos-queue", "queue.list");
    const closeToolName = connectorCommandToolName("aos-queue", "queue.close");

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([listToolName, closeToolName]),
    );

    const listTool = tools.find((tool) => tool.name === listToolName);
    expect(listTool).toBeDefined();
    expect(getConnectorToolMeta(listTool!)).toMatchObject({
      connectorTool: "aos-queue",
      connectorCommandId: "queue.list",
      requiredMode: "readonly",
    });

    const result = await listTool!.execute("call-1", {
      positional: ["critical"],
      options: { maxResults: 3, includeClosed: true },
    });

    expect(result.details).toMatchObject({
      ok: true,
      connector: {
        tool: "aos-queue",
        commandId: "queue.list",
      },
      data: {
        mode: "readonly",
        argv: ["critical", "--max-results", "3", "--include-closed"],
      },
    });
  });

  it("rejects a requested mode that is weaker than the connector command requires", async () => {
    const root = makeTempDir("connector-tools-root-");
    const binDir = makeTempDir("connector-tools-bin-");
    writeRepoFixture({
      root,
      tool: "aos-queue",
      permissions: {
        "queue.close": "write",
      },
    });
    writeBinaryFixture({ binDir, tool: "aos-queue" });
    vi.stubEnv("ARGENT_CONNECTOR_REPOS", root);
    vi.stubEnv("PATH", binDir);

    const tool = createConnectorTools().find(
      (entry) => entry.name === connectorCommandToolName("aos-queue", "queue.close"),
    );
    expect(tool).toBeDefined();

    await expect(
      tool!.execute("call-2", {
        mode: "readonly",
      }),
    ).rejects.toThrow('connector command "queue.close" requires mode=write');
  });

  it("applies session-scoped connector defaults to argv, global flags, and env", async () => {
    const root = makeTempDir("connector-tools-root-");
    const binDir = makeTempDir("connector-tools-bin-");
    const sessionDir = makeTempDir("connector-tools-session-");
    writeRepoFixture({
      root,
      tool: "aos-queue",
      permissions: {
        "queue.list": "readonly",
      },
    });
    writeBinaryFixture({ binDir, tool: "aos-queue" });
    const sessionStorePath = path.join(sessionDir, "sessions.json");
    fs.mkdirSync(path.dirname(sessionStorePath), { recursive: true });
    fs.writeFileSync(
      sessionStorePath,
      JSON.stringify(
        {
          "agent:main:main": {
            sessionId: "session-1",
            updatedAt: Date.now(),
            connectorSelections: [
              {
                tool: "aos-queue",
                label: "Queue",
                selectedCommands: ["queue.list"],
                scope: {
                  commandDefaults: {
                    "queue.list": {
                      positional: ["vip"],
                      options: { includeClosed: true },
                      globalOptions: { portalId: "demo-portal" },
                      env: { CONNECTOR_TEST_ENV: "scoped-default" },
                    },
                  },
                },
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    vi.stubEnv("ARGENT_CONNECTOR_REPOS", root);
    vi.stubEnv("PATH", binDir);

    const config = {
      session: {
        store: sessionStorePath,
      },
    } as ArgentConfig;

    const tool = createConnectorTools({
      config,
      agentSessionKey: "agent:main:main",
    }).find((entry) => entry.name === connectorCommandToolName("aos-queue", "queue.list"));
    expect(tool).toBeDefined();

    const result = await tool!.execute("call-3", {
      options: { maxResults: 5 },
    });

    expect(result.details).toMatchObject({
      ok: true,
      requested: {
        positional: ["vip"],
        options: {
          includeClosed: true,
          maxResults: 5,
        },
        globalOptions: {
          portalId: "demo-portal",
        },
        env: {
          CONNECTOR_TEST_ENV: "scoped-default",
        },
      },
      data: {
        mode: "readonly",
        preMode: ["--portal-id", "demo-portal"],
        argv: ["vip", "--include-closed", "--max-results", "5"],
        envValue: "scoped-default",
      },
    });
  });

  it("resolves declared connector service keys for subprocess env injection", () => {
    vi.stubEnv("CONNECTOR_TEST_SECRET", "service-secret");

    const env = resolveConnectorServiceKeyEnv({
      connector: {
        tool: "aos-queue",
        auth: {
          kind: "service-key",
          required: true,
          serviceKeys: ["CONNECTOR_TEST_SECRET"],
        },
      },
    });

    expect(env).toEqual({
      CONNECTOR_TEST_SECRET: "service-secret",
    });
  });

  it("reports connector service key injection without exposing secret values", async () => {
    const root = makeTempDir("connector-tools-root-");
    const binDir = makeTempDir("connector-tools-bin-");
    writeRepoFixture({
      root,
      tool: "aos-queue",
      permissions: {
        "queue.list": "readonly",
      },
      connectorMeta: {
        auth: {
          kind: "service-key",
          required: true,
          service_keys: ["CONNECTOR_TEST_ENV"],
        },
        commands: [
          {
            id: "queue.list",
            required_mode: "readonly",
            supports_json: true,
          },
        ],
      },
    });
    writeBinaryFixture({ binDir, tool: "aos-queue" });
    vi.stubEnv("ARGENT_CONNECTOR_REPOS", root);
    vi.stubEnv("PATH", binDir);
    vi.stubEnv("CONNECTOR_TEST_ENV", "service-secret");

    const tool = createConnectorTools().find(
      (entry) => entry.name === connectorCommandToolName("aos-queue", "queue.list"),
    );
    expect(tool).toBeDefined();

    const result = await tool!.execute("call-4", {});

    expect(result.details).toMatchObject({
      ok: true,
      requested: {
        serviceKeys: [{ variable: "CONNECTOR_TEST_ENV", injected: true }],
      },
      data: {
        envValue: "service-secret",
      },
    });
    expect(JSON.stringify(result.details.requested)).not.toContain("service-secret");
  });
});
