import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";
import { commandsHandlers } from "./commands.js";

const mocks = vi.hoisted(() => ({
  compactEmbeddedPiSession: vi.fn(),
  loadSessionEntry: vi.fn(),
  resolveSessionModelRef: vi.fn(() => ({ provider: "openai-codex", model: "gpt-5.5" })),
  loadConfigReturn: {} as Record<string, unknown>,
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn(),
  compactEmbeddedPiSession: mocks.compactEmbeddedPiSession,
  isEmbeddedPiRunActive: () => false,
  waitForEmbeddedPiRunEnd: vi.fn(),
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return { ...actual, loadConfig: () => mocks.loadConfigReturn };
});

vi.mock("../session-utils.js", () => ({
  loadSessionEntry: mocks.loadSessionEntry,
  resolveSessionModelRef: mocks.resolveSessionModelRef,
}));

vi.mock("../../config/sessions.js", async () => {
  const actual = await vi.importActual<typeof import("../../config/sessions.js")>(
    "../../config/sessions.js",
  );
  return { ...actual, resolveSessionFilePath: () => "/tmp/commands-compact-test/session.jsonl" };
});

function invokeCompact(sessionKey: string) {
  const respond = vi.fn();
  const handler = commandsHandlers["commands.compact"];
  const result = handler({
    params: { sessionKey },
    respond,
  } as unknown as GatewayRequestHandlerOptions);
  return { respond, result };
}

function compactCallArg(): { agentDir?: string; workspaceDir?: string } {
  expect(mocks.compactEmbeddedPiSession).toHaveBeenCalledTimes(1);
  return mocks.compactEmbeddedPiSession.mock.calls[0]?.[0] as {
    agentDir?: string;
    workspaceDir?: string;
  };
}

const normalize = (p?: string) => (p ?? "").replace(/\\/g, "/");

describe("commands.compact agent resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadSessionEntry.mockReturnValue({ entry: { sessionId: "session-1" } });
    mocks.compactEmbeddedPiSession.mockResolvedValue({
      ok: true,
      compacted: true,
      result: { tokensBefore: 100, tokensAfter: 10 },
    });
    // An agent literally named "main" exists alongside the default agent —
    // the regression scenario: its agentDir must NOT be picked up for another
    // agent's session.
    mocks.loadConfigReturn = {
      agents: {
        list: [{ id: "argent", default: true }, { id: "main" }],
      },
    };
  });

  it("compacts agent:argent:main with argent's agent dir, not agents/main", async () => {
    const { respond, result } = invokeCompact("agent:argent:main");
    await result;

    const call = compactCallArg();
    expect(normalize(call.agentDir)).toMatch(/agents\/argent\/agent$/);
    expect(normalize(call.agentDir)).not.toMatch(/agents\/main\/agent$/);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, compacted: true }),
      undefined,
    );
  });

  it("compacts a session of the agent actually named main with agents/main", async () => {
    const { result } = invokeCompact("agent:main:webchat");
    await result;

    const call = compactCallArg();
    expect(normalize(call.agentDir)).toMatch(/agents\/main\/agent$/);
  });
});
