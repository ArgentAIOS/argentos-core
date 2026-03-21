import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => {
  const spawn = vi.fn((_cmd: string, _args: string[]) => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
      emit: (event: string, code: number) => boolean;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => {
      child.emit("close", 0);
    };
    setImmediate(() => {
      stdout.emit("data", "");
      stderr.emit("data", "");
      child.emit("close", 0);
    });
    return child;
  });
  return { spawn };
});

import { spawn as mockedSpawn } from "node:child_process";
import type { ArgentConfig } from "../config/config.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import { QmdMemoryManager } from "./qmd-manager.js";

const spawnMock = mockedSpawn as unknown as vi.Mock;

describe("QmdMemoryManager", () => {
  let tmpRoot: string;
  let workspaceDir: string;
  let stateDir: string;
  let cfg: ArgentConfig;
  const agentId = "main";

  beforeEach(async () => {
    spawnMock.mockClear();
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qmd-manager-test-"));
    workspaceDir = path.join(tmpRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    stateDir = path.join(tmpRoot, "state");
    await fs.mkdir(stateDir, { recursive: true });
    process.env.ARGENT_STATE_DIR = stateDir;
    cfg = {
      agents: {
        list: [{ id: agentId, default: true, workspace: workspaceDir }],
      },
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: false,
          update: { interval: "0s", debounceMs: 60_000, onBoot: false },
          paths: [{ path: workspaceDir, pattern: "**/*.md", name: "workspace" }],
        },
      },
    } as ArgentConfig;
  });

  afterEach(async () => {
    delete process.env.ARGENT_STATE_DIR;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("debounces back-to-back sync calls", async () => {
    const resolved = resolveMemoryBackendConfig({ cfg, agentId });
    const manager = await QmdMemoryManager.create({ cfg, agentId, resolved });
    expect(manager).toBeTruthy();
    if (!manager) {
      throw new Error("manager missing");
    }

    const baselineCalls = spawnMock.mock.calls.length;

    await manager.sync({ reason: "manual" });
    expect(spawnMock.mock.calls.length).toBe(baselineCalls + 2);

    await manager.sync({ reason: "manual-again" });
    expect(spawnMock.mock.calls.length).toBe(baselineCalls + 2);

    (manager as unknown as { lastUpdateAt: number | null }).lastUpdateAt =
      Date.now() - (resolved.qmd?.update.debounceMs ?? 0) - 10;

    await manager.sync({ reason: "after-wait" });
    // By default we refresh embeddings less frequently than index updates.
    expect(spawnMock.mock.calls.length).toBe(baselineCalls + 3);

    await manager.close();
  });

  it("scopes by channel for agent-prefixed session keys", async () => {
    cfg = {
      ...cfg,
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: false,
          update: { interval: "0s", debounceMs: 60_000, onBoot: false },
          paths: [{ path: workspaceDir, pattern: "**/*.md", name: "workspace" }],
          scope: {
            default: "deny",
            rules: [{ action: "allow", match: { channel: "slack" } }],
          },
        },
      },
    } as ArgentConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId });
    const manager = await QmdMemoryManager.create({ cfg, agentId, resolved });
    expect(manager).toBeTruthy();
    if (!manager) {
      throw new Error("manager missing");
    }

    const isAllowed = (key?: string) =>
      (manager as unknown as { isScopeAllowed: (key?: string) => boolean }).isScopeAllowed(key);
    expect(isAllowed("agent:main:slack:channel:c123")).toBe(true);
    expect(isAllowed("agent:main:discord:channel:c123")).toBe(false);

    await manager.close();
  });

  it("blocks non-markdown or symlink reads for qmd paths", async () => {
    const resolved = resolveMemoryBackendConfig({ cfg, agentId });
    const manager = await QmdMemoryManager.create({ cfg, agentId, resolved });
    expect(manager).toBeTruthy();
    if (!manager) {
      throw new Error("manager missing");
    }

    const textPath = path.join(workspaceDir, "secret.txt");
    await fs.writeFile(textPath, "nope", "utf-8");
    await expect(manager.readFile({ relPath: "qmd/workspace/secret.txt" })).rejects.toThrow(
      "path required",
    );

    const target = path.join(workspaceDir, "target.md");
    await fs.writeFile(target, "ok", "utf-8");
    const link = path.join(workspaceDir, "link.md");
    await fs.symlink(target, link);
    await expect(manager.readFile({ relPath: "qmd/workspace/link.md" })).rejects.toThrow(
      "path required",
    );

    await manager.close();
  });

  it("parses noisy qmd query output and returns search results", async () => {
    const memoryPath = path.join(workspaceDir, "MEMORY.md");
    await fs.writeFile(memoryPath, "line one\nline two\n", "utf-8");

    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const child = new EventEmitter() as {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
        emit: (event: string, code: number) => boolean;
      };
      child.stdout = stdout;
      child.stderr = stderr;
      child.kill = () => child.emit("close", 0);
      setImmediate(() => {
        if (args[0] === "query") {
          stdout.emit(
            "data",
            `booting\n[{\"docid\":\"abc\",\"collection\":\"workspace\",\"file\":\"MEMORY.md\",\"score\":0.8,\"snippet\":\"@@ -1,1\\nline one\"}]\nready`,
          );
        } else {
          stdout.emit("data", "");
        }
        child.emit("close", 0);
      });
      return child;
    });

    const resolved = resolveMemoryBackendConfig({ cfg, agentId });
    const manager = await QmdMemoryManager.create({ cfg, agentId, resolved });
    expect(manager).toBeTruthy();
    if (!manager) {
      throw new Error("manager missing");
    }
    (
      manager as unknown as {
        docPathCache: Map<string, { rel: string; abs: string; source: "memory" | "sessions" }>;
      }
    ).docPathCache.set("workspace:abc", {
      rel: "MEMORY.md",
      abs: memoryPath,
      source: "memory",
    });

    const results = await manager.search("line", { sessionKey: "agent:main:webchat:dm:123" });
    expect(results.length).toBe(1);
    expect(results[0]?.path).toBe("MEMORY.md");
    expect(results[0]?.source).toBe("memory");

    await manager.close();
  });
});
