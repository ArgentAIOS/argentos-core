import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "argent", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "argent", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "argent", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "argent", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "argent", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "argent", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "argent", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "argent"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "argent", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "argent", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "argent", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "argent", "status", "--timeout=2500"], "--timeout")).toBe("2500");
    expect(getFlagValue(["node", "argent", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "argent", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "argent", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "argent", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "argent", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "argent", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "argent", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "argent", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "argent", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "argent", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "argent",
      rawArgs: ["node", "argent", "status"],
    });
    expect(nodeArgv).toEqual(["node", "argent", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "argent",
      rawArgs: ["node-22", "argent", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "argent", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "argent",
      rawArgs: ["node-22.2.0.exe", "argent", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "argent", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "argent",
      rawArgs: ["node-22.2", "argent", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "argent", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "argent",
      rawArgs: ["node-22.2.exe", "argent", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "argent", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "argent",
      rawArgs: ["/usr/bin/node-22.2.0", "argent", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "argent", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "argent",
      rawArgs: ["nodejs", "argent", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "argent", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "argent",
      rawArgs: ["node-dev", "argent", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "argent", "node-dev", "argent", "status"]);

    const directArgv = buildParseArgv({
      programName: "argent",
      rawArgs: ["argent", "status"],
    });
    expect(directArgv).toEqual(["node", "argent", "status"]);

    const bunArgv = buildParseArgv({
      programName: "argent",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "argent",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "argent", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "argent", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "argent", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "argent", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "argent", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "argent", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "argent", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "argent", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
