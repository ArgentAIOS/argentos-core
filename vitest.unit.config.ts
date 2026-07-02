import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

const baseTest = (baseConfig as { test?: { include?: string[]; exclude?: string[] } }).test ?? {};
const include = baseTest.include ?? [
  "src/**/*.test.ts",
  "extensions/**/*.test.ts",
  "test/format-error.test.ts",
];
const exclude = baseTest.exclude ?? [];

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseTest,
    include,
    exclude: [
      ...exclude,
      "src/gateway/**",
      "extensions/**",
      // Quarantined from the hermetic unit suite: spawns the Rust `argent-execd`
      // daemon (rust/target/debug/argent-execd). The binary is absent in the CI
      // unit-test job and a stale local build returns 404 (route version skew),
      // so it can't run deterministically here. Run it after `cargo build` in a
      // dedicated integration context.
      "src/infra/executive-shadow-client.integration.test.ts",
    ],
  },
});
