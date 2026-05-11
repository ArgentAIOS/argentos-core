import { describe, expect, it } from "vitest";
import type { RustGatewayParityReplayReport } from "./rust-gateway-parity-runner.js";
import { runRustGatewayParityReportJob } from "./rust-gateway-parity-report-run.js";

const report: RustGatewayParityReplayReport = {
  generatedAtMs: Date.UTC(2026, 3, 30, 12, 0, 0),
  totals: { passed: 1, failed: 0, skipped: 0 },
  results: [
    {
      fixtureId: "health",
      method: "health",
      safety: "read-only",
      expectedParity: "schema-compatible",
      observedParity: "schema-compatible",
      status: "passed",
      nodeOk: true,
      rustOk: true,
      notes: ["ok"],
    },
  ],
};

describe("runRustGatewayParityReportJob", () => {
  it("runs isolated parity and writes json, markdown, and drift outputs", async () => {
    const writes = new Map<string, string>();
    const madeDirs: string[] = [];

    const result = await runRustGatewayParityReportJob({
      outputDir: "/tmp/reports",
      token: "shared-token",
      startupTimeoutMs: 60_000,
      requestTimeoutMs: 3_000,
      createStarters: async (options) => {
        expect(options.token).toBe("shared-token");
        expect(options.timeoutMs).toBe(60_000);
        return {
          token: "shared-token",
          nodePort: 19100,
          rustPort: 19101,
          startNodeGateway: async () => ({ url: "ws://node", stop: () => undefined }),
          startRustGateway: async () => ({ url: "ws://rust", stop: () => undefined }),
        };
      },
      runParity: async (options) => {
        expect(options.token).toBe("shared-token");
        expect(options.timeoutMs).toBe(3_000);
        return report;
      },
      mkdir: async (dir) => {
        madeDirs.push(String(dir));
        return undefined;
      },
      writeFile: async (file, data) => {
        const filePath =
          typeof file === "string"
            ? file
            : Buffer.isBuffer(file)
              ? file.toString("utf8")
              : file.href;
        const content =
          typeof data === "string"
            ? data
            : Buffer.isBuffer(data)
              ? data.toString("utf8")
              : JSON.stringify(data);
        writes.set(filePath, content);
      },
    });

    expect(madeDirs).toEqual(["/tmp/reports"]);
    expect(result.readiness.ready).toBe(true);
    expect(result.files).toEqual({
      json: "/tmp/reports/rust-gateway-parity-report.json",
      markdown: "/tmp/reports/rust-gateway-parity-report.md",
      driftJsonl: "/tmp/reports/rust-gateway-shadow-drift.jsonl",
      readinessSummary: "/tmp/reports/rust-gateway-readiness-summary.json",
    });
    expect(writes.get(result.files.json)).toContain('"fixtureId": "health"');
    expect(writes.get(result.files.markdown)).toContain("Promotion readiness: ready");
    expect(writes.get(result.files.readinessSummary)).toContain('"promotionReady": true');
    expect(writes.get(result.files.readinessSummary)).toContain('"liveGateway": "node"');
    expect(writes.get(result.files.driftJsonl)).toBe("");
  });
});
