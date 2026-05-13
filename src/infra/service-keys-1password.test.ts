import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "../../test/helpers/temp-home.js";

async function loadServiceKeysModule() {
  vi.resetModules();
  return await import("./service-keys.js");
}

async function loadResolverModule() {
  return await import("./onepassword-resolver.js");
}

describe("service-keys 1Password integration", () => {
  beforeEach(() => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "ops_test_token_AAAAAAAAAA";
  });

  afterEach(async () => {
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
    const mod = await loadServiceKeysModule();
    mod.__setOnePasswordResolverForTests(null);
  });

  it("detects an op:// reference and resolves through the resolver hook", async () => {
    await withTempHome(async () => {
      const mod = await loadServiceKeysModule();
      mod.saveServiceKeys({
        version: 1,
        keys: [
          {
            id: "sk-op-ref-1",
            name: "Composio API Key",
            variable: "COMPOSIO_API_KEY",
            value: "op://Argent/Composio/api_key", // stored as a ref (auto-encrypted on read)
            enabled: true,
          },
        ],
      });

      let invocations = 0;
      mod.__setOnePasswordResolverForTests((ref) => {
        invocations += 1;
        expect(ref).toBe("op://Argent/Composio/api_key");
        return { ok: true, value: "the-real-key-value" };
      });

      const value = mod.resolveServiceKey("COMPOSIO_API_KEY");
      expect(value).toBe("the-real-key-value");
      expect(invocations).toBe(1);
    });
  });

  it("falls back to process.env when the op:// resolver reports a failure", async () => {
    await withTempHome(
      async () => {
        const mod = await loadServiceKeysModule();
        mod.saveServiceKeys({
          version: 1,
          keys: [
            {
              id: "sk-op-ref-2",
              name: "Atera",
              variable: "ATERA_API_KEY",
              value: "op://Argent/Atera/api_key",
              enabled: true,
            },
          ],
        });
        mod.__setOnePasswordResolverForTests(() => ({
          ok: false,
          errorCode: "op_cli_missing",
          errorMessage: "no op binary",
        }));

        const value = mod.resolveServiceKey("ATERA_API_KEY");
        expect(value).toBe("env-atera-fallback");
      },
      { env: { ATERA_API_KEY: "env-atera-fallback" } },
    );
  });

  it("non-ref values still resolve through the existing decrypt path", async () => {
    await withTempHome(async () => {
      const mod = await loadServiceKeysModule();
      const crypto = await import("./secret-crypto.js");
      mod.saveServiceKeys({
        version: 1,
        keys: [
          {
            id: "sk-literal",
            name: "Brave",
            variable: "BRAVE_API_KEY",
            value: crypto.encryptSecret("literal-brave-value"),
            enabled: true,
          },
        ],
      });
      // Ensure the resolver hook is NOT called for literal values.
      mod.__setOnePasswordResolverForTests(() => {
        throw new Error("resolver should not be called for literal values");
      });
      const value = mod.resolveServiceKey("BRAVE_API_KEY");
      expect(value).toBe("literal-brave-value");
    });
  });

  it("cache TTL boundary: hit within TTL, miss after", async () => {
    const resolver = await loadResolverModule();
    resolver.clearOnePasswordCache();

    let invocations = 0;
    let clock = 1_000_000;
    const exec = () => {
      invocations += 1;
      return { stdout: `value-${invocations}`, stderr: "", status: 0 };
    };

    const first = resolver.resolveOnePasswordRef("op://V/I/f", {
      exec,
      cacheTtlMs: 60_000,
      now: () => clock,
    });
    expect(first.ok).toBe(true);
    expect(first.value).toBe("value-1");

    // Within TTL -> cache hit
    clock += 30_000;
    const within = resolver.resolveOnePasswordRef("op://V/I/f", {
      exec,
      cacheTtlMs: 60_000,
      now: () => clock,
    });
    expect(within.value).toBe("value-1");
    expect(invocations).toBe(1);

    // Past TTL -> miss
    clock += 31_000;
    const past = resolver.resolveOnePasswordRef("op://V/I/f", {
      exec,
      cacheTtlMs: 60_000,
      now: () => clock,
    });
    expect(past.value).toBe("value-2");
    expect(invocations).toBe(2);
    resolver.clearOnePasswordCache();
  });

  it("when op CLI is missing the integration falls through gracefully", async () => {
    await withTempHome(
      async () => {
        const mod = await loadServiceKeysModule();
        mod.saveServiceKeys({
          version: 1,
          keys: [
            {
              id: "sk-no-op",
              name: "X",
              variable: "X_KEY",
              value: "op://Argent/X/k",
              enabled: true,
            },
          ],
        });
        // Simulate "op missing" via the resolver hook.
        mod.__setOnePasswordResolverForTests(() => ({
          ok: false,
          errorCode: "op_cli_missing",
          errorMessage: "op not found",
        }));
        const value = mod.resolveServiceKey("X_KEY");
        // Falls through to env, which we didn't set -> undefined (not a crash).
        expect(value).toBeUndefined();
      },
      { env: {} },
    );
  });
});
