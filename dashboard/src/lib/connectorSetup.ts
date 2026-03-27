import { fetchLocalApi } from "../utils/localApiFetch";

export type ConnectorSetupAction = {
  id: string;
  kind: "check" | "launch";
  label: string;
  detail?: string;
  accent?: "primary" | "secondary" | "success";
  installMissing?: boolean;
};

export type ConnectorSetupCheck = {
  name: string;
  label: string;
  ok: boolean;
  optional?: boolean;
  summary?: string;
};

export type ConnectorSetupStatus = {
  ok: boolean;
  supported: boolean;
  tool: string;
  title: string;
  summary: string;
  detail?: string;
  actions: ConnectorSetupAction[];
  checks: ConnectorSetupCheck[];
  nextSteps: string[];
};

export type ConnectorSetupLaunchResponse = {
  ok?: boolean;
  supported?: boolean;
  tool?: string;
  action?: string;
  message?: string;
  error?: string;
  details?: string;
  path?: string;
  url?: string;
  command?: string;
  cwd?: string;
  watchForChanges?: boolean;
};

export type ConnectorSetupFallback = {
  ok: false;
  supported: false;
  tool: string;
  title: string;
  summary: string;
  detail?: string;
  actions: ConnectorSetupAction[];
  checks: ConnectorSetupCheck[];
  nextSteps: string[];
};

type ConnectorSetupConnectorLike = {
  tool: string;
  label: string;
  installState: "ready" | "needs-setup" | "repo-only" | "error";
  status: {
    label: string;
    detail?: string;
  };
  discovery?: {
    binaryPath?: string;
    harnessDir?: string;
    repoDir?: string;
    requiresPython?: string;
  };
  auth?: {
    kind?: string;
    required?: boolean;
    serviceKeys?: string[];
    interactiveSetup?: string[];
  };
};

export async function fetchConnectorSetupStatus(
  tool: string,
  timeoutMs = 15_000,
): Promise<ConnectorSetupStatus | null> {
  const response = await fetchLocalApi(
    `/api/settings/connectors/${encodeURIComponent(tool)}/setup`,
    {},
    timeoutMs,
  );
  const payload = (await response.json().catch(() => ({}))) as ConnectorSetupStatus & {
    error?: string;
    details?: string;
  };
  if (response.status === 404 && payload.supported === false) {
    return null;
  }
  if (!response.ok || payload.supported === false) {
    throw new Error(payload.details || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function runConnectorSetupCheck(
  tool: string,
  options: { installMissing?: boolean; requireAuth?: boolean } = {},
  timeoutMs = 20_000,
): Promise<ConnectorSetupStatus> {
  const response = await fetchLocalApi(
    `/api/settings/connectors/${encodeURIComponent(tool)}/setup/check`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    },
    timeoutMs,
  );
  const payload = (await response.json().catch(() => ({}))) as ConnectorSetupStatus & {
    error?: string;
    details?: string;
  };
  if (!response.ok || payload.supported === false) {
    throw new Error(payload.details || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function launchConnectorSetupAction(
  tool: string,
  action: string,
  timeoutMs = 20_000,
): Promise<ConnectorSetupLaunchResponse> {
  const response = await fetchLocalApi(
    `/api/settings/connectors/${encodeURIComponent(tool)}/setup/launch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    },
    timeoutMs,
  );
  const payload = (await response.json().catch(() => ({}))) as ConnectorSetupLaunchResponse;
  if (!response.ok || payload.ok === false || payload.supported === false) {
    throw new Error(payload.details || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

export function buildFallbackConnectorSetup(
  connector: ConnectorSetupConnectorLike,
): ConnectorSetupFallback {
  const nextSteps: string[] = [];
  const auth = connector.auth;
  const discovery = connector.discovery;

  if (connector.installState === "repo-only") {
    nextSteps.push(
      "Install the connector runtime into a runnable environment before assigning live actions.",
    );
  }
  if (connector.installState === "needs-setup") {
    nextSteps.push(
      "Finish the connector auth or operator setup before launching workers with live connector actions.",
    );
  }
  if (auth?.serviceKeys?.length) {
    nextSteps.push(`Add service keys: ${auth.serviceKeys.join(", ")}.`);
  }
  if (auth?.interactiveSetup?.length) {
    nextSteps.push(...auth.interactiveSetup.map((step) => `Interactive setup: ${step}`));
  }
  if (!discovery?.binaryPath && discovery?.harnessDir) {
    nextSteps.push(`Install the harness from ${discovery.harnessDir}.`);
  }
  if (!discovery?.binaryPath && discovery?.requiresPython) {
    nextSteps.push(`Connector runtime requires Python ${discovery.requiresPython}.`);
  }
  if (nextSteps.length === 0 && connector.status.detail) {
    nextSteps.push(connector.status.detail);
  }

  return {
    ok: false,
    supported: false,
    tool: connector.tool,
    title: `${connector.label} setup`,
    summary: "No guided operator setup is registered for this connector yet.",
    detail:
      connector.status.detail ||
      "This connector can still be configured through service keys, auth setup, or external runtime installation.",
    actions: [],
    checks: [],
    nextSteps,
  };
}
