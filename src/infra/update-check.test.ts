import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkUpdateStatus, resolveNpmChannelTag } from "./update-check.js";

describe("resolveNpmChannelTag", () => {
  let versionByTag: Record<string, string | null>;

  beforeEach(() => {
    versionByTag = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const tag = decodeURIComponent(url.split("/").pop() ?? "");
        const version = versionByTag[tag] ?? null;
        return {
          ok: version != null,
          status: version != null ? 200 : 404,
          json: async () => ({ version }),
        } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to latest when beta is older", async () => {
    versionByTag.beta = "1.0.0-beta.1";
    versionByTag.latest = "1.0.1-1";

    const resolved = await resolveNpmChannelTag({ channel: "beta", timeoutMs: 1000 });

    expect(resolved).toEqual({ tag: "latest", version: "1.0.1-1" });
  });

  it("keeps beta when beta is not older", async () => {
    versionByTag.beta = "1.0.2-beta.1";
    versionByTag.latest = "1.0.1-1";

    const resolved = await resolveNpmChannelTag({ channel: "beta", timeoutMs: 1000 });

    expect(resolved).toEqual({ tag: "beta", version: "1.0.2-beta.1" });
  });
});

describe("checkUpdateStatus source readiness", () => {
  it("marks source ready when manifest and artifact exist", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-check-"));
    try {
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "argent" }),
        "utf-8",
      );
      await fs.mkdir(path.join(tempDir, "dist"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "dist", "entry.js"), "export {};\n", "utf-8");

      const result = await checkUpdateStatus({
        root: tempDir,
        timeoutMs: 500,
        fetchGit: false,
        includeRegistry: false,
      });

      expect(result.source?.ready).toBe(true);
      expect(result.source?.manifestReady).toBe(true);
      expect(result.source?.artifactReady).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("marks source not ready when artifact is missing", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-check-"));
    try {
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "argent" }),
        "utf-8",
      );

      const result = await checkUpdateStatus({
        root: tempDir,
        timeoutMs: 500,
        fetchGit: false,
        includeRegistry: false,
      });

      expect(result.source?.ready).toBe(false);
      expect(result.source?.manifestReady).toBe(true);
      expect(result.source?.artifactReady).toBe(false);
      expect(result.source?.reason).toBe("artifact-missing");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
