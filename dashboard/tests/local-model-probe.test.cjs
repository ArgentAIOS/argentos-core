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
        if (response instanceof Error) throw response;
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
    assert.strictEqual(lm.models.length, 2);
    assert.deepStrictEqual(lm.models.map((m) => m.ref).sort(), [
      "lmstudio/google/gemma-4-31b",
      "lmstudio/qwen/qwen3.6-35b-a3b",
    ]);

    // pushModel must have been called with liveRuntime provenance.
    const lmPushed = pushed.filter((p) => p.id.startsWith("lmstudio/"));
    assert.strictEqual(lmPushed.length, 2);
    for (const entry of lmPushed) {
      assert.strictEqual(entry.params?.liveRuntime, "lmstudio");
    }
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
    for (const id of liveLmStudio)
      models.push({ id: `lmstudio/${id}`, alias: null, params: { liveRuntime: "lmstudio" } });
    for (const id of liveOllama)
      models.push({ id: `ollama/${id}`, alias: null, params: { liveRuntime: "ollama" } });
    for (const id of configuredOnly) models.push({ id, alias: null, params: null });
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
      if (!ref) continue;
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
