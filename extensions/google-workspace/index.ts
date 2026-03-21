import type { ArgentPluginApi } from "../../src/plugins/types.js";
import { createGWorkspaceTool } from "./src/workspace-tool.js";

/**
 * Google Workspace Admin Extension
 *
 * MANAGEMENT-LEVEL EXTENSION
 * Requires Google service account with domain-wide delegation.
 * Provides administrative access to email reports and user directory.
 *
 * When ArgentOS adds formal capability tiers, tag this as "management".
 */
export default function register(api: ArgentPluginApi) {
  api.registerTool(createGWorkspaceTool(api));
}
