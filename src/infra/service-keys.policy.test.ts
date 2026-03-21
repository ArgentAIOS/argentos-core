import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempHome } from "../../test/helpers/temp-home.js";

async function loadServiceKeysModule() {
  vi.resetModules();
  return await import("./service-keys.js");
}

describe("service key policy enforcement", () => {
  it("falls back to process env when a stored encrypted key is unreadable", async () => {
    await withTempHome(
      async () => {
        const mod = await loadServiceKeysModule();
        process.env.BRAVE_API_KEY = "env-brave-secret";
        mod.saveServiceKeys({
          version: 1,
          keys: [
            {
              id: "sk-broken",
              name: "Brave",
              variable: "BRAVE_API_KEY",
              value: "enc:v1:000000000000000000000000:00000000000000000000000000000000:00",
              enabled: true,
            },
          ],
        });

        const value = mod.resolveServiceKey("BRAVE_API_KEY");
        expect(value).toBe("env-brave-secret");
      },
      { env: { BRAVE_API_KEY: "env-brave-secret" } },
    );
  });

  it("returns undefined instead of throwing when a stored encrypted key is unreadable", async () => {
    await withTempHome(async () => {
      const mod = await loadServiceKeysModule();
      mod.saveServiceKeys({
        version: 1,
        keys: [
          {
            id: "sk-broken",
            name: "Atera",
            variable: "ATERA_API_KEY",
            value: "enc:v1:000000000000000000000000:00000000000000000000000000000000:00",
            enabled: true,
          },
        ],
      });

      expect(mod.resolveServiceKey("ATERA_API_KEY")).toBeUndefined();
    });
  });

  it("allows access when actor role matches allowedRoles", async () => {
    await withTempHome(async (home) => {
      const mod = await loadServiceKeysModule();
      mod.saveServiceKeys({
        version: 1,
        keys: [
          {
            id: "sk-1",
            name: "Brave",
            variable: "BRAVE_API_KEY",
            value: "brave-secret",
            enabled: true,
            allowedRoles: ["support_specialist"],
          },
        ],
      });

      const value = mod.resolveServiceKey("BRAVE_API_KEY", undefined, {
        actorId: "sage",
        actorRole: "support_specialist",
        actorTeam: "support-a-team",
        sessionKey: "agent:sage:main",
      });
      expect(value).toBe("brave-secret");

      const audit = await mod.queryServiceKeyAudit({ secretVariable: "BRAVE_API_KEY", limit: 10 });
      expect(audit[0]?.action).toBe("fetch");
      expect(audit[0]?.result).toBe("success");
      expect(audit[0]?.actorRole).toBe("support_specialist");

      const auditPath = path.join(home, ".argentos", "secret-audit.jsonl");
      const content = await fs.readFile(auditPath, "utf8");
      expect(content).toContain('"secretVariable":"BRAVE_API_KEY"');
    });
  });

  it("denies access when scoped policy does not match actor", async () => {
    await withTempHome(async () => {
      const mod = await loadServiceKeysModule();
      mod.saveServiceKeys({
        version: 1,
        keys: [
          {
            id: "sk-2",
            name: "Atera",
            variable: "ATERA_API_KEY",
            value: "atera-secret",
            enabled: true,
            allowedRoles: ["support_specialist"],
            allowedTeams: ["support-a-team"],
          },
        ],
      });

      const value = mod.resolveServiceKey("ATERA_API_KEY", undefined, {
        actorId: "forge",
        actorRole: "software_engineer",
        actorTeam: "dev-team",
        sessionKey: "agent:forge:main",
      });
      expect(value).toBeUndefined();

      const audit = await mod.queryServiceKeyAudit({
        secretVariable: "ATERA_API_KEY",
        result: "denied",
        limit: 10,
      });
      expect(audit.length).toBeGreaterThan(0);
      expect(audit[0]?.action).toBe("denied");
      expect(audit[0]?.denialReason).toContain("does not match");
    });
  });

  it("applies grant and revoke policy updates", async () => {
    await withTempHome(async () => {
      const mod = await loadServiceKeysModule();
      mod.saveServiceKeys({
        version: 1,
        keys: [
          {
            id: "sk-3",
            name: "Replicate",
            variable: "REPLICATE_API_KEY",
            value: "replicate-secret",
            enabled: true,
          },
        ],
      });

      const granted = mod.grantServiceKeyAccess({
        variable: "REPLICATE_API_KEY",
        role: "software_engineer",
      });
      expect(granted.updated).toBe(true);

      const policiesAfterGrant = mod.listServiceKeyPolicies();
      expect(
        policiesAfterGrant.find((p) => p.variable === "REPLICATE_API_KEY")?.allowedRoles ?? [],
      ).toContain("software_engineer");

      const revoked = mod.revokeServiceKeyAccess({
        variable: "REPLICATE_API_KEY",
        role: "software_engineer",
      });
      expect(revoked.updated).toBe(true);

      const policiesAfterRevoke = mod.listServiceKeyPolicies();
      expect(
        policiesAfterRevoke.find((p) => p.variable === "REPLICATE_API_KEY")?.allowedRoles ?? [],
      ).not.toContain("software_engineer");
    });
  });
});
