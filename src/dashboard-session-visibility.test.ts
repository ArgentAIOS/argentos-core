import { describe, expect, it } from "vitest";
import {
  isVisibleOperatorSession,
  mergeVisibleChatAgentOptions,
  resolvePrimaryChatAgentId,
} from "../dashboard/src/lib/sessionVisibility.js";

describe("sessionVisibility", () => {
  it("derives the primary chat agent from the live main session key", () => {
    expect(resolvePrimaryChatAgentId("agent:argent:main", "main")).toBe("argent");
    expect(resolvePrimaryChatAgentId("agent:main:main", "main")).toBe("main");
  });

  it("keeps the selected agent main chat sessions visible", () => {
    expect(
      isVisibleOperatorSession({
        session: { key: "agent:argent:main" },
        currentSessionKey: "agent:argent:main",
        selectedAgentId: "argent",
        defaultAgentId: "argent",
      }),
    ).toBe(true);

    expect(
      isVisibleOperatorSession({
        session: { key: "agent:argent:webchat-123", channel: "webchat" },
        currentSessionKey: "agent:argent:main",
        selectedAgentId: "argent",
        defaultAgentId: "argent",
      }),
    ).toBe(true);
  });

  it("hides background and internal sessions for the selected agent", () => {
    expect(
      isVisibleOperatorSession({
        session: { key: "agent:argent:main:contemplation" },
        currentSessionKey: "agent:argent:main",
        selectedAgentId: "argent",
        defaultAgentId: "argent",
      }),
    ).toBe(false);

    expect(
      isVisibleOperatorSession({
        session: { key: "agent:argent:worker-execution" },
        currentSessionKey: "agent:argent:main",
        selectedAgentId: "argent",
        defaultAgentId: "argent",
      }),
    ).toBe(false);
  });

  it("hides sessions owned by other agents", () => {
    expect(
      isVisibleOperatorSession({
        session: { key: "agent:tier-1-technical-support:main" },
        currentSessionKey: "agent:argent:main",
        selectedAgentId: "argent",
        defaultAgentId: "argent",
      }),
    ).toBe(false);
  });

  it("keeps loaded family-agent options visible instead of collapsing to only the current agent", () => {
    expect(
      mergeVisibleChatAgentOptions({
        primaryAgentId: "argent",
        currentChatAgentId: "argent",
        loadedOptions: [
          { id: "argent", label: "Argent" },
          { id: "forge", label: "Forge" },
          { id: "scout", label: "Scout" },
        ],
      }),
    ).toEqual([
      { id: "argent", label: "Argent" },
      { id: "forge", label: "Forge" },
      { id: "scout", label: "Scout" },
    ]);
  });
});
