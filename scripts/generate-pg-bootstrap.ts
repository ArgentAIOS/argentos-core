/**
 * Regenerate src/data/pg/bootstrap-schema.ts from a reference database.
 *
 * The bootstrap module lets PgAdapter.init() self-create the full schema on a
 * genuinely fresh database (fresh-box installs), instead of requiring a
 * hand-run `drizzle-kit push` + migrations + ensure-pg-tables.sh.
 *
 * Procedure (run whenever src/data/pg/schema.ts or migrations change):
 *   createdb -p 5433 argentos_bsgen
 *   ARGENT_PG_URL=postgres://localhost:5433/argentos_bsgen pnpm drizzle-kit push --force
 *   for f in src/data/pg/migrations/*.sql; do psql postgres://localhost:5433/argentos_bsgen -q -f "$f"; done
 *   DATABASE_URL=postgres://localhost:5433/argentos_bsgen bash scripts/ensure-pg-tables.sh
 *   DATABASE_URL=postgres://localhost:5433/argentos_bsgen node --import tsx scripts/generate-pg-bootstrap.ts
 *   dropdb -p 5433 argentos_bsgen
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL required (reference database to dump)");
  process.exit(1);
}

const pgDumpCandidates = [
  "pg_dump",
  "/opt/homebrew/opt/postgresql@17/bin/pg_dump",
  "/usr/local/opt/postgresql@17/bin/pg_dump",
];
const pgDump = pgDumpCandidates.find((bin) => {
  try {
    execFileSync(bin, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});
if (!pgDump) {
  console.error("pg_dump not found");
  process.exit(1);
}

const raw = execFileSync(
  pgDump,
  [url, "--schema-only", "--no-owner", "--no-privileges", "--no-comments"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

const cleaned = raw
  .split("\n")
  .filter(
    (line) =>
      line.trim().length > 0 &&
      !line.startsWith("--") &&
      !line.startsWith("SET ") &&
      !line.startsWith("\\") &&
      !line.startsWith("SELECT pg_catalog"),
  )
  .join("\n");

if (cleaned.includes("`") || cleaned.includes("${")) {
  console.error("dump contains template-literal hazards; update the generator to escape them");
  process.exit(1);
}

const outPath = path.join("src", "data", "pg", "bootstrap-schema.ts");
const banner = `/**
 * GENERATED FILE — do not edit by hand.
 * Full PostgreSQL schema for a fresh ArgentOS database, applied by
 * PgAdapter.init() only when the database has no core tables yet.
 * Regenerate with scripts/generate-pg-bootstrap.ts (see its header).
 */
export const PG_BOOTSTRAP_SCHEMA_SQL = \`
`;
fs.writeFileSync(outPath, `${banner}${cleaned}\n\`;\n`);
console.log(`wrote ${outPath} (${cleaned.split("\n").length} SQL lines)`);
