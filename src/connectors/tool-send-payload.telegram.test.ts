import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GateNode, PipelineContext, StepRecord } from "../infra/workflow-types.js";
import {
  __testing,
  buildTelegramSendInput,
  dispatchToolSendPayload,
  isToolSendPayloadNode,
  postTelegramSendMessage,
} from "./tool-send-payload.js";

const ORIGINAL_TOKEN_ENV = process.env.TELEGRAM_BOT_TOKEN;
const ORIGINAL_CHAT_ID_ENV = process.env.TELEGRAM_CHAT_ID;

function makeNode(overrides: Partial<GateNode> = {}): GateNode {
  return {
    kind: "gate",
    id: "tool-send-payload",
    label: "tool-send-payload",
    config: {
      gateType: "error_handler",
      catchFrom: [],
      actions: [],
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  const baseStep: StepRecord = {
    nodeId: "synthesis-agent",
    nodeKind: "agent",
    nodeLabel: "Synthesis Agent",
    stepIndex: 0,
    status: "completed",
    durationMs: 100,
    output: {
      items: [
        {
          json: { summary: "AI Morning Brief — May 6 — synthesized." },
          text: "AI Morning Brief — May 6 — synthesized.",
        },
      ],
    },
    startedAt: 1,
    endedAt: 2,
  };
  return {
    workflowId: "wf-morning-brief",
    workflowName: "AI Morning Brief Podcast",
    runId: "run-test",
    currentNodeId: "tool-send-payload",
    currentStepIndex: 1,
    totalSteps: 2,
    trigger: { triggerType: "schedule" } as PipelineContext["trigger"],
    history: [baseStep],
    variables: {},
    totalTokensUsed: 0,
    totalCostUsd: 0,
    ...overrides,
  };
}

describe("tool-send-payload telegram dispatch", () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "";
    process.env.TELEGRAM_CHAT_ID = "";
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN_ENV === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN_ENV;
    }
    if (ORIGINAL_CHAT_ID_ENV === undefined) {
      delete process.env.TELEGRAM_CHAT_ID;
    } else {
      process.env.TELEGRAM_CHAT_ID = ORIGINAL_CHAT_ID_ENV;
    }
    vi.restoreAllMocks();
  });

  it("identifies the morning-brief tool-send-payload node", () => {
    expect(isToolSendPayloadNode(makeNode())).toBe(true);
    expect(
      isToolSendPayloadNode(makeNode({ id: "tool-send-payload-2", label: "Tool: Send Payload" })),
    ).toBe(true);
    expect(
      isToolSendPayloadNode(
        makeNode({
          id: "approve-podcast-render",
          label: "Approve",
          config: {
            gateType: "approval",
            approvers: [],
            channels: [],
            message: "ok?",
            showPreviousOutput: true,
            allowEdit: false,
            timeoutAction: "deny",
          },
        }),
      ),
    ).toBe(false);
    expect(isToolSendPayloadNode(makeNode({ id: "some-other-node", label: "other" }))).toBe(false);
  });

  it("builds a sendMessage payload from the previous step's text and pipeline variables", () => {
    const ctx = makeContext({ variables: { telegramChatId: "12345" } });
    const input = buildTelegramSendInput(makeNode(), ctx, {});
    expect(input.chatId).toBe("12345");
    expect(input.text).toBe("AI Morning Brief — May 6 — synthesized.");
  });

  it("truncates text to Telegram's 4096-character limit", () => {
    const long = "A".repeat(__testing.MAX_TEXT_CHARS + 500);
    const ctx = makeContext({
      variables: { telegramChatId: "12345" },
      history: [
        {
          nodeId: "synthesis-agent",
          nodeKind: "agent",
          nodeLabel: "Synthesis Agent",
          stepIndex: 0,
          status: "completed",
          durationMs: 100,
          output: { items: [{ json: { summary: long }, text: long }] },
          startedAt: 1,
          endedAt: 2,
        },
      ],
    });
    const input = buildTelegramSendInput(makeNode(), ctx, {});
    expect(input.text.length).toBe(__testing.MAX_TEXT_CHARS);
    expect(input.text.endsWith("…")).toBe(true);
  });

  it("dispatches a real sendMessage POST to the Telegram bot API and returns delivered:true", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.telegram.org/botTEST_TOKEN/sendMessage");
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers["content-type"]).toBe("application/json");
      const body = JSON.parse(typeof init.body === "string" ? init.body : "");
      expect(body.chat_id).toBe("12345");
      expect(body.text).toBe("AI Morning Brief — May 6 — synthesized.");
      return new Response(JSON.stringify({ ok: true, result: { message_id: 987 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await postTelegramSendMessage(
      { chatId: "12345", text: "AI Morning Brief — May 6 — synthesized." },
      { botToken: "TEST_TOKEN", fetchImpl: fetchMock as unknown as typeof fetch },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(true);
    expect(result.messageId).toBe(987);
    expect(result.status).toBe(200);
    expect(result.chatId).toBe("12345");
  });

  it("maps Telegram api ok:false into a failure result with the description preserved", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await postTelegramSendMessage(
      { chatId: "0", text: "boom" },
      { botToken: "TEST_TOKEN", fetchImpl: fetchMock as unknown as typeof fetch },
    );

    expect(result.ok).toBe(false);
    expect(result.delivered).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("Bad Request: chat not found");
  });

  it("returns a failure ItemSet (not standby) when the bot token is missing", async () => {
    const fetchMock = vi.fn();
    const ctx = makeContext({ variables: { telegramChatId: "12345" } });
    const itemSet = await dispatchToolSendPayload(makeNode(), ctx, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(itemSet.items).toHaveLength(1);
    const item = itemSet.items[0];
    // CRITICAL: must NOT be the old `{"gateType":"error_handler","status":"standby"}` placeholder.
    expect(item.json.gateType).toBeUndefined();
    expect(item.json.delivered).toBe(false);
    expect(item.json.channel).toBe("telegram");
    expect(String(item.json.error)).toContain("TELEGRAM_BOT_TOKEN missing");
  });

  it("dispatchToolSendPayload returns delivered:true items when wired end-to-end with mocked fetch", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const ctx = makeContext({ variables: { telegramChatId: "12345" } });

    const itemSet = await dispatchToolSendPayload(makeNode(), ctx, {
      botToken: "TEST_TOKEN",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(itemSet.items).toHaveLength(1);
    const item = itemSet.items[0];
    expect(item.json.channel).toBe("telegram");
    expect(item.json.delivered).toBe(true);
    expect(item.json.messageId).toBe(42);
    expect(item.json.chatId).toBe("12345");
    expect(String(item.text)).toContain("Telegram delivered to 12345");
    // Crucially: no longer the standby/error_handler shape.
    expect(item.json.gateType).toBeUndefined();
    expect(item.json.status).toBe(200);
    expect(item.json).not.toMatchObject({ gateType: "error_handler", status: "standby" });
  });
});
