import type { GatewayRequestHandlers, GatewayRequestOptions } from "./server-methods/types.js";
import { ErrorCodes, errorShape } from "./protocol/index.js";
import { aevpHandlers } from "./server-methods/aevp.js";
import { agentHandlers } from "./server-methods/agent.js";
import { agentsHandlers } from "./server-methods/agents.js";
import { appForgeHandlers } from "./server-methods/app-forge.js";
import { browserHandlers } from "./server-methods/browser.js";
import { channelsHandlers } from "./server-methods/channels.js";
import { chatHandlers } from "./server-methods/chat.js";
import { commandsHandlers } from "./server-methods/commands.js";
import { configHandlers } from "./server-methods/config.js";
import { connectHandlers } from "./server-methods/connect.js";
import { connectorsHandlers } from "./server-methods/connectors.js";
import { copilotHandlers } from "./server-methods/copilot.js";
import { cronHandlers } from "./server-methods/cron.js";
import { deviceHandlers } from "./server-methods/devices.js";
import { execApprovalsHandlers } from "./server-methods/exec-approvals.js";
import { executionWorkerHandlers } from "./server-methods/execution-worker.js";
import { familyTelemetryHandlers } from "./server-methods/family-telemetry.js";
import { healthHandlers } from "./server-methods/health.js";
import { intentHandlers } from "./server-methods/intent.js";
import { jobsOrchestratorHandlers } from "./server-methods/jobs-orchestrator.js";
import { jobsHandlers } from "./server-methods/jobs.js";
import { knowledgeHandlers } from "./server-methods/knowledge.js";
import { logsHandlers } from "./server-methods/logs.js";
import { modelsHandlers } from "./server-methods/models.js";
import { nodeHandlers } from "./server-methods/nodes.js";
import { providersHandlers } from "./server-methods/providers.js";
import { sendHandlers } from "./server-methods/send.js";
import { sessionsHandlers } from "./server-methods/sessions.js";
import { skillsHandlers } from "./server-methods/skills.js";
import { specforgeHandlers } from "./server-methods/specforge.js";
import { systemHandlers } from "./server-methods/system.js";
import { talkHandlers } from "./server-methods/talk.js";
import { terminalHandlers } from "./server-methods/terminal.js";
import { toolsHandlers } from "./server-methods/tools.js";
import { ttsHandlers } from "./server-methods/tts.js";
import { updateHandlers } from "./server-methods/update.js";
import { usageHandlers } from "./server-methods/usage.js";
import { voicewakeHandlers } from "./server-methods/voicewake.js";
import { webHandlers } from "./server-methods/web.js";
import { wizardHandlers } from "./server-methods/wizard.js";
import { workflowsHandlers } from "./server-methods/workflows.js";

const ADMIN_SCOPE = "operator.admin";
const READ_SCOPE = "operator.read";
const WRITE_SCOPE = "operator.write";
const APPROVALS_SCOPE = "operator.approvals";
const PAIRING_SCOPE = "operator.pairing";

const APPROVAL_METHODS = new Set(["exec.approval.request", "exec.approval.resolve"]);
const NODE_ROLE_METHODS = new Set(["node.invoke.result", "node.event", "skills.bins"]);
const PAIRING_METHODS = new Set([
  "node.pair.request",
  "node.pair.list",
  "node.pair.approve",
  "node.pair.reject",
  "node.pair.verify",
  "device.pair.list",
  "device.pair.approve",
  "device.pair.reject",
  "device.token.rotate",
  "device.token.revoke",
  "node.rename",
]);
const ADMIN_METHOD_PREFIXES = ["exec.approvals."];
const READ_METHODS = new Set([
  "health",
  "logs.tail",
  "channels.status",
  "status",
  "connectors.catalog",
  "usage.status",
  "usage.cost",
  "tts.status",
  "tts.providers",
  "models.list",
  "agents.list",
  "family.members",
  "agent.identity.get",
  "skills.status",
  "skills.personal",
  "skills.personal.update",
  "skills.personal.resolveConflict",
  "skills.personal.delete",
  "tools.status",
  "voicewake.get",
  "commands.list",
  "sessions.list",
  "sessions.preview",
  "cron.list",
  "cron.status",
  "cron.runs",
  "system-presence",
  "last-heartbeat",
  "node.list",
  "node.describe",
  "chat.history",
  "knowledge.search",
  "knowledge.library.list",
  "knowledge.collections.list",
  "jobs.overview",
  "jobs.templates.list",
  "jobs.assignments.list",
  "jobs.runs.list",
  "jobs.events.list",
  "jobs.runs.trace",
  "jobs.orchestrator.status",
  "execution.worker.status",
  "family.telemetry",
  "copilot.overview",
  "copilot.mode.get",
  "copilot.workforce.overview",
  "copilot.observability.overview",
  "copilot.run.story",
  "providers.status",
  "providers.registry",
  "appforge.bases.list",
  "appforge.bases.get",
  "appforge.tables.list",
  "appforge.tables.get",
  "appforge.records.list",
  "appforge.records.get",
  "workflows.get",
  "workflows.list",
  "workflows.runs.list",
  "workflows.runs.get",
  "workflows.versions.list",
  "workflows.subscribe",
  "workflows.pendingApprovals",
  "workflows.importPreview",
  "workflows.templates.list",
  "workflows.templates.get",
  "workflows.validate",
  "workflows.draft",
  "workflows.capabilities",
  "credentials.list",
  "credentials.validate",
  "workflows.manifest",
  "workflows.connectors",
  "workflows.connectorCommand",
]);
const WRITE_METHODS = new Set([
  "send",
  "agent",
  "agent.wait",
  "wake",
  "talk.mode",
  "talk.realtime.session",
  "talk.realtime.audio",
  "talk.realtime.mark",
  "talk.realtime.toolResult",
  "talk.realtime.stop",
  "tts.enable",
  "tts.disable",
  "tts.convert",
  "tts.setProvider",
  "voicewake.set",
  "node.invoke",
  "chat.send",
  "chat.abort",
  "knowledge.ingest",
  "knowledge.vault.ingest",
  "knowledge.library.delete",
  "knowledge.library.reindex",
  "knowledge.collections.grant",
  "jobs.templates.create",
  "jobs.templates.update",
  "jobs.templates.retire",
  "jobs.assignments.create",
  "jobs.assignments.update",
  "jobs.assignments.retire",
  "jobs.assignments.runNow",
  "jobs.runs.review",
  "jobs.runs.retry",
  "jobs.runs.advance",
  "family.register",
  "copilot.mode.set",
  "jobs.orchestrator.event",
  "execution.worker.runNow",
  "execution.worker.pause",
  "execution.worker.resume",
  "execution.worker.metrics.reset",
  "commands.compact",
  "browser.request",
  "terminal.create",
  "terminal.write",
  "terminal.resize",
  "terminal.kill",
  "contemplation.runOnce",
  "workflows.create",
  "workflows.update",
  "workflows.delete",
  "workflows.duplicate",
  "workflows.versions.restore",
  "workflows.run",
  "workflows.cancel",
  "workflows.resume",
  "workflows.emitEvent",
  "workflows.emitAppForgeEvent",
  "workflows.approve",
  "workflows.deny",
  "credentials.create",
  "credentials.delete",
  "appforge.bases.put",
  "appforge.bases.delete",
  "appforge.tables.put",
  "appforge.tables.delete",
  "appforge.records.put",
  "appforge.records.delete",
]);

function authorizeGatewayMethod(method: string, client: GatewayRequestOptions["client"]) {
  if (!client?.connect) {
    return null;
  }
  const role = client.connect.role ?? "operator";
  const scopes = client.connect.scopes ?? [];
  if (NODE_ROLE_METHODS.has(method)) {
    if (role === "node") {
      return null;
    }
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (role === "node") {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (role !== "operator") {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (scopes.includes(ADMIN_SCOPE)) {
    return null;
  }
  if (APPROVAL_METHODS.has(method) && !scopes.includes(APPROVALS_SCOPE)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.approvals");
  }
  if (PAIRING_METHODS.has(method) && !scopes.includes(PAIRING_SCOPE)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.pairing");
  }
  if (READ_METHODS.has(method) && !(scopes.includes(READ_SCOPE) || scopes.includes(WRITE_SCOPE))) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.read");
  }
  if (WRITE_METHODS.has(method) && !scopes.includes(WRITE_SCOPE)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.write");
  }
  if (APPROVAL_METHODS.has(method)) {
    return null;
  }
  if (PAIRING_METHODS.has(method)) {
    return null;
  }
  if (READ_METHODS.has(method)) {
    return null;
  }
  if (WRITE_METHODS.has(method)) {
    return null;
  }
  if (ADMIN_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix))) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.admin");
  }
  if (
    method.startsWith("config.") ||
    method.startsWith("wizard.") ||
    method.startsWith("update.") ||
    method === "channels.logout" ||
    method === "skills.install" ||
    method === "skills.update" ||
    method === "skills.personal.update" ||
    method === "skills.personal.resolveConflict" ||
    method === "skills.personal.delete" ||
    method === "cron.add" ||
    method === "cron.update" ||
    method === "cron.remove" ||
    method === "cron.run" ||
    method === "sessions.patch" ||
    method === "sessions.reset" ||
    method === "sessions.delete" ||
    method === "sessions.compact"
  ) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.admin");
  }
  return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.admin");
}

export const coreGatewayHandlers: GatewayRequestHandlers = {
  ...connectHandlers,
  ...connectorsHandlers,
  ...logsHandlers,
  ...voicewakeHandlers,
  ...healthHandlers,
  ...channelsHandlers,
  ...chatHandlers,
  ...cronHandlers,
  ...deviceHandlers,
  ...execApprovalsHandlers,
  ...executionWorkerHandlers,
  ...familyTelemetryHandlers,
  ...knowledgeHandlers,
  ...jobsHandlers,
  ...jobsOrchestratorHandlers,
  ...webHandlers,
  ...modelsHandlers,
  ...configHandlers,
  ...copilotHandlers,
  ...wizardHandlers,
  ...talkHandlers,
  ...ttsHandlers,
  ...skillsHandlers,
  ...toolsHandlers,
  ...sessionsHandlers,
  ...systemHandlers,
  ...updateHandlers,
  ...nodeHandlers,
  ...providersHandlers,
  ...sendHandlers,
  ...usageHandlers,
  ...commandsHandlers,
  ...agentHandlers,
  ...agentsHandlers,
  ...browserHandlers,
  ...terminalHandlers,
  ...aevpHandlers,
  ...appForgeHandlers,
  ...specforgeHandlers,
  ...intentHandlers,
  ...workflowsHandlers,
};

export async function handleGatewayRequest(
  opts: GatewayRequestOptions & { extraHandlers?: GatewayRequestHandlers },
): Promise<void> {
  const { req, respond, client, isWebchatConnect, context } = opts;
  const authError = authorizeGatewayMethod(req.method, client);
  if (authError) {
    respond(false, undefined, authError);
    return;
  }
  const handler = opts.extraHandlers?.[req.method] ?? coreGatewayHandlers[req.method];
  if (!handler) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `unknown method: ${req.method}`),
    );
    return;
  }
  await handler({
    req,
    params: (req.params ?? {}) as Record<string, unknown>,
    client,
    isWebchatConnect,
    respond,
    context,
  });
}
