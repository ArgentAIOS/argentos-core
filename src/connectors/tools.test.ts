import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectorCommandToolName, createConnectorTools, getConnectorToolMeta } from "./tools.js";

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
}

function writeBinaryFixture(params: { binDir: string; tool: string }) {
  const binaryPath = path.join(params.binDir, params.tool);
  fs.writeFileSync(
    binaryPath,
    [
      "#!/bin/sh",
      'mode=""',
      'if [ "$1" = "--json" ] && [ "$2" = "--mode" ]; then',
      '  mode="$3"',
      "  shift 3",
      "fi",
      'if [ "$1" = "queue" ] && [ "$2" = "list" ]; then',
      "  shift 2",
      '  printf \'%s\' "{\\"ok\\":true,\\"data\\":{\\"mode\\":\\"$mode\\",\\"argv\\":[\\""',
      "  first=1",
      '  for arg in "$@"; do',
      '    if [ "$first" = "1" ]; then',
      "      first=0",
      "    else",
      '      printf \'%s\' "\\",\\""',
      "    fi",
      "    printf '%s' \"$arg\"",
      "  done",
      '  printf \'%s\' "\\"]}}"',
      "  exit 0",
      "fi",
      'if [ "$1" = "queue" ] && [ "$2" = "close" ]; then',
      '  printf \'%s\' "{\\"ok\\":false,\\"error\\":{\\"message\\":\\"close failed\\"}}"',
      "  exit 3",
      "fi",
      'printf \'%s\' "{\\"ok\\":false,\\"error\\":{\\"message\\":\\"unknown command\\"}}"',
      "exit 2",
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
});
