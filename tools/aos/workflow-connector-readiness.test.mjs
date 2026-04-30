import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildWorkflowConnectorReadiness } from "./workflow-connector-readiness.mjs";

function writeManifest(root, id, auth = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "connector.json"),
    `${JSON.stringify(
      {
        tool: id,
        backend: `${id}-api`,
        connector: { label: id },
        auth,
        commands: [{ id: "health", required_mode: "readonly", supports_json: true }],
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

function writeHarness(sourceRoot, runtimeRoot, id, { binary = false } = {}) {
  const sourceHarness = path.join(sourceRoot, id, "agent-harness");
  fs.mkdirSync(path.join(sourceHarness, "tests"), { recursive: true });
  fs.writeFileSync(path.join(sourceHarness, "pyproject.toml"), `[project]\nname = "${id}"\n`);
  if (binary) {
    const runtimeBin = path.join(runtimeRoot, "tools", "aos", id, "agent-harness", ".venv", "bin");
    fs.mkdirSync(runtimeBin, { recursive: true });
    fs.writeFileSync(path.join(runtimeBin, id), "#!/bin/sh\nexit 0\n");
  }
}

test("truth-labels workflow connector runtime and credential gaps", () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aos-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aos-runtime-"));
  const workflowTemplate = path.join(sourceRoot, "workflow.ts");
  fs.writeFileSync(
    workflowTemplate,
    'connectorAction("check-slack", "Check Slack", "aos-slack", "health", "health.check", {});\n',
  );

  writeManifest(sourceRoot, "aos-slack", {
    required: true,
    service_keys: ["SLACK_BOT_TOKEN"],
  });
  writeHarness(sourceRoot, runtimeRoot, "aos-slack");
  writeManifest(sourceRoot, "aos-buffer", {
    required: true,
    required_one_of: [["BUFFER_API_KEY", "BUFFER_ACCESS_TOKEN"]],
    service_keys: ["BUFFER_API_KEY", "BUFFER_ACCESS_TOKEN"],
  });
  writeHarness(sourceRoot, runtimeRoot, "aos-buffer", { binary: true });
  writeManifest(sourceRoot, "aos-resend", { required: true, service_keys: ["RESEND_API_KEY"] });
  writeHarness(sourceRoot, runtimeRoot, "aos-resend", { binary: true });

  const report = buildWorkflowConnectorReadiness({
    sourceRoot,
    runtimeRoot,
    workflowTemplatePath: workflowTemplate,
    env: { RESEND_API_KEY: "test" },
  });
  const byId = Object.fromEntries(
    report.connectors.map((connector) => [connector.connector_id, connector]),
  );

  assert.equal(byId["aos-slack"].truth_label, "repo-only");
  assert.equal(byId["aos-slack"].expected_by_workflows, true);
  assert.deepEqual(byId["aos-slack"].workflow_operation_status.missing, ["health.check"]);
  assert.equal(byId["aos-buffer"].truth_label, "missing credentials");
  assert.deepEqual(byId["aos-buffer"].local_runtime.credential_status.missing, [
    "BUFFER_ACCESS_TOKEN",
    "BUFFER_API_KEY",
  ]);
  assert.equal(byId["aos-resend"].truth_label, "runnable");
  assert.equal(byId["aos-telegram"].truth_label, "blocked");
  assert.equal(report.overall_status, "blocked");
});
