const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let baseUrl;
let server;
let tempHome;
let configPath;

async function api(method, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

before(async () => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "argent-image-config-"));
  process.env.HOME = tempHome;
  process.env.API_PORT = "0";
  const configDir = path.join(tempHome, ".argentos");
  fs.mkdirSync(configDir, { recursive: true });
  configPath = path.join(configDir, "argent.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        agents: {
          defaults: {
            model: { primary: "zai/glm-5.1" },
          },
        },
        tools: {},
      },
      null,
      2,
    ),
  );

  const { app } = require("../api-server.cjs");
  server = app.listen(0);
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  if (server) server.close();
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
});

describe("Media image config", () => {
  it("GET /api/settings/agent exposes image analysis defaults", async () => {
    const res = await api("GET", "/api/settings/agent");
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.data.imageAnalysis, {
      primary: "google/gemini-3-flash-preview",
      fallbacks: ["anthropic/claude-sonnet-4-6"],
      timeoutSeconds: 60,
      models: [
        { provider: "google", model: "gemini-3-flash-preview" },
        { provider: "anthropic", model: "claude-sonnet-4-6" },
      ],
    });
  });

  it("PATCH /api/settings/agent persists image model and media image pipeline", async () => {
    const res = await api("PATCH", "/api/settings/agent", {
      imageAnalysis: {
        primary: "google/gemini-3-pro-preview",
        fallbacks: ["anthropic/claude-haiku-4-5"],
        timeoutSeconds: 75,
      },
    });
    assert.strictEqual(res.status, 200);

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.deepStrictEqual(config.agents.defaults.imageModel, {
      primary: "google/gemini-3-pro-preview",
      fallbacks: ["anthropic/claude-haiku-4-5"],
    });
    assert.deepStrictEqual(config.tools.media.image, {
      timeoutSeconds: 75,
      models: [
        { provider: "google", model: "gemini-3-pro-preview" },
        { provider: "anthropic", model: "claude-haiku-4-5" },
      ],
    });
  });
});
