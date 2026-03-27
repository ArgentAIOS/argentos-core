import os from "node:os";
import path from "node:path";
import type { ArgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { DoctorOptions, DoctorPrompter } from "./doctor-prompter.js";
import { formatCliCommand } from "../cli/command-format.js";
import { resolveGatewayPort } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import {
  resolveGatewayLaunchAgentLabel,
  resolveNodeLaunchAgentLabel,
} from "../daemon/constants.js";
import { readLastGatewayErrorLine } from "../daemon/diagnostics.js";
import {
  isLaunchAgentListed,
  isLaunchAgentLoaded,
  launchAgentPlistExists,
  repairLaunchAgentBootstrap,
} from "../daemon/launchd.js";
import { resolveGatewayService } from "../daemon/service.js";
import { renderSystemdUnavailableHints } from "../daemon/systemd-hints.js";
import { isSystemdUserServiceAvailable } from "../daemon/systemd.js";
import { formatPortDiagnostics, inspectPortUsage } from "../infra/ports.js";
import { isWSL } from "../infra/wsl.js";
import { note } from "../terminal/note.js";
import { sleep } from "../utils.js";
import { buildGatewayInstallPlan, gatewayInstallErrorHint } from "./daemon-install-helpers.js";
import {
  DEFAULT_GATEWAY_DAEMON_RUNTIME,
  GATEWAY_DAEMON_RUNTIME_OPTIONS,
  type GatewayDaemonRuntime,
} from "./daemon-runtime.js";
import { buildGatewayRuntimeHints, formatGatewayRuntimeSummary } from "./doctor-format.js";
import { formatHealthCheckFailure } from "./health-format.js";
import { healthCommand } from "./health.js";

function normalizeMaybePath(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function resolveServicePort(params: {
  serviceEnv?: Record<string, string>;
  programArguments?: string[];
}): number | null {
  const envPort = params.serviceEnv?.ARGENT_GATEWAY_PORT?.trim();
  if (envPort) {
    const parsed = Number.parseInt(envPort, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const args = params.programArguments ?? [];
  const index = args.indexOf("--port");
  if (index >= 0) {
    const raw = args[index + 1];
    const parsed = Number.parseInt(String(raw), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function isServiceScopedToCurrentDoctorRun(params: {
  serviceEnv?: Record<string, string>;
  programArguments?: string[];
  configPath?: string;
  stateDir?: string;
  port?: number;
}): boolean {
  const serviceConfigPath = normalizeMaybePath(params.serviceEnv?.ARGENT_CONFIG_PATH);
  const serviceStateDir = normalizeMaybePath(params.serviceEnv?.ARGENT_STATE_DIR);
  const servicePort = resolveServicePort({
    serviceEnv: params.serviceEnv,
    programArguments: params.programArguments,
  });
  const currentConfigPath = normalizeMaybePath(params.configPath);
  const currentStateDir = normalizeMaybePath(params.stateDir);

  if (serviceConfigPath && currentConfigPath) {
    return serviceConfigPath === currentConfigPath;
  }
  if (serviceStateDir && currentStateDir) {
    return serviceStateDir === currentStateDir;
  }
  if (servicePort !== null && typeof params.port === "number") {
    return servicePort === params.port;
  }
  return true;
}

function resolveDoctorConfigPort(cfg: ArgentConfig): number {
  const port = cfg.gateway?.port;
  if (typeof port === "number" && Number.isFinite(port) && port > 0) {
    return port;
  }
  return resolveGatewayPort(cfg, {});
}

function isAlternateHomeScope(env: NodeJS.ProcessEnv): boolean {
  const envHome = normalizeMaybePath(env.HOME);
  const realHome = normalizeMaybePath(os.userInfo().homedir);
  return Boolean(envHome && realHome && envHome !== realHome);
}

async function maybeRepairLaunchAgentBootstrap(params: {
  env: Record<string, string | undefined>;
  title: string;
  runtime: RuntimeEnv;
  prompter: DoctorPrompter;
}): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }

  const listed = await isLaunchAgentListed({ env: params.env });
  if (!listed) {
    return false;
  }

  const loaded = await isLaunchAgentLoaded({ env: params.env });
  if (loaded) {
    return false;
  }

  const plistExists = await launchAgentPlistExists(params.env);
  if (!plistExists) {
    return false;
  }

  note("LaunchAgent is listed but not loaded in launchd.", `Argent ${params.title} LaunchAgent`);

  const shouldFix = await params.prompter.confirmSkipInNonInteractive({
    message: `Repair Argent ${params.title} LaunchAgent bootstrap now?`,
    initialValue: true,
  });
  if (!shouldFix) {
    return false;
  }

  params.runtime.log(`Bootstrapping ${params.title} LaunchAgent...`);
  const repair = await repairLaunchAgentBootstrap({ env: params.env });
  if (!repair.ok) {
    params.runtime.error(
      `${params.title} LaunchAgent bootstrap failed: ${repair.detail ?? "unknown error"}`,
    );
    return false;
  }

  const verified = await isLaunchAgentLoaded({ env: params.env });
  if (!verified) {
    params.runtime.error(`${params.title} LaunchAgent still not loaded after repair.`);
    return false;
  }

  note(`${params.title} LaunchAgent repaired.`, `Argent ${params.title} LaunchAgent`);
  return true;
}

export async function maybeRepairGatewayDaemon(params: {
  cfg: ArgentConfig;
  runtime: RuntimeEnv;
  prompter: DoctorPrompter;
  options: DoctorOptions;
  gatewayDetailsMessage: string;
  healthOk: boolean;
  configPath?: string;
}) {
  if (params.healthOk) {
    return;
  }

  const service = resolveGatewayService();
  // systemd can throw in containers/WSL; treat as "not loaded" and fall back to hints.
  let loaded = false;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch {
    loaded = false;
  }
  let serviceRuntime: Awaited<ReturnType<typeof service.readRuntime>> | undefined;
  let serviceCommand: Awaited<ReturnType<typeof service.readCommand>> | null = null;
  if (loaded) {
    serviceCommand = await service.readCommand(process.env).catch(() => null);
  }
  if (loaded && !serviceCommand && isAlternateHomeScope(process.env)) {
    note(
      [
        "- Existing Argent gateway service is loaded for the primary user home.",
        `- Current HOME: ${process.env.HOME ?? ""}`,
        `- Primary HOME: ${os.userInfo().homedir}`,
        "- Skipping live service inspection for this alternate-home doctor run.",
      ].join("\n"),
      "Argent gateway",
    );
    loaded = false;
  }
  const currentStateDir = resolveStateDir(process.env, os.homedir);
  if (
    loaded &&
    serviceCommand &&
    !isServiceScopedToCurrentDoctorRun({
      serviceEnv: serviceCommand.environment,
      programArguments: serviceCommand.programArguments,
      configPath: params.configPath,
      stateDir: currentStateDir,
      port: resolveDoctorConfigPort(params.cfg),
    })
  ) {
    const serviceConfigPath = serviceCommand.environment?.ARGENT_CONFIG_PATH?.trim();
    const serviceStateDir = serviceCommand.environment?.ARGENT_STATE_DIR?.trim();
    const servicePort = resolveServicePort({
      serviceEnv: serviceCommand.environment,
      programArguments: serviceCommand.programArguments,
    });
    const currentPort = resolveDoctorConfigPort(params.cfg);
    const lines = [
      "- Existing Argent gateway service belongs to a different config/state scope.",
      serviceConfigPath ? `- Service config: ${serviceConfigPath}` : null,
      serviceStateDir ? `- Service state: ${serviceStateDir}` : null,
      servicePort !== null ? `- Service port: ${servicePort}` : null,
      params.configPath ? `- Current config: ${params.configPath}` : null,
      `- Current port: ${currentPort}`,
      "- Treating this doctor run as unmanaged by the live service.",
    ].filter((line): line is string => Boolean(line));
    note(lines.join("\n"), "Argent gateway");
    loaded = false;
    serviceCommand = null;
  }
  if (loaded) {
    serviceRuntime = await service.readRuntime(process.env).catch(() => undefined);
  }

  if (process.platform === "darwin" && params.cfg.gateway?.mode !== "remote") {
    const gatewayRepaired = await maybeRepairLaunchAgentBootstrap({
      env: process.env,
      title: "Gateway",
      runtime: params.runtime,
      prompter: params.prompter,
    });
    await maybeRepairLaunchAgentBootstrap({
      env: {
        ...process.env,
        ARGENT_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
      },
      title: "Node",
      runtime: params.runtime,
      prompter: params.prompter,
    });
    if (gatewayRepaired) {
      loaded = await service.isLoaded({ env: process.env });
      if (loaded) {
        serviceRuntime = await service.readRuntime(process.env).catch(() => undefined);
      }
    }
  }

  if (params.cfg.gateway?.mode !== "remote") {
    const port = resolveDoctorConfigPort(params.cfg);
    const diagnostics = await inspectPortUsage(port);
    if (diagnostics.status === "busy") {
      note(formatPortDiagnostics(diagnostics).join("\n"), "Argent gateway port");
    } else if (loaded && serviceRuntime?.status === "running") {
      const lastError = await readLastGatewayErrorLine(process.env);
      if (lastError) {
        note(`Last gateway error: ${lastError}`, "Argent gateway");
      }
    }
  }

  if (!loaded) {
    if (process.platform === "linux") {
      const systemdAvailable = await isSystemdUserServiceAvailable().catch(() => false);
      if (!systemdAvailable) {
        const wsl = await isWSL();
        note(renderSystemdUnavailableHints({ wsl }).join("\n"), "Argent gateway");
        return;
      }
    }
    note("Gateway service is not installed.", "Argent gateway");
    if (params.cfg.gateway?.mode !== "remote") {
      const install = await params.prompter.confirmSkipInNonInteractive({
        message: "Install the Argent gateway service now?",
        initialValue: true,
      });
      if (install) {
        const daemonRuntime = await params.prompter.select<GatewayDaemonRuntime>(
          {
            message: "Which runtime should power the Argent gateway service?",
            options: GATEWAY_DAEMON_RUNTIME_OPTIONS,
            initialValue: DEFAULT_GATEWAY_DAEMON_RUNTIME,
          },
          DEFAULT_GATEWAY_DAEMON_RUNTIME,
        );
        const port = resolveDoctorConfigPort(params.cfg);
        const { programArguments, workingDirectory, environment } = await buildGatewayInstallPlan({
          env: process.env,
          port,
          token: params.cfg.gateway?.auth?.token ?? process.env.ARGENT_GATEWAY_TOKEN,
          runtime: daemonRuntime,
          warn: (message, title) => note(message, title),
          config: params.cfg,
        });
        try {
          await service.install({
            env: process.env,
            stdout: process.stdout,
            programArguments,
            workingDirectory,
            environment,
          });
        } catch (err) {
          note(`Gateway service install failed: ${String(err)}`, "Argent gateway");
          note(gatewayInstallErrorHint(), "Argent gateway");
        }
      }
    }
    return;
  }

  const summary = formatGatewayRuntimeSummary(serviceRuntime);
  const hints = buildGatewayRuntimeHints(serviceRuntime, {
    platform: process.platform,
    env: process.env,
  });
  if (summary || hints.length > 0) {
    const lines: string[] = [];
    if (summary) {
      lines.push(`Runtime: ${summary}`);
    }
    lines.push(...hints);
    note(lines.join("\n"), "Argent gateway");
  }

  if (serviceRuntime?.status !== "running") {
    const start = await params.prompter.confirmSkipInNonInteractive({
      message: "Start the Argent gateway service now?",
      initialValue: true,
    });
    if (start) {
      await service.restart({
        env: process.env,
        stdout: process.stdout,
      });
      await sleep(1500);
    }
  }

  if (process.platform === "darwin") {
    const label = resolveGatewayLaunchAgentLabel(process.env.ARGENT_PROFILE);
    note(
      `LaunchAgent loaded; stopping requires "${formatCliCommand("argent gateway stop")}" or launchctl bootout gui/$UID/${label}.`,
      "Argent gateway",
    );
  }

  if (serviceRuntime?.status === "running") {
    const restart = await params.prompter.confirmSkipInNonInteractive({
      message: "Restart the Argent gateway service now?",
      initialValue: true,
    });
    if (restart) {
      await service.restart({
        env: process.env,
        stdout: process.stdout,
      });
      await sleep(1500);
      try {
        await healthCommand({ json: false, timeoutMs: 10_000 }, params.runtime);
      } catch (err) {
        const message = String(err);
        if (message.includes("gateway closed")) {
          note("Gateway not running.", "Argent gateway");
          note(params.gatewayDetailsMessage, "Argent gateway connection");
        } else {
          params.runtime.error(formatHealthCheckFailure(err));
        }
      }
    }
  }
}
