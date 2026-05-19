import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import { knowledgeHandlers } from "./knowledge.js";

const loadConfigMock = vi.fn();
const getMemuEmbedderMock = vi.fn();
const ensureKnowledgeCollectionAccessMock = vi.fn();
const getStorageAdapterMock = vi.fn(async () => ({ isReady: () => true }));
const getPgMemoryAdapterMock = vi.fn();

const createResourceMock = vi.fn();
const createItemMock = vi.fn();
const updateItemEmbeddingMock = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveSessionAgentIds: vi.fn(() => ({
    sessionAgentId: "argent",
    activeTargetId: "argent",
  })),
}));

vi.mock("../../data/storage-factory.js", () => ({
  getStorageAdapter: (...args: unknown[]) => getStorageAdapterMock(...args),
  getPgMemoryAdapter: (...args: unknown[]) => getPgMemoryAdapterMock(...args),
}));

vi.mock("../../memory/memu-embed.js", () => ({
  getMemuEmbedder: (...args: unknown[]) => getMemuEmbedderMock(...args),
}));

vi.mock("../../data/knowledge-acl.js", () => ({
  ensureKnowledgeCollectionAccess: (...args: unknown[]) =>
    ensureKnowledgeCollectionAccessMock(...args),
  getKnowledgeAclSnapshot: vi.fn(async () => ({
    aclEnforced: false,
    readableTags: new Set<string>(),
    writableTags: new Set<string>(),
    collections: [],
  })),
  hasKnowledgeCollectionReadAccess: vi.fn(() => true),
  knowledgeCollectionTag: vi.fn((collection: string, fallback: string) => {
    const normalized = String(collection ?? "").trim();
    return normalized || fallback || "default";
  }),
  listKnowledgeCollections: vi.fn(async () => ({
    aclEnforced: false,
    collections: [],
  })),
  normalizeKnowledgeCollection: vi.fn((value: string, fallback = "default") => {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }),
  setKnowledgeCollectionGrant: vi.fn(async () => ({
    access: {
      collection: "default",
      collectionTag: "default",
    },
    grant: {
      canRead: true,
      canWrite: true,
      isOwner: false,
      grantedBy: "test",
      updatedAt: new Date().toISOString(),
    },
  })),
}));

describe("knowledge.vault.ingest", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    createResourceMock.mockResolvedValue({ id: "res-1" });
    createItemMock.mockResolvedValue({ id: "item-1" });
    updateItemEmbeddingMock.mockResolvedValue(undefined);
    ensureKnowledgeCollectionAccessMock.mockResolvedValue({
      aclEnforced: false,
      canWrite: true,
    });
    getMemuEmbedderMock.mockResolvedValue({
      providerId: "mock",
      model: "mock-embed",
      embed: async () => new Array(768).fill(0.01),
      embedBatch: async () => [],
    });
    getPgMemoryAdapterMock.mockReturnValue({
      withAgentId: () => ({
        createResource: createResourceMock,
        createItem: createItemMock,
        updateItemEmbedding: updateItemEmbeddingMock,
      }),
    });
  });

  afterEach(async () => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function createVault(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vault-ingest-"));
    tempDirs.push(root);
    return root;
  }

  it("returns INVALID_REQUEST when vault ingest feature is disabled", async () => {
    loadConfigMock.mockReturnValue({
      memory: {
        vault: {
          enabled: false,
          ingest: { enabled: false },
        },
      },
    });
    const respond = vi.fn();
    const handler = knowledgeHandlers["knowledge.vault.ingest"];
    if (!handler) throw new Error("knowledge.vault.ingest handler missing");

    await handler({ params: {}, respond } as never);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST }),
    );
    expect(createItemMock).not.toHaveBeenCalled();
  });

  it("returns dry-run file list when feature is enabled", async () => {
    const vaultRoot = await createVault();
    await fs.mkdir(path.join(vaultRoot, "notes"), { recursive: true });
    await fs.mkdir(path.join(vaultRoot, "private"), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, "alpha.md"), "# Alpha\n");
    await fs.writeFile(path.join(vaultRoot, "notes", "beta.md"), "# Beta\n");
    await fs.writeFile(path.join(vaultRoot, "private", "secret.md"), "# Secret\n");
    await fs.writeFile(path.join(vaultRoot, "ignore.txt"), "plain");

    loadConfigMock.mockReturnValue({
      memory: {
        vault: {
          enabled: true,
          path: vaultRoot,
          knowledgeCollection: "vault-knowledge",
          ingest: {
            enabled: true,
            excludePaths: ["private"],
          },
        },
      },
    });

    const respond = vi.fn();
    const handler = knowledgeHandlers["knowledge.vault.ingest"];
    if (!handler) throw new Error("knowledge.vault.ingest handler missing");

    await handler({
      params: {
        options: {
          dryRun: true,
          limitFiles: 50,
        },
      },
      respond,
    } as never);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        success: true,
        dryRun: true,
        count: 2,
      }),
      undefined,
    );
    expect(createItemMock).not.toHaveBeenCalled();
  });

  it("ingests markdown files with source=vault metadata when enabled", async () => {
    const vaultRoot = await createVault();
    await fs.writeFile(path.join(vaultRoot, "alpha.md"), "# Alpha\nSome note text");

    loadConfigMock.mockReturnValue({
      memory: {
        vault: {
          enabled: true,
          path: vaultRoot,
          knowledgeCollection: "vault-knowledge",
          ingest: {
            enabled: true,
            excludePaths: [],
          },
        },
      },
    });

    const respond = vi.fn();
    const handler = knowledgeHandlers["knowledge.vault.ingest"];
    if (!handler) throw new Error("knowledge.vault.ingest handler missing");

    await handler({
      params: {
        options: {
          limitFiles: 10,
        },
      },
      respond,
    } as never);

    expect(createItemMock).toHaveBeenCalled();
    const createItemArg = createItemMock.mock.calls[0]?.[0] as {
      extra?: Record<string, unknown>;
    };
    expect(createItemArg?.extra?.source).toBe("vault");
    expect(createItemArg?.extra?.vaultPath).toBe("alpha.md");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        success: true,
        source: "vault",
        acceptedFiles: 1,
      }),
      undefined,
    );
  });
});
