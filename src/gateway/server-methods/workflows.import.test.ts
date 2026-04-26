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

async function callTemplateList(params: Record<string, unknown> = {}) {
  const respond = vi.fn();
  await workflowsHandlers["workflows.templates.list"]({
    params,
    respond,
  } as unknown as GatewayRequestHandlerOptions);
  return respond.mock.calls[0] as [boolean, unknown, unknown?];
}

async function callTemplateGet(params: Record<string, unknown>) {
  const respond = vi.fn();
  await workflowsHandlers["workflows.templates.get"]({
    params,
    respond,
  } as unknown as GatewayRequestHandlerOptions);
  return respond.mock.calls[0] as [boolean, unknown, unknown?];
}

async function callDraft(params: Record<string, unknown>) {
  const respond = vi.fn();
  await workflowsHandlers["workflows.draft"]({
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
    expect(
      (payload as { workflow?: { nodes?: Array<{ config?: { pinnedOutput?: unknown } }> } })
        .workflow?.nodes?.[0]?.config?.pinnedOutput,
    ).toBeDefined();
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

describe("workflows.draft", () => {
  it("accepts operator intent and workflow name without leaking them into tools.status", async () => {
    const [ok, payload, error] = await callDraft({
      name: "Daily AI Tech Brief",
      intent:
        "- GitHub\n- the latest models\n- large movements from big frontier companies\n- open-source big movers\nSummarize it all and send it to me in Telegram like a podcast",
    });

    expect(ok).toBe(true);
    expect(error).toBeUndefined();
    expect(payload).toMatchObject({
      name: "Daily AI Tech Brief",
      nodes: expect.any(Array),
      edges: expect.any(Array),
      canvasLayout: { nodes: expect.any(Array), edges: expect.any(Array) },
    });
  });
});

describe("workflows.templates", () => {
  it("lists owner-operator workflow templates for the browser gallery", async () => {
    const [ok, payload] = await callTemplateList();

    expect(ok).toBe(true);
    const templates = (payload as { templates?: Array<{ slug?: string; nodeCount?: number }> })
      .templates;
    expect(templates?.length).toBe(OWNER_OPERATOR_WORKFLOW_PACKAGES.length);
    expect(templates?.some((template) => template.slug === "vip-email-alert")).toBe(true);
    expect(templates?.every((template) => Number(template.nodeCount) > 0)).toBe(true);
  });

  it("filters templates by department and returns import-preview payloads by slug", async () => {
    const [listOk, listPayload] = await callTemplateList({ department: "marketing" });

    expect(listOk).toBe(true);
    expect(
      (listPayload as { templates?: Array<{ scenario?: { department?: string } }> }).templates
        ?.length,
    ).toBeGreaterThan(0);
    expect(
      (
        listPayload as { templates?: Array<{ scenario?: { department?: string } }> }
      ).templates?.every((template) => template.scenario?.department === "marketing"),
    ).toBe(true);

    const [getOk, getPayload] = await callTemplateGet({ slug: "vip-email-alert" });

    expect(getOk).toBe(true);
    expect(getPayload).toMatchObject({
      package: { kind: "argent.workflow.package", slug: "vip-email-alert" },
      workflow: { nodes: expect.any(Array) },
      readiness: { okForPinnedTestRun: true },
    });
  });

  it("returns a user-facing error for unknown template slugs", async () => {
    const [ok, , error] = await callTemplateGet({ slug: "missing-template" });

    expect(ok).toBe(false);
    expect(error).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
