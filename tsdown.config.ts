import type { Plugin } from "rolldown";
import { createRequire } from "node:module";
import { defineConfig } from "tsdown";

const require = createRequire(import.meta.url);
const pkg = require("./package.json") as { version: string };

const env = {
  NODE_ENV: "production",
};

const define = {
  __ARGENT_VERSION__: JSON.stringify(pkg.version),
};

/**
 * Rolldown emits an `__exportAll` helper into whatever chunk happens to be
 * largest.  When another chunk needs that helper AND is itself imported by
 * the large chunk, we get a circular-import deadlock at runtime:
 *
 *   reply.js  ──(static import)──▶  github-copilot-token.js
 *                                      │  needs __exportAll
 *                                      └──(static import)──▶  reply.js  (not yet evaluated!)
 *
 * The plugin below patches the dist output *after* rolldown writes it,
 * inlining a tiny copy of `__exportAll` into any chunk that (a) uses
 * it, and (b) is *not* the chunk that defines it.
 */
function inlineExportAllPlugin(): Plugin {
  return {
    name: "inline-exportAll",
    writeBundle: {
      sequential: true,
      order: "post",
      async handler(options) {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const outDir = options.dir || "dist";

        // The __exportAll helper body (matches rolldown output)
        const helperBody = `var __exportAll = (all, no_symbols) => {
  no_symbols = no_symbols || {};
  for (var name in all) if (!Object.prototype.hasOwnProperty.call(no_symbols, name))
    Object.defineProperty(no_symbols, name, { get: all[name], enumerable: true, configurable: true });
  return no_symbols;
};`;

        // Find all JS files in the output directory
        const files = fs.readdirSync(outDir).filter((f: string) => f.endsWith(".js"));

        for (const file of files) {
          const filePath = path.join(outDir, file);
          let code = fs.readFileSync(filePath, "utf8");

          // Look for: import { XX as __exportAll } from "./someChunk.js";
          const importRe = /import\s*\{\s*\w+\s+as\s+__exportAll\s*\}\s*from\s*"[^"]+"\s*;?\n?/;
          if (importRe.test(code)) {
            // Replace the import with an inline definition
            code = code.replace(importRe, helperBody + "\n");
            fs.writeFileSync(filePath, code, "utf8");
          }
        }
      },
    },
  };
}

export default defineConfig([
  {
    entry: "src/index.ts",
    env,
    define,
    fixedExtension: false,
    platform: "node",
    plugins: [inlineExportAllPlugin()],
  },
  {
    entry: "src/entry.ts",
    env,
    define,
    fixedExtension: false,
    platform: "node",
    plugins: [inlineExportAllPlugin()],
  },
  {
    dts: true,
    entry: "src/plugin-sdk/index.ts",
    outDir: "dist/plugin-sdk",
    env,
    define,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: "src/extensionAPI.ts",
    env,
    define,
    fixedExtension: false,
    platform: "node",
  },
  // Dashboard api-server.cjs imports these modules by path.
  // They must be emitted as standalone entry points so the imports resolve.
  {
    entry: {
      "gateway/server-methods/knowledge": "src/gateway/server-methods/knowledge.ts",
      "data/knowledge-acl": "src/data/knowledge-acl.ts",
      "data/agent-family": "src/data/agent-family.ts",
      "pg-adapter": "src/data/pg-adapter.ts",
      "infra/execution-worker-runner": "src/infra/execution-worker-runner.ts",
      "infra/exec-approval-forwarder": "src/infra/exec-approval-forwarder.ts",
    },
    env,
    define,
    fixedExtension: false,
    platform: "node",
    plugins: [inlineExportAllPlugin()],
  },
]);
