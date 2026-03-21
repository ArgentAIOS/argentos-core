import { describe, expect, it, vi } from "vitest";
import { subscribeEmbeddedPiSession } from "./pi-embedded-subscribe.js";

type StubSession = {
  subscribe: (fn: (evt: unknown) => void) => () => void;
};

describe("subscribeEmbeddedPiSession toolcall deltas", () => {
  it("does not leak toolcall delta json into assistant stream text", () => {
    let handler: ((evt: unknown) => void) | undefined;
    const session: StubSession = {
      subscribe: (fn) => {
        handler = fn;
        return () => {};
      },
    };

    const onAgentEvent = vi.fn();

    subscribeEmbeddedPiSession({
      session: session as unknown as Parameters<typeof subscribeEmbeddedPiSession>[0]["session"],
      runId: "run",
      onAgentEvent,
    });

    handler?.({ type: "message_start", message: { role: "assistant" } });
    handler?.({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "toolcall_delta",
        delta:
          '{"command":"cd /Users/sem/.argentos/workspace-main/cabbage-cheese && git status --short"',
      },
    });
    handler?.({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: { type: "text_delta", delta: "Checking the repo state now." },
    });

    const payloads = onAgentEvent.mock.calls
      .map((call) => call[0]?.data as Record<string, unknown> | undefined)
      .filter((value): value is Record<string, unknown> => Boolean(value));

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.text).toBe("Checking the repo state now.");
    expect(payloads[0]?.delta).toBe("Checking the repo state now.");
  });

  it("does not leak thinking content events into assistant stream text", () => {
    let handler: ((evt: unknown) => void) | undefined;
    const session: StubSession = {
      subscribe: (fn) => {
        handler = fn;
        return () => {};
      },
    };

    const onAgentEvent = vi.fn();

    subscribeEmbeddedPiSession({
      session: session as unknown as Parameters<typeof subscribeEmbeddedPiSession>[0]["session"],
      runId: "run",
      onAgentEvent,
    });

    handler?.({ type: "message_start", message: { role: "assistant" } });
    handler?.({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "thinking_end",
        content: "Inspecting the worktree and planning the next tool call.",
      },
    });
    handler?.({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: { type: "text_delta", delta: "I checked the worktree." },
    });

    const payloads = onAgentEvent.mock.calls
      .map((call) => call[0]?.data as Record<string, unknown> | undefined)
      .filter((value): value is Record<string, unknown> => Boolean(value));

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.text).toBe("I checked the worktree.");
    expect(payloads[0]?.delta).toBe("I checked the worktree.");
  });
});
