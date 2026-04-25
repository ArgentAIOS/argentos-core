import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "argent-marketplace-tool-"));
  tempDirs.push(dir);
  return dir;
}

const TEST_LICENSE_KEY = "aos_test_marketplace_license";

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function makeSkillArchive(): Promise<Buffer> {
  const workDir = await makeTempDir();
  const pkgDir = path.join(workDir, "package");
  const skillsDir = path.join(pkgDir, "skills", "calendar");
  await fsp.mkdir(skillsDir, { recursive: true });
  await fsp.writeFile(
    path.join(pkgDir, "argent.plugin.json"),
    JSON.stringify({ skills: ["calendar"] }, null, 2),
    "utf8",
  );
  await fsp.writeFile(
    path.join(skillsDir, "SKILL.md"),
    ["---", "name: calendar", "description: Calendar skill", "---", "", "# Calendar"].join("\n"),
    "utf8",
  );

  const archivePath = path.join(workDir, "calendar.tgz");
  await tar.c({ cwd: workDir, file: archivePath, gzip: true }, ["package"]);
  return await fsp.readFile(archivePath);
}

async function makeConnectorArchive(): Promise<Buffer> {
  const workDir = await makeTempDir();
  const connectorDir = path.join(workDir, "package", "connectors", "aos-hubspot");
  await fsp.mkdir(connectorDir, { recursive: true });
  await fsp.writeFile(
    path.join(connectorDir, "connector.json"),
    JSON.stringify({ tool: "aos-hubspot", label: "HubSpot" }, null, 2),
    "utf8",
  );
  await fsp.writeFile(path.join(connectorDir, "README.md"), "# HubSpot\n", "utf8");

  const archivePath = path.join(workDir, "aos-hubspot.tgz");
  await tar.c({ cwd: workDir, file: archivePath, gzip: true }, ["package"]);
  return await fsp.readFile(archivePath);
}

async function makeConnectorArchiveWithHarness(): Promise<Buffer> {
  const workDir = await makeTempDir();
  const connectorDir = path.join(workDir, "package", "connectors", "aos-cognee");
  const harnessDir = path.join(connectorDir, "agent-harness");
  const packageDir = path.join(harnessDir, "cli_aos", "cognee");
  await fsp.mkdir(packageDir, { recursive: true });
  await fsp.writeFile(
    path.join(connectorDir, "connector.json"),
    JSON.stringify({ tool: "aos-cognee", connector: { label: "Cognee" } }, null, 2),
    "utf8",
  );
  await fsp.writeFile(
    path.join(harnessDir, "pyproject.toml"),
    [
      "[build-system]",
      'requires = ["setuptools>=68", "wheel"]',
      'build-backend = "setuptools.build_meta"',
      "",
      "[project]",
      'name = "aos-cognee"',
      'version = "0.1.0"',
      'description = "Cognee test connector"',
      'requires-python = ">=3.9"',
      "",
      "[project.scripts]",
      'aos-cognee = "cli_aos.cognee.cli:main"',
      "",
      "[tool.setuptools]",
      'package-dir = { "" = "." }',
      "",
      "[tool.setuptools.packages.find]",
      'where = ["."]',
      'include = ["cli_aos*"]',
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(path.join(harnessDir, "cli_aos", "__init__.py"), "", "utf8");
  await fsp.writeFile(path.join(packageDir, "__init__.py"), "", "utf8");
  await fsp.writeFile(
    path.join(packageDir, "cli.py"),
    [
      "def main():",
      "    print('aos-cognee harness installed')",
      "",
      "if __name__ == '__main__':",
      "    main()",
      "",
    ].join("\n"),
    "utf8",
  );

  const archivePath = path.join(workDir, "aos-cognee.tgz");
  await tar.c({ cwd: workDir, file: archivePath, gzip: true }, ["package"]);
  return await fsp.readFile(archivePath);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("marketplace tool install", () => {
  it("resolves a slug from search and installs the downloaded skill package", async () => {
    const tempHome = await makeTempDir();
    await fsp.mkdir(path.join(tempHome, ".argentos"), { recursive: true });
    await fsp.writeFile(
      path.join(tempHome, ".argentos", "license.json"),
      JSON.stringify({ key: TEST_LICENSE_KEY }, null, 2),
      "utf8",
    );
    vi.stubEnv("HOME", tempHome);
    vi.stubEnv("ARGENT_STATE_DIR", path.join(tempHome, ".argentos"));

    const archive = await makeSkillArchive();
    const packageId = "fc24e08c-05e0-441b-89d4-49dfe1fc212c";
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = fetchInputUrl(input);
      if (url.includes("/catalog?") || url.includes("/catalog/licensed?")) {
        return jsonResponse({
          items: [
            {
              id: packageId,
              name: "calendar",
              display_name: "Calendar",
              description: "Calendar skill",
              category: "skills",
              tags: ["argentos-marketplace", "community"],
              author_name: "ArgentOS Community",
              author_verified: false,
              latest_version: "1.0.0",
              total_downloads: 0,
              rating: 0,
              pricing: "free",
              listed: true,
            },
          ],
          total: 1,
        });
      }
      if (url.endsWith(`/catalog/${packageId}/download`)) {
        return new Response(archive, {
          status: 200,
          headers: {
            "content-type": "application/gzip",
            "content-disposition": 'attachment; filename="calendar-1.0.0.argent-pkg"',
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const priorFetch = global.fetch;
    // @ts-expect-error override for test
    global.fetch = mockFetch;

    vi.resetModules();
    const { createMarketplaceTool } = await import("./marketplace-tool.js");
    const tool = createMarketplaceTool();
    const result = await tool.execute("test-install", { action: "install", packageId: "calendar" });

    expect(result.details).toMatchObject({
      ok: true,
      action: "install",
      packageId: "calendar",
      name: "calendar",
    });
    expect(result.content[0]?.type).toBe("text");
    expect(String(result.content[0]?.text)).toContain("Successfully installed Calendar");
    expect(fs.existsSync(path.join(tempHome, ".argentos", "skills", "calendar", "SKILL.md"))).toBe(
      true,
    );

    // @ts-expect-error restore
    global.fetch = priorFetch;
  });

  it("installs downloaded connector packages into user connectors", async () => {
    const tempHome = await makeTempDir();
    await fsp.mkdir(path.join(tempHome, ".argentos"), { recursive: true });
    await fsp.writeFile(
      path.join(tempHome, ".argentos", "license.json"),
      JSON.stringify({ key: TEST_LICENSE_KEY }, null, 2),
      "utf8",
    );
    vi.stubEnv("HOME", tempHome);
    vi.stubEnv("ARGENT_STATE_DIR", path.join(tempHome, ".argentos"));

    const archive = await makeConnectorArchive();
    const packageId = "31dc4a3c-1e1e-4556-a4e8-111111111111";
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = fetchInputUrl(input);
      if (url.includes("/catalog?") || url.includes("/catalog/licensed?")) {
        return jsonResponse({
          items: [
            {
              id: packageId,
              name: "aos-hubspot",
              display_name: "HubSpot CRM",
              description: "HubSpot connector",
              category: "connectors",
              tags: ["crm"],
              author_name: "ArgentOS",
              author_verified: true,
              latest_version: "1.0.0",
              total_downloads: 0,
              rating: 0,
              pricing: "free",
              listed: true,
            },
          ],
          total: 1,
        });
      }
      if (url.endsWith(`/catalog/${packageId}/download`)) {
        return new Response(archive, {
          status: 200,
          headers: {
            "content-type": "application/gzip",
            "content-disposition": 'attachment; filename="aos-hubspot-1.0.0.argent-pkg"',
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const priorFetch = global.fetch;
    // @ts-expect-error override for test
    global.fetch = mockFetch;

    vi.resetModules();
    const { createMarketplaceTool } = await import("./marketplace-tool.js");
    const tool = createMarketplaceTool();
    const result = await tool.execute("test-install", {
      action: "install",
      packageId: "aos-hubspot",
    });

    expect(result.details).toMatchObject({
      ok: true,
      action: "install",
      packageId: "aos-hubspot",
      name: "aos-hubspot",
      installed: ["aos-hubspot"],
    });
    expect(String(result.content[0]?.text)).toContain("Successfully installed HubSpot CRM");
    expect(
      fs.existsSync(
        path.join(tempHome, ".argentos", "connectors", "aos-hubspot", "connector.json"),
      ),
    ).toBe(true);

    // @ts-expect-error restore
    global.fetch = priorFetch;
  });

  it("installs connector agent harnesses into local venvs", async () => {
    const tempHome = await makeTempDir();
    await fsp.mkdir(path.join(tempHome, ".argentos"), { recursive: true });
    await fsp.writeFile(
      path.join(tempHome, ".argentos", "license.json"),
      JSON.stringify({ key: TEST_LICENSE_KEY }, null, 2),
      "utf8",
    );
    vi.stubEnv("HOME", tempHome);
    vi.stubEnv("ARGENT_STATE_DIR", path.join(tempHome, ".argentos"));

    const archive = await makeConnectorArchiveWithHarness();
    const packageId = "31dc4a3c-1e1e-4556-a4e8-222222222222";
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = fetchInputUrl(input);
      if (url.includes("/catalog?") || url.includes("/catalog/licensed?")) {
        return jsonResponse({
          items: [
            {
              id: packageId,
              name: "aos-cognee",
              display_name: "Cognee",
              description: "Cognee connector",
              category: "connectors",
              tags: ["memory"],
              author_name: "ArgentOS",
              author_verified: true,
              latest_version: "0.1.0",
              total_downloads: 0,
              rating: 0,
              pricing: "free",
              listed: true,
            },
          ],
          total: 1,
        });
      }
      if (url.endsWith(`/catalog/${packageId}/download`)) {
        return new Response(archive, {
          status: 200,
          headers: {
            "content-type": "application/gzip",
            "content-disposition": 'attachment; filename="aos-cognee-0.1.0.argent-pkg"',
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const priorFetch = global.fetch;
    // @ts-expect-error override for test
    global.fetch = mockFetch;

    vi.resetModules();
    const { createMarketplaceTool } = await import("./marketplace-tool.js");
    const tool = createMarketplaceTool();
    const result = await tool.execute("test-install", {
      action: "install",
      packageId: "aos-cognee",
    });

    expect(result.details).toMatchObject({
      ok: true,
      action: "install",
      packageId: "aos-cognee",
      name: "aos-cognee",
      installed: ["aos-cognee"],
    });
    const harnessBinary = path.join(
      tempHome,
      ".argentos",
      "connectors",
      "aos-cognee",
      "agent-harness",
      ".venv",
      "bin",
      "aos-cognee",
    );
    expect(fs.existsSync(harnessBinary)).toBe(true);
    expect(String(result.content[0]?.text)).toContain("Installed 1 connector harness(es).");

    // @ts-expect-error restore
    global.fetch = priorFetch;
  });
});
