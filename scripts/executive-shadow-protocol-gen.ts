import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executiveShadowProtocolJsonSchema } from "../src/infra/executive-shadow-contract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function writeSchemaArtifacts() {
  const schemaString = `${JSON.stringify(executiveShadowProtocolJsonSchema, null, 2)}\n`;

  const distDir = path.join(repoRoot, "dist");
  await fs.mkdir(distDir, { recursive: true });
  const distPath = path.join(distDir, "executive-shadow.protocol.schema.json");
  await fs.writeFile(distPath, schemaString, "utf8");

  const repoNativePath = path.join(
    repoRoot,
    "rust",
    "argent-execd",
    "executive-shadow.protocol.schema.json",
  );
  await fs.writeFile(repoNativePath, schemaString, "utf8");

  console.log(`wrote ${distPath}`);
  console.log(`wrote ${repoNativePath}`);
}

await writeSchemaArtifacts();
