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
    });
    expect(status.operatorMessages.join(" ")).toContain("without PostgreSQL");
    expect(status.operatorMessages.join(" ")).toContain("cron reconciliation is skipped");
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
      }),
    );
  });
});
