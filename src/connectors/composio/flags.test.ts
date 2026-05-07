/**
 * Composio flags store tests — slice 2.2 (Q7 TS-only harness).
 *
 * Mirrors the per-actor isolation discipline of
 * `src/infra/service-keys.policy.test.ts`: every test asserts that one
 * agent's flags cannot leak into another, and that the default-off Q4 gate
 * is preserved across read paths.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setComposioFlagsPathForTesting,
  defaultComposioFlags,
  getComposioFlagsPath,
  readAllComposioFlags,
  readComposioFlagsForAgent,
  writeComposioFlagsForAgent,
} from "./flags.js";

let tmpDir: string;
let tmpFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "composio-flags-test-"));
  tmpFile = path.join(tmpDir, "composio-flags.json");
  __setComposioFlagsPathForTesting(tmpFile);
});

afterEach(() => {
  __setComposioFlagsPathForTesting(undefined);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("defaultComposioFlags()", () => {
  it("Q4 default-off: enabled=false and toolRouter.enabled=false", () => {
    const flags = defaultComposioFlags();
    expect(flags.enabled).toBe(false);
    expect(flags.toolRouter?.enabled).toBe(false);
    expect(flags.preferComposio).toEqual([]);
  });

  it("returns a fresh object each call (no shared reference)", () => {
    const a = defaultComposioFlags();
    const b = defaultComposioFlags();
    expect(a).not.toBe(b);
    expect(a.toolRouter).not.toBe(b.toolRouter);
    a.preferComposio?.push("airtable");
    expect(b.preferComposio).toEqual([]);
  });
});

describe("readComposioFlagsForAgent — empty store", () => {
  it("returns the default-off flags when the file does not exist", () => {
    expect(fs.existsSync(getComposioFlagsPath())).toBe(false);
    const flags = readComposioFlagsForAgent("actor-a");
    expect(flags).toEqual(defaultComposioFlags());
  });

  it("returns the default-off flags when no agentId is supplied", () => {
    expect(readComposioFlagsForAgent(undefined)).toEqual(defaultComposioFlags());
    expect(readComposioFlagsForAgent("")).toEqual(defaultComposioFlags());
    expect(readComposioFlagsForAgent("   ")).toEqual(defaultComposioFlags());
  });

  it("returns the default-off flags when the stored file is corrupt", () => {
    fs.writeFileSync(tmpFile, "this is not json", "utf-8");
    expect(readComposioFlagsForAgent("actor-a")).toEqual(defaultComposioFlags());
  });
});

describe("writeComposioFlagsForAgent — round-trip", () => {
  it("persists a per-agent enable flip and reads it back identically", () => {
    writeComposioFlagsForAgent("actor-a", {
      enabled: true,
      toolRouter: { enabled: true },
      preferComposio: ["airtable", "asana"],
    });
    const got = readComposioFlagsForAgent("actor-a");
    expect(got.enabled).toBe(true);
    expect(got.toolRouter?.enabled).toBe(true);
    expect(got.preferComposio).toEqual(["airtable", "asana"]);
  });

  it("normalizes the agent id (Q1) on both write and read paths", () => {
    writeComposioFlagsForAgent("Actor-B", { enabled: true });
    expect(readComposioFlagsForAgent("actor-b").enabled).toBe(true);
    expect(readComposioFlagsForAgent("ACTOR-B").enabled).toBe(true);
    expect(readComposioFlagsForAgent("  actor-b  ").enabled).toBe(true);
  });

  it("rejects empty agentId on write (programmer error)", () => {
    expect(() => writeComposioFlagsForAgent("", { enabled: true })).toThrow(/agentId is required/);
    expect(() => writeComposioFlagsForAgent(undefined, { enabled: true })).toThrow(
      /agentId is required/,
    );
  });

  it("dedupes and lowercases preferComposio entries", () => {
    writeComposioFlagsForAgent("actor-c", {
      enabled: true,
      preferComposio: ["Airtable", "airtable", "  ASANA  ", ""],
    });
    expect(readComposioFlagsForAgent("actor-c").preferComposio).toEqual(["airtable", "asana"]);
  });

  it("returns a defensive clone — caller mutation does not bleed into store", () => {
    const stored = writeComposioFlagsForAgent("actor-d", {
      enabled: true,
      preferComposio: ["airtable"],
    });
    stored.preferComposio?.push("evil");
    if (stored.toolRouter) {
      stored.toolRouter.enabled = true;
    }
    const reread = readComposioFlagsForAgent("actor-d");
    expect(reread.preferComposio).toEqual(["airtable"]);
    expect(reread.toolRouter?.enabled).toBe(false);
  });
});

describe("per-agent isolation (cross-agent leakage discipline)", () => {
  it("writing actor-a's flags does not affect actor-b", () => {
    writeComposioFlagsForAgent("actor-a", {
      enabled: true,
      toolRouter: { enabled: true },
      preferComposio: ["github"],
    });
    const aFlags = readComposioFlagsForAgent("actor-a");
    const bFlags = readComposioFlagsForAgent("actor-b");

    expect(aFlags.enabled).toBe(true);
    expect(aFlags.toolRouter?.enabled).toBe(true);
    expect(aFlags.preferComposio).toEqual(["github"]);

    expect(bFlags.enabled).toBe(false);
    expect(bFlags.toolRouter?.enabled).toBe(false);
    expect(bFlags.preferComposio).toEqual([]);
  });

  it("subsequent writes to one agent leave other agents untouched", () => {
    writeComposioFlagsForAgent("actor-a", { enabled: true, preferComposio: ["x"] });
    writeComposioFlagsForAgent("actor-b", { enabled: true, preferComposio: ["y"] });
    writeComposioFlagsForAgent("actor-a", { enabled: false, preferComposio: ["z"] });

    expect(readComposioFlagsForAgent("actor-a").preferComposio).toEqual(["z"]);
    expect(readComposioFlagsForAgent("actor-a").enabled).toBe(false);
    expect(readComposioFlagsForAgent("actor-b").preferComposio).toEqual(["y"]);
    expect(readComposioFlagsForAgent("actor-b").enabled).toBe(true);
  });

  it("readAllComposioFlags returns a per-agent snapshot keyed by normalized id", () => {
    writeComposioFlagsForAgent("Actor-A", { enabled: true });
    writeComposioFlagsForAgent("ActorB", { enabled: false, toolRouter: { enabled: true } });
    const all = readAllComposioFlags();
    expect(Object.keys(all).toSorted()).toEqual(["actor-a", "actorb"]);
    expect(all["actor-a"].enabled).toBe(true);
    // Even when the user fat-fingered enabled=false but toolRouter=true, the
    // store preserves the inputs verbatim — the runtime gate logic
    // (`isComposioToolRouterEnabled`) is responsible for the AND-gate.
    expect(all["actorb"].enabled).toBe(false);
    expect(all["actorb"].toolRouter?.enabled).toBe(true);
  });
});

describe("on-disk file shape", () => {
  it("writes a versioned file with mode 0o600 (POSIX best-effort)", () => {
    writeComposioFlagsForAgent("actor-a", { enabled: true });
    expect(fs.existsSync(tmpFile)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.agents["actor-a"].enabled).toBe(true);
    if (process.platform !== "win32") {
      const mode = fs.statSync(tmpFile).mode & 0o777;
      // Some test filesystems clamp to 0o644 — accept either as long as
      // group/other write bits are clear.
      expect(mode & 0o022).toBe(0);
    }
  });
});
