import net from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runCommandWithTimeoutMock = vi.fn();

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: (...args: unknown[]) => runCommandWithTimeoutMock(...args),
}));

const describeUnix = process.platform === "win32" ? describe.skip : describe;

describeUnix("inspectPortUsage", () => {
  beforeEach(() => {
    runCommandWithTimeoutMock.mockReset();
  });

  it("reports busy when lsof is missing but loopback listener exists", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;

    runCommandWithTimeoutMock.mockRejectedValueOnce(
      Object.assign(new Error("spawn lsof ENOENT"), { code: "ENOENT" }),
    );

    try {
      const { inspectPortUsage } = await import("./ports-inspect.js");
      const result = await inspectPortUsage(port);
      expect(result.status).toBe("busy");
      expect(result.errors?.some((err) => err.includes("ENOENT"))).toBe(true);
    } finally {
      server.close();
    }
  });

  it("falls back to ss listener parsing when lsof fails", async () => {
    runCommandWithTimeoutMock
      .mockRejectedValueOnce(Object.assign(new Error("spawn lsof ENOENT"), { code: "ENOENT" }))
      .mockResolvedValueOnce({
        stdout: 'LISTEN 0 4096 127.0.0.1:18789 0.0.0.0:* users:(("argent",pid=321,fd=19))\n',
        stderr: "",
        code: 0,
      })
      .mockResolvedValueOnce({ stdout: "node argent gateway", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "sem", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "100", stderr: "", code: 0 });

    const { inspectPortUsage } = await import("./ports-inspect.js");
    const result = await inspectPortUsage(18789);

    expect(result.status).toBe("busy");
    expect(result.listeners[0]).toMatchObject({
      pid: 321,
      ppid: 100,
      command: "argent",
      user: "sem",
    });
  });
});
