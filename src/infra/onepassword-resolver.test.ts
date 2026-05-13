import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearOnePasswordCache,
  isOnePasswordRef,
  maskRef,
  parseOnePasswordRef,
  redactToken,
  resetOpAvailabilityCache,
  resolveOnePasswordRef,
  resolveServiceAccountToken,
} from "./onepassword-resolver.js";

describe("onepassword-resolver", () => {
  const originalToken = process.env.OP_SERVICE_ACCOUNT_TOKEN;

  beforeEach(() => {
    clearOnePasswordCache();
    resetOpAvailabilityCache();
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "ops_test_token_AAAAAAAAAA";
  });

  afterEach(() => {
    clearOnePasswordCache();
    resetOpAvailabilityCache();
    if (originalToken === undefined) {
      delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
    } else {
      process.env.OP_SERVICE_ACCOUNT_TOKEN = originalToken;
    }
  });

  it("isOnePasswordRef detects the prefix", () => {
    expect(isOnePasswordRef("op://Vault/Item/field")).toBe(true);
    expect(isOnePasswordRef("op://Private/MyToken/credential")).toBe(true);
    expect(isOnePasswordRef("hello")).toBe(false);
    expect(isOnePasswordRef("")).toBe(false);
    expect(isOnePasswordRef(null)).toBe(false);
    expect(isOnePasswordRef(undefined)).toBe(false);
  });

  it("parseOnePasswordRef splits vault/item/field", () => {
    expect(parseOnePasswordRef("op://Vault/Item/field")).toEqual({
      vault: "Vault",
      item: "Item",
      field: "field",
    });
    // Field may contain slashes (sections), they collapse via reconstruction.
    expect(parseOnePasswordRef("op://V/I/section/field")).toEqual({
      vault: "V",
      item: "I",
      field: "section/field",
    });
    // Malformed refs return null.
    expect(parseOnePasswordRef("op://Vault/Item")).toBeNull();
    expect(parseOnePasswordRef("op://Vault")).toBeNull();
    expect(parseOnePasswordRef("op://")).toBeNull();
    expect(parseOnePasswordRef("not-a-ref")).toBeNull();
  });

  it("maskRef hides the item and field but keeps the vault", () => {
    expect(maskRef("op://Argent/Composio/api_key")).toBe("op://Argent/<item>/<field>");
    expect(maskRef("not-a-ref")).toBe("(not-a-ref)");
    expect(maskRef("op://oops")).toBe("op://<malformed>");
  });

  it("redactToken replaces the token literal", () => {
    const t = "ops_supersecret_token_value";
    const msg = `failed because token=${t} expired`;
    expect(redactToken(msg, t)).toBe("failed because token=[redacted] expired");
    // Short / missing tokens are passed through.
    expect(redactToken("plain message", null)).toBe("plain message");
    expect(redactToken("plain message", "")).toBe("plain message");
  });

  it("resolveServiceAccountToken prefers explicit option, then env", () => {
    expect(resolveServiceAccountToken({ serviceAccountToken: "explicit_value" })).toBe(
      "explicit_value",
    );
    expect(resolveServiceAccountToken()).toBe("ops_test_token_AAAAAAAAAA");
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
    expect(resolveServiceAccountToken()).toBeNull();
  });

  it("resolveOnePasswordRef rejects non-refs", () => {
    const result = resolveOnePasswordRef("not-an-op-ref", {
      exec: () => ({ stdout: "", stderr: "", status: 0 }),
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("not_a_ref");
  });

  it("resolveOnePasswordRef rejects malformed refs", () => {
    const result = resolveOnePasswordRef("op://VaultOnly", {
      exec: () => ({ stdout: "", stderr: "", status: 0 }),
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("invalid_ref");
  });

  it("resolveOnePasswordRef returns token_missing when no token configured", () => {
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
    const result = resolveOnePasswordRef("op://Argent/Item/field", {
      exec: () => ({ stdout: "value", stderr: "", status: 0 }),
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("token_missing");
  });

  it("resolveOnePasswordRef returns the value on success", () => {
    let invoked = 0;
    const result = resolveOnePasswordRef("op://Argent/Item/field", {
      exec: (args, env) => {
        invoked += 1;
        expect(args).toEqual(["read", "op://Argent/Item/field"]);
        // Sanity: the token is propagated to the child env.
        expect(env.OP_SERVICE_ACCOUNT_TOKEN).toBe("ops_test_token_AAAAAAAAAA");
        return { stdout: "resolved-secret-value\n", stderr: "", status: 0 };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.value).toBe("resolved-secret-value");
    expect(invoked).toBe(1);
  });

  it("resolveOnePasswordRef returns op_cli_failed on non-zero exit", () => {
    const result = resolveOnePasswordRef("op://Argent/Item/field", {
      exec: () => ({ stdout: "", stderr: "item not found", status: 1 }),
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("op_cli_failed");
    expect(result.errorMessage).toContain("item not found");
  });

  it("resolveOnePasswordRef redacts the token from any error message", () => {
    const result = resolveOnePasswordRef("op://Argent/Item/field", {
      exec: () => ({
        stdout: "",
        stderr: "auth failed for ops_test_token_AAAAAAAAAA expired",
        status: 1,
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).not.toContain("ops_test_token_AAAAAAAAAA");
    expect(result.errorMessage).toContain("[redacted]");
  });

  it("caches within the TTL window and re-resolves after it expires", () => {
    let invocations = 0;
    let clock = 1_000_000;
    const exec = () => {
      invocations += 1;
      return { stdout: `value-${invocations}`, stderr: "", status: 0 };
    };

    // First call resolves and caches.
    const first = resolveOnePasswordRef("op://A/B/c", {
      exec,
      cacheTtlMs: 60_000,
      now: () => clock,
    });
    expect(first.ok).toBe(true);
    expect(first.value).toBe("value-1");
    expect(invocations).toBe(1);

    // Within the TTL — cache hit, no new invocation.
    clock += 30_000;
    const second = resolveOnePasswordRef("op://A/B/c", {
      exec,
      cacheTtlMs: 60_000,
      now: () => clock,
    });
    expect(second.ok).toBe(true);
    expect(second.value).toBe("value-1");
    expect(invocations).toBe(1);

    // Just past the TTL — refresh.
    clock += 31_000; // total 61s elapsed
    const third = resolveOnePasswordRef("op://A/B/c", {
      exec,
      cacheTtlMs: 60_000,
      now: () => clock,
    });
    expect(third.ok).toBe(true);
    expect(third.value).toBe("value-2");
    expect(invocations).toBe(2);
  });

  it("ttl=0 disables caching", () => {
    let invocations = 0;
    const exec = () => {
      invocations += 1;
      return { stdout: `v${invocations}`, stderr: "", status: 0 };
    };
    resolveOnePasswordRef("op://A/B/c", { exec, cacheTtlMs: 0 });
    resolveOnePasswordRef("op://A/B/c", { exec, cacheTtlMs: 0 });
    expect(invocations).toBe(2);
  });

  it("empty stdout is reported as empty_value", () => {
    const result = resolveOnePasswordRef("op://A/B/c", {
      exec: () => ({ stdout: "", stderr: "", status: 0 }),
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("empty_value");
  });

  it("clearOnePasswordCache flushes cached entries", () => {
    let invocations = 0;
    const exec = () => {
      invocations += 1;
      return { stdout: `value-${invocations}`, stderr: "", status: 0 };
    };
    resolveOnePasswordRef("op://A/B/c", { exec, cacheTtlMs: 60_000, now: () => 1 });
    resolveOnePasswordRef("op://A/B/c", { exec, cacheTtlMs: 60_000, now: () => 1 });
    expect(invocations).toBe(1);
    clearOnePasswordCache();
    resolveOnePasswordRef("op://A/B/c", { exec, cacheTtlMs: 60_000, now: () => 1 });
    expect(invocations).toBe(2);
  });
});
