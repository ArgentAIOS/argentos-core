import { describe, expect, it, vi } from "vitest";
import type { AgentDispatcher } from "./workflow-types.js";
import {
  OWNER_OPERATOR_WORKFLOW_PACKAGES,
  OWNER_OPERATOR_WORKFLOW_VARIATION_SLUGS,
} from "./workflow-owner-operator-templates.js";
import {
  applyWorkflowPackageTestFixtures,
  importWorkflowPackage,
  parseWorkflowPackageText,
  serializeWorkflowPackage,
} from "./workflow-package.js";
import { executeWorkflow } from "./workflow-runner.js";

vi.mock("../data/redis-client.js", () => ({ refreshPresence: vi.fn() }));
vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));
vi.mock("../data/storage-factory.js", () => ({
  getStorageAdapter: vi.fn(async () => ({
    memory: {
      createItem: vi.fn(async () => ({ id: "fixture-memory" })),
    },
    tasks: {
      update: vi.fn(async () => ({ id: "fixture-task" })),
    },
  })),
}));

const dispatchMock = vi.fn(async () => ({
  items: [{ json: { unexpected: true }, text: "Unexpected live agent call" }],
}));
const dispatcher: AgentDispatcher = { dispatch: dispatchMock };

describe("owner-operator workflow packages", () => {
  it("covers 20 concrete owner-operator workflow scenarios plus five highlighted variations", () => {
    expect(OWNER_OPERATOR_WORKFLOW_PACKAGES).toHaveLength(20);
    expect(new Set(OWNER_OPERATOR_WORKFLOW_PACKAGES.map((pkg) => pkg.slug)).size).toBe(20);
    expect(OWNER_OPERATOR_WORKFLOW_VARIATION_SLUGS).toHaveLength(5);
    for (const slug of OWNER_OPERATOR_WORKFLOW_VARIATION_SLUGS) {
      expect(OWNER_OPERATOR_WORKFLOW_PACKAGES.some((pkg) => pkg.slug === slug)).toBe(true);
    }
    expect(new Set(OWNER_OPERATOR_WORKFLOW_PACKAGES.map((pkg) => pkg.scenario.department))).toEqual(
      new Set(["marketing", "sales", "operations", "finance", "hr", "support"]),
    );
  });

  it("imports every package into the canonical workflow contract without blocking validation errors", () => {
    const imports = OWNER_OPERATOR_WORKFLOW_PACKAGES.map(importWorkflowPackage);
    const blockers = imports.flatMap((result) =>
      result.readiness.blockers.map((issue) => ({
        workflow: result.package.slug,
        code: issue.code,
        message: issue.message,
      })),
    );

    expect(blockers).toEqual([]);
    expect(imports.every((result) => result.readiness.okForImport)).toBe(true);
    expect(imports.every((result) => result.normalized.workflow.nodes.length >= 3)).toBe(true);
  });

  it("keeps the showcase owner-operator workflows built out enough to inspect on canvas", () => {
    const showcaseSlugs = new Set([
      "daily-marketing-brief",
      "social-post-generator",
      "newsletter-builder",
      "client-onboarding",
      ...OWNER_OPERATOR_WORKFLOW_VARIATION_SLUGS,
    ]);
    const showcase = OWNER_OPERATOR_WORKFLOW_PACKAGES.filter((pkg) => showcaseSlugs.has(pkg.slug));

    expect(showcase.map((pkg) => pkg.slug).sort()).toEqual([...showcaseSlugs].sort());
    for (const workflowPackage of showcase) {
      const nodeKinds = new Set(workflowPackage.workflow.nodes.map((node) => node.kind));
      expect(workflowPackage.workflow.nodes.length, workflowPackage.slug).toBeGreaterThanOrEqual(6);
      expect(workflowPackage.canvasLayout.nodes.length, workflowPackage.slug).toBe(
        workflowPackage.workflow.nodes.length,
      );
      expect(nodeKinds.has("agent"), workflowPackage.slug).toBe(true);
      expect(nodeKinds.has("output"), workflowPackage.slug).toBe(true);
      expect(
        workflowPackage.workflow.nodes.some(
          (node) =>
            node.kind === "action" || (node.kind === "gate" && node.config.gateType === "approval"),
        ),
        workflowPackage.slug,
      ).toBe(true);
    }
  });

  it("round-trips packages through JSON and YAML import text", () => {
    const source = OWNER_OPERATOR_WORKFLOW_PACKAGES.find(
      (pkg) => pkg.slug === "daily-marketing-brief",
    );
    expect(source).toBeDefined();
    if (!source) {
      return;
    }

    const fromJson = parseWorkflowPackageText(serializeWorkflowPackage(source, "json"), "json");
    const fromYaml = parseWorkflowPackageText(serializeWorkflowPackage(source, "yaml"), "yaml");

    expect(fromJson.workflow.name).toBe(source.workflow.name);
    expect(fromYaml.workflow.nodes.map((node) => node.id)).toEqual(
      source.workflow.nodes.map((node) => node.id),
    );
    expect(importWorkflowPackage(fromYaml).readiness.okForImport).toBe(true);
  });

  it("executes every package in pinned fixture mode without external side effects", async () => {
    const results = [];
    for (const workflowPackage of OWNER_OPERATOR_WORKFLOW_PACKAGES) {
      const imported = importWorkflowPackage(workflowPackage);
      expect(imported.readiness.okForPinnedTestRun, workflowPackage.slug).toBe(true);
      const result = await executeWorkflow({
        workflow: applyWorkflowPackageTestFixtures(workflowPackage),
        runId: `fixture-${workflowPackage.slug}`,
        dispatcher,
        triggerSource: "gateway:manual_test",
        triggerPayload: workflowPackage.testFixtures?.triggerPayload,
      });
      results.push({
        slug: workflowPackage.slug,
        status: result.status,
        steps: result.steps.length,
      });
    }

    expect(results.every((result) => result.status === "completed")).toBe(true);
    expect(results.every((result) => result.steps >= 3)).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("surfaces live requirements so import can explain missing credentials and bases", () => {
    const newsletter = OWNER_OPERATOR_WORKFLOW_PACKAGES.find(
      (pkg) => pkg.slug === "newsletter-builder",
    );
    expect(newsletter).toBeDefined();
    if (!newsletter) {
      return;
    }

    const imported = importWorkflowPackage(newsletter);
    expect(imported.readiness.liveRequirements).toEqual(
      expect.arrayContaining([
        expect.stringContaining("credential:resend.primary"),
        expect.stringContaining("connector:aos-resend"),
      ]),
    );
  });
});
