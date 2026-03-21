import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultPublicCoreManifestPath,
  repoRootFromModule,
  resolveManifestEntryPath,
  resolvePublicCoreRepoRoot,
} from "./public-core-export.js";

describe("public core export helpers", () => {
  it("points to the repo-local default manifest", () => {
    const repoRoot = "/Users/sem/code/argentos";

    expect(defaultPublicCoreManifestPath(repoRoot)).toBe(
      "/Users/sem/code/argentos/docs/argent/public-core.manifest.example.json",
    );
  });

  it("resolves manifest-relative entries", () => {
    const manifestPath = "/Users/sem/code/argentos/docs/argent/public-core.manifest.example.json";

    expect(resolveManifestEntryPath(manifestPath, "./public-core-denylist.json")).toBe(
      "/Users/sem/code/argentos/docs/argent/public-core-denylist.json",
    );
    expect(resolveManifestEntryPath(manifestPath, "../..")).toBe("/Users/sem/code/argentos");
  });

  it("derives repo root from module url", () => {
    const fakeModulePath = path.join(
      "/Users/sem/code/argentos",
      "src",
      "infra",
      "public-core-export.ts",
    );

    expect(repoRootFromModule(new URL(`file://${fakeModulePath}`).href)).toBe(
      "/Users/sem/code/argentos",
    );
  });

  it("allows explicit repo root overrides for export targets", () => {
    const manifestPath = "/Users/sem/code/argentos/docs/argent/public-core.manifest.example.json";

    expect(resolvePublicCoreRepoRoot(manifestPath, "../../.tmp/public-core-export")).toBe(
      "/Users/sem/code/argentos/.tmp/public-core-export",
    );
    expect(
      resolvePublicCoreRepoRoot(
        manifestPath,
        "../../.tmp/public-core-export",
        "/Users/sem/code/argentos-core",
      ),
    ).toBe("/Users/sem/code/argentos-core");
  });
});
