import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveArgentPackageRootMock = vi.fn();

vi.mock("../infra/argent-root.js", () => ({
  resolveArgentPackageRoot: (params: unknown) => resolveArgentPackageRootMock(params),
}));

describe("resolveArgentDocsPath", () => {
  beforeEach(() => {
    vi.resetModules();
    resolveArgentPackageRootMock.mockReset();
  });

  it("reuses cached package-root lookups for identical inputs", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "argent-docs-path-"));
    const packageRoot = path.join(tmp, "pkg");
    await fs.mkdir(path.join(packageRoot, "docs"), { recursive: true });
    resolveArgentPackageRootMock.mockResolvedValue(packageRoot);

    const mod = await import("./docs-path.js");
    mod.clearArgentDocsPathCache();

    const first = await mod.resolveArgentDocsPath({ cwd: tmp });
    const second = await mod.resolveArgentDocsPath({ cwd: tmp });

    expect(first).toBe(path.join(packageRoot, "docs"));
    expect(second).toBe(first);
    expect(resolveArgentPackageRootMock).toHaveBeenCalledTimes(1);
  });

  it("runs the lookup again after cache clear", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "argent-docs-path-"));
    const packageRoot = path.join(tmp, "pkg");
    await fs.mkdir(path.join(packageRoot, "docs"), { recursive: true });
    resolveArgentPackageRootMock.mockResolvedValue(packageRoot);

    const mod = await import("./docs-path.js");
    mod.clearArgentDocsPathCache();

    await mod.resolveArgentDocsPath({ cwd: tmp });
    mod.clearArgentDocsPathCache();
    await mod.resolveArgentDocsPath({ cwd: tmp });

    expect(resolveArgentPackageRootMock).toHaveBeenCalledTimes(2);
  });
});
