import { describe, expect, it, vi } from "vitest";
import {
  assertNativeSqliteRuntime,
  assertSupportedRuntime,
  detectRuntime,
  isAtLeast,
  parseSemver,
  shouldProbeNativeSqlite,
  type RuntimeDetails,
  runtimeSatisfies,
} from "./runtime-guard.js";

describe("runtime-guard", () => {
  it("parses semver with or without leading v", () => {
    expect(parseSemver("v22.1.3")).toEqual({ major: 22, minor: 1, patch: 3 });
    expect(parseSemver("1.3.0")).toEqual({ major: 1, minor: 3, patch: 0 });
    expect(parseSemver("invalid")).toBeNull();
  });

  it("compares versions correctly", () => {
    expect(isAtLeast({ major: 22, minor: 0, patch: 0 }, { major: 22, minor: 0, patch: 0 })).toBe(
      true,
    );
    expect(isAtLeast({ major: 22, minor: 1, patch: 0 }, { major: 22, minor: 0, patch: 0 })).toBe(
      true,
    );
    expect(isAtLeast({ major: 21, minor: 9, patch: 0 }, { major: 22, minor: 0, patch: 0 })).toBe(
      false,
    );
  });

  it("validates runtime thresholds", () => {
    const nodeOk: RuntimeDetails = {
      kind: "node",
      version: "22.0.0",
      abi: "127",
      execPath: "/usr/bin/node",
      pathEnv: "/usr/bin",
    };
    const nodeOld: RuntimeDetails = { ...nodeOk, version: "21.9.0" };
    const unknown: RuntimeDetails = {
      kind: "unknown",
      version: null,
      abi: null,
      execPath: null,
      pathEnv: "/usr/bin",
    };
    expect(runtimeSatisfies(nodeOk)).toBe(true);
    expect(runtimeSatisfies(nodeOld)).toBe(false);
    expect(runtimeSatisfies(unknown)).toBe(false);
  });

  it("throws via exit when runtime is too old", () => {
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(() => {
        throw new Error("exit");
      }),
    };
    const details: RuntimeDetails = {
      kind: "node",
      version: "20.0.0",
      abi: "115",
      execPath: "/usr/bin/node",
      pathEnv: "/usr/bin",
    };
    expect(() => assertSupportedRuntime(runtime, details)).toThrow("exit");
    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("requires Node"));
  });

  it("returns silently when runtime meets requirements", () => {
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };
    const details: RuntimeDetails = {
      ...detectRuntime(),
      kind: "node",
      version: "22.0.0",
      abi: "127",
      execPath: "/usr/bin/node",
    };
    expect(() => assertSupportedRuntime(runtime, details)).not.toThrow();
    expect(runtime.exit).not.toHaveBeenCalled();
  });

  it("exits with remediation when better-sqlite3 ABI probe fails", () => {
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(() => {
        throw new Error("exit");
      }),
    };
    const details: RuntimeDetails = {
      kind: "node",
      version: "25.4.0",
      abi: "141",
      execPath: "/opt/homebrew/bin/node",
      pathEnv: "/opt/homebrew/bin",
    };
    const failingProbe = () => {
      throw new Error(
        "The module was compiled against NODE_MODULE_VERSION 127. This version requires 141.",
      );
    };

    expect(() => assertNativeSqliteRuntime(runtime, details, failingProbe)).toThrow("exit");
    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("Detected better-sqlite3 ABI mismatch."),
    );
    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("pnpm rebuild better-sqlite3"),
    );
  });

  it("returns when native sqlite probe succeeds", () => {
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };
    const details: RuntimeDetails = {
      kind: "node",
      version: "22.22.0",
      abi: "127",
      execPath: "/Users/sem/.nvm/versions/node/v22.22.0/bin/node",
      pathEnv: "/Users/sem/.nvm/versions/node/v22.22.0/bin",
    };
    expect(() => assertNativeSqliteRuntime(runtime, details, () => undefined)).not.toThrow();
    expect(runtime.exit).not.toHaveBeenCalled();
  });

  it("skips sqlite probe in strict postgres-only storage mode", () => {
    expect(
      shouldProbeNativeSqlite({
        backend: "postgres",
        readFrom: "postgres",
        writeTo: ["postgres"],
      }),
    ).toBe(false);
  });

  it("requires sqlite probe for sqlite and dual sqlite-write modes", () => {
    expect(
      shouldProbeNativeSqlite({
        backend: "sqlite",
        readFrom: "sqlite",
        writeTo: ["sqlite"],
      }),
    ).toBe(true);
    expect(
      shouldProbeNativeSqlite({
        backend: "dual",
        readFrom: "postgres",
        writeTo: ["sqlite", "postgres"],
      }),
    ).toBe(true);
  });

  it("honors explicit probe overrides", () => {
    expect(
      shouldProbeNativeSqlite(
        {
          backend: "postgres",
          readFrom: "postgres",
          writeTo: ["postgres"],
        },
        { ARGENT_FORCE_SQLITE_PROBE: "1" } as NodeJS.ProcessEnv,
      ),
    ).toBe(true);

    expect(
      shouldProbeNativeSqlite(
        {
          backend: "sqlite",
          readFrom: "sqlite",
          writeTo: ["sqlite"],
        },
        { ARGENT_SKIP_SQLITE_PROBE: "1" } as NodeJS.ProcessEnv,
      ),
    ).toBe(false);
  });
});
