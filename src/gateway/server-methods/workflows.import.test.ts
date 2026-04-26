import { describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";
import { OWNER_OPERATOR_WORKFLOW_PACKAGES } from "../../infra/workflow-owner-operator-templates.js";
import { serializeWorkflowPackage } from "../../infra/workflow-package.js";
import { workflowsHandlers } from "./workflows.js";

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

async function callImportPreview(params: Record<string, unknown>) {
  const respond = vi.fn();
  await workflowsHandlers["workflows.importPreview"]({
    params,
    respond,
  } as unknown as GatewayRequestHandlerOptions);
  return respond.mock.calls[0] as [boolean, unknown, unknown?];
}

describe("workflows.importPreview", () => {
  it("previews canonical JSON packages without persisting them", async () => {
    const source = OWNER_OPERATOR_WORKFLOW_PACKAGES[0];
    const [ok, payload] = await callImportPreview({
      text: serializeWorkflowPackage(source, "json"),
      format: "json",
    });

    expect(ok).toBe(true);
    expect(payload).toMatchObject({
      workflow: { name: source.workflow.name },
      readiness: { okForImport: true, okForPinnedTestRun: true },
      validation: { ok: true },
    });
  });

  it("previews canonical YAML packages for drag/drop import", async () => {
    const source = OWNER_OPERATOR_WORKFLOW_PACKAGES.find(
      (workflowPackage) => workflowPackage.slug === "vip-email-alert",
    );
    expect(source).toBeDefined();
    if (!source) {
      return;
    }

    const [ok, payload] = await callImportPreview({
      text: serializeWorkflowPackage(source, "yaml"),
      format: "yaml",
    });

    expect(ok).toBe(true);
    expect(payload).toMatchObject({
      package: { kind: "argent.workflow.package", slug: "vip-email-alert" },
      canvasLayout: { nodes: expect.any(Array), edges: expect.any(Array) },
    });
  });

  it("returns a user-facing error for unsupported import payloads", async () => {
    const [ok, , error] = await callImportPreview({
      text: JSON.stringify({ format: "argent-workflow" }),
      format: "json",
    });

    expect(ok).toBe(false);
    expect(error).toMatchObject({
      code: "INVALID_REQUEST",
    });
  });
});
