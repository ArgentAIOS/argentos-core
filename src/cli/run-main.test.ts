import { describe, expect, it } from "vitest";
import { rewriteUpdateFlagArgv, shouldSkipGlobalPluginRegistration } from "./run-main.js";

describe("rewriteUpdateFlagArgv", () => {
  it("leaves argv unchanged when --update is absent", () => {
    const argv = ["node", "entry.js", "status"];
    expect(rewriteUpdateFlagArgv(argv)).toBe(argv);
  });

  it("rewrites --update into the update command", () => {
    expect(rewriteUpdateFlagArgv(["node", "entry.js", "--update"])).toEqual([
      "node",
      "entry.js",
      "update",
    ]);
  });

  it("preserves global flags that appear before --update", () => {
    expect(rewriteUpdateFlagArgv(["node", "entry.js", "--profile", "p", "--update"])).toEqual([
      "node",
      "entry.js",
      "--profile",
      "p",
      "update",
    ]);
  });

  it("keeps update options after the rewritten command", () => {
    expect(rewriteUpdateFlagArgv(["node", "entry.js", "--update", "--json"])).toEqual([
      "node",
      "entry.js",
      "update",
      "--json",
    ]);
  });
});

describe("shouldSkipGlobalPluginRegistration", () => {
  it("skips plugin registration for top-level help", () => {
    expect(shouldSkipGlobalPluginRegistration(["node", "entry.js", "--help"], null)).toBe(true);
  });

  it("skips plugin registration for subcommand help", () => {
    expect(
      shouldSkipGlobalPluginRegistration(["node", "entry.js", "onboard", "--help"], "onboard"),
    ).toBe(true);
  });

  it("does not skip plugin registration for normal command execution", () => {
    expect(shouldSkipGlobalPluginRegistration(["node", "entry.js", "onboard"], "onboard")).toBe(
      false,
    );
  });

  it("skips plugin registration for disposable loopback gateway smoke", () => {
    expect(
      shouldSkipGlobalPluginRegistration(
        ["node", "entry.js", "gateway", "authority", "smoke-loopback", "--confirm-local-only"],
        "gateway",
      ),
    ).toBe(true);
  });
});
