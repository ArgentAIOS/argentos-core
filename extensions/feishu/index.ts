import type { ArgentPluginApi } from "argent/plugin-sdk";
import { emptyPluginConfigSchema } from "argent/plugin-sdk";
import { feishuPlugin } from "./src/channel.js";

const plugin = {
  id: "feishu",
  name: "Feishu",
  description: "Feishu (Lark) channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: ArgentPluginApi) {
    api.registerChannel({ plugin: feishuPlugin });
  },
};

export default plugin;
