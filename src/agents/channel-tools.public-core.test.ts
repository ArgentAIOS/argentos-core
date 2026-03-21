import { afterEach, describe, expect, it } from "vitest";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";
import { listChannelAgentTools } from "./channel-tools.js";

function makeChannelPlugin(id: string, toolName: string): ChannelPlugin {
  return {
    id,
    meta: {
      id,
      label: id,
      selectionLabel: id,
      docsPath: `/channels/${id}`,
      blurb: "test stub",
    },
    capabilities: { chatTypes: ["direct"] },
    config: {
      listAccountIds: () => [],
      resolveAccount: () => ({}),
    },
    agentTools: [
      {
        name: toolName,
        description: `${toolName} description`,
        parameters: { type: "object", properties: {} },
        async execute() {
          return { content: [{ type: "text", text: "ok" }] };
        },
      },
    ],
  };
}

afterEach(() => {
  setActivePluginRegistry(createTestRegistry());
});

describe("listChannelAgentTools public-core surface", () => {
  it("blocks channel plugin tools unless the plugin is explicitly allowlisted", () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "slack",
          source: "test",
          plugin: makeChannelPlugin("slack", "slack_login"),
        },
      ]),
    );

    const blocked = listChannelAgentTools({
      cfg: {
        distribution: {
          surfaceProfile: "public-core",
        },
      },
    });
    expect(blocked).toHaveLength(0);

    const allowed = listChannelAgentTools({
      cfg: {
        distribution: {
          surfaceProfile: "public-core",
          publicCore: {
            allowPlugins: ["slack"],
          },
        },
      },
    });
    expect(allowed.map((tool) => tool.name)).toEqual(["slack_login"]);
  });

  it("removes allowlisted channel plugin tools when denied by tool name", () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "slack",
          source: "test",
          plugin: makeChannelPlugin("slack", "slack_login"),
        },
      ]),
    );

    const denied = listChannelAgentTools({
      cfg: {
        distribution: {
          surfaceProfile: "public-core",
          publicCore: {
            allowPlugins: ["slack"],
            denyTools: ["slack_login"],
          },
        },
      },
    });
    expect(denied).toHaveLength(0);
  });
});
