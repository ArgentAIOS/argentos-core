import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  buildRustGatewayParityNodeCommand,
  buildRustGatewayParityRustCommand,
  createRustGatewayParityServiceStarters,
  startRustGatewayParityNodeGateway,
  startRustGatewayParityRustGateway,
  type SpawnProcess,
} from "./rust-gateway-parity-services.js";

class FakeProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killedSignal: NodeJS.Signals | null = null;

  kill(signal?: NodeJS.Signals): boolean {
    this.killedSignal = signal ?? "SIGTERM";
    queueMicrotask(() => {
      this.signalCode = this.killedSignal;
      this.emit("exit", null, this.killedSignal);
    });
    return true;
  }
}

describe("rust gateway parity service command builders", () => {
  it("builds an isolated Node gateway command without exposing the token in its summary", () => {
    const command = buildRustGatewayParityNodeCommand({
      repoRoot: "/repo",
      port: 19100,
      token: "secret-token",
    });

    expect(command.command).toBe(process.execPath);
    expect(command.args).toContain("scripts/run-node.mjs");
    expect(command.args).toContain("gateway");
    expect(command.args).toContain("--allow-unconfigured");
    expect(command.args).toContain("secret-token");
    expect(command.env.ARGENT_SKIP_CHANNELS).toBe("1");
    expect(command.url).toBe("ws://127.0.0.1:19100");
    expect(command.redactedSummary).not.toContain("secret-token");
  });

  it("builds an argentd command for a loopback shadow gateway", () => {
    const command = buildRustGatewayParityRustCommand({
      repoRoot: "/repo",
      port: 19101,
      token: "secret-token",
    });

    expect(command.command).toBe("cargo");
    expect(command.args).toEqual([
      "run",
      "--manifest-path",
      "rust/Cargo.toml",
      "-p",
      "argentd",
      "--quiet",
    ]);
    expect(command.env.ARGENTD_BIND).toBe("127.0.0.1:19101");
    expect(command.env.ARGENTD_AUTH_TOKEN).toBe("secret-token");
    expect(command.url).toBe("ws://127.0.0.1:19101");
    expect(command.redactedSummary).not.toContain("secret-token");
  });
});

describe("rust gateway parity service starters", () => {
  it("starts a process, waits for readiness output, and cleans up on stop", async () => {
    const child = new FakeProcess();
    const removed: string[] = [];
    const spawnProcess: SpawnProcess = (_command, _args, options) => {
      expect(options.env).toMatchObject({
        ARGENT_GATEWAY_TOKEN: "test-token",
        HOME: "/tmp/parity-home",
        XDG_CONFIG_HOME: "/tmp/parity-home/.config",
      });
      queueMicrotask(() => child.stdout.write("gateway: listening on ws://127.0.0.1:19100\n"));
      return child as never;
    };

    const handle = await startRustGatewayParityNodeGateway({
      repoRoot: "/repo",
      port: 19100,
      token: "test-token",
      spawnProcess,
      makeTempDir: async () => "/tmp/parity-home",
      removeDir: async (dir) => {
        removed.push(dir);
      },
    });

    expect(handle.url).toBe("ws://127.0.0.1:19100");
    await handle.stop();
    expect(child.killedSignal).toBe("SIGTERM");
    expect(removed).toEqual(["/tmp/parity-home"]);
  });

  it("stops and removes the temp home when readiness fails", async () => {
    const child = new FakeProcess();
    const removed: string[] = [];
    const spawnProcess: SpawnProcess = () => {
      queueMicrotask(() => {
        child.stderr.write("boom\n");
        child.exitCode = 1;
        child.emit("exit", 1, null);
      });
      return child as never;
    };

    await expect(
      startRustGatewayParityNodeGateway({
        repoRoot: "/repo",
        port: 19100,
        timeoutMs: 100,
        spawnProcess,
        makeTempDir: async () => "/tmp/parity-home",
        removeDir: async (dir) => {
          removed.push(dir);
        },
      }),
    ).rejects.toThrow("exited before ready");
    expect(removed).toEqual(["/tmp/parity-home"]);
  });

  it("does not override HOME for rustup-backed argentd startup", async () => {
    const child = new FakeProcess();
    const removed: string[] = [];
    const spawnProcess: SpawnProcess = (_command, _args, options) => {
      expect(options.env).toMatchObject({
        ARGENTD_BIND: "127.0.0.1:19101",
        ARGENTD_AUTH_TOKEN: "test-token",
      });
      expect((options.env as Record<string, string>).HOME).toBe(process.env.HOME);
      queueMicrotask(() =>
        child.stdout.write(
          "argentd shadow gateway listening on http://127.0.0.1:19101 (health=/health)\n",
        ),
      );
      return child as never;
    };

    const handle = await startRustGatewayParityRustGateway({
      repoRoot: "/repo",
      port: 19101,
      token: "test-token",
      spawnProcess,
      makeTempDir: async () => "/tmp/parity-home",
      removeDir: async (dir) => {
        removed.push(dir);
      },
    });

    expect(handle.url).toBe("ws://127.0.0.1:19101");
    await handle.stop();
    expect(removed).toEqual([]);
  });

  it("allocates paired service starters with a shared token", async () => {
    const starters = await createRustGatewayParityServiceStarters({
      nodePort: 19110,
      rustPort: 19111,
      token: "shared-token",
    });

    expect(starters.token).toBe("shared-token");
    expect(starters.nodePort).toBe(19110);
    expect(starters.rustPort).toBe(19111);
    expect(starters.startNodeGateway).toEqual(expect.any(Function));
    expect(starters.startRustGateway).toEqual(expect.any(Function));
  });
});
