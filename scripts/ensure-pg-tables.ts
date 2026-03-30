import { PgAdapter } from "../src/data/pg-adapter.js";

const port = process.env.ARGENT_PG_PORT?.trim() || "5433";
const db = process.env.ARGENT_PG_DB?.trim() || "argentos";
const connectionString =
  process.env.ARGENT_PG_CONNECTION_STRING?.trim() || `postgres://localhost:${port}/${db}`;

async function main() {
  console.log(`Ensuring ArgentOS PostgreSQL tables exist (${connectionString})...`);
  const adapter = new PgAdapter({ connectionString }, "installer");
  try {
    await adapter.init();
    console.log("ArgentOS PostgreSQL schema is ready.");
  } finally {
    await adapter.close().catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to ensure PostgreSQL tables: ${message}`);
  process.exitCode = 1;
});
