import { describe, expect, it, vi } from "vitest";

const watchMock = vi.fn(() => ({
  on: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock("chokidar", () => {
  return {
    default: { watch: watchMock },
  };
});

describe("ensureSkillsWatcher", () => {
  it("ignores node_modules, dist, and .git by default", async () => {
    const mod = await import("./refresh.js");
    mod.ensureSkillsWatcher({ workspaceDir: "/tmp/workspace" });

    expect(watchMock).toHaveBeenCalledTimes(1);
    const opts = watchMock.mock.calls[0]?.[1] as { ignored?: unknown };

    expect(opts.ignored).toBe(mod.DEFAULT_SKILLS_WATCH_IGNORED);
    const ignored = mod.DEFAULT_SKILLS_WATCH_IGNORED;
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/node_modules/pkg/index.js"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/dist/index.js"))).toBe(true);
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.git/config"))).toBe(true);
    expect(ignored.some((re) => re.test("/tmp/.hidden/skills/index.md"))).toBe(false);
  });

  it("does not create watchers for ephemeral subagent workspaces", async () => {
    const mod = await import("./refresh.js");
    watchMock.mockClear();

    mod.ensureSkillsWatcher({
      workspaceDir:
        "/Users/sem/.argentos/workspace-agent-main-subagent-76cf55a6-8a4d-4af7-8c23-b98113e5f8d1",
    });

    expect(watchMock).not.toHaveBeenCalled();
  });
});
