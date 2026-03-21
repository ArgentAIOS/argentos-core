/**
 * Drizzle Kit Configuration — PostgreSQL schema management.
 *
 * Usage:
 *   pnpm drizzle-kit generate   — generate migration SQL from schema changes
 *   pnpm drizzle-kit migrate    — apply pending migrations
 *   pnpm drizzle-kit studio     — open Drizzle Studio GUI
 *
 * Connection: PostgreSQL on port 5433 (non-default, see ARGENT_PG_PORT).
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/data/pg/schema.ts",
  out: "./src/data/pg/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.ARGENT_PG_URL ?? `postgres://localhost:5433/argentos`,
  },
  verbose: true,
  strict: true,
});
