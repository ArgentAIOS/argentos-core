import type { ArgentPluginApi } from "../../src/plugins/types.js";
import { createLlmTaskTool } from "./src/llm-task-tool.js";

export default function register(api: ArgentPluginApi) {
  api.registerTool(createLlmTaskTool(api), { optional: true });
}
