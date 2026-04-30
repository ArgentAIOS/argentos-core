import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateRunResult } from "../infra/update-runner.js";

const confirm = vi.fn();
const select = vi.fn();
const spinner = vi.fn(() => ({ start: vi.fn(), stop: vi.fn() }));
const isCancel = (value: unknown) => value === "cancel";

vi.mock("@clack/prompts", () => ({
  confirm,
  select,
  isCancel,
  spinner,
}));

// Mock the update-runner module
vi.mock("../infra/update-runner.js", () => ({
  runGatewayUpdate: vi.fn(),
}));

vi.mock("../infra/argent-root.js", () => ({
  resolveArgentPackageRoot: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  readConfigFileSnapshot: vi.fn(),
  writeConfigFile: vi.fn(),
}));

vi.mock("../infra/update-check.js", async () => {
  const actual = await vi.importActual<typeof import("../infra/update-check.js")>(
    "../infra/update-check.js",
  );
  return {
    ...actual,
    checkUpdateStatus: vi.fn(),
    fetchNpmTagVersion: vi.fn(),
    resolveNpmChannelTag: vi.fn(),
  };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawnSync: vi.fn(() => ({
      pid: 0,
      output: [],
      stdout: "",
      stderr: "",
      status: 0,
      signal: null,
    })),
  };
});

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: vi.fn(),
}));

// Mock doctor (heavy module; should not run in unit tests)
vi.mock("../commands/doctor.js", () => ({
  doctorCommand: vi.fn(),
}));
// Mock the daemon-cli module
vi.mock("./daemon-cli.js", () => ({
  runDaemonRestart: vi.fn(),
}));

// Mock the runtime
vi.mock("../runtime.js", () => ({
  defaultRuntime: {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  },
}));

describe("update-cli", () => {
  const baseSnapshot = {
    valid: true,
    config: {},
    issues: [],
  } as const;

  const setTty = (value: boolean | undefined) => {
    Object.defineProperty(process.stdin, "isTTY", {
      value,
      configurable: true,
    });
  };

  const setStdoutTty = (value: boolean | undefined) => {
    Object.defineProperty(process.stdout, "isTTY", {
      value,
      configurable: true,
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { resolveArgentPackageRoot } = await import("../infra/argent-root.js");
    const { readConfigFileSnapshot } = await import("../config/config.js");
    const { checkUpdateStatus, fetchNpmTagVersion, resolveNpmChannelTag } =
      await import("../infra/update-check.js");
    const { runCommandWithTimeout } = await import("../process/exec.js");
    vi.mocked(resolveArgentPackageRoot).mockResolvedValue(process.cwd());
    vi.mocked(readConfigFileSnapshot).mockResolvedValue(baseSnapshot);
    vi.mocked(fetchNpmTagVersion).mockResolvedValue({
      tag: "latest",
      version: "9999.0.0",
    });
    vi.mocked(resolveNpmChannelTag).mockResolvedValue({
      tag: "latest",
      version: "9999.0.0",
    });
    vi.mocked(checkUpdateStatus).mockResolvedValue({
      root: "/test/path",
      installKind: "git",
      packageManager: "pnpm",
      git: {
        root: "/test/path",
        sha: "abcdef1234567890",
        tag: "v1.2.3",
        branch: "main",
        upstream: "origin/main",
        dirty: false,
        ahead: 0,
        behind: 0,
        fetchOk: true,
      },
      deps: {
        manager: "pnpm",
        status: "ok",
        lockfilePath: "/test/path/pnpm-lock.yaml",
        markerPath: "/test/path/node_modules",
      },
      registry: {
        latestVersion: "1.2.3",
      },
    });
    vi.mocked(runCommandWithTimeout).mockResolvedValue({
      stdout: "",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
    });
    setTty(false);
    setStdoutTty(false);
  });

  it("exports updateCommand and registerUpdateCli", async () => {
    const { updateCommand, registerUpdateCli, updateWizardCommand } =
      await import("./update-cli.js");
    expect(typeof updateCommand).toBe("function");
    expect(typeof registerUpdateCli).toBe("function");
    expect(typeof updateWizardCommand).toBe("function");
  }, 20_000);

  it("updateCommand runs update and outputs result", async () => {
    const { runGatewayUpdate } = await import("../infra/update-runner.js");
    const { defaultRuntime } = await import("../runtime.js");
    const { updateCommand } = await import("./update-cli.js");

    const mockResult: UpdateRunResult = {
      status: "ok",
      mode: "git",
      root: "/test/path",
      before: { sha: "abc123", version: "1.0.0" },
      after: { sha: "def456", version: "1.0.1" },
      steps: [
        {
          name: "git fetch",
          command: "git fetch",
          cwd: "/test/path",
          durationMs: 100,
          exitCode: 0,
        },
      ],
      durationMs: 500,
    };

    vi.mocked(runGatewayUpdate).mockResolvedValue(mockResult);

    await updateCommand({ json: false });

    expect(runGatewayUpdate).toHaveBeenCalled();
    expect(defaultRuntime.log).toHaveBeenCalled();
  });

  it("updateStatusCommand prints table output", async () => {
    const { defaultRuntime } = await import("../runtime.js");
    const { updateStatusCommand } = await import("./update-cli.js");

    await updateStatusCommand({ json: false });

    const logs = vi.mocked(defaultRuntime.log).mock.calls.map((call) => call[0]);
    expect(logs.join("\n")).toContain("Argent update status");
  });

  it("updateStatusCommand emits JSON", async () => {
    const { defaultRuntime } = await import("../runtime.js");
    const { updateStatusCommand } = await import("./update-cli.js");

    await updateStatusCommand({ json: true });

    const last = vi.mocked(defaultRuntime.log).mock.calls.at(-1)?.[0];
    expect(typeof last).toBe("string");
    const parsed = JSON.parse(String(last));
    expect(parsed.channel.value).toBe("stable");
  });

  it("updateStatusCommand resolves hosted git installs through ARGENT_GIT_DIR", async () => {
    const previousArgentGitDir = process.env.ARGENT_GIT_DIR;
    const previousArgentosGitDir = process.env.ARGENTOS_GIT_DIR;
    try {
      process.env.ARGENT_GIT_DIR = "/hosted/argentos";
      delete process.env.ARGENTOS_GIT_DIR;
      const { checkUpdateStatus } = await import("../infra/update-check.js");
      const { updateStatusCommand } = await import("./update-cli.js");

      await updateStatusCommand({ json: true });

      expect(vi.mocked(checkUpdateStatus).mock.calls.at(-1)?.[0]?.root).toBe("/hosted/argentos");
    } finally {
      if (previousArgentGitDir) {
        process.env.ARGENT_GIT_DIR = previousArgentGitDir;
      } else {
        delete process.env.ARGENT_GIT_DIR;
      }
      if (previousArgentosGitDir) {
        process.env.ARGENTOS_GIT_DIR = previousArgentosGitDir;
      } else {
        delete process.env.ARGENTOS_GIT_DIR;
      }
    }
  });

  it("defaults to stable channel for release-tag git installs when unset", async () => {
    const { runGatewayUpdate } = await import("../infra/update-runner.js");
    const { updateCommand } = await import("./update-cli.js");

    vi.mocked(runGatewayUpdate).mockResolvedValue({
      status: "ok",
      mode: "git",
      steps: [],
      durationMs: 100,
    });

    await updateCommand({});

    const call = vi.mocked(runGatewayUpdate).mock.calls[0]?.[0];
    expect(call?.channel).toBe("stable");
  });

  it("defaults to dev channel for branch-based git installs when unset", async () => {
    const { checkUpdateStatus } = await import("../infra/update-check.js");
    const { runGatewayUpdate } = await import("../infra/update-runner.js");
    const { updateCommand } = await import("./update-cli.js");

    vi.mocked(checkUpdateStatus).mockResolvedValue({
      root: "/test/path",
      installKind: "git",
      packageManager: "pnpm",
      git: {
        root: "/test/path",
        sha: "abcdef1234567890",
        tag: null,
        branch: "main",
        upstream: "origin/main",
        dirty: false,
        ahead: 0,
        behind: 0,
        fetchOk: true,
      },
      deps: {
        manager: "pnpm",
        status: "ok",
        lockfilePath: "/test/path/pnpm-lock.yaml",
        markerPath: "/test/path/node_modules",
      },
      registry: {
        latestVersion: "1.2.3",
      },
    });
    vi.mocked(runGatewayUpdate).mockResolvedValue({
      status: "ok",
      mode: "git",
      steps: [],
      durationMs: 100,
    });

    await updateCommand({});

    const call = vi.mocked(runGatewayUpdate).mock.calls[0]?.[0];
    expect(call?.channel).toBe("dev");
  });

  it("defaults to stable channel for package installs when unset", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-"));
    try {
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "argentos", version: "1.0.0" }),
        "utf-8",
      );

      const { resolveArgentPackageRoot } = await import("../infra/argent-root.js");
      const { runGatewayUpdate } = await import("../infra/update-runner.js");
      const { runCommandWithTimeout } = await import("../process/exec.js");
      const { checkUpdateStatus } = await import("../infra/update-check.js");
      const { updateCommand } = await import("./update-cli.js");

      vi.mocked(resolveArgentPackageRoot).mockResolvedValue(tempDir);
      vi.mocked(checkUpdateStatus).mockResolvedValue({
        root: tempDir,
        installKind: "package",
        packageManager: "npm",
        deps: {
          manager: "npm",
          status: "ok",
          lockfilePath: null,
          markerPath: null,
        },
      });
      vi.mocked(runGatewayUpdate).mockResolvedValue({
        status: "ok",
        mode: "npm",
        steps: [],
        durationMs: 100,
      });

      await updateCommand({ yes: true });

      expect(runGatewayUpdate).not.toHaveBeenCalled();
      const commands = vi
        .mocked(runCommandWithTimeout)
        .mock.calls.map(([argv]) => (Array.isArray(argv) ? argv.join(" ") : String(argv)));
      expect(commands.some((command) => command.includes("argentos@latest"))).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses stored beta channel when configured", async () => {
    const { readConfigFileSnapshot } = await import("../config/config.js");
    const { runGatewayUpdate } = await import("../infra/update-runner.js");
    const { updateCommand } = await import("./update-cli.js");

    vi.mocked(readConfigFileSnapshot).mockResolvedValue({
      ...baseSnapshot,
      config: { update: { channel: "beta" } },
    });
    vi.mocked(runGatewayUpdate).mockResolvedValue({
      status: "ok",
      mode: "git",
      steps: [],
      durationMs: 100,
    });

    await updateCommand({});

    const call = vi.mocked(runGatewayUpdate).mock.calls[0]?.[0];
    expect(call?.channel).toBe("beta");
  });

  it("keeps git installs on the git rail when switching to stable", async () => {
    const { runGatewayUpdate } = await import("../infra/update-runner.js");
    const { updateCommand } = await import("./update-cli.js");

    vi.mocked(runGatewayUpdate).mockResolvedValue({
      status: "ok",
      mode: "git",
      steps: [],
      durationMs: 100,
    });

    await updateCommand({ channel: "stable" });

    const call = vi.mocked(runGatewayUpdate).mock.calls[0]?.[0];
    expect(call?.channel).toBe("stable");
  });

  it("switches package installs to the core git checkout on dev", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-core-"));
    const previousArgentosGitDir = process.env.ARGENTOS_GIT_DIR;
    const previousLegacyGitDir = process.env.ARGENT_GIT_DIR;
    try {
      process.env.ARGENTOS_GIT_DIR = tempDir;
      delete process.env.ARGENT_GIT_DIR;

      const { checkUpdateStatus } = await import("../infra/update-check.js");
      const { runGatewayUpdate } = await import("../infra/update-runner.js");
      const { runCommandWithTimeout } = await import("../process/exec.js");
      const { updateCommand } = await import("./update-cli.js");

      vi.mocked(checkUpdateStatus).mockResolvedValue({
        root: "/test/package",
        installKind: "package",
        packageManager: "npm",
        deps: {
          manager: "npm",
          status: "ok",
          lockfilePath: null,
          markerPath: null,
        },
      });
      vi.mocked(runGatewayUpdate).mockResolvedValue({
        status: "ok",
        mode: "git",
        steps: [],
        durationMs: 100,
      });

      await updateCommand({ channel: "dev", yes: true });

      const cloneCall = vi
        .mocked(runCommandWithTimeout)
        .mock.calls.find(
          ([argv]) => Array.isArray(argv) && argv[0] === "git" && argv[1] === "clone",
        );
      expect(cloneCall?.[0]).toEqual([
        "git",
        "clone",
        "https://github.com/ArgentAIOS/argentos-core.git",
        tempDir,
      ]);
      const updateCall = vi.mocked(runGatewayUpdate).mock.calls[0]?.[0];
      expect(updateCall?.cwd).toBe(tempDir);
      expect(updateCall?.channel).toBe("dev");
    } finally {
      if (previousArgentosGitDir) {
        process.env.ARGENTOS_GIT_DIR = previousArgentosGitDir;
      } else {
        delete process.env.ARGENTOS_GIT_DIR;
      }
      if (previousLegacyGitDir) {
        process.env.ARGENT_GIT_DIR = previousLegacyGitDir;
      } else {
        delete process.env.ARGENT_GIT_DIR;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to latest when beta tag is older than release", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-"));
    try {
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "argentos", version: "1.0.0" }),
        "utf-8",
      );

      const { resolveArgentPackageRoot } = await import("../infra/argent-root.js");
      const { readConfigFileSnapshot } = await import("../config/config.js");
      const { resolveNpmChannelTag } = await import("../infra/update-check.js");
      const { runGatewayUpdate } = await import("../infra/update-runner.js");
      const { runCommandWithTimeout } = await import("../process/exec.js");
      const { updateCommand } = await import("./update-cli.js");
      const { checkUpdateStatus } = await import("../infra/update-check.js");

      vi.mocked(resolveArgentPackageRoot).mockResolvedValue(tempDir);
      vi.mocked(readConfigFileSnapshot).mockResolvedValue({
        ...baseSnapshot,
        config: { update: { channel: "beta" } },
      });
      vi.mocked(checkUpdateStatus).mockResolvedValue({
        root: tempDir,
        installKind: "package",
        packageManager: "npm",
        deps: {
          manager: "npm",
          status: "ok",
          lockfilePath: null,
          markerPath: null,
        },
      });
      vi.mocked(resolveNpmChannelTag).mockResolvedValue({
        tag: "latest",
        version: "1.2.3-1",
      });
      vi.mocked(runGatewayUpdate).mockResolvedValue({
        status: "ok",
        mode: "npm",
        steps: [],
        durationMs: 100,
      });

      await updateCommand({});

      expect(runGatewayUpdate).not.toHaveBeenCalled();
      const commands = vi
        .mocked(runCommandWithTimeout)
        .mock.calls.map(([argv]) => (Array.isArray(argv) ? argv.join(" ") : String(argv)));
      expect(commands.some((command) => command.includes("argentos@latest"))).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("honors --tag override", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-"));
    try {
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "argentos", version: "1.0.0" }),
        "utf-8",
      );

      const { resolveArgentPackageRoot } = await import("../infra/argent-root.js");
      const { runGatewayUpdate } = await import("../infra/update-runner.js");
      const { updateCommand } = await import("./update-cli.js");

      vi.mocked(resolveArgentPackageRoot).mockResolvedValue(tempDir);
      vi.mocked(runGatewayUpdate).mockResolvedValue({
        status: "ok",
        mode: "npm",
        steps: [],
        durationMs: 100,
      });

      await updateCommand({ tag: "next" });

      const call = vi.mocked(runGatewayUpdate).mock.calls[0]?.[0];
      expect(call?.tag).toBe("next");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("updateCommand outputs JSON when --json is set", async () => {
    const { runGatewayUpdate } = await import("../infra/update-runner.js");
    const { defaultRuntime } = await import("../runtime.js");
    const { updateCommand } = await import("./update-cli.js");

    const mockResult: UpdateRunResult = {
      status: "ok",
      mode: "git",
      steps: [],
      durationMs: 100,
    };

    vi.mocked(runGatewayUpdate).mockResolvedValue(mockResult);
    vi.mocked(defaultRuntime.log).mockClear();

    await updateCommand({ json: true });

    const logCalls = vi.mocked(defaultRuntime.log).mock.calls;
    const jsonOutput = logCalls.find((call) => {
      try {
        JSON.parse(call[0] as string);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonOutput).toBeDefined();
  });

  it("updateCommand exits with error on failure", async () => {
    const { runGatewayUpdate } = await import("../infra/update-runner.js");
    const { defaultRuntime } = await import("../runtime.js");
    const { updateCommand } = await import("./update-cli.js");

    const mockResult: UpdateRunResult = {
      status: "error",
      mode: "git",
      reason: "rebase-failed",
      steps: [],
      durationMs: 100,
    };

    vi.mocked(runGatewayUpdate).mockResolvedValue(mockResult);
    vi.mocked(defaultRuntime.exit).mockClear();

    await updateCommand({});

    expect(defaultRuntime.exit).toHaveBeenCalledWith(1);
  });

  it("treats skipped up-to-date as success", async () => {
    const { runGatewayUpdate } = await import("../infra/update-runner.js");
    const { defaultRuntime } = await import("../runtime.js");
    const { updateCommand } = await import("./update-cli.js");

    vi.mocked(runGatewayUpdate).mockResolvedValue({
      status: "skipped",
      reason: "up-to-date",
      mode: "git",
      steps: [],
      durationMs: 50,
    });
    vi.mocked(defaultRuntime.exit).mockClear();

    await updateCommand({});

    expect(defaultRuntime.exit).toHaveBeenCalledWith(0);
    const lines = vi.mocked(defaultRuntime.log).mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes("Already up to date"))).toBe(true);
  });

  it("updateCommand refreshes the daemon service through a fresh CLI process by default", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-root-"));
    try {
      await fs.writeFile(path.join(tempRoot, "argent.mjs"), "#!/usr/bin/env node\n");
      const { spawnSync } = await import("node:child_process");
      const { runGatewayUpdate } = await import("../infra/update-runner.js");
      const { updateCommand } = await import("./update-cli.js");

      vi.mocked(runGatewayUpdate).mockResolvedValue({
        status: "ok",
        mode: "git",
        root: tempRoot,
        steps: [],
        durationMs: 100,
      });
      vi.mocked(spawnSync).mockClear();

      await updateCommand({});

      expect(vi.mocked(spawnSync)).toHaveBeenCalledWith(
        expect.any(String),
        [path.join(tempRoot, "argent.mjs"), "daemon", "install", "--force"],
        expect.objectContaining({
          cwd: tempRoot,
          stdio: "inherit",
        }),
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("updateCommand restarts macOS dashboard services after daemon restart", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-home-"));
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-root-"));
    const originalPlatform = process.platform;
    let homedirSpy: ReturnType<typeof vi.spyOn> | null = null;
    try {
      await fs.writeFile(path.join(tempRoot, "argent.mjs"), "#!/usr/bin/env node\n");
      const launchAgents = path.join(tempHome, "Library", "LaunchAgents");
      await fs.mkdir(launchAgents, { recursive: true });
      await fs.writeFile(path.join(launchAgents, "ai.argent.dashboard-api.plist"), "");
      await fs.writeFile(path.join(launchAgents, "ai.argent.dashboard-ui.plist"), "");
      homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tempHome);
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });

      const { spawnSync } = await import("node:child_process");
      const { runGatewayUpdate } = await import("../infra/update-runner.js");
      const { updateCommand } = await import("./update-cli.js");

      vi.mocked(runGatewayUpdate).mockResolvedValue({
        status: "ok",
        mode: "git",
        root: tempRoot,
        steps: [],
        durationMs: 100,
      });
      vi.mocked(spawnSync).mockClear();

      await updateCommand({});

      const calls = vi.mocked(spawnSync).mock.calls.map(([cmd, args]) => ({
        cmd,
        args: Array.isArray(args) ? args.join(" ") : "",
      }));
      expect(calls).toContainEqual(
        expect.objectContaining({
          cmd: "/bin/launchctl",
          args: expect.stringContaining("kickstart -k"),
        }),
      );
      expect(calls.some((call) => call.args.includes("ai.argent.dashboard-api"))).toBe(true);
      expect(calls.some((call) => call.args.includes("ai.argent.dashboard-ui"))).toBe(true);
    } finally {
      homedirSpy?.mockRestore();
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      await fs.rm(tempHome, { recursive: true, force: true });
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("updateCommand runs post-update doctor from a fresh CLI process", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-root-"));
    try {
      await fs.writeFile(path.join(tempRoot, "argent.mjs"), "#!/usr/bin/env node\n");

      const { spawnSync } = await import("node:child_process");
      const { runGatewayUpdate } = await import("../infra/update-runner.js");
      const { updateCommand } = await import("./update-cli.js");

      vi.mocked(runGatewayUpdate).mockResolvedValue({
        status: "ok",
        mode: "git",
        root: tempRoot,
        steps: [],
        durationMs: 100,
      });
      vi.mocked(spawnSync).mockClear();

      await updateCommand({ yes: true });

      expect(vi.mocked(spawnSync)).toHaveBeenCalledWith(
        expect.any(String),
        [path.join(tempRoot, "argent.mjs"), "doctor", "--non-interactive", "--repair"],
        expect.objectContaining({
          cwd: tempRoot,
          stdio: "inherit",
          env: expect.objectContaining({ ARGENT_UPDATE_IN_PROGRESS: "1" }),
        }),
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("updateCommand skips restart when --no-restart is set", async () => {
    const { runGatewayUpdate } = await import("../infra/update-runner.js");
    const { spawnSync } = await import("node:child_process");
    const { updateCommand } = await import("./update-cli.js");

    const mockResult: UpdateRunResult = {
      status: "ok",
      mode: "git",
      steps: [],
      durationMs: 100,
    };

    vi.mocked(runGatewayUpdate).mockResolvedValue(mockResult);
    vi.mocked(spawnSync).mockClear();

    await updateCommand({ restart: false });

    const calls = vi
      .mocked(spawnSync)
      .mock.calls.map(([, args]) => (Array.isArray(args) ? args.join(" ") : ""));
    expect(calls.some((args) => args.includes("daemon install --force"))).toBe(false);
  });

  it("updateCommand skips success message when restart does not run", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-no-cli-"));
    const { runGatewayUpdate } = await import("../infra/update-runner.js");
    const { defaultRuntime } = await import("../runtime.js");
    const { updateCommand } = await import("./update-cli.js");

    try {
      const mockResult: UpdateRunResult = {
        status: "ok",
        mode: "git",
        root: tempRoot,
        steps: [],
        durationMs: 100,
      };

      vi.mocked(runGatewayUpdate).mockResolvedValue(mockResult);
      vi.mocked(defaultRuntime.log).mockClear();

      await updateCommand({ restart: true });

      const logLines = vi.mocked(defaultRuntime.log).mock.calls.map((call) => String(call[0]));
      expect(logLines.some((line) => line.includes("Daemon restarted successfully."))).toBe(false);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("updateCommand validates timeout option", async () => {
    const { defaultRuntime } = await import("../runtime.js");
    const { updateCommand } = await import("./update-cli.js");

    vi.mocked(defaultRuntime.error).mockClear();
    vi.mocked(defaultRuntime.exit).mockClear();

    await updateCommand({ timeout: "invalid" });

    expect(defaultRuntime.error).toHaveBeenCalledWith(expect.stringContaining("timeout"));
    expect(defaultRuntime.exit).toHaveBeenCalledWith(1);
  });

  it("persists update channel when --channel is set", async () => {
    const { writeConfigFile } = await import("../config/config.js");
    const { runGatewayUpdate } = await import("../infra/update-runner.js");
    const { updateCommand } = await import("./update-cli.js");

    const mockResult: UpdateRunResult = {
      status: "ok",
      mode: "git",
      steps: [],
      durationMs: 100,
    };

    vi.mocked(runGatewayUpdate).mockResolvedValue(mockResult);

    await updateCommand({ channel: "beta" });

    expect(writeConfigFile).toHaveBeenCalled();
    const call = vi.mocked(writeConfigFile).mock.calls[0]?.[0] as {
      update?: { channel?: string };
    };
    expect(call?.update?.channel).toBe("beta");
  });

  it("requires confirmation on downgrade when non-interactive", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-"));
    try {
      setTty(false);
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "argentos", version: "2.0.0" }),
        "utf-8",
      );

      const { resolveArgentPackageRoot } = await import("../infra/argent-root.js");
      const { resolveNpmChannelTag } = await import("../infra/update-check.js");
      const { runGatewayUpdate } = await import("../infra/update-runner.js");
      const { runCommandWithTimeout } = await import("../process/exec.js");
      const { defaultRuntime } = await import("../runtime.js");
      const { updateCommand } = await import("./update-cli.js");
      const { checkUpdateStatus } = await import("../infra/update-check.js");

      vi.mocked(resolveArgentPackageRoot).mockResolvedValue(tempDir);
      vi.mocked(checkUpdateStatus).mockResolvedValue({
        root: tempDir,
        installKind: "package",
        packageManager: "npm",
        deps: {
          manager: "npm",
          status: "ok",
          lockfilePath: null,
          markerPath: null,
        },
      });
      vi.mocked(resolveNpmChannelTag).mockResolvedValue({
        tag: "latest",
        version: "0.0.1",
      });
      vi.mocked(runGatewayUpdate).mockResolvedValue({
        status: "ok",
        mode: "npm",
        steps: [],
        durationMs: 100,
      });
      vi.mocked(defaultRuntime.error).mockClear();
      vi.mocked(defaultRuntime.exit).mockClear();

      await updateCommand({});

      expect(defaultRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("Downgrade confirmation required."),
      );
      expect(defaultRuntime.exit).toHaveBeenCalledWith(1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("allows downgrade with --yes in non-interactive mode", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-"));
    try {
      setTty(false);
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "argentos", version: "2.0.0" }),
        "utf-8",
      );

      const { resolveArgentPackageRoot } = await import("../infra/argent-root.js");
      const { resolveNpmChannelTag } = await import("../infra/update-check.js");
      const { runGatewayUpdate } = await import("../infra/update-runner.js");
      const { runCommandWithTimeout } = await import("../process/exec.js");
      const { defaultRuntime } = await import("../runtime.js");
      const { updateCommand } = await import("./update-cli.js");
      const { checkUpdateStatus } = await import("../infra/update-check.js");

      vi.mocked(resolveArgentPackageRoot).mockResolvedValue(tempDir);
      vi.mocked(checkUpdateStatus).mockResolvedValue({
        root: tempDir,
        installKind: "package",
        packageManager: "npm",
        deps: {
          manager: "npm",
          status: "ok",
          lockfilePath: null,
          markerPath: null,
        },
      });
      vi.mocked(resolveNpmChannelTag).mockResolvedValue({
        tag: "latest",
        version: "0.0.1",
      });
      vi.mocked(runGatewayUpdate).mockResolvedValue({
        status: "ok",
        mode: "npm",
        steps: [],
        durationMs: 100,
      });
      vi.mocked(defaultRuntime.error).mockClear();
      vi.mocked(defaultRuntime.exit).mockClear();

      await updateCommand({ yes: true });

      expect(defaultRuntime.error).not.toHaveBeenCalledWith(
        expect.stringContaining("Downgrade confirmation required."),
      );
      expect(runGatewayUpdate).not.toHaveBeenCalled();
      expect(vi.mocked(runCommandWithTimeout).mock.calls.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("updateWizardCommand requires a TTY", async () => {
    const { defaultRuntime } = await import("../runtime.js");
    const { updateWizardCommand } = await import("./update-cli.js");

    setTty(false);
    vi.mocked(defaultRuntime.error).mockClear();
    vi.mocked(defaultRuntime.exit).mockClear();

    await updateWizardCommand({});

    expect(defaultRuntime.error).toHaveBeenCalledWith(
      expect.stringContaining("Update wizard requires a TTY"),
    );
    expect(defaultRuntime.exit).toHaveBeenCalledWith(1);
  });

  it("updateWizardCommand offers dev checkout and forwards selections", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-wizard-"));
    const previousArgentosGitDir = process.env.ARGENTOS_GIT_DIR;
    const previousLegacyGitDir = process.env.ARGENT_GIT_DIR;
    try {
      setTty(true);
      process.env.ARGENTOS_GIT_DIR = tempDir;
      delete process.env.ARGENT_GIT_DIR;

      const { checkUpdateStatus } = await import("../infra/update-check.js");
      const { runGatewayUpdate } = await import("../infra/update-runner.js");
      const { updateWizardCommand } = await import("./update-cli.js");

      vi.mocked(checkUpdateStatus).mockResolvedValue({
        root: "/test/path",
        installKind: "package",
        packageManager: "npm",
        deps: {
          manager: "npm",
          status: "ok",
          lockfilePath: null,
          markerPath: null,
        },
      });
      select.mockResolvedValue("dev");
      confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      vi.mocked(runGatewayUpdate).mockResolvedValue({
        status: "ok",
        mode: "git",
        steps: [],
        durationMs: 100,
      });

      await updateWizardCommand({});

      const call = vi.mocked(runGatewayUpdate).mock.calls[0]?.[0];
      expect(call?.channel).toBe("dev");
    } finally {
      if (previousArgentosGitDir) {
        process.env.ARGENTOS_GIT_DIR = previousArgentosGitDir;
      } else {
        delete process.env.ARGENTOS_GIT_DIR;
      }
      if (previousLegacyGitDir) {
        process.env.ARGENT_GIT_DIR = previousLegacyGitDir;
      } else {
        delete process.env.ARGENT_GIT_DIR;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
