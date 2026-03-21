import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn(),
      close: vi.fn(async () => undefined),
    })),
  },
}));

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () => ({
    requestedProvider: "openai",
    provider: {
      id: "openai",
      model: "text-embedding-3-small",
      embedQuery: async () => [0.1, 0.2, 0.3],
      embedBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]),
    },
  }),
}));

describe("memory manager close safety", () => {
  let workspaceDir: string;
  let indexPath: string;
  let manager: MemoryIndexManager | null = null;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-mem-close-"));
    indexPath = path.join(workspaceDir, "index.sqlite");
    await fs.mkdir(path.join(workspaceDir, "memory"));
    await fs.writeFile(path.join(workspaceDir, "memory", "test.md"), "hello\n");
  });

  afterEach(async () => {
    if (manager) {
      await manager.close();
      manager = null;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("waits for pending sync before resolving close", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "text-embedding-3-small",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    manager = result.manager;

    let releaseSync: (() => void) | undefined;
    const pendingSync = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    (manager as unknown as { syncing: Promise<void> | null }).syncing = pendingSync;

    let resolved = false;
    const closePromise = manager.close().then(() => {
      resolved = true;
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(resolved).toBe(false);

    releaseSync?.();
    await closePromise;
    expect(resolved).toBe(true);
    manager = null;
  });

  it("ignores sync calls after close", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "text-embedding-3-small",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    manager = result.manager;

    await manager.close();
    await expect(manager.sync({ reason: "manual" })).resolves.toBeUndefined();
    manager = null;
  });
});
