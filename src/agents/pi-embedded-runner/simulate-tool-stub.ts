/**
 * WR2 P4 "D9" — SIMULATE-mode write-capable tool stubbing.
 *
 * In SIMULATE mode, a worker's write-capable tool calls must NOT execute. Instead of
 * touching the world, the stubbed `execute` records a `proposed_action {tool, args}`
 * into a collector and returns a benign "recorded (simulated)" result. The worker can't
 * tell the difference; the operator gets a reviewable proposal on the run record.
 *
 * Write-capability is decided by `isExternalArtifactTool` (the same set the telemetry
 * cross-check uses: web_search, web_fetch, doc_panel, message, marketplace). Read-only
 * tools pass through unchanged so simulate mode never blunts harmless reads.
 *
 * Pure: the collector is caller-owned, so the contract is unit-testable without a runner.
 */
import { isExternalArtifactTool } from "../../infra/work-report-crosscheck.js";

/** A recorded write-capable tool call that was stubbed out in SIMULATE mode. */
export type ProposedAction = { tool: string; args: unknown };

/**
 * Wrap a tool for SIMULATE mode. If the tool is write-capable (per
 * `isExternalArtifactTool`) AND has an `execute`, return a shallow clone whose `execute`
 * does NOT call the original — it pushes `{ tool, args }` to `collector` and returns a
 * benign simulated `AgentToolResult`-shaped object. Otherwise the tool is returned
 * unchanged (passthrough). `.name` and all other fields are preserved.
 */
export function wrapToolForSimulate<T extends { name: string; execute?: Function }>(
  tool: T,
  collector: ProposedAction[],
): T {
  if (!isExternalArtifactTool(tool.name) || typeof tool.execute !== "function") {
    return tool;
  }
  const summary = `recorded (simulated): ${tool.name}`;
  return {
    ...tool,
    // Mirror the AgentTool execute signature: (toolCallId, params, signal, onUpdate).
    execute: async (_toolCallId: string, params: unknown) => {
      collector.push({ tool: tool.name, args: params });
      return {
        content: [{ type: "text", text: summary }],
        details: { ok: true, simulated: true, summary },
      };
    },
  };
}
