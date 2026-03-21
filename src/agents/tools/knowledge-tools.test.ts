import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

import {
  createKnowledgeCollectionsListTool,
  createKnowledgeSearchTool,
} from "./knowledge-tools.js";

describe("knowledge tools", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    callGatewayMock.mockResolvedValue({ success: true });
  });

  it("knowledge_search routes to knowledge.search with collection filter and session key", async () => {
    const tool = createKnowledgeSearchTool({ agentSessionKey: "agent:main:webchat-1" });

    await tool.execute("call-1", {
      query: "least-privilege microsoft graph scopes",
      collection: ["jason-dev", "default"],
      limit: 7,
      includeShared: false,
      ingestedOnly: true,
    });

    expect(callGatewayMock).toHaveBeenCalledTimes(1);
    expect(callGatewayMock.mock.calls[0]?.[0]).toEqual({
      method: "knowledge.search",
      params: {
        query: "least-privilege microsoft graph scopes",
        sessionKey: "agent:main:webchat-1",
        options: {
          collection: ["jason-dev", "default"],
          limit: 7,
          includeShared: false,
          ingestedOnly: true,
        },
      },
    });
  });

  it("knowledge_search only sends required options when optional inputs are omitted", async () => {
    const tool = createKnowledgeSearchTool();

    await tool.execute("call-2", {
      query: "sharepoint app registration",
    });

    expect(callGatewayMock).toHaveBeenCalledTimes(1);
    expect(callGatewayMock.mock.calls[0]?.[0]).toEqual({
      method: "knowledge.search",
      params: {
        query: "sharepoint app registration",
        sessionKey: undefined,
        options: {},
      },
    });
  });

  it("knowledge_collections_list routes to knowledge.collections.list with target agent", async () => {
    const tool = createKnowledgeCollectionsListTool({ agentSessionKey: "agent:main:discord-1" });

    await tool.execute("call-3", {
      agentId: "argent",
      includeInaccessible: true,
    });

    expect(callGatewayMock).toHaveBeenCalledTimes(1);
    expect(callGatewayMock.mock.calls[0]?.[0]).toEqual({
      method: "knowledge.collections.list",
      params: {
        sessionKey: "agent:main:discord-1",
        options: {
          agentId: "argent",
          includeInaccessible: true,
        },
      },
    });
  });
});
