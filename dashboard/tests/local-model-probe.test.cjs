/**
 * Unit tests for the local-runtime probe + background-model suggestion filter
 * (bugs #214, #218, #219, #LM-Studio-models-section).
 *
 * These tests stub global fetch so the probe is exercised without a live
 * Ollama / LM Studio daemon — CI hosts don't run either.
 *
 * Run: cd dashboard && node --test tests/local-model-probe.test.cjs
 */
const { describe, it, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let api;
let originalFetch;
let originalHome;
let tempHome;

// Bring up the api-server module once with a sandboxed HOME so it doesn't
// inherit the developer's argent.json (which can configure custom LM Studio
// baseUrls and pollute probe state).
before(() => {
  originalHome = process.env.HOME;
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "argent-probe-test-"));
  process.env.HOME = tempHome;
  process.env.API_PORT = "0";
  delete process.env.DASHBOARD_API_TOKEN;
  // Clear module cache so the module re-evaluates against the new HOME.
  delete require.cache[require.resolve("../api-server.cjs")];
  ({ __test: api } = require("../api-server.cjs"));
});

after(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (tempHome) {
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFetchStub(handlers) {
  return async (url) => {
    const u = String(url);
    for (const [pattern, response] of Object.entries(handlers)) {
      if (u.includes(pattern)) {
        if (response instanceof Error) {
          throw response;
        }
        return response;
      }
    }
    // Default: simulate not-running
    const err = new Error(`ECONNREFUSED for ${u}`);
    err.code = "ECONNREFUSED";
    throw err;
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

// ── probeLocalModelRuntimes ────────────────────────────────────────────────

describe("probeLocalModelRuntimes", () => {
  it("detects LM Studio /v1/models when reachable", async () => {
    global.fetch = makeFetchStub({
      // v0 endpoint absent → server should fall back to /v1/models.
      "127.0.0.1:1234/api/v0/models": jsonResponse(
        { error: "not found" },
        { ok: false, status: 404 },
      ),
      "127.0.0.1:1234/v1/models": jsonResponse({
        data: [
          { id: "qwen/qwen3.6-35b-a3b", owned_by: "organization_owner" },
          { id: "google/gemma-4-31b", owned_by: "organization_owner" },
        ],
      }),
    });

    const pushed = [];
    const pushModel = (id, alias, params) => pushed.push({ id, params });
    const runtimes = await api.probeLocalModelRuntimes({}, {}, pushModel);

    const lm = runtimes.find((r) => r.provider === "lmstudio");
    assert.ok(lm, "lmstudio runtime entry present");
    assert.strictEqual(lm.running, true, "LM Studio reports running");
    assert.strictEqual(lm.source, "v1", "fell back to legacy v1 endpoint");
    assert.strictEqual(lm.models.length, 2);
    assert.deepStrictEqual(lm.models.map((m) => m.ref).sort(), [
      "lmstudio/google/gemma-4-31b",
      "lmstudio/qwen/qwen3.6-35b-a3b",
    ]);
    // v1 fallback can't distinguish load state → all entries report null.
    for (const m of lm.models) {
      assert.strictEqual(m.loaded, null, "v1 fallback marks load state unknown");
    }

    // pushModel must have been called with liveRuntime provenance.
    const lmPushed = pushed.filter((p) => p.id.startsWith("lmstudio/"));
    assert.strictEqual(lmPushed.length, 2);
    for (const entry of lmPushed) {
      assert.strictEqual(entry.params?.liveRuntime, "lmstudio");
    }
  });

  it("prefers /api/v0/models and surfaces per-model load state (GH #220)", async () => {
    // v0 returns the same catalog plus `state: 'loaded' | 'not-loaded'` per model.
    // v1 should NOT be consulted when v0 succeeds — assert by making v1 throw.
    let v1Called = false;
    global.fetch = makeFetchStub({
      "127.0.0.1:1234/api/v0/models": jsonResponse({
        data: [
          { id: "qwen/qwen3.6-35b-a3b", state: "loaded", publisher: "qwen" },
          { id: "google/gemma-4-31b", state: "not-loaded", publisher: "google" },
          { id: "nvidia/nemotron-3-super", state: "loaded", publisher: "nvidia" },
          // Unknown / non-standard state should map to null (treated as "registered, unknown").
          { id: "openai/oss-20b", state: "loading", publisher: "openai" },
        ],
      }),
    });
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes("127.0.0.1:1234/v1/models")) {
        v1Called = true;
        throw new Error("v1 should not be hit when v0 succeeds");
      }
      return originalFetch(url);
    };

    const pushed = [];
    const pushModel = (id, alias, params) => pushed.push({ id, params });
    const runtimes = await api.probeLocalModelRuntimes({}, {}, pushModel);

    const lm = runtimes.find((r) => r.provider === "lmstudio");
    assert.ok(lm, "lmstudio runtime entry present");
    assert.strictEqual(lm.running, true);
    assert.strictEqual(lm.source, "v0", "v0 source recorded");
    assert.strictEqual(v1Called, false, "v1 endpoint not consulted when v0 succeeds");

    // All four models surface in the runtime entry — dropdown should be able
    // to render the full catalog with per-row distinction.
    assert.strictEqual(lm.models.length, 4);
    const byRef = Object.fromEntries(lm.models.map((m) => [m.ref, m]));
    assert.strictEqual(byRef["lmstudio/qwen/qwen3.6-35b-a3b"].loaded, true);
    assert.strictEqual(byRef["lmstudio/nvidia/nemotron-3-super"].loaded, true);
    assert.strictEqual(byRef["lmstudio/google/gemma-4-31b"].loaded, false);
    // Unknown state values normalize to null (treat as "registered, unknown").
    assert.strictEqual(byRef["lmstudio/openai/oss-20b"].loaded, null);

    // Catalog pushModel: ONLY loaded (or unknown-state) models should be
    // stamped with liveRuntime so the background-model suggestion engine
    // never recommends a not-loaded model. The not-loaded gemma must not
    // appear with liveRuntime provenance.
    const lmPushed = pushed.filter((p) => p.id.startsWith("lmstudio/"));
    const liveRefs = lmPushed.filter((p) => p.params?.liveRuntime === "lmstudio").map((p) => p.id);
    assert.ok(
      liveRefs.includes("lmstudio/qwen/qwen3.6-35b-a3b"),
      "loaded qwen model is marked live",
    );
    assert.ok(
      liveRefs.includes("lmstudio/nvidia/nemotron-3-super"),
      "loaded nemotron model is marked live",
    );
    assert.ok(
      !liveRefs.includes("lmstudio/google/gemma-4-31b"),
      "not-loaded gemma must NOT be stamped liveRuntime (would mislead suggestion engine)",
    );
  });

  it("falls back to /v1/models when /api/v0/models returns non-OK", async () => {
    global.fetch = makeFetchStub({
      "127.0.0.1:1234/api/v0/models": jsonResponse(
        { error: "method not allowed" },
        { ok: false, status: 405 },
      ),
      "127.0.0.1:1234/v1/models": jsonResponse({
        data: [{ id: "qwen/qwen3.6-27b" }],
      }),
    });
    const runtimes = await api.probeLocalModelRuntimes({}, {}, () => {});
    const lm = runtimes.find((r) => r.provider === "lmstudio");
    assert.strictEqual(lm.running, true);
    assert.strictEqual(lm.source, "v1");
    assert.strictEqual(lm.models.length, 1);
    assert.strictEqual(lm.models[0].loaded, null);
  });

  it("marks LM Studio not-running on connection refused (Bug 1)", async () => {
    global.fetch = makeFetchStub({
      // Only Ollama answers; LM Studio falls through to default refused.
      "127.0.0.1:11434/api/tags": jsonResponse({ models: [] }),
    });
    const runtimes = await api.probeLocalModelRuntimes({}, {}, () => {});
    const lm = runtimes.find((r) => r.provider === "lmstudio");
    assert.ok(lm);
    assert.strictEqual(lm.running, false);
    assert.strictEqual(lm.models.length, 0);
  });

  it("detects Ollama /api/tags when reachable", async () => {
    global.fetch = makeFetchStub({
      "127.0.0.1:11434/api/tags": jsonResponse({
        models: [{ name: "qwen3:30b-a3b-instruct-2507-q4_K_M" }, { name: "llama3.2:1b" }],
      }),
    });
    const pushed = [];
    const pushModel = (id, alias, params) => pushed.push({ id, params });
    const runtimes = await api.probeLocalModelRuntimes({}, {}, pushModel);
    const ollama = runtimes.find((r) => r.provider === "ollama");
    assert.ok(ollama);
    assert.strictEqual(ollama.running, true);
    assert.strictEqual(ollama.models.length, 2);
    // Live-runtime provenance stamped.
    const ollamaPushed = pushed.filter((p) => p.id.startsWith("ollama/"));
    for (const entry of ollamaPushed) {
      assert.strictEqual(entry.params?.liveRuntime, "ollama");
    }
  });

  it("returns both runtimes structured even if both are down", async () => {
    global.fetch = makeFetchStub({});
    const runtimes = await api.probeLocalModelRuntimes({}, {}, () => {});
    assert.strictEqual(runtimes.length, 2);
    for (const r of runtimes) {
      assert.strictEqual(r.running, false);
      assert.strictEqual(r.models.length, 0);
    }
  });
});

// ── probeLmStudioCatalogWithState (GH #220 — endpoint shape unit tests) ─────

describe("probeLmStudioCatalogWithState", () => {
  it("returns ok:false when baseUrl is empty", async () => {
    global.fetch = makeFetchStub({});
    const res = await api.probeLmStudioCatalogWithState("");
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.source, null);
    assert.deepStrictEqual(res.models, []);
  });

  it("handles a baseUrl with or without trailing /v1 identically", async () => {
    // Both probes should resolve to the same root + paths.
    global.fetch = makeFetchStub({
      "127.0.0.1:1234/api/v0/models": jsonResponse({
        data: [{ id: "qwen/qwen3.6-27b", state: "loaded" }],
      }),
    });
    const a = await api.probeLmStudioCatalogWithState("http://127.0.0.1:1234");
    const b = await api.probeLmStudioCatalogWithState("http://127.0.0.1:1234/v1");
    const c = await api.probeLmStudioCatalogWithState("http://127.0.0.1:1234/v1/");
    for (const r of [a, b, c]) {
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.source, "v0");
      assert.strictEqual(r.models.length, 1);
      assert.strictEqual(r.models[0].loaded, true);
    }
  });

  it("normalizes mixed loaded / not-loaded / unknown states", async () => {
    global.fetch = makeFetchStub({
      "127.0.0.1:1234/api/v0/models": jsonResponse({
        data: [
          { id: "a", state: "loaded" },
          { id: "b", state: "not-loaded" },
          { id: "c", state: "weird-future-state" },
          { id: "d" }, // no state field at all
        ],
      }),
    });
    const res = await api.probeLmStudioCatalogWithState("http://127.0.0.1:1234");
    const byId = Object.fromEntries(res.models.map((m) => [m.id, m]));
    assert.strictEqual(byId.a.loaded, true);
    assert.strictEqual(byId.b.loaded, false);
    assert.strictEqual(byId.c.loaded, null);
    assert.strictEqual(byId.d.loaded, null);
  });

  it("returns ok:false when both endpoints fail", async () => {
    global.fetch = makeFetchStub({
      "127.0.0.1:1234/api/v0/models": jsonResponse(null, { ok: false, status: 500 }),
      "127.0.0.1:1234/v1/models": jsonResponse(null, { ok: false, status: 500 }),
    });
    const res = await api.probeLmStudioCatalogWithState("http://127.0.0.1:1234");
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.source, null);
    assert.strictEqual(res.models.length, 0);
  });
});

// ── collectAvailableModelsCatalog ───────────────────────────────────────────

describe("collectAvailableModelsCatalog (Bug 2: dropdown population)", () => {
  it("returns localRuntimes alongside flat models list (Bug 1+2)", async () => {
    global.fetch = makeFetchStub({
      "127.0.0.1:1234/v1/models": jsonResponse({
        data: [{ id: "qwen/qwen3.6-27b" }],
      }),
    });
    const catalog = await api.collectAvailableModelsCatalog({});
    assert.ok(Array.isArray(catalog.models), "models is array");
    assert.ok(Array.isArray(catalog.localRuntimes), "localRuntimes is array");
    const lm = catalog.localRuntimes.find((r) => r.provider === "lmstudio");
    assert.ok(lm, "LM Studio runtime present");
    assert.strictEqual(lm.running, true);
    assert.ok(
      lm.models.some((m) => m.ref === "lmstudio/qwen/qwen3.6-27b"),
      "LM Studio model surfaces in localRuntimes",
    );
  });

  it("stamps liveRuntime params for currently-loaded LM Studio models", async () => {
    global.fetch = makeFetchStub({
      "127.0.0.1:1234/v1/models": jsonResponse({
        data: [{ id: "qwen/qwen3.6-35b-a3b" }],
      }),
    });
    const catalog = await api.collectAvailableModelsCatalog({});
    const live = catalog.models.find((m) => m.id === "lmstudio/qwen/qwen3.6-35b-a3b");
    assert.ok(live, "live LM Studio model present in flat catalog");
    assert.strictEqual(live.params?.liveRuntime, "lmstudio");
  });
});

// ── buildBackgroundModelRecommendations ─────────────────────────────────────

describe("buildBackgroundModelRecommendations (Bug 3: suggestion filter)", () => {
  function fakeCatalog({ liveLmStudio = [], liveOllama = [], configuredOnly = [] } = {}) {
    const models = [];
    const localRuntimes = [
      {
        provider: "ollama",
        label: "Ollama (Local)",
        running: liveOllama.length > 0,
        baseUrl: "http://127.0.0.1:11434",
        models: liveOllama.map((id) => ({
          id,
          ref: `ollama/${id}`,
          label: `ollama/${id}`,
        })),
      },
      {
        provider: "lmstudio",
        label: "LM Studio (Local)",
        running: liveLmStudio.length > 0,
        baseUrl: "http://127.0.0.1:1234/v1",
        models: liveLmStudio.map((id) => ({
          id,
          ref: `lmstudio/${id}`,
          label: `lmstudio/${id}`,
        })),
      },
    ];
    for (const id of liveLmStudio) {
      models.push({ id: `lmstudio/${id}`, alias: null, params: { liveRuntime: "lmstudio" } });
    }
    for (const id of liveOllama) {
      models.push({ id: `ollama/${id}`, alias: null, params: { liveRuntime: "ollama" } });
    }
    for (const id of configuredOnly) {
      models.push({ id, alias: null, params: null });
    }
    return { models, providers: [], localRuntimes };
  }

  it("never suggests a kernel model from a down runtime (Bug 3 root cause)", () => {
    // Ollama down, LM Studio loaded with qwen3.6 only.
    // Without the fix, qwen3.5-35b-a3b (configured but not loaded) would be
    // suggested. With the fix, only the live qwen3.6 should be suggested.
    const catalog = fakeCatalog({
      liveLmStudio: ["qwen/qwen3.6-35b-a3b", "qwen/qwen3.6-27b"],
      liveOllama: [],
      configuredOnly: [
        "lmstudio/qwen/qwen3.5-35b-a3b",
        "ollama/qwen3:30b-a3b-instruct-2507-q4_K_M",
      ],
    });
    const config = {
      agents: { defaults: { kernel: { localModel: "lmstudio/qwen/qwen3.6-27b" } } },
    };
    const recs = api.buildBackgroundModelRecommendations(config, catalog);
    const suggested = recs.lanes.kernel.suggested;
    assert.ok(
      suggested.ref.startsWith("lmstudio/"),
      `expected live lmstudio suggestion, got ${suggested.ref}`,
    );
    assert.notStrictEqual(
      suggested.ref,
      "lmstudio/qwen/qwen3.5-35b-a3b",
      "must never suggest the unloaded qwen3.5 model",
    );
    assert.notStrictEqual(
      suggested.ref,
      "ollama/qwen3:30b-a3b-instruct-2507-q4_K_M",
      "must never suggest from Ollama when Ollama is down",
    );
  });

  it("suggests empty for kernel when no live local model exists", () => {
    const catalog = fakeCatalog({
      liveLmStudio: [],
      liveOllama: [],
      configuredOnly: ["lmstudio/qwen/qwen3.5-35b-a3b"],
    });
    const config = { agents: { defaults: { kernel: { localModel: "" } } } };
    const recs = api.buildBackgroundModelRecommendations(config, catalog);
    assert.strictEqual(recs.lanes.kernel.suggested.ref, "");
  });

  it("filters down-runtime suggestions out of contemplation/heartbeat (Bug 3 cross-lane)", () => {
    // Ollama is down; suggestion engine must not surface ollama/... models.
    const catalog = fakeCatalog({
      liveLmStudio: ["qwen/qwen3.6-27b"],
      liveOllama: [],
      configuredOnly: [
        "ollama/qwen3:30b-a3b-instruct-2507-q4_K_M",
        "ollama/qwen3.5:27b",
        "groq/openai/gpt-oss-20b",
        "groq/llama-3.3-70b-versatile",
        "groq/qwen-qwq-32b",
      ],
    });
    const config = { agents: { defaults: { kernel: { localModel: "" } } } };
    const recs = api.buildBackgroundModelRecommendations(config, catalog);
    for (const laneName of ["contemplation", "sis", "heartbeat", "executionWorker"]) {
      const ref = recs.lanes[laneName].suggested.ref;
      if (!ref) {
        continue;
      }
      assert.ok(
        !ref.startsWith("ollama/"),
        `lane ${laneName} should not suggest Ollama when daemon is down (got ${ref})`,
      );
    }
  });

  it("preserves Ollama suggestions when Ollama is up", () => {
    const catalog = fakeCatalog({
      liveLmStudio: [],
      liveOllama: ["qwen3.5:27b", "nomic-embed-text:latest"],
      configuredOnly: ["groq/openai/gpt-oss-20b"],
    });
    const config = { agents: { defaults: { kernel: { localModel: "" } } } };
    const recs = api.buildBackgroundModelRecommendations(config, catalog);
    // Embeddings stack starts with ollama/nomic-embed-text:latest; if Ollama is
    // up that should win.
    assert.strictEqual(recs.lanes.embeddings.suggested.ref, "ollama/nomic-embed-text:latest");
  });
});
