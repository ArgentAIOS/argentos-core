/**
 * ComposioSettingsPanel — pure-helper tests (slice 2.2).
 *
 * The Q7 contract is TS-only. Dashboard tests run with vitest using a
 * mocked `fetch` — no jsdom — and assert the wire format the panel sends to
 * `/api/connectors/composio/*` and `/api/settings/service-keys`. Each test
 * exercises the helpers the React component uses verbatim, so a regression
 * in the data contract surfaces here before it ever reaches the UI.
 */

import { describe, expect, it, vi } from "vitest";
import {
  COMPOSIO_DEFAULT_LEARN_MORE_URL,
  deriveComposioBadge,
  emptyComposioStatus,
  formatPreferComposioForInput,
  loadComposioStatus,
  parsePreferComposioInput,
  replaceComposioApiKey,
  runComposioConnectivityProbe,
  saveComposioApiKey,
  saveComposioFlags,
  type ComposioStatusResponse,
} from "./composioSettings";

function mockFetch(responses: Array<{ ok?: boolean; status?: number; json?: unknown }>): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; method: string; body: unknown }>;
} {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  let i = 0;
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const next = responses[i++];
    if (!next) {
      throw new Error(`mockFetch: ran out of responses at call ${i}`);
    }
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({
      url: String(url),
      method: (init?.method || "GET").toUpperCase(),
      body,
    });
    return new Response(JSON.stringify(next.json ?? null), {
      status: next.status ?? (next.ok === false ? 500 : 200),
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("emptyComposioStatus + defaults", () => {
  it("Q4 default-off: enabled=false in flags even though the entry-level enabled stays true", () => {
    const empty = emptyComposioStatus("agent-a");
    expect(empty.configured).toBe(false);
    expect(empty.flags.enabled).toBe(false);
    expect(empty.flags.toolRouter?.enabled).toBe(false);
    expect(empty.apiKeyVariable).toBe("COMPOSIO_API_KEY");
    expect(empty.learnMoreUrl).toBe(COMPOSIO_DEFAULT_LEARN_MORE_URL);
  });
});

describe("deriveComposioBadge", () => {
  it("warns when no key is configured", () => {
    const status = emptyComposioStatus("a");
    expect(deriveComposioBadge(status).tone).toBe("warning");
    expect(deriveComposioBadge(status).label).toBe("Not configured");
  });

  it("reports neutral 'Disabled' when key configured but flag off", () => {
    const status: ComposioStatusResponse = {
      ...emptyComposioStatus("a"),
      configured: true,
      apiKeyTail: "…1234",
      flags: { enabled: false, toolRouter: { enabled: false }, preferComposio: [] },
    };
    expect(deriveComposioBadge(status).tone).toBe("neutral");
    expect(deriveComposioBadge(status).label).toBe("Disabled");
  });

  it("flags 'Enabled' when master flag on, Tool Router off", () => {
    const status: ComposioStatusResponse = {
      ...emptyComposioStatus("a"),
      configured: true,
      apiKeyTail: "…1234",
      flags: { enabled: true, toolRouter: { enabled: false }, preferComposio: [] },
    };
    expect(deriveComposioBadge(status).label).toBe("Enabled");
    expect(deriveComposioBadge(status).tone).toBe("ready");
  });

  it("flags 'Tool Router (beta)' when both flags on", () => {
    const status: ComposioStatusResponse = {
      ...emptyComposioStatus("a"),
      configured: true,
      apiKeyTail: "…1234",
      flags: { enabled: true, toolRouter: { enabled: true }, preferComposio: ["airtable"] },
    };
    expect(deriveComposioBadge(status).label).toBe("Tool Router (beta)");
    expect(deriveComposioBadge(status).tone).toBe("ready");
  });
});

describe("parsePreferComposioInput", () => {
  it("splits on commas and newlines, lowercases, trims", () => {
    expect(parsePreferComposioInput("Airtable, asana\ngithub")).toEqual([
      "airtable",
      "asana",
      "github",
    ]);
  });

  it("dedupes and drops empties", () => {
    expect(parsePreferComposioInput("airtable,airtable, ,Airtable")).toEqual(["airtable"]);
  });

  it("handles undefined/empty inputs", () => {
    expect(parsePreferComposioInput(undefined)).toEqual([]);
    expect(parsePreferComposioInput("")).toEqual([]);
    expect(parsePreferComposioInput("   ")).toEqual([]);
  });

  it("formatPreferComposioForInput round-trips", () => {
    const list = parsePreferComposioInput("airtable, asana");
    expect(formatPreferComposioForInput(list)).toBe("airtable, asana");
  });
});

describe("loadComposioStatus", () => {
  it("issues GET /api/connectors/composio/status?agentId=… and normalizes the payload", async () => {
    const { fetchImpl, calls } = mockFetch([
      {
        json: {
          agentId: "actor-a",
          configured: true,
          apiKeyTail: "…abcd",
          enabled: true,
          allowedAgents: ["actor-a"],
          flags: { enabled: true, toolRouter: { enabled: false }, preferComposio: ["airtable"] },
          flagsAvailable: true,
          keyId: "sk-123",
          apiKeyVariable: "COMPOSIO_API_KEY",
          learnMoreUrl: "https://app.composio.dev",
        },
      },
    ]);
    const status = await loadComposioStatus({ agentId: "actor-a", fetchImpl });
    expect(calls[0]).toEqual({
      url: "/api/connectors/composio/status?agentId=actor-a",
      method: "GET",
      body: undefined,
    });
    expect(status.configured).toBe(true);
    expect(status.apiKeyTail).toBe("…abcd");
    expect(status.flags.enabled).toBe(true);
    expect(status.flagsAvailable).toBe(true);
    expect(status.keyId).toBe("sk-123");
    expect(status.allowedAgents).toEqual(["actor-a"]);
  });

  it("returns the empty default-off status on an empty agentId", async () => {
    const { fetchImpl, calls } = mockFetch([]);
    const status = await loadComposioStatus({ agentId: "", fetchImpl });
    expect(calls).toHaveLength(0);
    expect(status.flags.enabled).toBe(false);
    expect(status.configured).toBe(false);
  });

  it("falls back to empty when the server returns an error", async () => {
    const { fetchImpl } = mockFetch([{ status: 500, json: { error: "boom" } }]);
    const status = await loadComposioStatus({ agentId: "actor-a", fetchImpl });
    expect(status.configured).toBe(false);
    expect(status.flagsAvailable).toBe(false);
  });
});

describe("saveComposioApiKey", () => {
  it("POSTs to /api/settings/service-keys with the COMPOSIO_API_KEY shape", async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 201, json: { key: { id: "sk-new" } } }]);
    const result = await saveComposioApiKey({
      value: "ck_test_abcd",
      agentId: "actor-a",
      fetchImpl,
    });
    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toBe("/api/settings/service-keys");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({
      variable: "COMPOSIO_API_KEY",
      value: "ck_test_abcd",
      service: "Composio",
      category: "Connectors",
      allowedAgents: ["actor-a"],
    });
  });

  it("rejects empty values without calling the API", async () => {
    const { fetchImpl, calls } = mockFetch([]);
    const result = await saveComposioApiKey({ value: "   ", agentId: "actor-a", fetchImpl });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("relays server error messages", async () => {
    const { fetchImpl } = mockFetch([{ status: 400, json: { error: "boom" } }]);
    const result = await saveComposioApiKey({
      value: "ck_x",
      agentId: "actor-a",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("boom");
    }
  });
});

describe("replaceComposioApiKey", () => {
  it("PATCHes the existing keyId when present", async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, json: { key: { id: "sk-1" } } }]);
    const result = await replaceComposioApiKey({
      keyId: "sk-1",
      value: "ck_v2",
      agentId: "actor-a",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe("/api/settings/service-keys/sk-1");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toEqual({ value: "ck_v2" });
  });

  it("falls back to POST when no keyId is known", async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 201, json: { key: { id: "sk-new" } } }]);
    const result = await replaceComposioApiKey({
      keyId: null,
      value: "ck_v1",
      agentId: "actor-a",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(calls[0].method).toBe("POST");
  });
});

describe("saveComposioFlags", () => {
  it("PUTs the per-agent flags and returns the server-normalized shape", async () => {
    const { fetchImpl, calls } = mockFetch([
      {
        status: 200,
        json: {
          agentId: "actor-a",
          flags: {
            enabled: true,
            toolRouter: { enabled: true },
            preferComposio: ["airtable"],
          },
        },
      },
    ]);
    const result = await saveComposioFlags({
      agentId: "actor-a",
      enabled: true,
      toolRouterEnabled: true,
      preferComposio: ["airtable"],
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe("/api/connectors/composio/flags");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body).toEqual({
      agentId: "actor-a",
      enabled: true,
      toolRouterEnabled: true,
      preferComposio: ["airtable"],
    });
    if (result.ok) {
      expect(result.flags.enabled).toBe(true);
      expect(result.flags.toolRouter?.enabled).toBe(true);
      expect(result.flags.preferComposio).toEqual(["airtable"]);
    }
  });

  it("rejects empty agentId without calling the API", async () => {
    const { fetchImpl, calls } = mockFetch([]);
    const result = await saveComposioFlags({
      agentId: "  ",
      enabled: true,
      toolRouterEnabled: false,
      preferComposio: [],
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("runComposioConnectivityProbe", () => {
  it("POSTs to /api/connectors/composio/test with the agentId", async () => {
    const { fetchImpl, calls } = mockFetch([
      {
        status: 200,
        json: {
          ok: true,
          userId: "actor-a",
          apiKeyTail: "…1234",
          baseURL: "https://api.composio.dev",
          probedAt: "2026-05-06T00:00:00Z",
        },
      },
    ]);
    const result = await runComposioConnectivityProbe({ agentId: "actor-a", fetchImpl });
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe("/api/connectors/composio/test");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ agentId: "actor-a" });
  });

  it("classifies an empty agentId locally without hitting the API", async () => {
    const { fetchImpl, calls } = mockFetch([]);
    const result = await runComposioConnectivityProbe({ agentId: "  ", fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-actor-identity");
    expect(calls).toHaveLength(0);
  });

  it("relays a structured failure shape from the server", async () => {
    const { fetchImpl } = mockFetch([
      {
        status: 200,
        json: {
          ok: false,
          reason: "auth-error",
          message: "401 unauthorized",
          apiKeyTail: "…dead",
        },
      },
    ]);
    const result = await runComposioConnectivityProbe({ agentId: "actor-a", fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("auth-error");
    expect(result.apiKeyTail).toBe("…dead");
  });

  it("classifies a thrown fetch as network-error (panel renders the rose banner)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const result = await runComposioConnectivityProbe({ agentId: "actor-a", fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("network-error");
    expect(result.message).toContain("ENOTFOUND");
  });
});
