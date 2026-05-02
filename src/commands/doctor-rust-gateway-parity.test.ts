import { describe, expect, it, vi } from "vitest";
import { collectRustGatewayParityReadiness } from "./doctor-rust-gateway-parity.js";

const packageJson = JSON.stringify({
  scripts: {
    "rust-gateway:parity:report": "node --import tsx scripts/rust-gateway-parity-report.ts",
  },
});

const freshReport = JSON.stringify({
  generatedAtMs: 1_000,
  totals: { passed: 10, failed: 0, skipped: 3 },
  results: [
    {
      fixtureId: "rpc-status",
      method: "status",
      safety: "read-only",
      expectedParity: "mock-compatible",
      observedParity: "mock-compatible",
      status: "passed",
      nodeOk: true,
      rustOk: true,
      notes: ["shape only"],
    },
  ],
});

describe("collectRustGatewayParityReadiness", () => {
  it("reports available tooling and a fresh latest report", async () => {
    const readiness = await collectRustGatewayParityReadiness({
      cwd: "/repo",
      nowMs: () => 2_000,
      execFileImpl: vi.fn(async () => ({ stdout: "cargo 1.90.0\n", stderr: "" })),
      readFile: vi.fn(async (file) => {
        const filePath = String(file);
        if (filePath.endsWith("package.json")) {
          return packageJson;
        }
        return freshReport;
      }),
    });

    expect(readiness.checks).toEqual([
      { label: "cargo", status: "ok", detail: "cargo 1.90.0" },
      {
        label: "report command",
        status: "ok",
        detail: "pnpm rust-gateway:parity:report",
      },
      {
        label: "latest report",
        status: "ok",
        detail: "fresh; 10 passed, 0 failed, 3 skipped; promotionReady=NO; blockers=0; warnings=1",
      },
    ]);
  });

  it("keeps missing tooling and reports as warnings", async () => {
    const readiness = await collectRustGatewayParityReadiness({
      cwd: "/repo",
      execFileImpl: vi.fn(async () => {
        throw new Error("cargo missing");
      }),
      readFile: vi.fn(async (file) => {
        const filePath = String(file);
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({ scripts: {} });
        }
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }),
    });

    expect(readiness.checks.map((check) => check.status)).toEqual(["warn", "warn", "warn"]);
    expect(readiness.checks[2]?.detail).toContain("missing at");
  });
});
