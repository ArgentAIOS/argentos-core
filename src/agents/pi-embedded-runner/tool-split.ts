import type { AgentTool } from "../../agent-core/core.js";
// GH #305: argent-native `ToolDefinition` (carries `@sinclair/typebox` TSchema)
// — matches what `createArgentAgentSession` consumes. Previously pulled from
// `agent-core/coding.js`, which re-exports pi's `typebox@1.x`-flavored
// `ToolDefinition` whose TSchema identity doesn't satisfy argent's.
import type { ToolDefinition } from "../../argent-agent/extension-types.js";
import { toToolDefinitions } from "../pi-tool-definition-adapter.js";

// We always pass tools via `customTools` so our policy filtering, sandbox integration,
// and extended toolset remain consistent across providers.
type AnyAgentTool = AgentTool;

export function splitSdkTools(options: { tools: AnyAgentTool[]; sandboxEnabled: boolean }): {
  builtInTools: AnyAgentTool[];
  customTools: ToolDefinition[];
} {
  const { tools } = options;
  return {
    builtInTools: [],
    customTools: toToolDefinitions(tools),
  };
}
