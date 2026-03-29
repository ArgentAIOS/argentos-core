import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGatewayConfigPath, resolveGatewayStateDir } from "./paths.js";

describe("resolveGatewayStateDir", () => {
  it("uses the default state dir when no overrides are set", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".argentos"));
  });

  it("appends the profile suffix when set", () => {
    const env = { HOME: "/Users/test", ARGENT_PROFILE: "rescue" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".argentos-rescue"));
  });

  it("treats default profiles as the base state dir", () => {
    const env = { HOME: "/Users/test", ARGENT_PROFILE: "Default" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".argentos"));
  });

  it("uses ARGENT_STATE_DIR when provided", () => {
    const env = { HOME: "/Users/test", ARGENT_STATE_DIR: "/var/lib/argent" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/var/lib/argent"));
  });

  it("expands ~ in ARGENT_STATE_DIR", () => {
    const env = { HOME: "/Users/test", ARGENT_STATE_DIR: "~/argent-state" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/Users/test/argent-state"));
  });

  it("preserves Windows absolute paths without HOME", () => {
    const env = { ARGENT_STATE_DIR: "C:\\State\\argent" };
    expect(resolveGatewayStateDir(env)).toBe("C:\\State\\argent");
  });
});

describe("resolveGatewayConfigPath", () => {
  it("derives the config path from the resolved state dir", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayConfigPath(env)).toBe(
      path.join("/Users/test", ".argentos", "argent.json"),
    );
  });

  it("respects explicit config path overrides", () => {
    const env = { HOME: "/Users/test", ARGENT_CONFIG_PATH: "~/custom/argent.json" };
    expect(resolveGatewayConfigPath(env)).toBe(path.resolve("/Users/test/custom/argent.json"));
  });
});
