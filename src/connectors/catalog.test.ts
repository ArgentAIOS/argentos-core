import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { defaultRepoRoots, discoverConnectorCatalog } from "./catalog.js";

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
  requiresPython?: string;
  backend?: string;
  permissions: Record<string, string>;
  connectorMeta?: Record<string, unknown>;
}) {
  const repoDir = path.join(params.root, params.tool);
  const harnessDir = path.join(repoDir, "agent-harness");
  fs.mkdirSync(harnessDir, { recursive: true });
  fs.writeFileSync(
    path.join(harnessDir, "pyproject.toml"),
    [
      "[build-system]",
      'requires = ["setuptools>=68", "wheel"]',
      'build-backend = "setuptools.build_meta"',
      "",
      "[project]",
      `name = "${params.tool}"`,
      'version = "0.1.0"',
      `description = "${params.description ?? `${params.tool} connector`}"`,
      `requires-python = "${params.requiresPython ?? ">=3.10"}"`,
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
        backend: params.backend ?? "fixture-backend",
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
  return { repoDir, harnessDir };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("discoverConnectorCatalog", () => {
  it("includes the vendored tools/aos root in default discovery", () => {
    const expectedVendoredRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "tools",
      "aos",
    );
    const expectedUserRoot = path.join(os.homedir(), ".argentos", "connectors");
    const externalRepoRoot = path.join(os.homedir(), "code", "agent-cli-tools");

    expect(defaultRepoRoots()).toContain(expectedVendoredRoot);
    expect(defaultRepoRoots().indexOf(expectedUserRoot)).toBeLessThan(
      defaultRepoRoots().indexOf(expectedVendoredRoot),
    );
    expect(defaultRepoRoots().indexOf(expectedVendoredRoot)).toBeLessThan(
      defaultRepoRoots().indexOf(externalRepoRoot),
    );
  });

  it("catalogs repo-only connectors when the adapter is not installed yet", async () => {
    const root = makeTempDir("connector-repo-only-");
    writeRepoFixture({
      root,
      tool: "aos-ledger",
      description: "Agent-native QuickBooks connector",
      permissions: {
        "invoice.list": "readonly",
        "invoice.create": "write",
      },
      connectorMeta: {
        connector: {
          label: "QuickBooks",
          category: "accounting",
          resources: ["invoice", "customer"],
        },
        auth: {
          kind: "oauth",
          required: true,
          service_keys: ["QB_CLIENT_ID", "QB_CLIENT_SECRET"],
          interactive_setup: ["Complete QuickBooks OAuth login"],
        },
        commands: [
          {
            id: "invoice.list",
            summary: "List invoices",
            required_mode: "readonly",
            supports_json: true,
            resource: "invoice",
            action_class: "read",
          },
        ],
      },
    });

    const result = await discoverConnectorCatalog({
      repoRoots: [root],
      pathEnv: "",
      timeoutMs: 500,
    });

    expect(result.total).toBe(1);
    expect(result.connectors[0]).toMatchObject({
      tool: "aos-ledger",
      installState: "repo-only",
      label: "QuickBooks",
      backend: "fixture-backend",
      categories: expect.arrayContaining(["accounting"]),
      resources: expect.arrayContaining(["invoice", "customer"]),
      commands: expect.arrayContaining([
        expect.objectContaining({
          id: "invoice.list",
          requiredMode: "readonly",
          summary: "List invoices",
        }),
      ]),
      auth: expect.objectContaining({
        kind: "oauth",
        required: true,
        serviceKeys: ["QB_CLIENT_ID", "QB_CLIENT_SECRET"],
      }),
      discovery: expect.objectContaining({
        repoDir: expect.stringContaining("aos-ledger"),
      }),
    });
  });

  it("uses connector metadata as the worker-visible command surface when provided", async () => {
    const root = makeTempDir("connector-meta-surface-");
    writeRepoFixture({
      root,
      tool: "aos-mailbox",
      description: "Agent-native inbox connector",
      permissions: {
        "mail.search": "readonly",
        health: "readonly",
        "config.show": "readonly",
      },
      connectorMeta: {
        connector: {
          label: "Mailbox",
          category: "inbox",
          resources: ["mail"],
        },
        commands: [
          {
            id: "capabilities",
            summary: "Describe connector capabilities",
            required_mode: "readonly",
            supports_json: true,
            resource: "connector",
            action_class: "read",
          },
          {
            id: "health",
            summary: "Check connector health",
            required_mode: "readonly",
            supports_json: true,
            resource: "connector",
            action_class: "read",
          },
          {
            id: "config.show",
            summary: "Show connector config",
            required_mode: "readonly",
            supports_json: true,
            resource: "connector",
            action_class: "read",
          },
          {
            id: "mail.search",
            summary: "Search mailbox messages",
            required_mode: "readonly",
            supports_json: true,
            resource: "mail",
            action_class: "read",
          },
        ],
      },
    });

    const result = await discoverConnectorCatalog({
      repoRoots: [root],
      pathEnv: "",
      timeoutMs: 500,
    });

    expect(result.total).toBe(1);
    expect(result.connectors[0]?.commands).toEqual([
      expect.objectContaining({
        id: "mail.search",
        summary: "Search mailbox messages",
        requiredMode: "readonly",
      }),
    ]);
  });

  it("prefers live capabilities output when a runnable connector binary exists", async () => {
    const root = makeTempDir("connector-ready-");
    const binDir = makeTempDir("connector-bin-");
    writeRepoFixture({
      root,
      tool: "aos-demo",
      description: "Agent-native Demo connector",
      permissions: {
        "queue.list": "readonly",
      },
    });

    const binaryPath = path.join(binDir, "aos-demo");
    fs.writeFileSync(
      binaryPath,
      [
        "#!/bin/sh",
        'if [ "$1" = "--json" ] && [ "$2" = "capabilities" ]; then',
        `  printf '%s' '${JSON.stringify({
          ok: true,
          data: {
            tool: "aos-demo",
            version: "2.0.0",
            manifest_schema_version: "2.0.0",
            backend: "demo-backend",
            modes: ["readonly", "write"],
            connector: {
              label: "Demo Queue",
              category: "ticket-queue",
              resources: ["queue"],
            },
            commands: [
              {
                id: "health",
                summary: "Check connector health",
                required_mode: "readonly",
                supports_json: true,
                resource: "connector",
                action_class: "read",
              },
              {
                id: "queue.list",
                summary: "List tickets",
                required_mode: "readonly",
                supports_json: true,
                resource: "queue",
                action_class: "read",
              },
            ],
          },
        })}'`,
        "  exit 0",
        "fi",
        'if [ "$1" = "--json" ] && [ "$2" = "health" ]; then',
        `  printf '%s' '${JSON.stringify({
          ok: true,
          data: {
            status: "healthy",
          },
        })}'`,
        "  exit 0",
        "fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    fs.chmodSync(binaryPath, 0o755);

    const result = await discoverConnectorCatalog({
      repoRoots: [root],
      pathEnv: binDir,
      timeoutMs: 500,
    });

    expect(result.total).toBe(1);
    expect(result.connectors[0]).toMatchObject({
      tool: "aos-demo",
      label: "Demo Queue",
      installState: "ready",
      backend: "demo-backend",
      version: "2.0.0",
      category: "ticket-queue",
      categories: expect.arrayContaining(["ticket-queue"]),
      commands: [expect.objectContaining({ id: "queue.list", summary: "List tickets" })],
      discovery: expect.objectContaining({
        binaryPath,
      }),
      status: expect.objectContaining({
        ok: true,
        label: "Ready",
      }),
    });
    expect(result.connectors[0]?.commands).toHaveLength(1);
  });
});
