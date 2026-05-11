import { describe, expect, it } from "vitest";
import {
  buildWorkflowRustShadowFixturePack,
  buildWorkflowTemplateCanaryProof,
} from "./workflow-rust-canary-fixtures.js";

describe("workflow Rust shadow canary fixtures", () => {
  it("covers the scheduler and pause states Rust must compare without mutation", () => {
    const pack = buildWorkflowRustShadowFixturePack();

    expect(pack).toMatchObject({
      schemaVersion: 1,
      id: "workflows-rust-shadow-canary-fixtures",
      generatedFrom: "synthetic-workflows-owned-contract",
    });
    expect(pack.cases.map((fixture) => fixture.id)).toEqual([
      "cron_workflow_run",
      "waiting_duration",
      "waiting_event",
      "waiting_approval",
      "duplicate_workflow_run_prevention",
      "stale_cron_cleanup",
      "rollback_inventory_expectations",
    ]);
    expect(
      pack.cases.every(
        (fixture) =>
          fixture.expected.rustAuthority === "shadow_read_only" &&
          fixture.expected.nodeAuthority === "live" &&
          fixture.expected.allowedRustAction === "compare_only" &&
          fixture.expected.mustNotMutate.includes("workflow_runs"),
      ),
    ).toBe(true);
  });

  it("uses durable ledger shapes for waits and approvals", () => {
    const pack = buildWorkflowRustShadowFixturePack();
    const byId = new Map(pack.cases.map((fixture) => [fixture.id, fixture]));

    expect(byId.get("waiting_duration")?.runs[0]).toMatchObject({
      status: "waiting_duration",
      currentNodeId: "wait-duration",
    });
    expect(byId.get("waiting_duration")?.steps[0]).toMatchObject({
      id: "step-run-rust-fixture-wait-duration-wait-duration",
      status: "running",
      inputContext: { durationMs: 900_000 },
    });

    expect(byId.get("waiting_event")?.runs[0]).toMatchObject({
      status: "waiting_event",
      currentNodeId: "wait-event",
    });
    expect(byId.get("waiting_approval")?.steps[0]).toMatchObject({
      status: "running",
      approvalStatus: "pending",
    });
  });

  it("makes duplicate cron comparison explicit without granting cleanup authority", () => {
    const duplicateCase = buildWorkflowRustShadowFixturePack().cases.find(
      (fixture) => fixture.id === "duplicate_workflow_run_prevention",
    );

    expect(duplicateCase?.cronJobs).toHaveLength(2);
    expect(duplicateCase?.runs).toHaveLength(1);
    expect(duplicateCase?.runs[0]?.dedupeKey).toBe(
      "workflowRun:wf-rust-fixture-cron:2026-05-02T10:45:00.000Z",
    );
    expect(duplicateCase?.expected.mustNotMutate).toContain("cron jobs");
  });
});

describe("workflow template canary proof", () => {
  it("labels AppForge/AOS dependent templates as dry-run safe but not live without bindings", () => {
    const proof = buildWorkflowTemplateCanaryProof();

    expect(proof.noLiveExternalSideEffects).toBe(true);
    expect(proof.families.length).toBeGreaterThan(0);
    expect(proof.families.every((family) => family.dryRunReady)).toBe(true);
    expect(proof.families.some((family) => family.liveReadiness.status === "dry_run_only")).toBe(
      true,
    );
    expect(
      proof.families.every((family) =>
        family.dryRunToLivePath.some(
          (stage) => stage.stage === "live_ready" && stage.status === "blocked",
        ),
      ),
    ).toBe(true);
  });

  it("shows the dry-run to canary-required to live-ready path when bindings and canary proof exist", () => {
    const proof = buildWorkflowTemplateCanaryProof({
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

    const newsletter = proof.families.find((family) => family.slug === "newsletter-builder");
    expect(newsletter).toBeDefined();
    expect(newsletter?.liveReadiness.status).toBe("live_ready");
    expect(newsletter?.dryRunToLivePath).toEqual([
      expect.objectContaining({ stage: "import", status: "passed" }),
      expect.objectContaining({ stage: "dry_run", status: "passed" }),
      expect.objectContaining({ stage: "canary_required", status: "passed" }),
      expect.objectContaining({ stage: "live_ready", status: "passed" }),
    ]);
  });
});
