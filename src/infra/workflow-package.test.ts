import { describe, expect, it, vi } from "vitest";
import type { AgentDispatcher } from "./workflow-types.js";
import {
  OWNER_OPERATOR_WORKFLOW_PACKAGES,
  OWNER_OPERATOR_WORKFLOW_VARIATION_SLUGS,
} from "./workflow-owner-operator-templates.js";
import {
  applyWorkflowPackageTestFixtures,
  auditWorkflowPackageLiveReadiness,
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
  it("covers 21 concrete owner-operator workflow scenarios plus five highlighted variations", () => {
    expect(OWNER_OPERATOR_WORKFLOW_PACKAGES).toHaveLength(21);
    expect(new Set(OWNER_OPERATOR_WORKFLOW_PACKAGES.map((pkg) => pkg.slug)).size).toBe(21);
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

    expect(showcase.map((pkg) => pkg.slug).toSorted()).toEqual([...showcaseSlugs].toSorted());
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

  it("proves Morning Brief imports and dry-runs end to end with visible DocPanel artifacts", async () => {
    dispatchMock.mockClear();
    const morningBrief = OWNER_OPERATOR_WORKFLOW_PACKAGES.find(
      (pkg) => pkg.slug === "ai-morning-brief-podcast",
    );
    expect(morningBrief).toBeDefined();
    if (!morningBrief) {
      return;
    }

    const imported = importWorkflowPackage(morningBrief);
    expect(imported.readiness.okForImport).toBe(true);
    expect(imported.readiness.okForPinnedTestRun).toBe(true);
    expect(imported.readiness.liveReadiness).toMatchObject({
      okForLive: false,
      status: "dry_run_only",
      label: "Import/dry-run only",
    });
    expect(imported.readiness.liveReadiness?.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "missing_connector",
        "missing_credentials",
        "missing_channel",
        "canary_required",
      ]),
    );
    expect(imported.readiness.liveRequirements).toEqual(
      expect.arrayContaining([
        expect.stringContaining("credential:elevenlabs.primary"),
        expect.stringContaining("connector:aos-telegram"),
        expect.stringContaining("channel:telegram.workflow"),
      ]),
    );
    expect(imported.readiness.dryRunEvidence).toMatchObject({
      mode: "pinned_fixture",
      dryRunOnly: true,
      noLiveSideEffects: true,
      stepCount: 12,
      ledgerNodeId: "run-ledger",
      artifacts: expect.arrayContaining([
        expect.objectContaining({ nodeId: "brief-doc", type: "docpanel" }),
        expect.objectContaining({ nodeId: "run-ledger", type: "docpanel" }),
      ]),
    });
    expect(imported.readiness.liveReadiness?.canary.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "connector-runtime", status: "blocked" }),
        expect.objectContaining({ id: "live-bindings", status: "blocked" }),
        expect.objectContaining({
          id: "appforge-write-ready",
          status: "passed",
          message: "This template family does not require AppForge base/table resources.",
        }),
        expect.objectContaining({ id: "family-canary", status: "blocked" }),
      ]),
    );

    const savedDocs: Array<{ title: string; content: string; format?: string }> = [];
    const saveToDocPanel = vi.fn(async (title: string, content: string, format?: string) => {
      savedDocs.push({ title, content, format });
      return { ok: true, docId: `doc-${savedDocs.length}` };
    });
    const workflow = applyWorkflowPackageTestFixtures(morningBrief);

    const result = await executeWorkflow({
      workflow,
      runId: "morning-brief-visible-e2e-dry-run",
      dispatcher,
      triggerSource: "gateway:manual_test",
      triggerPayload: morningBrief.testFixtures?.triggerPayload,
      actions: { saveToDocPanel },
    });

    const stepLedger = result.steps.map((step) => ({
      nodeId: step.nodeId,
      nodeKind: step.nodeKind,
      nodeLabel: step.nodeLabel,
      status: step.status,
      artifactTypes: step.output.items.flatMap((item) =>
        (item.artifacts ?? []).map((artifact) => artifact.type),
      ),
    }));

    expect(result.status).toBe("completed");
    expect(stepLedger).toEqual([
      expect.objectContaining({ nodeId: "trigger", status: "completed" }),
      expect.objectContaining({ nodeId: "github-scout", status: "completed" }),
      expect.objectContaining({ nodeId: "frontier-scout", status: "completed" }),
      expect.objectContaining({ nodeId: "thought-scout", status: "completed" }),
      expect.objectContaining({ nodeId: "synthesize-brief", status: "completed" }),
      expect.objectContaining({
        nodeId: "brief-doc",
        status: "completed",
        artifactTypes: ["docpanel"],
      }),
      expect.objectContaining({ nodeId: "podcast-script", status: "completed" }),
      expect.objectContaining({ nodeId: "podcast-plan", status: "completed" }),
      expect.objectContaining({ nodeId: "approve-podcast-render", status: "completed" }),
      expect.objectContaining({ nodeId: "podcast-generate", status: "completed" }),
      expect.objectContaining({ nodeId: "delivery-status", status: "completed" }),
      expect.objectContaining({
        nodeId: "run-ledger",
        status: "completed",
        artifactTypes: ["docpanel"],
      }),
    ]);
    expect(saveToDocPanel).toHaveBeenCalledTimes(2);
    expect(savedDocs).toEqual([
      expect.objectContaining({
        title: "AI Morning Brief — morning-brief-visible-e2e-dry-run",
        format: "markdown",
      }),
      expect.objectContaining({
        title: "AI Morning Brief Run Ledger — morning-brief-visible-e2e-dry-run",
        format: "markdown",
      }),
    ]);
    expect(savedDocs[0]?.content).toContain("Synthesis Agent: fixture result");
    expect(savedDocs[1]?.content).toContain("Delivery Status: fixture action result");
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

  it("keeps templates dry-run only when live bindings are missing or connector-only metadata is read-ready", () => {
    const dailyMarketing = OWNER_OPERATOR_WORKFLOW_PACKAGES.find(
      (pkg) => pkg.slug === "daily-marketing-brief",
    );
    expect(dailyMarketing).toBeDefined();
    if (!dailyMarketing) {
      return;
    }

    const readiness = auditWorkflowPackageLiveReadiness(dailyMarketing, {
      connectors: [
        {
          tool: "appforge-core",
          label: "AppForge Core",
          installState: "metadata-only",
          status: { ok: true, label: "Metadata only" },
          modes: ["readonly"],
          discovery: {},
        },
        {
          tool: "aos-slack",
          label: "Slack",
          installState: "repo-only",
          status: { ok: false, label: "Repo only" },
          modes: ["readonly"],
          discovery: {},
        },
      ],
    });

    expect(readiness.okForLive).toBe(false);
    expect(readiness.status).toBe("dry_run_only");
    expect(readiness.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "appforge_metadata_only",
        "appforge_write_not_ready",
        "connector_repo_only",
        "missing_credentials",
        "missing_appforge_base",
        "missing_appforge_table",
        "missing_channel",
        "canary_required",
      ]),
    );
    expect(readiness.deferrals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: "appforge",
          label: "Deferred on AppForge resources",
          reasonCodes: expect.arrayContaining([
            "appforge_metadata_only",
            "appforge_write_not_ready",
            "missing_appforge_base",
            "missing_appforge_table",
          ]),
        }),
        expect.objectContaining({
          owner: "aos",
          label: "Deferred on AOS connector runtime",
          reasonCodes: expect.arrayContaining(["connector_repo_only"]),
        }),
        expect.objectContaining({
          owner: "operator",
          label: "Deferred on operator bindings",
          reasonCodes: expect.arrayContaining(["missing_credentials", "missing_channel"]),
        }),
        expect.objectContaining({
          owner: "workflows",
          label: "Deferred on Workflows canary",
          reasonCodes: ["canary_required"],
        }),
      ]),
    );
  });

  it("requires a canary even after connector, credential, channel, and AppForge bindings are live-ready", () => {
    const newsletter = OWNER_OPERATOR_WORKFLOW_PACKAGES.find(
      (pkg) => pkg.slug === "newsletter-builder",
    );
    expect(newsletter).toBeDefined();
    if (!newsletter) {
      return;
    }

    const almostReady = auditWorkflowPackageLiveReadiness(newsletter, {
      connectors: [
        {
          tool: "appforge-core",
          label: "AppForge Core",
          installState: "ready",
          status: { ok: true, label: "Ready" },
          modes: ["readonly", "write"],
          discovery: { binaryPath: "/bin/appforge-core" },
        },
        {
          tool: "aos-resend",
          label: "Resend",
          installState: "ready",
          status: { ok: true, label: "Ready" },
          modes: ["readonly", "write"],
          discovery: { binaryPath: "/bin/aos-resend" },
        },
      ],
      credentialIds: ["resend.primary"],
      appForgeBases: [
        {
          id: "marketing-ops",
          writeReady: true,
          tables: [{ id: "Content Calendar", readReady: true, writeReady: true }],
        },
      ],
    });

    expect(almostReady.okForLive).toBe(false);
    expect(almostReady.status).toBe("canary_required");
    expect(almostReady.reasons.map((reason) => reason.code)).toEqual(["canary_required"]);
    expect(almostReady.canary).toMatchObject({
      familyId: "marketing:schedule",
      required: true,
      passed: false,
    });
    expect(almostReady.canary.checklist).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "family-canary", status: "pending" })]),
    );
    expect(almostReady.deferrals).toEqual([
      expect.objectContaining({
        owner: "workflows",
        label: "Deferred on Workflows canary",
        reasonCodes: ["canary_required"],
      }),
    ]);

    const ready = auditWorkflowPackageLiveReadiness(newsletter, {
      connectors: [
        {
          tool: "appforge-core",
          label: "AppForge Core",
          installState: "ready",
          status: { ok: true, label: "Ready" },
          modes: ["readonly", "write"],
          discovery: { binaryPath: "/bin/appforge-core" },
        },
        {
          tool: "aos-resend",
          label: "Resend",
          installState: "ready",
          status: { ok: true, label: "Ready" },
          modes: ["readonly", "write"],
          discovery: { binaryPath: "/bin/aos-resend" },
        },
      ],
      credentialIds: ["resend.primary"],
      appForgeBases: [
        {
          id: "marketing-ops",
          writeReady: true,
          tables: [{ id: "Content Calendar", readReady: true, writeReady: true }],
        },
      ],
      canaryPassedPackageSlugs: ["newsletter-builder"],
    });

    expect(ready.okForLive).toBe(true);
    expect(ready.status).toBe("live_ready");
    expect(ready.deferrals).toEqual([]);
    expect(ready.canary.checklist).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "family-canary", status: "passed" })]),
    );
  });
});
