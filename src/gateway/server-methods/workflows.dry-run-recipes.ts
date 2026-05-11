import type { WorkflowDefinition } from "../../infra/workflow-types.js";
import { OWNER_OPERATOR_WORKFLOW_PACKAGES } from "../../infra/workflow-owner-operator-templates.js";
import { importWorkflowPackage } from "../../infra/workflow-package.js";

export const MORNING_BRIEF_DRY_RUN_RECIPE_SLUG = "ai-morning-brief-podcast";

export type WorkflowDryRunRecipeParams = {
  name: string;
  description: string;
  deploymentStage: WorkflowDefinition["deploymentStage"];
  definition: WorkflowDefinition;
  canvasLayout: unknown;
};

export type WorkflowDryRunRecipe = {
  slug: string;
  name: string;
  command: string;
  params: WorkflowDryRunRecipeParams;
  safety: {
    requiresPostgres: false;
    noLiveConnectorExecution: true;
    noCustomerData: true;
    noChannelDelivery: true;
  };
  knownGaps: string[];
};

export function buildMorningBriefDryRunRecipeParams(): WorkflowDryRunRecipeParams {
  const workflowPackage = OWNER_OPERATOR_WORKFLOW_PACKAGES.find(
    (pkg) => pkg.slug === MORNING_BRIEF_DRY_RUN_RECIPE_SLUG,
  );
  if (!workflowPackage) {
    throw new Error(`Missing workflow package: ${MORNING_BRIEF_DRY_RUN_RECIPE_SLUG}`);
  }

  const imported = importWorkflowPackage(workflowPackage);
  if (!imported.readiness.okForImport || !imported.readiness.okForPinnedTestRun) {
    throw new Error("Morning Brief package is not ready for local dry-run recipe generation.");
  }

  return {
    name: `${workflowPackage.name} local dry-run recipe`,
    description:
      "Local no-PostgreSQL, no-live-side-effect recipe for workflows.dryRun operator proof.",
    deploymentStage: "simulate",
    definition: {
      ...imported.normalized.workflow,
      id: "morning-brief-local-dry-run-recipe",
      name: workflowPackage.name,
      description: workflowPackage.description,
      deploymentStage: "simulate",
    },
    canvasLayout: workflowPackage.canvasLayout,
  };
}

export function buildMorningBriefDryRunRecipe(): WorkflowDryRunRecipe {
  return {
    slug: MORNING_BRIEF_DRY_RUN_RECIPE_SLUG,
    name: "Morning Brief local dry-run",
    command:
      'params=$(pnpm exec tsx scripts/workflows/morning-brief-dryrun-params.ts) && argent gateway call workflows.dryRun --params "$params" --json',
    params: buildMorningBriefDryRunRecipeParams(),
    safety: {
      requiresPostgres: false,
      noLiveConnectorExecution: true,
      noCustomerData: true,
      noChannelDelivery: true,
    },
    knownGaps: [
      "Does not create, list, or run saved PostgreSQL-backed workflows.",
      "Does not execute live connectors, podcast generation, or Telegram delivery.",
      "Does not prove rendered dashboard UI or installed gateway RPC health.",
    ],
  };
}
