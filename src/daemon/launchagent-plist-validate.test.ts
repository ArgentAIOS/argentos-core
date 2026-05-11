import { describe, expect, it } from "vitest";
import {
  findBadProgramArguments,
  formatLaunchAgentInstallIssues,
  resolveCanonicalInstallPackageDir,
  resolveCanonicalInstallScope,
  validateLaunchAgentInstallPaths,
} from "./launchagent-plist-validate.js";

const CANONICAL = "/Users/sem/.argentos/lib/node_modules/argentos";
const CANONICAL_SCOPE = "/Users/sem/.argentos";

describe("resolveCanonicalInstallPackageDir", () => {
  it("prefers ARGENT_INSTALL_PACKAGE_DIR when set", () => {
    const dir = resolveCanonicalInstallPackageDir({
      HOME: "/Users/sem",
      ARGENT_INSTALL_PACKAGE_DIR: "/opt/custom/lib/node_modules/argentos",
    });
    expect(dir).toBe("/opt/custom/lib/node_modules/argentos");
  });

  it("falls back to $HOME/.argentos/lib/node_modules/argentos", () => {
    const dir = resolveCanonicalInstallPackageDir({ HOME: "/Users/sem" });
    expect(dir).toBe(CANONICAL);
  });

  it("returns null when HOME is unset", () => {
    expect(resolveCanonicalInstallPackageDir({})).toBeNull();
  });
});

describe("resolveCanonicalInstallScope", () => {
  it("walks three levels up from the install package dir to the npm prefix", () => {
    expect(resolveCanonicalInstallScope(CANONICAL)).toBe(CANONICAL_SCOPE);
  });

  it("falls back to the install dir itself for very short paths", () => {
    // Edge case: a custom path that isn't deep enough to walk up 3 levels.
    expect(resolveCanonicalInstallScope("/opt/argentos")).toBe("/opt/argentos");
  });
});

describe("findBadProgramArguments", () => {
  it("passes a canonical install (under ~/.argentos/lib/node_modules/argentos)", () => {
    const bad = findBadProgramArguments({
      programArguments: [
        "/opt/homebrew/opt/node@22/bin/node",
        `${CANONICAL}/dist/index.js`,
        "gateway",
        "--port",
        "18789",
      ],
      canonicalInstallPackageDir: CANONICAL,
    });
    expect(bad).toEqual([]);
  });

  it("passes sibling artifacts under the npm prefix (backups, redis config)", () => {
    // These are installed alongside the package by `npm i -g argentos` and
    // are legitimate plist targets — don't flag them as drift.
    const bad = findBadProgramArguments({
      programArguments: ["/bin/bash", "/Users/sem/.argentos/backups/database/run-db-backup.sh"],
      canonicalInstallPackageDir: CANONICAL,
    });
    expect(bad).toEqual([]);

    const badRedis = findBadProgramArguments({
      programArguments: ["/opt/homebrew/bin/redis-server", "/Users/sem/.argentos/redis/redis.conf"],
      canonicalInstallPackageDir: CANONICAL,
    });
    expect(badRedis).toEqual([]);
  });

  it("flags a legacy install pointing at /Users/sem/argentos/ (the rogue poller case)", () => {
    const bad = findBadProgramArguments({
      programArguments: [
        "/opt/homebrew/opt/node@22/bin/node",
        "/Users/sem/argentos/dist/index.js",
        "telegram",
      ],
      canonicalInstallPackageDir: CANONICAL,
    });
    expect(bad).toEqual(["/Users/sem/argentos/dist/index.js"]);
  });

  it("flags a manually-edited plist pointing at a different .argentos prefix", () => {
    const bad = findBadProgramArguments({
      programArguments: [
        "/usr/local/bin/node",
        "/opt/argentos-stale/lib/node_modules/argentos/dist/index.js",
      ],
      canonicalInstallPackageDir: CANONICAL,
    });
    expect(bad).toEqual(["/opt/argentos-stale/lib/node_modules/argentos/dist/index.js"]);
  });

  it("ignores plain interpreters and non-argent paths", () => {
    const bad = findBadProgramArguments({
      programArguments: [
        "/opt/homebrew/bin/redis-server",
        "/etc/redis/redis.conf",
        "--port",
        "6379",
      ],
      canonicalInstallPackageDir: CANONICAL,
    });
    expect(bad).toEqual([]);
  });

  it("accepts auxiliary scripts inside the canonical install dir (dashboard/static-server.cjs)", () => {
    const bad = findBadProgramArguments({
      programArguments: [
        "/Users/sem/.nvm/versions/node/v22.22.0/bin/node",
        `${CANONICAL}/dashboard/static-server.cjs`,
      ],
      canonicalInstallPackageDir: CANONICAL,
    });
    expect(bad).toEqual([]);
  });
});

describe("validateLaunchAgentInstallPaths", () => {
  const HOME = "/Users/sem";
  const LAUNCH_AGENTS_DIR = `${HOME}/Library/LaunchAgents`;

  function makePlistReader(map: Record<string, string[]>) {
    return async (plistPath: string) => {
      const args = map[plistPath];
      if (!args) {
        return null;
      }
      return {
        programArguments: args,
        sourcePath: plistPath,
      };
    };
  }

  it("returns no issues when every plist is canonical", async () => {
    const plistMap = {
      [`${LAUNCH_AGENTS_DIR}/ai.argent.gateway.plist`]: [
        "/opt/homebrew/opt/node@22/bin/node",
        `${CANONICAL}/dist/index.js`,
        "gateway",
      ],
      [`${LAUNCH_AGENTS_DIR}/ai.argent.dashboard-ui.plist`]: [
        "/Users/sem/.nvm/versions/node/v22.22.0/bin/node",
        `${CANONICAL}/dashboard/static-server.cjs`,
      ],
      [`${LAUNCH_AGENTS_DIR}/ai.argent.database-backup.plist`]: [
        "/bin/bash",
        "/Users/sem/.argentos/backups/database/run-db-backup.sh",
      ],
      [`${LAUNCH_AGENTS_DIR}/ai.argent.redis.plist`]: [
        "/opt/homebrew/bin/redis-server",
        "/Users/sem/.argentos/redis/redis.conf",
      ],
    };
    const issues = await validateLaunchAgentInstallPaths({
      env: { HOME },
      listPlists: async () => Object.keys(plistMap),
      readProgramArguments: makePlistReader(plistMap),
    });
    expect(issues).toEqual([]);
  });

  it("flags a legacy install plist with an actionable suggestedFix", async () => {
    const legacyPath = `${LAUNCH_AGENTS_DIR}/ai.argent.telegram.plist`;
    const plistMap = {
      [`${LAUNCH_AGENTS_DIR}/ai.argent.gateway.plist`]: [
        "/opt/homebrew/opt/node@22/bin/node",
        `${CANONICAL}/dist/index.js`,
      ],
      [legacyPath]: [
        "/opt/homebrew/opt/node@22/bin/node",
        "/Users/sem/argentos/dist/telegram-poller.js",
      ],
    };
    const issues = await validateLaunchAgentInstallPaths({
      env: { HOME },
      listPlists: async () => Object.keys(plistMap),
      readProgramArguments: makePlistReader(plistMap),
    });
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    expect(issue.label).toBe("ai.argent.telegram");
    expect(issue.plistPath).toBe(legacyPath);
    expect(issue.badArgs).toEqual(["/Users/sem/argentos/dist/telegram-poller.js"]);
    expect(issue.suggestedFix).toContain("launchctl bootout");
    expect(issue.suggestedFix).toContain("ai.argent.telegram.plist");
    expect(issue.suggestedFix).toContain("argent doctor --fix");
  });

  it("returns an empty list when LaunchAgents dir does not exist", async () => {
    const issues = await validateLaunchAgentInstallPaths({
      env: { HOME },
      listPlists: async () => [],
      readProgramArguments: async () => null,
    });
    expect(issues).toEqual([]);
  });

  it("skips plists with no ProgramArguments", async () => {
    const issues = await validateLaunchAgentInstallPaths({
      env: { HOME },
      listPlists: async () => [`${LAUNCH_AGENTS_DIR}/ai.argent.broken.plist`],
      readProgramArguments: async () => null,
    });
    expect(issues).toEqual([]);
  });

  it("returns an empty list when HOME is missing", async () => {
    const issues = await validateLaunchAgentInstallPaths({
      env: {},
      listPlists: async () => ["/anywhere/ai.argent.gateway.plist"],
      readProgramArguments: async () => ({
        programArguments: ["/opt/homebrew/opt/node@22/bin/node", "/Users/sem/argentos/dist/x.js"],
      }),
    });
    expect(issues).toEqual([]);
  });

  it("honors ARGENT_INSTALL_PACKAGE_DIR override", async () => {
    const customPrefix = "/opt/custom/lib/node_modules/argentos";
    const plistPath = `${LAUNCH_AGENTS_DIR}/ai.argent.gateway.plist`;
    const issues = await validateLaunchAgentInstallPaths({
      env: { HOME, ARGENT_INSTALL_PACKAGE_DIR: customPrefix },
      listPlists: async () => [plistPath],
      readProgramArguments: async () => ({
        programArguments: [
          "/opt/homebrew/opt/node@22/bin/node",
          // This used to be canonical under the default $HOME/.argentos path,
          // but with the override pointed at /opt/custom/... it is drift.
          `${CANONICAL}/dist/index.js`,
        ],
      }),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].badArgs).toEqual([`${CANONICAL}/dist/index.js`]);
  });
});

describe("formatLaunchAgentInstallIssues", () => {
  it("returns null when there are no issues", () => {
    expect(
      formatLaunchAgentInstallIssues([], { canonicalInstallPackageDir: CANONICAL }),
    ).toBeNull();
  });

  it("formats a multi-issue summary with canonical path + per-plist fix", () => {
    const message = formatLaunchAgentInstallIssues(
      [
        {
          plistPath: "/Users/sem/Library/LaunchAgents/ai.argent.telegram.plist",
          label: "ai.argent.telegram",
          badArgs: ["/Users/sem/argentos/dist/telegram-poller.js"],
          suggestedFix:
            "launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.argent.telegram.plist && rm ~/Library/LaunchAgents/ai.argent.telegram.plist && argent doctor --fix",
        },
      ],
      { canonicalInstallPackageDir: CANONICAL },
    );
    expect(message).not.toBeNull();
    expect(message).toContain("non-canonical argent install");
    expect(message).toContain(`Canonical install package: ${CANONICAL}`);
    expect(message).toContain(`Accepted install scope:    ${CANONICAL_SCOPE}`);
    expect(message).toContain("ai.argent.telegram.plist references");
    expect(message).toContain("/Users/sem/argentos/dist/telegram-poller.js");
    expect(message).toContain("launchctl bootout");
    expect(message).toContain("argent doctor --fix");
  });
});
