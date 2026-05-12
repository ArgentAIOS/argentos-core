import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAddGenericPasswordCommand,
  buildFindGenericPasswordCommand,
  resolveKeychainPath,
} from "./keychain.js";

const tempDirs: string[] = [];

function makeTempHome(withKeychain = true): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-keychain-test-"));
  tempDirs.push(dir);
  if (withKeychain) {
    const keychainsDir = path.join(dir, "Library", "Keychains");
    fs.mkdirSync(keychainsDir, { recursive: true });
    fs.writeFileSync(path.join(keychainsDir, "login.keychain-db"), "");
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveKeychainPath", () => {
  it("defaults to $HOME/Library/Keychains/login.keychain-db when the file exists", () => {
    const home = makeTempHome(true);
    const resolved = resolveKeychainPath({ homeDir: home, env: {} });
    expect(resolved).toBe(path.join(home, "Library", "Keychains", "login.keychain-db"));
  });

  it("honors ARGENT_KEYCHAIN_PATH override when the file exists", () => {
    const home = makeTempHome(true);
    const custom = path.join(home, "custom.keychain-db");
    fs.writeFileSync(custom, "");
    const resolved = resolveKeychainPath({
      homeDir: home,
      env: { ARGENT_KEYCHAIN_PATH: custom },
    });
    expect(resolved).toBe(custom);
  });

  it("returns null when the resolved path does not exist (backward-compat fallback)", () => {
    const home = makeTempHome(false);
    const resolved = resolveKeychainPath({ homeDir: home, env: {} });
    expect(resolved).toBeNull();
  });

  it("returns null when ARGENT_KEYCHAIN_PATH points at a missing file", () => {
    const home = makeTempHome(true);
    const resolved = resolveKeychainPath({
      homeDir: home,
      env: { ARGENT_KEYCHAIN_PATH: "/nonexistent/path/login.keychain-db" },
    });
    expect(resolved).toBeNull();
  });

  it("returns null when HOME is empty and no override is set", () => {
    const resolved = resolveKeychainPath({ homeDir: "", env: {} });
    expect(resolved).toBeNull();
  });

  it("supports an injected fileExists predicate for hermetic tests", () => {
    const resolved = resolveKeychainPath({
      homeDir: "/Users/test",
      env: {},
      fileExists: () => true,
    });
    expect(resolved).toBe("/Users/test/Library/Keychains/login.keychain-db");
  });
});

describe("buildFindGenericPasswordCommand", () => {
  it("appends -k <path> when a keychain path is provided", () => {
    const cmd = buildFindGenericPasswordCommand(
      "ArgentOS-MasterKey",
      "ArgentOS",
      "/Users/test/Library/Keychains/login.keychain-db",
    );
    expect(cmd).toContain(`-k "/Users/test/Library/Keychains/login.keychain-db"`);
    expect(cmd).toBe(
      `security find-generic-password -s "ArgentOS-MasterKey" -a "ArgentOS" -w -k "/Users/test/Library/Keychains/login.keychain-db"`,
    );
  });

  it("omits -k when keychain path is null (backward-compat fallback)", () => {
    const cmd = buildFindGenericPasswordCommand("ArgentOS-MasterKey", "ArgentOS", null);
    expect(cmd).not.toContain("-k ");
    expect(cmd).toBe(`security find-generic-password -s "ArgentOS-MasterKey" -a "ArgentOS" -w`);
  });
});

describe("buildAddGenericPasswordCommand", () => {
  it("appends -k <path> when a keychain path is provided", () => {
    const cmd = buildAddGenericPasswordCommand(
      "ArgentOS-MasterKey",
      "ArgentOS",
      "deadbeef".repeat(8),
      "/Users/test/Library/Keychains/login.keychain-db",
    );
    expect(cmd).toContain(`-k "/Users/test/Library/Keychains/login.keychain-db"`);
    expect(cmd).toContain("-U");
    expect(cmd.startsWith("security add-generic-password -U")).toBe(true);
  });

  it("omits -k when keychain path is null (backward-compat fallback)", () => {
    const cmd = buildAddGenericPasswordCommand(
      "ArgentOS-MasterKey",
      "ArgentOS",
      "deadbeef".repeat(8),
      null,
    );
    expect(cmd).not.toContain("-k ");
    expect(cmd).toContain("-U");
  });
});
