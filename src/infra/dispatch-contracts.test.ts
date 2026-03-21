import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendDispatchContractEvent,
  createDispatchContract,
  getDispatchContract,
  listDispatchContractEvents,
  listDispatchContracts,
  recordDispatchContractHeartbeat,
  resetDispatchContractsStoreForTests,
} from "./dispatch-contracts.js";

describe("dispatch contracts store", () => {
  beforeEach(() => {
    resetDispatchContractsStoreForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDispatchContractsStoreForTests();
  });

  it("creates a contract with initial lifecycle event", async () => {
    const created = await createDispatchContract({
      contractId: "contract-1",
      taskId: "task-1",
      task: "Research Graph API scope constraints",
      targetAgentId: "scout",
      dispatchedBy: "argent",
      toolGrantSnapshot: ["web_search", "doc_panel", "web_search"],
      timeoutMs: 120000,
      heartbeatIntervalMs: 15000,
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(created.contractId).toBe("contract-1");
    expect(created.status).toBe("contract_created");
    expect(created.toolGrantSnapshot).toEqual(["web_search", "doc_panel"]);
    expect(created.createdAt.toISOString()).toBe("2026-03-01T12:00:00.000Z");

    const loaded = await getDispatchContract("contract-1");
    expect(loaded).not.toBeNull();
    expect(loaded?.taskId).toBe("task-1");

    const events = await listDispatchContractEvents("contract-1");
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe("contract_created");
  });

  it("applies lifecycle events and preserves event order", async () => {
    await createDispatchContract({
      contractId: "contract-2",
      task: "Fix dashboard TS regression",
      targetAgentId: "forge",
      dispatchedBy: "argent",
      toolGrantSnapshot: ["read", "write", "exec"],
      timeoutMs: 600000,
      heartbeatIntervalMs: 5000,
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
    });

    await appendDispatchContractEvent({
      contractId: "contract-2",
      status: "accepted",
      eventAt: new Date("2026-03-01T12:00:02.000Z"),
    });
    await appendDispatchContractEvent({
      contractId: "contract-2",
      status: "started",
      eventAt: new Date("2026-03-01T12:00:03.000Z"),
    });
    await appendDispatchContractEvent({
      contractId: "contract-2",
      status: "heartbeat",
      eventAt: new Date("2026-03-01T12:00:04.000Z"),
      payload: { progress: "running tests" },
    });
    const completed = await appendDispatchContractEvent({
      contractId: "contract-2",
      status: "completed",
      eventAt: new Date("2026-03-01T12:00:05.000Z"),
      resultSummary: "Updated 2 files and tests passed.",
    });

    expect(completed.status).toBe("completed");
    expect(completed.acceptedAt?.toISOString()).toBe("2026-03-01T12:00:02.000Z");
    expect(completed.startedAt?.toISOString()).toBe("2026-03-01T12:00:03.000Z");
    expect(completed.lastHeartbeatAt?.toISOString()).toBe("2026-03-01T12:00:04.000Z");
    expect(completed.completedAt?.toISOString()).toBe("2026-03-01T12:00:05.000Z");
    expect(completed.resultSummary).toBe("Updated 2 files and tests passed.");

    const events = await listDispatchContractEvents("contract-2");
    expect(events.map((e) => e.status)).toEqual([
      "contract_created",
      "accepted",
      "started",
      "heartbeat",
      "completed",
    ]);
  });

  it("filters listed contracts by status and target agent", async () => {
    await createDispatchContract({
      contractId: "contract-3",
      task: "Prepare customer report",
      targetAgentId: "quill",
      dispatchedBy: "argent",
      toolGrantSnapshot: ["doc_panel"],
      timeoutMs: 120000,
      heartbeatIntervalMs: 15000,
    });
    await createDispatchContract({
      contractId: "contract-4",
      task: "Investigate outage root cause",
      targetAgentId: "scout",
      dispatchedBy: "argent",
      toolGrantSnapshot: ["web_search", "memory_recall"],
      timeoutMs: 240000,
      heartbeatIntervalMs: 15000,
    });
    await appendDispatchContractEvent({
      contractId: "contract-4",
      status: "failed",
      failureReason: "timeout waiting for external API",
    });

    const failed = await listDispatchContracts({ status: "failed" });
    expect(failed).toHaveLength(1);
    expect(failed[0]?.contractId).toBe("contract-4");

    const scout = await listDispatchContracts({ targetAgentId: "scout" });
    expect(scout).toHaveLength(1);
    expect(scout[0]?.status).toBe("failed");
  });

  it("throws when appending an event to an unknown contract", async () => {
    await expect(
      appendDispatchContractEvent({
        contractId: "missing-contract",
        status: "accepted",
      }),
    ).rejects.toThrow("dispatch contract not found");
  });

  it("auto-fails on timeout when contract remains active", async () => {
    vi.useFakeTimers();
    await createDispatchContract({
      contractId: "contract-timeout",
      task: "Long-running task",
      targetAgentId: "forge",
      dispatchedBy: "argent",
      toolGrantSnapshot: ["read"],
      timeoutMs: 120,
      heartbeatIntervalMs: 60,
    });

    await appendDispatchContractEvent({
      contractId: "contract-timeout",
      status: "started",
    });

    await vi.advanceTimersByTimeAsync(160);

    const contract = await getDispatchContract("contract-timeout");
    expect(contract?.status).toBe("failed");
    expect(contract?.failureReason).toContain("timed out");
  });

  it("auto-fails on missed heartbeat once heartbeat mode is active", async () => {
    vi.useFakeTimers();
    await createDispatchContract({
      contractId: "contract-heartbeat",
      task: "Heartbeat-sensitive task",
      targetAgentId: "forge",
      dispatchedBy: "argent",
      toolGrantSnapshot: ["read"],
      timeoutMs: 5000,
      heartbeatIntervalMs: 80,
    });

    await appendDispatchContractEvent({
      contractId: "contract-heartbeat",
      status: "started",
    });
    await recordDispatchContractHeartbeat("contract-heartbeat", { progress: "alive" });

    await vi.advanceTimersByTimeAsync(320);

    const contract = await getDispatchContract("contract-heartbeat");
    expect(contract?.status).toBe("failed");
    expect(contract?.failureReason).toContain("missed heartbeat");
  });
});
