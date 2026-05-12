import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanLegacyGitDirEnvFromPlistFile,
  stripLegacyGitDirEnvVars,
} from "./plist-legacy-cleanup.js";

const HOME = "/Users/jason";

function makePlist(envEntries: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "  <dict>",
    "    <key>Label</key>",
    "    <string>ai.argent.gateway</string>",
    "    <key>RunAtLoad</key>",
    "    <true/>",
    "    <key>ProgramArguments</key>",
    "    <array>",
    "      <string>/opt/homebrew/bin/node</string>",
    "      <string>/Users/jason/.argentos/lib/node_modules/argentos/dist/entry.js</string>",
    "      <string>gateway</string>",
    "    </array>",
    "    <key>StandardOutPath</key>",
    "    <string>/Users/jason/.argent/logs/gateway.log</string>",
    "    <key>StandardErrorPath</key>",
    "    <string>/Users/jason/.argent/logs/gateway.err.log</string>",
    "    <key>EnvironmentVariables</key>",
    "    <dict>",
    envEntries,
    "    </dict>",
    "  </dict>",
    "</plist>",
  ].join("\n");
}

describe("stripLegacyGitDirEnvVars", () => {
  it("removes both ARGENT_GIT_DIR and ARGENTOS_GIT_DIR when they reference the legacy path", () => {
    const plist = makePlist(
      [
        "    <key>HOME</key>",
        "    <string>/Users/jason</string>",
        "    <key>ARGENT_GIT_DIR</key>",
        "    <string>/Users/jason/argentos</string>",
        "    <key>ARGENTOS_GIT_DIR</key>",
        "    <string>/Users/jason/argentos</string>",
        "    <key>ARGENT_GATEWAY_PORT</key>",
        "    <string>18789</string>",
      ].join("\n"),
    );
    const result = stripLegacyGitDirEnvVars(plist, { home: HOME });
    expect(result.changed).toBe(true);
    expect(result.removedKeys.toSorted()).toEqual(["ARGENTOS_GIT_DIR", "ARGENT_GIT_DIR"]);
    expect(result.plist).not.toContain("ARGENT_GIT_DIR");
    expect(result.plist).not.toContain("ARGENTOS_GIT_DIR");
    // Other env vars survive.
    expect(result.plist).toContain("<key>HOME</key>");
    expect(result.plist).toContain("<key>ARGENT_GATEWAY_PORT</key>");
    expect(result.plist).toContain("<string>18789</string>");
  });

  it("is idempotent — running on a clean plist returns it unchanged", () => {
    const plist = makePlist(
      [
        "    <key>HOME</key>",
        "    <string>/Users/jason</string>",
        "    <key>ARGENT_GATEWAY_PORT</key>",
        "    <string>18789</string>",
      ].join("\n"),
    );
    const first = stripLegacyGitDirEnvVars(plist, { home: HOME });
    expect(first.changed).toBe(false);
    expect(first.removedKeys).toEqual([]);
    expect(first.plist).toBe(plist);

    const second = stripLegacyGitDirEnvVars(first.plist, { home: HOME });
    expect(second.changed).toBe(false);
    expect(second.plist).toBe(plist);
  });

  it("preserves ARGENT_GIT_DIR when it references a NON-legacy path (custom checkout)", () => {
    const plist = makePlist(
      [
        "    <key>ARGENT_GIT_DIR</key>",
        "    <string>/Users/jason/code/argent-core</string>",
        "    <key>ARGENTOS_GIT_DIR</key>",
        "    <string>/Users/jason/argentos</string>",
      ].join("\n"),
    );
    const result = stripLegacyGitDirEnvVars(plist, { home: HOME });
    // Only the legacy ARGENTOS_GIT_DIR is stripped; the custom override
    // survives untouched.
    expect(result.changed).toBe(true);
    expect(result.removedKeys).toEqual(["ARGENTOS_GIT_DIR"]);
    expect(result.plist).toContain("ARGENT_GIT_DIR");
    expect(result.plist).toContain("/Users/jason/code/argent-core");
    expect(result.plist).not.toContain("ARGENTOS_GIT_DIR");
  });

  it("normalizes trailing slashes when matching the legacy path", () => {
    const plist = makePlist(
      ["    <key>ARGENT_GIT_DIR</key>", "    <string>/Users/jason/argentos/</string>"].join("\n"),
    );
    const result = stripLegacyGitDirEnvVars(plist, { home: HOME });
    expect(result.changed).toBe(true);
    expect(result.removedKeys).toEqual(["ARGENT_GIT_DIR"]);
  });

  it("removes the EnvironmentVariables block entirely when no other entries remain", () => {
    const plist = makePlist(
      [
        "    <key>ARGENT_GIT_DIR</key>",
        "    <string>/Users/jason/argentos</string>",
        "    <key>ARGENTOS_GIT_DIR</key>",
        "    <string>/Users/jason/argentos</string>",
      ].join("\n"),
    );
    const result = stripLegacyGitDirEnvVars(plist, { home: HOME });
    expect(result.changed).toBe(true);
    expect(result.plist).not.toContain("EnvironmentVariables");
    // Rest of the plist still parses.
    expect(result.plist).toContain("<key>Label</key>");
    expect(result.plist).toContain("<string>ai.argent.gateway</string>");
    expect(result.plist).toContain("</plist>");
  });

  it("returns unchanged when the plist has no EnvironmentVariables dict", () => {
    const plist = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0">',
      "  <dict>",
      "    <key>Label</key>",
      "    <string>ai.argent.gateway</string>",
      "  </dict>",
      "</plist>",
    ].join("\n");
    const result = stripLegacyGitDirEnvVars(plist, { home: HOME });
    expect(result.changed).toBe(false);
    expect(result.plist).toBe(plist);
  });

  it("is a no-op when HOME cannot be determined", () => {
    const plist = makePlist(
      ["    <key>ARGENT_GIT_DIR</key>", "    <string>/Users/jason/argentos</string>"].join("\n"),
    );
    const result = stripLegacyGitDirEnvVars(plist, { home: "" });
    expect(result.changed).toBe(false);
    expect(result.plist).toBe(plist);
  });
});

describe("cleanLegacyGitDirEnvFromPlistFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-plist-cleanup-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("writes back a cleaned plist when legacy vars are present", async () => {
    const plistPath = path.join(tempDir, "ai.argent.gateway.plist");
    const original = makePlist(
      [
        "    <key>ARGENT_GIT_DIR</key>",
        "    <string>/Users/jason/argentos</string>",
        "    <key>HOME</key>",
        "    <string>/Users/jason</string>",
      ].join("\n"),
    );
    await fs.writeFile(plistPath, original, "utf8");

    const result = await cleanLegacyGitDirEnvFromPlistFile(plistPath, { home: HOME });

    expect(result.changed).toBe(true);
    expect(result.removedKeys).toEqual(["ARGENT_GIT_DIR"]);
    const written = await fs.readFile(plistPath, "utf8");
    expect(written).not.toContain("ARGENT_GIT_DIR");
    expect(written).toContain("<key>HOME</key>");
  });

  it("is a no-op when the file does not exist", async () => {
    const missing = path.join(tempDir, "does-not-exist.plist");
    const result = await cleanLegacyGitDirEnvFromPlistFile(missing, { home: HOME });
    expect(result.changed).toBe(false);
    expect(result.removedKeys).toEqual([]);
  });

  it("does not rewrite the file when there is nothing to clean", async () => {
    const plistPath = path.join(tempDir, "ai.argent.gateway.plist");
    const original = makePlist(
      ["    <key>HOME</key>", "    <string>/Users/jason</string>"].join("\n"),
    );
    await fs.writeFile(plistPath, original, "utf8");
    const beforeMtime = (await fs.stat(plistPath)).mtimeMs;

    // Give the filesystem a beat so any rewrite would actually change mtime.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await cleanLegacyGitDirEnvFromPlistFile(plistPath, { home: HOME });
    expect(result.changed).toBe(false);

    const afterMtime = (await fs.stat(plistPath)).mtimeMs;
    expect(afterMtime).toBe(beforeMtime);
  });
});
