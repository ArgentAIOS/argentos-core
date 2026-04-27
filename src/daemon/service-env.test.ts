import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMinimalServicePath,
  buildNodeServiceEnvironment,
  buildServiceEnvironment,
  getMinimalServicePathParts,
  getMinimalServicePathPartsFromEnv,
} from "./service-env.js";

describe("getMinimalServicePathParts - Linux user directories", () => {
  it("includes user bin directories when HOME is set on Linux", () => {
    const result = getMinimalServicePathParts({
      platform: "linux",
      home: "/home/testuser",
    });

    // Should include all common user bin directories
    expect(result).toContain("/home/testuser/.local/bin");
    expect(result).toContain("/home/testuser/.npm-global/bin");
    expect(result).toContain("/home/testuser/bin");
    expect(result).toContain("/home/testuser/.nvm/current/bin");
    expect(result).toContain("/home/testuser/.fnm/current/bin");
    expect(result).toContain("/home/testuser/.volta/bin");
    expect(result).toContain("/home/testuser/.asdf/shims");
    expect(result).toContain("/home/testuser/.local/share/pnpm");
    expect(result).toContain("/home/testuser/.bun/bin");
  });

  it("excludes user bin directories when HOME is undefined on Linux", () => {
    const result = getMinimalServicePathParts({
      platform: "linux",
      home: undefined,
    });

    // The running node binary's directory (process.execPath) is always prepended
    // to prevent ABI mismatches with native modules. Filter it out to check
    // that no HOME-derived user directories are included.
    const execDir = path.dirname(process.execPath);
    const withoutExecDir = result.filter((p) => p !== execDir);

    // Should only include system directories (beyond execDir)
    expect(withoutExecDir).toEqual(["/usr/local/bin", "/usr/bin", "/bin"]);

    // Should not include any HOME-derived user-specific paths
    expect(withoutExecDir.some((p) => p.includes(".local"))).toBe(false);
    expect(withoutExecDir.some((p) => p.includes(".npm-global"))).toBe(false);
  });

  it("places user directories before system directories on Linux", () => {
    const result = getMinimalServicePathParts({
      platform: "linux",
      home: "/home/testuser",
    });

    const userDirIndex = result.indexOf("/home/testuser/.local/bin");
    const systemDirIndex = result.indexOf("/usr/bin");

    expect(userDirIndex).toBeGreaterThan(-1);
    expect(systemDirIndex).toBeGreaterThan(-1);
    expect(userDirIndex).toBeLessThan(systemDirIndex);
  });

  it("places extraDirs before user directories on Linux", () => {
    const result = getMinimalServicePathParts({
      platform: "linux",
      home: "/home/testuser",
      extraDirs: ["/custom/bin"],
    });

    const extraDirIndex = result.indexOf("/custom/bin");
    const userDirIndex = result.indexOf("/home/testuser/.local/bin");

    expect(extraDirIndex).toBeGreaterThan(-1);
    expect(userDirIndex).toBeGreaterThan(-1);
    expect(extraDirIndex).toBeLessThan(userDirIndex);
  });

  it("includes env-configured bin roots when HOME is set on Linux", () => {
    const result = getMinimalServicePathPartsFromEnv({
      platform: "linux",
      env: {
        HOME: "/home/testuser",
        PNPM_HOME: "/opt/pnpm",
        NPM_CONFIG_PREFIX: "/opt/npm",
        BUN_INSTALL: "/opt/bun",
        VOLTA_HOME: "/opt/volta",
        ASDF_DATA_DIR: "/opt/asdf",
        NVM_DIR: "/opt/nvm",
        FNM_DIR: "/opt/fnm",
      },
    });

    expect(result).toContain("/opt/pnpm");
    expect(result).toContain("/opt/npm/bin");
    expect(result).toContain("/opt/bun/bin");
    expect(result).toContain("/opt/volta/bin");
    expect(result).toContain("/opt/asdf/shims");
    expect(result).toContain("/opt/nvm/current/bin");
    expect(result).toContain("/opt/fnm/current/bin");
  });

  it("does not include Linux user directories on macOS", () => {
    const result = getMinimalServicePathParts({
      platform: "darwin",
      home: "/Users/testuser",
    });

    // The running node binary's directory (process.execPath) is always prepended
    // regardless of platform to prevent ABI mismatches. Filter it out so we can
    // verify that no Linux-specific HOME-derived user dirs are added for macOS.
    const execDir = path.dirname(process.execPath);
    const withoutExecDir = result.filter((p) => p !== execDir);

    // Should not include Linux-specific user dirs even with HOME set
    expect(withoutExecDir.some((p) => p.includes(".npm-global"))).toBe(false);
    expect(withoutExecDir.some((p) => p.includes(".nvm"))).toBe(false);

    // Should only include macOS system directories
    expect(result).toContain("/opt/homebrew/bin");
    expect(result).toContain("/usr/local/bin");
  });

  it("does not include Linux user directories on Windows", () => {
    const result = getMinimalServicePathParts({
      platform: "win32",
      home: "C:\\Users\\testuser",
    });

    // Windows returns empty array (uses existing PATH)
    expect(result).toEqual([]);
  });
});

describe("buildMinimalServicePath", () => {
  const splitPath = (value: string, platform: NodeJS.Platform) =>
    value.split(platform === "win32" ? path.win32.delimiter : path.posix.delimiter);

  it("includes Homebrew + system dirs on macOS", () => {
    const result = buildMinimalServicePath({
      platform: "darwin",
    });
    const parts = splitPath(result, "darwin");
    expect(parts).toContain("/opt/homebrew/bin");
    expect(parts).toContain("/usr/local/bin");
    expect(parts).toContain("/usr/bin");
    expect(parts).toContain("/bin");
  });

  it("returns PATH as-is on Windows", () => {
    const result = buildMinimalServicePath({
      env: { PATH: "C:\\\\Windows\\\\System32" },
      platform: "win32",
    });
    expect(result).toBe("C:\\\\Windows\\\\System32");
  });

  it("includes Linux user directories when HOME is set in env", () => {
    const result = buildMinimalServicePath({
      platform: "linux",
      env: { HOME: "/home/alice" },
    });
    const parts = splitPath(result, "linux");

    // Verify user directories are included
    expect(parts).toContain("/home/alice/.local/bin");
    expect(parts).toContain("/home/alice/.npm-global/bin");
    expect(parts).toContain("/home/alice/.nvm/current/bin");

    // Verify system directories are also included
    expect(parts).toContain("/usr/local/bin");
    expect(parts).toContain("/usr/bin");
    expect(parts).toContain("/bin");
  });

  it("excludes Linux user directories when HOME is not in env", () => {
    const result = buildMinimalServicePath({
      platform: "linux",
      env: {},
    });
    const parts = splitPath(result, "linux");

    // The running node binary's directory (process.execPath) is always prepended
    // to prevent ABI mismatches. Filter it out to verify no HOME-derived dirs.
    const execDir = path.dirname(process.execPath);
    const withoutExecDir = parts.filter((p) => p !== execDir);

    // Should only have system directories (beyond execDir)
    expect(withoutExecDir).toEqual(["/usr/local/bin", "/usr/bin", "/bin"]);

    // No HOME-derived user-specific paths
    expect(withoutExecDir.some((p) => p.includes("home"))).toBe(false);
  });

  it("ensures user directories come before system directories on Linux", () => {
    const result = buildMinimalServicePath({
      platform: "linux",
      env: { HOME: "/home/bob" },
    });
    const parts = splitPath(result, "linux");

    const firstUserDirIdx = parts.indexOf("/home/bob/.local/bin");
    const firstSystemDirIdx = parts.indexOf("/usr/local/bin");

    expect(firstUserDirIdx).toBeLessThan(firstSystemDirIdx);
  });

  it("includes extra directories when provided", () => {
    const result = buildMinimalServicePath({
      platform: "linux",
      extraDirs: ["/custom/tools"],
      env: {},
    });
    expect(splitPath(result, "linux")).toContain("/custom/tools");
  });

  it("deduplicates directories", () => {
    const result = buildMinimalServicePath({
      platform: "linux",
      extraDirs: ["/usr/bin"],
      env: {},
    });
    const parts = splitPath(result, "linux");
    const unique = [...new Set(parts)];
    expect(parts.length).toBe(unique.length);
  });
});

describe("buildServiceEnvironment", () => {
  it("sets minimal PATH and gateway vars", () => {
    const env = buildServiceEnvironment({
      env: { HOME: "/home/user" },
      port: 18789,
      token: "secret",
    });
    expect(env.HOME).toBe("/home/user");
    if (process.platform === "win32") {
      expect(env.PATH).toBe("");
    } else {
      expect(env.PATH).toContain("/usr/bin");
    }
    expect(env.ARGENT_GATEWAY_PORT).toBe("18789");
    expect(env.ARGENT_GATEWAY_TOKEN).toBe("secret");
    expect(env.ARGENT_RUNTIME_MODE).toBe("argent_with_fallback");
    expect(env.ARGENT_SERVICE_MARKER).toBe("argent");
    expect(env.ARGENT_SERVICE_KIND).toBe("gateway");
    expect(typeof env.ARGENT_SERVICE_VERSION).toBe("string");
    expect(env.ARGENT_INSTALL_PACKAGE_DIR).toBe("/home/user/.argentos/lib/node_modules/argentos");
    expect(env.ARGENT_SYSTEMD_UNIT).toBe("argent-gateway.service");
    if (process.platform === "darwin") {
      expect(env.ARGENT_LAUNCHD_LABEL).toBe("ai.argent.gateway");
    }
  });

  it("passes hosted git and runtime snapshot paths to service environments", () => {
    const env = buildServiceEnvironment({
      env: {
        HOME: "/home/user",
        ARGENT_GIT_DIR: "/home/user/argentos",
        ARGENT_INSTALL_PACKAGE_DIR: "/home/user/.argentos/lib/node_modules/argentos",
      },
      port: 18789,
    });
    expect(env.ARGENT_GIT_DIR).toBe("/home/user/argentos");
    expect(env.ARGENTOS_GIT_DIR).toBe("/home/user/argentos");
    expect(env.ARGENT_INSTALL_PACKAGE_DIR).toBe("/home/user/.argentos/lib/node_modules/argentos");
  });

  it("uses profile-specific unit and label", () => {
    const env = buildServiceEnvironment({
      env: { HOME: "/home/user", ARGENT_PROFILE: "work" },
      port: 18789,
    });
    expect(env.ARGENT_SYSTEMD_UNIT).toBe("argent-gateway-work.service");
    if (process.platform === "darwin") {
      expect(env.ARGENT_LAUNCHD_LABEL).toBe("ai.argent.work");
    }
  });

  it("preserves explicit runtime mode overrides", () => {
    const env = buildServiceEnvironment({
      env: { HOME: "/home/user", ARGENT_RUNTIME_MODE: "pi_only" },
      port: 18789,
    });
    expect(env.ARGENT_RUNTIME_MODE).toBe("pi_only");
  });
});

describe("buildNodeServiceEnvironment", () => {
  it("passes through HOME for node services", () => {
    const env = buildNodeServiceEnvironment({
      env: { HOME: "/home/user" },
    });
    expect(env.HOME).toBe("/home/user");
  });
});
