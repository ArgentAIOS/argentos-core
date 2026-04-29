const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let baseUrl;
let server;
let apiHooks;

before(async () => {
  process.env.API_PORT = "0";
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "argent-reminders-test-"));
  const apiServer = require("../api-server.cjs");
  server = apiServer.app.listen(0);
  apiHooks = apiServer.__test;
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  if (server) server.close();
});

async function api(method, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

describe("Task reminders", () => {
  it("creates and completes a due reminder through the scheduler tick", async () => {
    const dueAt = new Date(Date.now() - 60_000).toISOString();
    const create = await api("POST", "/api/tasks", {
      title: "Reminder smoke",
      type: "reminder",
      schedule: { frequency: "once", at: dueAt },
      metadata: { reminder: { deliveryTargets: ["in_app"], action: "notify" } },
    });

    assert.strictEqual(create.status, 201);
    assert.strictEqual(create.data.task.type, "reminder");
    assert.strictEqual(create.data.task.schedule.frequency, "once");
    assert.ok(create.data.task.schedule.nextRun);

    const tick = await apiHooks.runSchedulerTick();
    assert.ok(tick.dueCount >= 1);

    const list = await api("GET", "/api/tasks");
    const reminder = list.data.tasks.find((task) => task.id === create.data.task.id);
    assert.strictEqual(reminder.status, "completed");
    assert.deepStrictEqual(reminder.metadata.reminder.deliveryTargets, ["in_app"]);
  });
});
