import type { ArgentPluginApi } from "../../src/plugins/types.js";
import { createGoogleMeetTool } from "./src/tool.js";

export default function register(api: ArgentPluginApi) {
  api.registerTool(createGoogleMeetTool(api), { optional: true });
}
