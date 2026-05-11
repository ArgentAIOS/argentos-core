import type {
  RustGatewayParityReplayReport,
  RustGatewayParityReplayResult,
} from "./rust-gateway-parity-runner.js";

export type RustGatewayShadowDriftSeverity = "info" | "warn" | "error";

export type RustGatewayShadowDriftEvent = {
  type: "rust_gateway_shadow_drift";
  generatedAtMs: number;
  fixtureId: string;
  method: string;
  severity: RustGatewayShadowDriftSeverity;
  expectedParity: RustGatewayParityReplayResult["expectedParity"];
  observedParity: RustGatewayParityReplayResult["observedParity"];
  status: RustGatewayParityReplayResult["status"];
  nodeOk: boolean | null;
  rustOk: boolean | null;
  notes: string[];
};

export type RustGatewayShadowDriftSink = (line: string) => void | Promise<void>;

export function collectRustGatewayShadowDriftEvents(
  report: RustGatewayParityReplayReport,
): RustGatewayShadowDriftEvent[] {
  return report.results
    .filter((result) => shouldLogDrift(result))
    .map((result) => ({
      type: "rust_gateway_shadow_drift",
      generatedAtMs: report.generatedAtMs,
      fixtureId: result.fixtureId,
      method: result.method,
      severity: classifySeverity(result),
      expectedParity: result.expectedParity,
      observedParity: result.observedParity,
      status: result.status,
      nodeOk: result.nodeOk,
      rustOk: result.rustOk,
      notes: result.notes,
    }));
}

export async function writeRustGatewayShadowDriftLog(params: {
  report: RustGatewayParityReplayReport;
  sink: RustGatewayShadowDriftSink;
}): Promise<number> {
  const events = collectRustGatewayShadowDriftEvents(params.report);
  for (const event of events) {
    await params.sink(JSON.stringify(event));
  }
  return events.length;
}

function shouldLogDrift(result: RustGatewayParityReplayResult): boolean {
  return (
    result.status === "failed" ||
    result.observedParity === "mock-compatible" ||
    result.expectedParity === "unsupported" ||
    (result.status === "skipped" && result.safety !== "unsafe")
  );
}

function classifySeverity(result: RustGatewayParityReplayResult): RustGatewayShadowDriftSeverity {
  if (result.status === "failed") {
    return "error";
  }
  if (result.observedParity === "mock-compatible" || result.expectedParity === "unsupported") {
    return "warn";
  }
  return "info";
}
