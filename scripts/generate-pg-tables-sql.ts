/**
 * Generate CREATE TABLE IF NOT EXISTS SQL from the Drizzle schema.
 * Output can be piped to psql or saved to a file.
 *
 * Usage: npx tsx scripts/generate-pg-tables-sql.ts > scripts/ensure-pg-tables.sql
 */
import { pgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/data/pg/schema.js";

// Get all exported pgTable objects
const tables = Object.values(schema).filter(
  (v): v is ReturnType<typeof pgTable> =>
    v != null &&
    typeof v === "object" &&
    "_.name" in (v as any) === false &&
    typeof (v as any)[Symbol.for("drizzle:Name")] === "string",
);

for (const table of tables) {
  const config = getTableConfig(table);
  console.log(`-- Table: ${config.name}`);
  const cols = config.columns.map((col) => {
    let def = `  ${col.name} ${col.columnType}`;
    if (col.primaryKey) def += " PRIMARY KEY";
    if (col.notNull) def += " NOT NULL";
    if (col.default !== undefined) def += ` DEFAULT ${col.default}`;
    return def;
  });
  console.log(`CREATE TABLE IF NOT EXISTS ${config.name} (`);
  console.log(cols.join(",\n"));
  console.log(`);\n`);
}
