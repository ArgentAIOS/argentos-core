import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentToolResult } from "../agent-core/core.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { toolPolicyRequiresApproval, wrapToolWithApprovalPolicy } from "./tool-approval.js";

const callGatewayToolMock = vi.fn();
const enqueueSystemEventMock = vi.fn();
const requestHeartbeatNowMock = vi.fn();

vi.mock("./tools/gateway.js", () => ({
  callGatewayTool: (...args: unknown[]) => callGatewayToolMock(...args),
}));

vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent: (...args: unknown[]) => enqueueSystemEventMock(...args),
}));

vi.mock("../infra/heartbeat-wake.js", () => ({
  requestHeartbeatNow: (...args: unknown[]) => requestHeartbeatNowMock(...args),
}));

function makeTool(name: string, execute = vi.fn()): AnyAgentTool {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute,
  } as unknown as AnyAgentTool;
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  callGatewayToolMock.mockReset();
  enqueueSystemEventMock.mockReset();
  requestHeartbeatNowMock.mockReset();
});

describe("tool approval policy", () => {
  it("recognizes high-risk actions", () => {
    expect(toolPolicyRequiresApproval("email_delivery", { action: "send_resend" })).toBe(true);
    expect(toolPolicyRequiresApproval("email_delivery", { action: "test_provider" })).toBe(false);
    expect(toolPolicyRequiresApproval("namecheap_dns", { action: "set_hosts" })).toBe(true);
    expect(toolPolicyRequiresApproval("namecheap_dns", { action: "check_domain" })).toBe(false);
    expect(toolPolicyRequiresApproval("message", { action: "broadcast" })).toBe(true);
  });

  it("returns approval-pending immediately and executes after approval", async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: "text", text: "sent" }],
      details: { ok: true },
    })) as unknown as AnyAgentTool["execute"];
    const wrapped = wrapToolWithApprovalPolicy(makeTool("email_delivery", execute), {
      approvalRequired: true,
      sessionKey: "agent:main:main",
      agentId: "main",
    });

    callGatewayToolMock.mockResolvedValue({ decision: "allow-once" });

    const result = (await wrapped.execute?.("call-1", {
      action: "send_resend",
    })) as AgentToolResult<unknown>;
    expect(result.details).toMatchObject({ status: "approval-pending", tool: "email_delivery" });

    await flushAsyncWork();

    expect(callGatewayToolMock).toHaveBeenCalledWith(
      "exec.approval.request",
      expect.any(Object),
      expect.objectContaining({
        command: expect.stringContaining("[TOOL_APPROVAL] email_delivery action=send_resend"),
        sessionKey: "agent:main:main",
      }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(enqueueSystemEventMock).toHaveBeenCalledWith(
      expect.stringContaining("Tool use approved for email_delivery"),
      expect.objectContaining({ sessionKey: "agent:main:main" }),
    );
  });

  it("does not execute when approval is denied", async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: "text", text: "sent" }],
    })) as unknown as AnyAgentTool["execute"];
    const wrapped = wrapToolWithApprovalPolicy(makeTool("send_payload", execute), {
      approvalRequired: true,
      sessionKey: "agent:main:main",
      agentId: "main",
    });

    callGatewayToolMock.mockResolvedValue({ decision: "deny" });

    await wrapped.execute?.("call-2", { message: "hello", routes: [] });
    await flushAsyncWork();

    expect(execute).not.toHaveBeenCalled();
    expect(enqueueSystemEventMock).toHaveBeenCalledWith(
      expect.stringContaining("Tool use denied for send_payload"),
      expect.objectContaining({ sessionKey: "agent:main:main" }),
    );
  });
});
