import { describe, expect, it, vi } from "vitest";
import type { StorageConfig } from "../../data/storage-config.js";
import type { GatewayRequestHandlerOptions } from "./types.js";
import { buildWorkflowBackendStatus, workflowsHandlers } from "./workflows.js";

vi.mock("../../data/redis-client.js", () => ({ refreshPresence: vi.fn() }));
vi.mock("../../logging/subsystem.js", () => ({
  createSubsystemLogger: () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      child: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    return logger;
  },
}));

const sqliteStorage: StorageConfig = {
  backend: "sqlite",
  readFrom: "sqlite",
  writeTo: ["sqlite"],
  postgres: null,
  redis: null,
};

const postgresStorage: StorageConfig = {
  backend: "postgres",
  readFrom: "postgres",
  writeTo: ["postgres"],
  postgres: { connectionString: "postgres://localhost:5433/argentos" },
  redis: null,
};

describe("workflow backend status", () => {
  it("explains that graph dry-run works without PostgreSQL", () => {
    const status = buildWorkflowBackendStatus({ storage: sqliteStorage, env: {} });

    expect(status).toMatchObject({
      ok: true,
      backend: "sqlite",
      postgres: {
        activeForRuntime: false,
        connectionSource: "not_applicable",
        status: "not_configured",
      },
      dryRun: {
        graphPayloadAvailable: true,
        requiresPostgres: false,
        method: "workflows.dryRun",
        noLiveSideEffects: true,
      },
      savedWorkflows: {
        available: false,
        requiresPostgres: true,
      },
      scheduleCron: {
        available: false,
        requiresPostgres: true,
        status: "skipped_no_postgres",
      },
      schedulerBoundary: {
        contractVersion: "rust-spine-scheduler-v1",
        schedulerAuthority: "node",
        rustScheduler: "shadow",
        workflowRunAuthority: "node",
        workflowSessionAuthority: "node",
        channelDeliveryAuthority: "node",
        authoritySwitchAllowed: false,
        localDryRunCompatible: true,
        leases: {
          requiredForLiveRuns: true,
          storage: "postgres",
          status: "blocked_without_postgres",
          owner: "node-workflows",
          rustOwnership: "not_enabled",
        },
        wakeups: {
          owner: "node-cron",
          mode: "next-heartbeat",
          rustOwnership: "shadow",
        },
        handoff: {
          runPayload: "cron payload kind=workflowRun workflowId",
          session: "isolated workflow agent session",
          dryRun: "canvas payload validation",
          liveRunRequiresPostgres: true,
        },
        runSessionHandoff: {
          contractVersion: "workflow-run-session-handoff-v1",
          dryRun: {
            authority: "node-workflows",
            input: "canvas payload",
            persistsWorkflowRun: false,
            requiresPostgres: false,
            duplicatePrevention: "not_applicable_no_saved_run",
          },
          liveRun: {
            authority: "node-workflows",
            input: "saved workflow row",
            payloadKind: "workflowRun",
            persistsWorkflowRun: true,
            requiresPostgres: true,
            sessionTarget: "isolated",
          },
          session: {
            owner: "node-workflow-runner",
            keyDerivation: "buildWorkflowAgentSessionKey(agentId, stepIndex)",
            isolation: "per agent step",
            rustOwnership: "not_enabled",
          },
          duplicatePrevention: {
            scheduleCron: "one workflowRun cron job per active schedule",
            duplicateWorkflow: "scheduled duplicates start inactive",
            staleCronCleanup: "extra workflowRun cron jobs are removed during reconciliation",
            rustOwnership: "shadow_observe_only",
          },
          rustPromotionBlockers: [
            "postgres_required_for_live_scheduler_leases",
            "rust_scheduler_shadow_only",
            "authority_switch_not_allowed",
          ],
        },
        blockers: [
          "postgres_required_for_live_scheduler_leases",
          "rust_scheduler_shadow_only",
          "authority_switch_not_allowed",
        ],
      },
    });
    expect(status.operatorMessages.join(" ")).toContain("without PostgreSQL");
    expect(status.operatorMessages.join(" ")).toContain("cron reconciliation is skipped");
    expect(status.operatorMessages.join(" ")).toContain("Rust scheduler remains shadow-only");
    expect(status.dryRun.command).toContain("argent gateway call workflows.dryRun");
  });

  it("marks saved workflow runtime configured when PostgreSQL is active", () => {
    const status = buildWorkflowBackendStatus({ storage: postgresStorage, env: {} });

    expect(status.postgres).toMatchObject({
      activeForRuntime: true,
      connectionSource: "config",
      status: "configured",
    });
    expect(status.savedWorkflows).toMatchObject({
      available: true,
      requiresPostgres: true,
    });
    expect(status.scheduleCron).toMatchObject({
      available: true,
      requiresPostgres: true,
      status: "configured",
    });
    expect(status.schedulerBoundary).toMatchObject({
      schedulerAuthority: "node",
      rustScheduler: "shadow",
      authoritySwitchAllowed: false,
      leases: {
        status: "configured",
        owner: "node-workflows",
        rustOwnership: "not_enabled",
      },
      wakeups: {
        duplicatePrevention: expect.stringContaining("one workflowRun cron job"),
      },
      runSessionHandoff: {
        liveRun: {
          authority: "node-workflows",
          persistsWorkflowRun: true,
          requiresPostgres: true,
          sessionTarget: "isolated",
        },
        duplicatePrevention: {
          staleCronCleanup: expect.stringContaining("extra workflowRun cron jobs"),
          rustOwnership: "shadow_observe_only",
        },
        rustPromotionBlockers: ["rust_scheduler_shadow_only", "authority_switch_not_allowed"],
      },
      blockers: ["rust_scheduler_shadow_only", "authority_switch_not_allowed"],
    });
  });

  it("returns backend status without touching saved workflow storage", async () => {
    const respond = vi.fn();

    await workflowsHandlers["workflows.backendStatus"]({
      params: {},
      respond,
    } as unknown as GatewayRequestHandlerOptions);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        dryRun: expect.objectContaining({ requiresPostgres: false }),
        savedWorkflows: expect.objectContaining({ requiresPostgres: true }),
        scheduleCron: expect.objectContaining({ status: "skipped_no_postgres" }),
        schedulerBoundary: expect.objectContaining({
          schedulerAuthority: "node",
          rustScheduler: "shadow",
          authoritySwitchAllowed: false,
        }),
      }),
    );
  });
});
