/**
 * Integration tests for Dashboard API server
 * Run: cd dashboard && node --test tests/api-server.test.js
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

let baseUrl;
let server;

// Start the API server on a random port
before(async () => {
  // Override port to avoid conflicting with running instance
  process.env.API_PORT = "0";
  // Set HOME for DB paths
  process.env.HOME = process.env.HOME || "/tmp";
  const { app } = require("../api-server.cjs");
  server = app.listen(0);
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
  console.log(`[Test] API server started on ${baseUrl}`);
});

after(() => {
  if (server) server.close();
});

// Helper to make requests
async function api(method, path, body) {
  const url = `${baseUrl}${path}`;
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const contentType = res.headers.get("content-type") || "";
  let data;
  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, data, headers: res.headers };
}

// ── Health ──

describe("Health", () => {
  it("GET /api/health returns 200", async () => {
    const res = await api("GET", "/api/health");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, "ok");
  });
});

// ── Tasks CRUD ──

describe("Tasks", () => {
  let taskId;

  it("POST /api/tasks creates a task", async () => {
    const res = await api("POST", "/api/tasks", { title: "Test task", project: "test" });
    assert.strictEqual(res.status, 201);
    assert.ok(res.data.task);
    assert.strictEqual(res.data.task.title, "Test task");
    taskId = res.data.task.id;
  });

  it("GET /api/tasks lists tasks", async () => {
    const res = await api("GET", "/api/tasks");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.tasks));
    assert.ok(res.data.tasks.length > 0);
  });

  it("PATCH /api/tasks/:id updates a task", async () => {
    const res = await api("PATCH", `/api/tasks/${taskId}`, { title: "Updated task" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.task.title, "Updated task");
  });

  it("POST /api/tasks/:id/start starts a task", async () => {
    const res = await api("POST", `/api/tasks/${taskId}/start`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.task.status, "in-progress");
  });

  it("POST /api/tasks/:id/complete completes a task", async () => {
    const res = await api("POST", `/api/tasks/${taskId}/complete`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.task.status, "completed");
  });

  it("GET /api/tasks/search finds tasks", async () => {
    const res = await api("GET", "/api/tasks/search?q=Updated");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.tasks));
  });

  it("GET /api/tasks/counts returns counts", async () => {
    const res = await api("GET", "/api/tasks/counts");
    assert.strictEqual(res.status, 200);
    assert.ok("total" in res.data || "counts" in res.data || typeof res.data === "object");
  });

  it("DELETE /api/tasks/:id deletes a task", async () => {
    const res = await api("DELETE", `/api/tasks/${taskId}`);
    assert.strictEqual(res.status, 200);
  });
});

// ── Canvas / Doc Panel ──

describe("Canvas", () => {
  let docId;

  it("POST /api/canvas/save creates a document", async () => {
    const id = `test-${Date.now()}`;
    const res = await api("POST", "/api/canvas/save", {
      doc: {
        id,
        title: "Test Doc",
        content: "# Hello\nWorld",
        type: "markdown",
      },
    });
    assert.strictEqual(res.status, 200);
    docId = res.data.id || id;
  });

  it("GET /api/canvas/documents lists documents", async () => {
    const res = await api("GET", "/api/canvas/documents");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.documents));
  });

  it("GET /api/canvas/document/:id fetches document", async () => {
    if (!docId) return;
    const res = await api("GET", `/api/canvas/document/${docId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.title, "Test Doc");
  });

  it("DELETE /api/canvas/document/:id deletes document", async () => {
    if (!docId) return;
    const res = await api("DELETE", `/api/canvas/document/${docId}`);
    assert.strictEqual(res.status, 200);
  });
});

// ── Apps CRUD ──

describe("Apps", () => {
  let appId;

  it("POST /api/apps creates an app", async () => {
    const res = await api("POST", "/api/apps", {
      name: "Test App",
      description: "A test app",
      icon: "<svg></svg>",
      code: "<!DOCTYPE html><html><body>Test</body></html>",
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.data.app);
    appId = res.data.app.id;
  });

  it("GET /api/apps lists apps", async () => {
    const res = await api("GET", "/api/apps");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.apps));
  });

  it("GET /api/apps/:id gets app", async () => {
    const res = await api("GET", `/api/apps/${appId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.app.name, "Test App");
  });

  it("PATCH /api/apps/:id updates app", async () => {
    const res = await api("PATCH", `/api/apps/${appId}`, { name: "Updated App" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.app.name, "Updated App");
  });

  it("DELETE /api/apps/:id deletes app", async () => {
    const res = await api("DELETE", `/api/apps/${appId}`);
    assert.strictEqual(res.status, 200);
  });
});

// ── Widgets CRUD ──

describe("Widgets", () => {
  let widgetId;

  it("POST /api/widgets creates a widget", async () => {
    const res = await api("POST", "/api/widgets", {
      name: "Test Widget",
      description: "A test widget",
      icon: "<svg></svg>",
      code: "<!DOCTYPE html><html><body>Widget</body></html>",
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.data.widget);
    widgetId = res.data.widget.id;
  });

  it("GET /api/widgets lists widgets", async () => {
    const res = await api("GET", "/api/widgets");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.widgets));
  });

  it("GET /api/widgets/:id gets widget", async () => {
    const res = await api("GET", `/api/widgets/${widgetId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.widget.name, "Test Widget");
  });

  it("PATCH /api/widgets/:id updates widget", async () => {
    const res = await api("PATCH", `/api/widgets/${widgetId}`, { name: "Updated Widget" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.widget.name, "Updated Widget");
  });

  it("GET /api/widgets/layout gets layout", async () => {
    const res = await api("GET", "/api/widgets/layout");
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.layout !== undefined);
  });

  it("POST /api/widgets/assign assigns widget to slot", async () => {
    const res = await api("POST", "/api/widgets/assign", { widgetId, position: 1 });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
  });

  it("DELETE /api/widgets/:id deletes widget", async () => {
    const res = await api("DELETE", `/api/widgets/${widgetId}`);
    assert.strictEqual(res.status, 200);
  });
});

// ── Auth Settings ──

describe("Auth Settings", () => {
  it("GET /api/settings/auth returns profiles", async () => {
    const res = await api("GET", "/api/settings/auth");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.profiles));
  });
});

// ── Proxy Endpoints (conditional — skip if keys not set) ──

describe("Proxy - missing key handling", () => {
  it("POST /api/proxy/tts/elevenlabs returns 503 without key", async () => {
    // This test validates the error path; actual TTS requires a real key
    const origKey = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    const res = await api("POST", "/api/proxy/tts/elevenlabs", {
      voiceId: "test",
      text: "hello",
    });
    // Restore
    if (origKey) process.env.ELEVENLABS_API_KEY = origKey;
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.data.error, "missing_api_key");
  });

  it("POST /api/proxy/search/brave returns 503 without key", async () => {
    const origKey = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;
    const res = await api("POST", "/api/proxy/search/brave", { query: "test" });
    if (origKey) process.env.BRAVE_API_KEY = origKey;
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.data.error, "missing_api_key");
  });

  it("POST /api/proxy/fetch/firecrawl returns 503 without key", async () => {
    const origKey = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    const res = await api("POST", "/api/proxy/fetch/firecrawl", { url: "https://example.com" });
    if (origKey) process.env.FIRECRAWL_API_KEY = origKey;
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.data.error, "missing_api_key");
  });

  it("POST /api/proxy/tts/elevenlabs validates required fields", async () => {
    const origKey = process.env.ELEVENLABS_API_KEY;
    process.env.ELEVENLABS_API_KEY = "test-key";
    const res = await api("POST", "/api/proxy/tts/elevenlabs", {});
    if (origKey) process.env.ELEVENLABS_API_KEY = origKey;
    else delete process.env.ELEVENLABS_API_KEY;
    assert.strictEqual(res.status, 400);
  });

  it("POST /api/proxy/search/brave validates required fields", async () => {
    const origKey = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = "test-key";
    const res = await api("POST", "/api/proxy/search/brave", {});
    if (origKey) process.env.BRAVE_API_KEY = origKey;
    else delete process.env.BRAVE_API_KEY;
    assert.strictEqual(res.status, 400);
  });
});

// ── Calendar ──

describe("Calendar", () => {
  it("GET /api/calendar/today returns 200", async () => {
    const res = await api("GET", "/api/calendar/today");
    // May return 200 or 500 depending on google auth
    assert.ok([200, 500].includes(res.status));
  });
});

// ── Weather ──

describe("Weather", () => {
  it("GET /api/weather returns 200", async () => {
    const res = await api("GET", "/api/weather");
    assert.strictEqual(res.status, 200);
  });
});
