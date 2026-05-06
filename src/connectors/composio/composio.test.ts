/**
 * Composio connector — slice 2.1 tests.
 *
 * Q7 mandates a TS-only vitest harness; this test file mirrors the shape
 * of `src/infra/exec-approvals.test.ts` (gating + structured results) and
 * the per-actor isolation discipline of
 * `src/infra/service-keys.policy.test.ts`.
 *
 * The probe never throws — every assertion checks the structured
 * `ComposioConnectivityResult` envelope.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createComposioClient,
  isComposioEnabled,
  isComposioToolRouterEnabled,
  resolveComposioUserId,
  tailApiKey,
} from "./client.js";
import { checkComposioConnectivity } from "./connectivity.js";
import {
  COMPOSIO_API_KEY_VAR,
  DEFAULT_COMPOSIO_BASE_URL,
  type ComposioFeatureFlags,
} from "./types.js";

const ENABLED: ComposioFeatureFlags = { enabled: true };

describe("composio types & constants", () => {
  it("exports COMPOSIO_API_KEY_VAR pinned to the spec name", () => {
    expect(COMPOSIO_API_KEY_VAR).toBe("COMPOSIO_API_KEY");
  });

  it("defaults to Composio production base URL", () => {
    expect(DEFAULT_COMPOSIO_BASE_URL).toBe("https://api.composio.dev");
  });
});

describe("composio feature gating (Q4)", () => {
  it("isComposioEnabled defaults to false", () => {
    expect(isComposioEnabled()).toBe(false);
    expect(isComposioEnabled({})).toBe(false);
    expect(isComposioEnabled({ enabled: false })).toBe(false);
  });

  it("isComposioEnabled is true only on explicit opt-in", () => {
    expect(isComposioEnabled({ enabled: true })).toBe(true);
  });

  it("Tool Router stays off unless both gates are flipped (beta opt-in)", () => {
    expect(isComposioToolRouterEnabled({ enabled: true })).toBe(false);
    expect(isComposioToolRouterEnabled({ enabled: true, toolRouter: { enabled: false } })).toBe(
      false,
    );
    expect(isComposioToolRouterEnabled({ enabled: false, toolRouter: { enabled: true } })).toBe(
      false,
    );
    expect(isComposioToolRouterEnabled({ enabled: true, toolRouter: { enabled: true } })).toBe(
      true,
    );
  });
});

describe("composio user_id derivation (Q1)", () => {
  const previousAgentId = process.env.ARGENT_AGENT_ID;
  beforeEach(() => {
    delete process.env.ARGENT_AGENT_ID;
  });
  afterEach(() => {
    if (previousAgentId === undefined) {
      delete process.env.ARGENT_AGENT_ID;
    } else {
      process.env.ARGENT_AGENT_ID = previousAgentId;
    }
  });

  it("returns undefined when no actor context is provided", () => {
    expect(resolveComposioUserId()).toBeUndefined();
    expect(resolveComposioUserId({})).toBeUndefined();
  });

  it("normalizes the agent id to the same shape service-keys uses", () => {
    expect(resolveComposioUserId({ actorId: "Operator-Main" })).toBe("operator-main");
    expect(resolveComposioUserId({ actorId: "  Agent.Persona  " })).toBe("agent-persona");
  });

  it("falls back to ARGENT_AGENT_ID env when actor is empty", () => {
    process.env.ARGENT_AGENT_ID = "ArgentAgent";
    expect(resolveComposioUserId()).toBe("argentagent");
  });

  it("does not leak between actors — different inputs yield different ids", () => {
    expect(resolveComposioUserId({ actorId: "actor-a" })).toBe("actor-a");
    expect(resolveComposioUserId({ actorId: "actor-b" })).toBe("actor-b");
  });
});

describe("composio SDK client construction", () => {
  it("constructs with a valid API key (real @composio/core import)", () => {
    const client = createComposioClient({ apiKey: "ck_test_dummy_key" });
    expect(client).toBeDefined();
    // Sanity: SDK exposes the toolkits surface we probe in connectivity.
    expect(typeof (client as { toolkits?: unknown }).toolkits).toBe("object");
  });

  it("rejects an empty API key (programmer error)", () => {
    expect(() => createComposioClient({ apiKey: "" })).toThrow(/apiKey is required/);
    expect(() => createComposioClient({ apiKey: "   " })).toThrow(/apiKey is required/);
  });

  it("trims whitespace from the API key", () => {
    const client = createComposioClient({ apiKey: "  ck_pad  " });
    expect(client).toBeDefined();
  });

  it("redacts the API key when computing the audit tail", () => {
    expect(tailApiKey("ck_test_abcd1234")).toBe("…1234");
    expect(tailApiKey("xy")).toBe("**");
    expect(tailApiKey("")).toBe("*");
  });
});

describe("composio connectivity probe — failure paths (no network)", () => {
  it("returns feature-disabled when the per-agent gate is off (Q4)", async () => {
    const result = await checkComposioConnectivity({
      actor: { actorId: "actor-a" },
      flags: { enabled: false },
      resolveApiKey: () => "ck_should_not_be_used",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("feature-disabled");
      // Probe must not surface the API key tail when the feature gate trips
      // first — defense-in-depth against accidental leak.
      expect(result.apiKeyTail).toBeUndefined();
    }
  });

  it("returns missing-actor-identity when no user_id resolves (Q1)", async () => {
    const previous = process.env.ARGENT_AGENT_ID;
    delete process.env.ARGENT_AGENT_ID;
    try {
      const result = await checkComposioConnectivity({
        flags: ENABLED,
        resolveApiKey: () => "ck_should_not_be_used",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("missing-actor-identity");
      }
    } finally {
      if (previous !== undefined) {
        process.env.ARGENT_AGENT_ID = previous;
      }
    }
  });

  it("returns missing-api-key when service-keys yields nothing (Q2)", async () => {
    const result = await checkComposioConnectivity({
      actor: { actorId: "actor-a" },
      flags: ENABLED,
      resolveApiKey: () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing-api-key");
    }
  });
});

describe("composio connectivity probe — network paths (mocked SDK client)", () => {
  it("returns ok=true with userId + redacted tail on a successful read", async () => {
    const listCategories = vi.fn().mockResolvedValue([{ id: "communication" }]);
    const fakeClient = { toolkits: { listCategories } } as unknown as Parameters<
      typeof checkComposioConnectivity
    >[0] extends infer P
      ? P extends { client?: infer C }
        ? NonNullable<C>
        : never
      : never;

    const result = await checkComposioConnectivity({
      actor: { actorId: "ActorA" },
      flags: ENABLED,
      resolveApiKey: () => "ck_test_abcd1234",
      // The fake client bypasses real SDK construction entirely, so we
      // never make a real network call from the unit test.
      client: fakeClient,
    });

    expect(listCategories).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe("actora");
      expect(result.apiKeyTail).toBe("…1234");
      expect(result.baseURL).toBe(DEFAULT_COMPOSIO_BASE_URL);
      expect(typeof result.probedAt).toBe("string");
    }
  });

  it("classifies 401/unauthorized responses as auth-error", async () => {
    const listCategories = vi
      .fn()
      .mockRejectedValue(new Error("Request failed: 401 Unauthorized — invalid API key"));
    const result = await checkComposioConnectivity({
      actor: { actorId: "actor-a" },
      flags: ENABLED,
      resolveApiKey: () => "ck_test_bad",
      client: { toolkits: { listCategories } } as unknown as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("auth-error");
      expect(result.apiKeyTail).toBe("…_bad");
    }
  });

  it("classifies network errors as network-error", async () => {
    const listCategories = vi
      .fn()
      .mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.composio.dev"));
    const result = await checkComposioConnectivity({
      actor: { actorId: "actor-a" },
      flags: ENABLED,
      resolveApiKey: () => "ck_test_net",
      client: { toolkits: { listCategories } } as unknown as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network-error");
    }
  });

  it("falls through to unknown-error for unclassified failures", async () => {
    const listCategories = vi.fn().mockRejectedValue(new Error("kaboom"));
    const result = await checkComposioConnectivity({
      actor: { actorId: "actor-a" },
      flags: ENABLED,
      resolveApiKey: () => "ck_test_x",
      client: { toolkits: { listCategories } } as unknown as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unknown-error");
      expect(result.message).toBe("kaboom");
    }
  });

  it("respects an injected baseURL override (regional endpoints / fixtures)", async () => {
    const listCategories = vi.fn().mockResolvedValue([]);
    const result = await checkComposioConnectivity({
      actor: { actorId: "actor-a" },
      flags: ENABLED,
      resolveApiKey: () => "ck_test_ok",
      baseURL: "https://api-eu.composio.dev",
      client: { toolkits: { listCategories } } as unknown as never,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.baseURL).toBe("https://api-eu.composio.dev");
    }
  });
});

describe("composio per-actor isolation (cross-agent secret discipline)", () => {
  it("a falsy API key for actor A does not leak into actor B's probe", async () => {
    const calls: Array<{ actorId?: string }> = [];
    const resolveApiKey: Parameters<typeof checkComposioConnectivity>[0] extends infer P
      ? P extends { resolveApiKey?: infer R }
        ? NonNullable<R>
        : never
      : never = (actor) => {
      calls.push({ actorId: actor?.actorId });
      // Only actor B has a key configured.
      return actor?.actorId === "actor-b" ? "ck_test_only_b" : undefined;
    };

    const listCategories = vi.fn().mockResolvedValue([]);
    const client = { toolkits: { listCategories } } as unknown as never;

    const aResult = await checkComposioConnectivity({
      actor: { actorId: "actor-a" },
      flags: ENABLED,
      resolveApiKey,
      client,
    });
    const bResult = await checkComposioConnectivity({
      actor: { actorId: "actor-b" },
      flags: ENABLED,
      resolveApiKey,
      client,
    });

    expect(aResult.ok).toBe(false);
    if (!aResult.ok) {
      expect(aResult.reason).toBe("missing-api-key");
    }
    expect(bResult.ok).toBe(true);
    if (bResult.ok) {
      expect(bResult.userId).toBe("actor-b");
      expect(bResult.apiKeyTail).toBe("…ly_b");
    }

    // Each probe MUST consult the resolver with its own actor — no shared
    // memoization that could let actor-a inherit actor-b's key.
    expect(calls.map((c) => c.actorId)).toEqual(["actor-a", "actor-b"]);
  });
});
