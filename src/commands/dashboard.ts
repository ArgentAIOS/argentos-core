import type { RuntimeEnv } from "../runtime.js";
import { readConfigFileSnapshot } from "../config/config.js";
import { copyToClipboard } from "../infra/clipboard.js";
import { defaultRuntime } from "../runtime.js";
import { detectBrowserOpenSupport, openUrl } from "./onboard-helpers.js";

type DashboardOptions = {
  noOpen?: boolean;
};

const DEFAULT_DASHBOARD_URL = "http://127.0.0.1:8080/";

function resolveDashboardUrlBase(): string {
  const override = process.env.ARGENT_DASHBOARD_URL?.trim();
  return override || DEFAULT_DASHBOARD_URL;
}

function withToken(url: string, token: string): string {
  if (!token) {
    return url;
  }
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("token", token);
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  }
}

export async function dashboardCommand(
  runtime: RuntimeEnv = defaultRuntime,
  options: DashboardOptions = {},
) {
  const snapshot = await readConfigFileSnapshot();
  const cfg = snapshot.valid ? snapshot.config : {};
  const token = cfg.gateway?.auth?.token ?? process.env.ARGENT_GATEWAY_TOKEN ?? "";

  const dashboardBaseUrl = resolveDashboardUrlBase();
  const authedUrl = withToken(dashboardBaseUrl, token);

  runtime.log(`Dashboard URL: ${authedUrl}`);

  const copied = await copyToClipboard(authedUrl).catch(() => false);
  runtime.log(copied ? "Copied to clipboard." : "Copy to clipboard unavailable.");

  let opened = false;
  let hint: string | undefined;
  if (!options.noOpen) {
    const browserSupport = await detectBrowserOpenSupport();
    if (browserSupport.ok) {
      opened = await openUrl(authedUrl);
    }
    if (!opened) {
      hint = "Could not open browser automatically. Use the URL above.";
    }
  } else {
    hint = "Browser launch disabled (--no-open). Use the URL above.";
  }

  if (opened) {
    runtime.log("Opened in your browser. Keep that tab to control Argent.");
  } else if (hint) {
    runtime.log(hint);
  }
}
