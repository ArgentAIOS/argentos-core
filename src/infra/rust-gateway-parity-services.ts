import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  RustGatewayParityServiceHandle,
  RustGatewayParityServiceStarter,
} from "./rust-gateway-parity-isolated.js";
import { getDeterministicFreePortBlock } from "../test-utils/ports.js";

export type RustGatewayParityServiceKind = "node" | "rust";

export type RustGatewayParityProcessCommand = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  url: string;
  readinessPattern: RegExp;
  redactedSummary: string;
};

export type RustGatewayParityProcessStarterOptions = {
  repoRoot?: string;
  port?: number;
  token?: string;
  timeoutMs?: number;
  spawnProcess?: SpawnProcess;
  makeTempDir?: (prefix: string) => Promise<string>;
  removeDir?: (dir: string) => Promise<void>;
};

export type RustGatewayParityServiceStartersOptions = Omit<
  RustGatewayParityProcessStarterOptions,
  "port"
> & {
  nodePort?: number;
  rustPort?: number;
};

export type RustGatewayParityServiceStarters = {
  token: string;
  nodePort: number;
  rustPort: number;
  startNodeGateway: RustGatewayParityServiceStarter;
  startRustGateway: RustGatewayParityServiceStarter;
};

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

type WaitForProcessReadyOptions = {
  child: ChildProcessWithoutNullStreams;
  readinessPattern: RegExp;
  timeoutMs: number;
  summary: string;
};

const DEFAULT_TOKEN = "rust-gateway-parity-token";
const DEFAULT_TIMEOUT_MS = 20_000;

export async function createRustGatewayParityServiceStarters(
  options: RustGatewayParityServiceStartersOptions = {},
): Promise<RustGatewayParityServiceStarters> {
  const basePort =
    options.nodePort && options.rustPort
      ? options.nodePort
      : await getDeterministicFreePortBlock({ offsets: [0, 1] });
  const nodePort = options.nodePort ?? basePort;
  const rustPort = options.rustPort ?? (nodePort === basePort ? basePort + 1 : basePort);
  const token = options.token ?? DEFAULT_TOKEN;

  return {
    token,
    nodePort,
    rustPort,
    startNodeGateway: () =>
      startRustGatewayParityNodeGateway({
        ...options,
        port: nodePort,
        token,
      }),
    startRustGateway: () =>
      startRustGatewayParityRustGateway({
        ...options,
        port: rustPort,
        token,
      }),
  };
}

export function buildRustGatewayParityNodeCommand(
  options: Required<Pick<RustGatewayParityProcessStarterOptions, "repoRoot" | "port" | "token">>,
): RustGatewayParityProcessCommand {
  return {
    command: process.execPath,
    args: [
      "scripts/run-node.mjs",
      "gateway",
      "--port",
      String(options.port),
      "--bind",
      "loopback",
      "--allow-unconfigured",
      "--auth",
      "token",
      "--token",
      options.token,
      "--ws-log",
      "compact",
    ],
    cwd: options.repoRoot,
    env: {
      ARGENT_SKIP_CHANNELS: "1",
      ARGENT_RUNNER_LOG: "0",
      ARGENT_GATEWAY_TOKEN: options.token,
    },
    url: `ws://127.0.0.1:${options.port}`,
    readinessPattern: /listening on ws:\/\/(?:127\.0\.0\.1|localhost):\d+/i,
    redactedSummary: `node scripts/run-node.mjs gateway --port ${options.port} --bind loopback --allow-unconfigured --auth token --token <redacted> --ws-log compact`,
  };
}

export function buildRustGatewayParityRustCommand(
  options: Required<Pick<RustGatewayParityProcessStarterOptions, "repoRoot" | "port" | "token">>,
): RustGatewayParityProcessCommand {
  return {
    command: "cargo",
    args: ["run", "--manifest-path", "rust/Cargo.toml", "-p", "argentd", "--quiet"],
    cwd: options.repoRoot,
    env: {
      ARGENTD_BIND: `127.0.0.1:${options.port}`,
      ARGENTD_AUTH_TOKEN: options.token,
    },
    url: `ws://127.0.0.1:${options.port}`,
    readinessPattern: /argentd shadow gateway listening on http:\/\/127\.0\.0\.1:\d+/i,
    redactedSummary: `ARGENTD_BIND=127.0.0.1:${options.port} ARGENTD_AUTH_TOKEN=<redacted> cargo run --manifest-path rust/Cargo.toml -p argentd --quiet`,
  };
}

export async function startRustGatewayParityNodeGateway(
  options: RustGatewayParityProcessStarterOptions = {},
): Promise<RustGatewayParityServiceHandle> {
  return await startRustGatewayParityProcess("node", options);
}

export async function startRustGatewayParityRustGateway(
  options: RustGatewayParityProcessStarterOptions = {},
): Promise<RustGatewayParityServiceHandle> {
  return await startRustGatewayParityProcess("rust", options);
}

async function startRustGatewayParityProcess(
  kind: RustGatewayParityServiceKind,
  options: RustGatewayParityProcessStarterOptions,
): Promise<RustGatewayParityServiceHandle> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const port = options.port ?? (await getDeterministicFreePortBlock());
  const token = options.token ?? DEFAULT_TOKEN;
  const command =
    kind === "node"
      ? buildRustGatewayParityNodeCommand({ repoRoot, port, token })
      : buildRustGatewayParityRustCommand({ repoRoot, port, token });
  const makeTempDir = options.makeTempDir ?? defaultMakeTempDir;
  const removeDir = options.removeDir ?? defaultRemoveDir;
  const tempHome = kind === "node" ? await makeTempDir(`argent-${kind}-parity-`) : null;
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
  const child = spawnProcess(command.command, command.args, {
    cwd: command.cwd,
    env: {
      ...process.env,
      ...command.env,
      ...(tempHome ? isolatedHomeEnv(tempHome) : {}),
    },
    stdio: "pipe",
  });

  try {
    await waitForProcessReady({
      child,
      readinessPattern: command.readinessPattern,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      summary: command.redactedSummary,
    });
  } catch (error) {
    await stopChildProcess(child);
    if (tempHome) {
      await removeDir(tempHome);
    }
    throw error;
  }

  return {
    url: command.url,
    stop: async () => {
      await stopChildProcess(child);
      if (tempHome) {
        await removeDir(tempHome);
      }
    },
  };
}

async function waitForProcessReady(options: WaitForProcessReadyOptions): Promise<void> {
  const output: string[] = [];
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.child.stdout.off("data", onData);
      options.child.stderr.off("data", onData);
      options.child.off("exit", onExit);
      options.child.off("error", onError);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output.push(text);
      if (options.readinessPattern.test(text) || options.readinessPattern.test(output.join(""))) {
        finish();
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(
        new Error(
          `parity service exited before ready (${options.summary}, code=${code ?? "null"}, signal=${signal ?? "null"}): ${output.join("").trim()}`,
        ),
      );
    };
    const onError = (error: Error) => finish(error);
    const timer = setTimeout(() => {
      finish(
        new Error(
          `timed out waiting for parity service readiness (${options.summary}): ${output.join("").trim()}`,
        ),
      );
    }, options.timeoutMs);

    options.child.stdout.on("data", onData);
    options.child.stderr.on("data", onData);
    options.child.once("exit", onExit);
    options.child.once("error", onError);
  });
}

async function stopChildProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function isolatedHomeEnv(home: string): Record<string, string> {
  return {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
  };
}

async function defaultMakeTempDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function defaultRemoveDir(dir: string): Promise<void> {
  await fs.rm(dir, { force: true, recursive: true });
}

function defaultSpawnProcess(
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcessWithoutNullStreams {
  return spawn(command, args, options) as ChildProcessWithoutNullStreams;
}
