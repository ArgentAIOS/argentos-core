import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withEnvOverride, withTempHome } from "./test-helpers.js";

describe("config env vars", () => {
  it("does not apply env vars from config by default", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".argentos");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "argent.json"),
        JSON.stringify(
          {
            env: { vars: { OPENROUTER_API_KEY: "config-key" } },
          },
          null,
          2,
        ),
        "utf-8",
      );

      await withEnvOverride({ OPENROUTER_API_KEY: undefined }, async () => {
        const { loadConfig } = await import("./config.js");
        loadConfig();
        expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
      });
    });
  });

  it("applies env vars from config only when legacy import is explicitly enabled", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".argentos");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "argent.json"),
        JSON.stringify(
          {
            env: { vars: { OPENROUTER_API_KEY: "config-key" } },
          },
          null,
          2,
        ),
        "utf-8",
      );

      await withEnvOverride(
        { OPENROUTER_API_KEY: undefined, ARGENT_ALLOW_CONFIG_ENV_VARS: "1" },
        async () => {
          const { loadConfig } = await import("./config.js");
          loadConfig();
          expect(process.env.OPENROUTER_API_KEY).toBe("config-key");
        },
      );
    });
  });

  it("honors existing env vars when legacy import is enabled", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".argentos");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "argent.json"),
        JSON.stringify(
          {
            env: { vars: { GROQ_API_KEY: "gsk-config" } },
          },
          null,
          2,
        ),
        "utf-8",
      );

      await withEnvOverride(
        { GROQ_API_KEY: "existing", ARGENT_ALLOW_CONFIG_ENV_VARS: "1" },
        async () => {
          const { loadConfig } = await import("./config.js");
          loadConfig();
          expect(process.env.GROQ_API_KEY).toBe("existing");
        },
      );
    });
  });
});
