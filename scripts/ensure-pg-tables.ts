import os from "node:os";
import { PgAdapter } from "../src/data/pg-adapter.js";

const port = process.env.ARGENT_PG_PORT?.trim() || "5433";
const db = process.env.ARGENT_PG_DB?.trim() || "argentos";
const currentUser = (() => {
  try {
    return os.userInfo().username || "argent";
  } catch {
    return "argent";
  }
})();
const defaultConnectionString =
  process.platform === "linux"
    ? `postgresql://${encodeURIComponent(currentUser)}@localhost/${db}?host=/var/run/postgresql&port=${port}`
    : `postgres://localhost:${port}/${db}`;
const connectionString = process.env.ARGENT_PG_CONNECTION_STRING?.trim() || defaultConnectionString;

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
