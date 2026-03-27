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

function readRealLicenseKey(): string {
  const licensePath = path.join(os.homedir(), ".argentos", "license.json");
  const parsed = JSON.parse(fs.readFileSync(licensePath, "utf8")) as { key?: string };
  if (!parsed.key) {
    throw new Error("Missing local marketplace license");
  }
  return parsed.key;
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
});

describe("marketplace tool install", () => {
  it("resolves a slug from search and installs the downloaded skill package", async () => {
    const licenseKey = readRealLicenseKey();
    const tempHome = await makeTempDir();
    await fsp.mkdir(path.join(tempHome, ".argentos"), { recursive: true });
    await fsp.writeFile(
      path.join(tempHome, ".argentos", "license.json"),
      JSON.stringify({ key: licenseKey }, null, 2),
      "utf8",
    );
    vi.stubEnv("HOME", tempHome);

    const archive = await makeSkillArchive();
    const packageId = "fc24e08c-05e0-441b-89d4-49dfe1fc212c";
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
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
});
