import { buildMorningBriefDryRunRecipeParams } from "../../src/gateway/server-methods/workflows.dry-run-recipes.js";

const pretty = process.argv.includes("--pretty");
process.stdout.write(JSON.stringify(buildMorningBriefDryRunRecipeParams(), null, pretty ? 2 : 0));
process.stdout.write("\n");
