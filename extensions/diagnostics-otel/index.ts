import type { ArgentPluginApi } from "argent/plugin-sdk";
import { emptyPluginConfigSchema } from "argent/plugin-sdk";
import { createDiagnosticsOtelService } from "./src/service.js";

const plugin = {
  id: "diagnostics-otel",
  name: "Diagnostics OpenTelemetry",
  description: "Export diagnostics events to OpenTelemetry",
  configSchema: emptyPluginConfigSchema(),
  register(api: ArgentPluginApi) {
    api.registerService(createDiagnosticsOtelService());
  },
};

export default plugin;
