import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { createExecApprovalForwarder } from "./exec-approval-forwarder.js";

const baseRequest = {
  id: "req-1",
  request: {
    command: "echo hello",
    agentId: "main",
    sessionKey: "agent:main:main",
  },
  createdAtMs: 1000,
  expiresAtMs: 6000,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("exec approval forwarder", () => {
  it("forwards to session target and resolves", async () => {
    vi.useFakeTimers();
    const deliver = vi.fn().mockResolvedValue([]);
    const cfg = {
      approvals: { exec: { enabled: true, mode: "session" } },
    } as ArgentConfig;

    const forwarder = createExecApprovalForwarder({
      getConfig: () => cfg,
      deliver,
      nowMs: () => 1000,
      resolveSessionTarget: () => ({ channel: "slack", to: "U1" }),
    });

    await forwarder.handleRequested(baseRequest);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payloads: [
          expect.objectContaining({ text: expect.stringContaining("🔒 Exec approval required") }),
        ],
      }),
    );

    await forwarder.handleResolved({
      id: baseRequest.id,
      decision: "allow-once",
      resolvedBy: "slack:U1",
      ts: 2000,
    });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payloads: [
          expect.objectContaining({
            text: expect.stringContaining("✅ Exec approval allowed once."),
          }),
        ],
      }),
    );

    await vi.runAllTimersAsync();
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it("forwards to explicit targets and expires", async () => {
    vi.useFakeTimers();
    const deliver = vi.fn().mockResolvedValue([]);
    const cfg = {
      approvals: {
        exec: {
          enabled: true,
          mode: "targets",
          targets: [{ channel: "telegram", to: "123" }],
        },
      },
    } as ArgentConfig;

    const forwarder = createExecApprovalForwarder({
      getConfig: () => cfg,
      deliver,
      nowMs: () => 1000,
      resolveSessionTarget: () => null,
    });

    await forwarder.handleRequested(baseRequest);
    expect(deliver).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payloads: [
          expect.objectContaining({ text: expect.stringContaining("⏱️ Exec approval expired.") }),
        ],
      }),
    );
  });

  it("renders tool approval copy for synthetic tool approvals", async () => {
    vi.useFakeTimers();
    const deliver = vi.fn().mockResolvedValue([]);
    const cfg = {
      approvals: { exec: { enabled: true, mode: "session" } },
    } as ArgentConfig;

    const forwarder = createExecApprovalForwarder({
      getConfig: () => cfg,
      deliver,
      nowMs: () => 1000,
      resolveSessionTarget: () => ({ channel: "slack", to: "U1" }),
    });

    const toolRequest = {
      ...baseRequest,
      request: {
        ...baseRequest.request,
        command: "[TOOL_APPROVAL] email_delivery action=send_resend subject=Invoice follow-up",
      },
    };

    await forwarder.handleRequested(toolRequest);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payloads: [
          expect.objectContaining({ text: expect.stringContaining("🔒 Tool approval required") }),
        ],
      }),
    );
    expect(deliver).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payloads: [
          expect.objectContaining({
            text: expect.stringContaining(
              "Tool: email_delivery action=send_resend subject=Invoice follow-up",
            ),
          }),
        ],
      }),
    );

    await forwarder.handleResolved({
      id: toolRequest.id,
      decision: "allow-once",
      resolvedBy: "slack:U1",
      ts: 2000,
    });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payloads: [
          expect.objectContaining({
            text: expect.stringContaining("✅ Tool approval allowed once."),
          }),
        ],
      }),
    );
  });
});
