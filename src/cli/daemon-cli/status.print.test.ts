import { describe, expect, it, vi } from "vitest";

const runtimeLog = vi.fn();
const runtimeError = vi.fn();

vi.mock("../../runtime.js", () => ({
  defaultRuntime: {
    log: runtimeLog,
    error: runtimeError,
    exit: vi.fn(),
  },
}));

describe("printDaemonStatus diagnosis output", () => {
  it("prints token mismatch unauthorized diagnosis", async () => {
    const { printDaemonStatus } = await import("./status.print.js");
    runtimeLog.mockReset();
    runtimeError.mockReset();

    printDaemonStatus(
      {
        service: {
          label: "LaunchAgent",
          loaded: true,
          loadedText: "loaded",
          notLoadedText: "not loaded",
          runtime: { status: "running" },
        },
        extraServices: [],
        rpc: {
          ok: false,
          error: "unauthorized: gateway token mismatch",
          diagnosis: "token-mismatch-unauthorized",
          diagnosisMessage: "Token mismatch unauthorized.",
          url: "ws://127.0.0.1:18789",
        },
      },
      { json: false },
    );

    const joined = runtimeError.mock.calls.map((call) => String(call[0])).join("\n");
    expect(joined).toContain("Diagnosis:");
    expect(joined).toContain("token mismatch unauthorized");
  });
});
