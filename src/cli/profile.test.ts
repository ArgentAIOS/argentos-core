import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs(["node", "argent", "gateway", "--dev", "--allow-unconfigured"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "argent", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "argent", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "argent", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "argent", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "argent", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "argent", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "argent", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "argent", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join("/home/peter", ".argentos-dev");
    expect(env.ARGENT_PROFILE).toBe("dev");
    expect(env.ARGENT_STATE_DIR).toBe(expectedStateDir);
    expect(env.ARGENT_CONFIG_PATH).toBe(path.join(expectedStateDir, "argent.json"));
    expect(env.ARGENT_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      ARGENT_STATE_DIR: "/custom",
      ARGENT_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.ARGENT_STATE_DIR).toBe("/custom");
    expect(env.ARGENT_GATEWAY_PORT).toBe("19099");
    expect(env.ARGENT_CONFIG_PATH).toBe(path.join("/custom", "argent.json"));
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("argent doctor --fix", {})).toBe("argent doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("argent doctor --fix", { ARGENT_PROFILE: "default" })).toBe(
      "argent doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("argent doctor --fix", { ARGENT_PROFILE: "Default" })).toBe(
      "argent doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("argent doctor --fix", { ARGENT_PROFILE: "bad profile" })).toBe(
      "argent doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(formatCliCommand("argent --profile work doctor --fix", { ARGENT_PROFILE: "work" })).toBe(
      "argent --profile work doctor --fix",
    );
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("argent --dev doctor", { ARGENT_PROFILE: "dev" })).toBe(
      "argent --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("argent doctor --fix", { ARGENT_PROFILE: "work" })).toBe(
      "argent --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("argent doctor --fix", { ARGENT_PROFILE: "  jbargent  " })).toBe(
      "argent --profile jbargent doctor --fix",
    );
  });

  it("handles command with no args after argent", () => {
    expect(formatCliCommand("argent", { ARGENT_PROFILE: "test" })).toBe("argent --profile test");
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm argent doctor", { ARGENT_PROFILE: "work" })).toBe(
      "pnpm argent --profile work doctor",
    );
  });
});
