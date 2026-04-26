import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginManifest } from "./manifest.js";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = path.join(os.tmpdir(), `argent-plugin-manifest-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadPluginManifest", () => {
  it("preserves optional marketplace and preflight metadata fields", () => {
    const pluginDir = makeTempDir();
    const capabilities = ["chat", { id: "workflow", label: "Workflow", experimental: true }];
    const permissions = [{ id: "network", level: "read", optional: true }];
    const runtimeSurfaces = ["cli", { id: "dashboard", label: "Dashboard" }];
    const nativeDependencies = [
      { name: "ffmpeg", install: "brew install ffmpeg", platforms: ["darwin"] },
    ];
    const setupChecks = [{ id: "api-key", command: 'test -n "$API_KEY"', severity: "warn" }];
    const oauthProviders = [{ id: "google", scopes: ["openid", "email"], docsPath: "/oauth" }];
    const installNotes = ["Restart Argent after install", { platform: "linux", note: "Run setup" }];

    fs.writeFileSync(
      path.join(pluginDir, "argent.plugin.json"),
      JSON.stringify(
        {
          id: "demo-plugin",
          configSchema: { type: "object", additionalProperties: true },
          capabilities,
          permissions,
          runtimeSurfaces,
          nativeDependencies,
          setupChecks,
          oauthProviders,
          installNotes,
          futureMarketplaceField: { keep: "tolerated" },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const result = loadPluginManifest(pluginDir);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.manifest.capabilities).toEqual(capabilities);
    expect(result.manifest.permissions).toEqual(permissions);
    expect(result.manifest.runtimeSurfaces).toEqual(runtimeSurfaces);
    expect(result.manifest.nativeDependencies).toEqual(nativeDependencies);
    expect(result.manifest.setupChecks).toEqual(setupChecks);
    expect(result.manifest.oauthProviders).toEqual(oauthProviders);
    expect(result.manifest.installNotes).toEqual(installNotes);
    expect("futureMarketplaceField" in result.manifest).toBe(false);
  });

  it("filters invalid metadata entries without rejecting the manifest", () => {
    const pluginDir = makeTempDir();
    fs.writeFileSync(
      path.join(pluginDir, "argent.plugin.json"),
      JSON.stringify(
        {
          id: "demo-plugin",
          configSchema: { type: "object" },
          capabilities: ["chat", 42, null, { id: "workflow" }],
          permissions: "network",
          installNotes: ["note", false, { platform: "darwin" }],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const result = loadPluginManifest(pluginDir);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.manifest.capabilities).toEqual(["chat", { id: "workflow" }]);
    expect(result.manifest.permissions).toBeUndefined();
    expect(result.manifest.installNotes).toEqual(["note", { platform: "darwin" }]);
  });
});
