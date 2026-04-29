import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectLocalSecretExposureFindings } from "./audit-secrets.js";

describe("audit-secrets", () => {
  it("reports likely object secrets with redacted fingerprints only", async () => {
    const secret = "super-secret-password-value";
    const findings = await collectLocalSecretExposureFindings({
      objects: [
        {
          source: "argent-config",
          value: {
            gateway: {
              auth: {
                password: secret,
              },
            },
            hooks: {
              token: "${ARGENT_HOOKS_TOKEN}",
            },
          },
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      checkId: "secrets.password",
      severity: "warn",
      title: "Password stored in config",
    });
    expect(findings[0]?.detail).toContain("source=argent-config");
    expect(findings[0]?.detail).toContain("key=gateway.auth.password");
    expect(findings[0]?.detail).toContain("pattern=password");
    expect(findings[0]?.detail).toContain("fingerprint=sha256:");
    expect(JSON.stringify(findings)).not.toContain(secret);
    expect(JSON.stringify(findings)).not.toContain("ARGENT_HOOKS_TOKEN");
  });

  it("scans caller-provided JSON5 files and ignores missing or unparseable files", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "argent-audit-secrets-"));
    try {
      const configPath = path.join(tmp, "auth-profile.json5");
      const brokenPath = path.join(tmp, "broken.json");
      const apiKey = "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz";
      await fs.writeFile(
        configPath,
        `{
          authProfiles: {
            openai: {
              apiKey: "${apiKey}",
              refreshToken: "\${OPENAI_REFRESH_TOKEN}",
            },
          },
        }\n`,
        "utf-8",
      );
      await fs.writeFile(brokenPath, "{ this is not valid", "utf-8");

      const findings = await collectLocalSecretExposureFindings({
        filePaths: [configPath, brokenPath, path.join(tmp, "missing.json")],
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        checkId: "secrets.api_key",
        severity: "warn",
      });
      expect(findings[0]?.detail).toContain(`source=${configPath}`);
      expect(findings[0]?.detail).toContain("key=authProfiles.openai.apiKey");
      expect(JSON.stringify(findings)).not.toContain(apiKey);
      expect(JSON.stringify(findings)).not.toContain("OPENAI_REFRESH_TOKEN");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("catches token-like workflow/action config values without secret disclosure", async () => {
    const bearer = "Bearer abcdefghijklmnopqrstuvwxyz1234567890";
    const findings = await collectLocalSecretExposureFindings({
      objects: [
        {
          source: "workflow-action",
          value: {
            actions: [
              {
                type: "http",
                headers: {
                  authorization: bearer,
                },
              },
            ],
          },
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      checkId: "secrets.token",
      severity: "warn",
    });
    expect(findings[0]?.detail).toContain("key=actions.0.headers.authorization");
    expect(JSON.stringify(findings)).not.toContain(bearer);
  });
});
