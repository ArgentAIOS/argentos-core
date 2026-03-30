import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  access: vi.fn(),
  realpath: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: { access: fsMocks.access, realpath: fsMocks.realpath },
  access: fsMocks.access,
  realpath: fsMocks.realpath,
}));

import { resolveGatewayProgramArguments } from "./program-args.js";

const originalArgv = [...process.argv];
const originalHome = process.env.HOME;
const originalStateDir = process.env.ARGENT_STATE_DIR;
const originalInstallPackageDir = process.env.ARGENT_INSTALL_PACKAGE_DIR;

afterEach(() => {
  process.argv = [...originalArgv];
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalStateDir === undefined) {
    delete process.env.ARGENT_STATE_DIR;
  } else {
    process.env.ARGENT_STATE_DIR = originalStateDir;
  }
  if (originalInstallPackageDir === undefined) {
    delete process.env.ARGENT_INSTALL_PACKAGE_DIR;
  } else {
    process.env.ARGENT_INSTALL_PACKAGE_DIR = originalInstallPackageDir;
  }
  vi.resetAllMocks();
});

describe("resolveGatewayProgramArguments", () => {
  it("uses realpath-resolved dist entry when running via npx shim", async () => {
    const argv1 = path.resolve("/tmp/.npm/_npx/63c3/node_modules/.bin/argent");
    const entryPath = path.resolve("/tmp/.npm/_npx/63c3/node_modules/argent/dist/entry.js");
    process.argv = ["node", argv1];
    fsMocks.realpath.mockResolvedValue(entryPath);
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === entryPath) {
        return;
      }
      throw new Error("missing");
    });

    const result = await resolveGatewayProgramArguments({ port: 18789 });

    expect(result.programArguments).toEqual([
      process.execPath,
      entryPath,
      "gateway",
      "--port",
      "18789",
    ]);
  });

  it("prefers symlinked path over realpath for stable service config", async () => {
    // Simulates pnpm global install where node_modules/argent is a symlink
    // to .pnpm/argent@X.Y.Z/node_modules/argent
    const symlinkPath = path.resolve(
      "/Users/test/Library/pnpm/global/5/node_modules/argent/dist/entry.js",
    );
    const realpathResolved = path.resolve(
      "/Users/test/Library/pnpm/global/5/node_modules/.pnpm/argent@2026.1.21-2/node_modules/argent/dist/entry.js",
    );
    process.argv = ["node", symlinkPath];
    fsMocks.realpath.mockResolvedValue(realpathResolved);
    fsMocks.access.mockResolvedValue(undefined); // Both paths exist

    const result = await resolveGatewayProgramArguments({ port: 18789 });

    // Should use the symlinked path, not the realpath-resolved versioned path
    expect(result.programArguments[1]).toBe(symlinkPath);
    expect(result.programArguments[1]).not.toContain("@2026.1.21-2");
  });

  it("falls back to node_modules package dist when .bin path is not resolved", async () => {
    const argv1 = path.resolve("/tmp/.npm/_npx/63c3/node_modules/.bin/argent");
    const indexPath = path.resolve("/tmp/.npm/_npx/63c3/node_modules/argent/dist/index.js");
    process.argv = ["node", argv1];
    fsMocks.realpath.mockRejectedValue(new Error("no realpath"));
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === indexPath) {
        return;
      }
      throw new Error("missing");
    });

    const result = await resolveGatewayProgramArguments({ port: 18789 });

    expect(result.programArguments).toEqual([
      process.execPath,
      indexPath,
      "gateway",
      "--port",
      "18789",
    ]);
  });

  it("prefers installed runtime snapshot over repo dist when available", async () => {
    const repoDist = path.resolve("/Users/dev/argentos/dist/index.js");
    const installedCli = path.resolve("/Users/test/.argentos/lib/node_modules/argentos/argent.mjs");
    const installedDist = path.resolve(
      "/Users/test/.argentos/lib/node_modules/argentos/dist/index.js",
    );
    process.argv = ["node", repoDist];
    process.env.HOME = "/Users/test";
    delete process.env.ARGENT_STATE_DIR;
    fsMocks.realpath.mockImplementation(async (target: string) => target);
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === installedCli || target === installedDist) {
        return;
      }
      throw new Error(`missing: ${target}`);
    });

    const result = await resolveGatewayProgramArguments({ port: 18789 });

    expect(result.programArguments).toEqual([
      process.execPath,
      installedDist,
      "gateway",
      "--port",
      "18789",
    ]);
  });

  it("prefers ARGENT_INSTALL_PACKAGE_DIR over the default state snapshot path", async () => {
    const repoDist = path.resolve("/Users/dev/argentos/dist/index.js");
    const installPackageDir = path.resolve("/Users/custom/argent-runtime");
    const installedCli = path.resolve(installPackageDir, "argent.mjs");
    const installedDist = path.resolve(installPackageDir, "dist/index.js");
    const defaultInstalledCli = path.resolve(
      "/Users/test/.argentos/lib/node_modules/argentos/argent.mjs",
    );
    process.argv = ["node", repoDist];
    process.env.HOME = "/Users/test";
    delete process.env.ARGENT_STATE_DIR;
    process.env.ARGENT_INSTALL_PACKAGE_DIR = installPackageDir;
    fsMocks.realpath.mockImplementation(async (target: string) => target);
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === installedCli || target === installedDist) {
        return;
      }
      if (target === defaultInstalledCli) {
        throw new Error(`unexpected default snapshot probe: ${target}`);
      }
      throw new Error(`missing: ${target}`);
    });

    const result = await resolveGatewayProgramArguments({ port: 18789 });

    expect(result.programArguments).toEqual([
      process.execPath,
      installedDist,
      "gateway",
      "--port",
      "18789",
    ]);
  });

  it("ignores installed runtime path when it resolves back into the same repo", async () => {
    const repoDist = path.resolve("/Users/dev/argentos/dist/index.js");
    const repoArgent = path.resolve("/Users/dev/argentos/argent.mjs");
    const installedCli = path.resolve("/Users/test/.argentos/lib/node_modules/argentos/argent.mjs");
    process.argv = ["node", repoDist];
    process.env.HOME = "/Users/test";
    delete process.env.ARGENT_STATE_DIR;
    fsMocks.realpath.mockImplementation(async (target: string) => {
      if (target === installedCli) {
        return repoArgent;
      }
      return target;
    });
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === installedCli || target === repoDist) {
        return;
      }
      throw new Error(`missing: ${target}`);
    });

    const result = await resolveGatewayProgramArguments({ port: 18789 });

    expect(result.programArguments).toEqual([
      process.execPath,
      repoDist,
      "gateway",
      "--port",
      "18789",
    ]);
  });
});
