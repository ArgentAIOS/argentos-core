import { describe, expect, it } from "vitest";
import { parseArgs } from "../../scripts/rust-gateway-parity-report.js";

describe("rust gateway parity report script args", () => {
  it("uses safe defaults", () => {
    expect(parseArgs([])).toEqual({
      outputDir: ".omx/state/rust-gateway-parity/latest",
      jsonSummary: false,
      strict: false,
      help: false,
    });
  });

  it("parses explicit report options", () => {
    expect(
      parseArgs([
        "--",
        "--output-dir",
        ".omx/state/rust-gateway-parity/manual",
        "--node-port=19100",
        "--rust-port",
        "19101",
        "--token",
        "test-token",
        "--timeout-ms=5000",
        "--startup-timeout-ms=60000",
        "--request-timeout-ms",
        "3000",
        "--json-summary",
        "--strict",
      ]),
    ).toEqual({
      outputDir: ".omx/state/rust-gateway-parity/manual",
      nodePort: 19100,
      rustPort: 19101,
      token: "test-token",
      timeoutMs: 5000,
      startupTimeoutMs: 60000,
      requestTimeoutMs: 3000,
      jsonSummary: true,
      strict: true,
      help: false,
    });
  });

  it("rejects unsafe or malformed arguments", () => {
    expect(() => parseArgs(["--node-port", "0"])).toThrow("--node-port");
    expect(() => parseArgs(["--rust-port=70000"])).toThrow("--rust-port");
    expect(() => parseArgs(["--unknown"])).toThrow("unknown argument");
  });
});
