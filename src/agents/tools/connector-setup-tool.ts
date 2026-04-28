/**
 * Connector Setup Tool
 *
 * Lets the main agent guide an operator through connector setup without
 * exposing secrets or asking the operator to understand local runtime details.
 */

import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const execFileAsync = promisify(execFile);

const GOOGLE_TOOL_ID = "aos-google";
const GOOGLE_REQUIRED_SERVICES = "drive,gmail,calendar,sheets,docs";
const GOOGLE_PREFLIGHT_PATH = path.resolve(
  process.cwd(),
  "tools",
  "aos",
  GOOGLE_TOOL_ID,
  "installer",
  "preflight_gws.py",
);
const GOOGLE_CONFIG_DIR = path.join(os.homedir(), ".config", "gws");

type ConnectorSetupAction = "status" | "check" | "start_google_login";

type ConnectorSetupToolOptions = {
  runCommand?: (
    file: string,
    args: string[],
    options?: { cwd?: string },
  ) => Promise<{ stdout: string; stderr: string }>;
  platform?: NodeJS.Platform;
  preflightPath?: string;
};

type PreflightCheck = {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
};

type PreflightPayload = {
  ok?: boolean;
  checks?: PreflightCheck[];
  next_steps?: string[];
};

async function defaultRunCommand(
  file: string,
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, args, {
    cwd: options?.cwd,
    encoding: "utf8",
  });
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

const ConnectorSetupToolSchema = Type.Object({
  action: Type.Optional(
    Type.Union([Type.Literal("status"), Type.Literal("check"), Type.Literal("start_google_login")]),
  ),
  connector: Type.Optional(
    Type.String({
      description:
        "Connector id. Currently supports aos-google / Google Workspace. Defaults to aos-google.",
    }),
  ),
  installMissing: Type.Optional(
    Type.Boolean({
      description:
        "For action=check, allow installer-style remediation for missing local helper binaries.",
    }),
  ),
  confirm: Type.Optional(
    Type.Boolean({
      description:
        "Required true for start_google_login because it opens an interactive Google sign-in flow.",
    }),
  ),
});

function normalizeAction(value: string | undefined): ConnectorSetupAction {
  if (value === "check" || value === "start_google_login") {
    return value;
  }
  return "status";
}

function normalizeConnector(value: string | undefined): string {
  const normalized = (value || GOOGLE_TOOL_ID).trim().toLowerCase();
  if (["google", "google-workspace", "workspace", "gmail"].includes(normalized)) {
    return GOOGLE_TOOL_ID;
  }
  return normalized;
}

function checkNamed(payload: PreflightPayload, name: string): PreflightCheck | undefined {
  return payload.checks?.find((check) => check.name === name);
}

function operatorLabelForCheck(name: string): string {
  switch (name) {
    case "gws_binary":
      return "Google Workspace helper installed";
    case "gws_version":
      return "Google Workspace helper responding";
    case "gcloud_cli":
      return "Google setup helper available";
    case "oauth_client_config":
      return "Google connection app configured";
    case "gws_auth":
      return "Google account connected";
    case "model_armor_config":
      return "Optional content safety filter configured";
    default:
      return name.replace(/_/g, " ");
  }
}

function buildPlainLanguageSteps(payload: PreflightPayload): string[] {
  const steps: string[] = [];
  const gws = checkNamed(payload, "gws_binary");
  const oauth = checkNamed(payload, "oauth_client_config");
  const auth = checkNamed(payload, "gws_auth");

  if (gws && !gws.ok) {
    steps.push("Install the local Google Workspace helper so Argent can talk to Google safely.");
  }
  if (oauth && !oauth.ok) {
    steps.push(
      "Connect a Google app credential. In a polished product flow this should be a one-click 'Connect Google' step, not a file or environment-variable task.",
    );
  }
  if (oauth?.ok && auth && !auth.ok) {
    steps.push("Sign in with Google and approve Drive, Gmail, Calendar, Sheets, and Docs access.");
  }
  if (payload.ok) {
    steps.push("Google Workspace is connected. The agent can now use approved Google actions.");
  }
  if (steps.length === 0) {
    steps.push("Review the readiness checks and continue with the next incomplete item.");
  }
  return steps;
}

function summarizePreflight(payload: PreflightPayload) {
  const checks = (payload.checks ?? []).map((check) => ({
    name: check.name,
    label: operatorLabelForCheck(check.name),
    ok: check.ok,
    optional: check.name === "gcloud_cli" || check.name === "model_armor_config",
  }));
  return {
    ok: payload.ok === true,
    connector: GOOGLE_TOOL_ID,
    title: "Google Workspace connection",
    summary:
      payload.ok === true
        ? "Google Workspace is ready."
        : "Google Workspace needs setup before agents can use Gmail, Drive, Calendar, Docs, or Sheets.",
    checks,
    operatorSteps: buildPlainLanguageSteps(payload),
    technicalNextSteps: payload.next_steps ?? [],
    sourceOfTruth: {
      oauthClient: "~/.config/gws/client_secret.json or GOOGLE_WORKSPACE_CLI_CLIENT_ID/SECRET",
      credentials: "~/.config/gws/credentials.enc",
      connector: "tools/aos/aos-google/connector.json",
    },
    agentGuidance:
      "Explain one step at a time. Do not ask business owners to edit env vars unless the simpler Google sign-in flow is unavailable.",
  };
}

async function runPreflight(options: ConnectorSetupToolOptions, installMissing: boolean) {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const preflightPath = options.preflightPath ?? GOOGLE_PREFLIGHT_PATH;
  const args = [preflightPath, "--require-auth", "--json"];
  if (installMissing) {
    args.splice(1, 0, "--install-missing");
  }
  try {
    const result = await runCommand("python3", args, { cwd: process.cwd() });
    return JSON.parse(result.stdout || "{}") as PreflightPayload;
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    if (err.stdout?.trim()) {
      try {
        return JSON.parse(err.stdout) as PreflightPayload;
      } catch {
        // fall through
      }
    }
    throw new Error(err.stderr || err.message || "Google Workspace setup check failed");
  }
}

function appleScriptLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function launchGoogleLogin(options: ConnectorSetupToolOptions) {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error("Interactive Google sign-in launch is currently supported on macOS only.");
  }
  const runCommand = options.runCommand ?? defaultRunCommand;
  const command = `cd '${GOOGLE_CONFIG_DIR.replace(/'/g, `'\"'\"'`)}' && gws auth login -s ${GOOGLE_REQUIRED_SERVICES}`;
  await runCommand("osascript", [
    "-e",
    'tell application "Terminal" to activate',
    "-e",
    `tell application "Terminal" to do script ${appleScriptLiteral(command)}`,
  ]);
  return {
    ok: true,
    connector: GOOGLE_TOOL_ID,
    action: "start_google_login",
    operatorActionRequired: true,
    summary: "Google sign-in has been opened.",
    operatorSteps: [
      "Choose the Google account for this business.",
      "Review the requested access.",
      "Click Allow if the access matches what you want Argent to do.",
      "Return to Argent and ask me to check Google Workspace again.",
    ],
  };
}

export function createConnectorSetupTool(options: ConnectorSetupToolOptions = {}): AnyAgentTool {
  return {
    label: "ConnectorSetup",
    name: "connector_setup",
    description: `Guide an operator through connector setup in plain language and check readiness without exposing secrets.

Use this when the operator asks to connect, configure, troubleshoot, or verify Google Workspace, Gmail, Drive, Calendar, Docs, or Sheets.

For business owners, explain the returned operatorSteps one at a time. Avoid raw implementation terms like gws, OAuth client, env var, or credentials unless the tool reports that manual technical setup is unavoidable.

Actions:
- status: check readiness and return business-friendly steps.
- check: same as status, with optional installMissing remediation.
- start_google_login: opens the interactive Google sign-in flow; only call after the operator asks to connect/sign in or confirm=true is explicitly appropriate.`,
    parameters: ConnectorSetupToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = normalizeAction(readStringParam(params, "action"));
      const connector = normalizeConnector(readStringParam(params, "connector"));

      if (connector !== GOOGLE_TOOL_ID) {
        return jsonResult({
          ok: false,
          supported: false,
          connector,
          summary: "Guided setup is currently implemented for Google Workspace first.",
          operatorSteps: [
            "Open Systems and check this connector's setup card.",
            "Use service keys only for connectors that explicitly say they use service keys.",
          ],
        });
      }

      if (action === "start_google_login") {
        if (params.confirm !== true) {
          return jsonResult({
            ok: false,
            connector,
            action,
            needsConfirmation: true,
            summary: "Starting Google sign-in opens a browser/Terminal flow for the operator.",
            operatorSteps: [
              "Ask the operator if they are ready to sign in with Google.",
              "Then call this tool again with confirm=true.",
            ],
          });
        }
        const preflight = await runPreflight(options, false);
        if (!checkNamed(preflight, "oauth_client_config")?.ok) {
          return jsonResult({
            ...summarizePreflight(preflight),
            ok: false,
            action,
            summary: "Google sign-in cannot start until the Google connection app is configured.",
          });
        }
        return jsonResult(await launchGoogleLogin(options));
      }

      const preflight = await runPreflight(options, params.installMissing === true);
      return jsonResult({
        ...summarizePreflight(preflight),
        action,
      });
    },
  };
}
