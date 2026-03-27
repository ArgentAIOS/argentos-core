import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ArgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { DoctorOptions, DoctorPrompter } from "./doctor-prompter.js";
import { resolveGatewayPort, resolveIsNixMode, resolveStateDir } from "../config/paths.js";
import { findExtraGatewayServices, renderGatewayServiceCleanupHints } from "../daemon/inspect.js";
import { renderSystemNodeWarning, resolveSystemNodeInfo } from "../daemon/runtime-paths.js";
import {
  auditGatewayServiceConfig,
  needsNodeRuntimeMigration,
  SERVICE_AUDIT_CODES,
} from "../daemon/service-audit.js";
import { resolveGatewayService } from "../daemon/service.js";
import { note } from "../terminal/note.js";
import { buildGatewayInstallPlan } from "./daemon-install-helpers.js";
import { DEFAULT_GATEWAY_DAEMON_RUNTIME, type GatewayDaemonRuntime } from "./daemon-runtime.js";

const execFileAsync = promisify(execFile);

function detectGatewayRuntime(programArguments: string[] | undefined): GatewayDaemonRuntime {
  const first = programArguments?.[0];
  if (first) {
    const base = path.basename(first).toLowerCase();
    if (base === "bun" || base === "bun.exe") {
      return "bun";
    }
    if (base === "node" || base === "node.exe") {
      return "node";
    }
  }
  return DEFAULT_GATEWAY_DAEMON_RUNTIME;
}

function findGatewayEntrypoint(programArguments?: string[]): string | null {
  if (!programArguments || programArguments.length === 0) {
    return null;
  }
  const gatewayIndex = programArguments.indexOf("gateway");
  if (gatewayIndex <= 0) {
    return null;
  }
  return programArguments[gatewayIndex - 1] ?? null;
}

function normalizeExecutablePath(value: string): string {
  return path.resolve(value);
}

function extractDetailPath(detail: string, prefix: string): string | null {
  if (!detail.startsWith(prefix)) {
    return null;
  }
  const value = detail.slice(prefix.length).trim();
  return value.length > 0 ? value : null;
}

async function cleanupLegacyLaunchdService(params: {
  label: string;
  plistPath: string;
}): Promise<string | null> {
  const domain = typeof process.getuid === "function" ? `gui/${process.getuid()}` : "gui/501";
  await execFileAsync("launchctl", ["bootout", domain, params.plistPath]).catch(() => undefined);
  await execFileAsync("launchctl", ["unload", params.plistPath]).catch(() => undefined);

  const trashDir = path.join(os.homedir(), ".Trash");
  try {
    await fs.mkdir(trashDir, { recursive: true });
  } catch {
    // ignore
  }

  try {
    await fs.access(params.plistPath);
  } catch {
    return null;
  }

  const dest = path.join(trashDir, `${params.label}-${Date.now()}.plist`);
  try {
    await fs.rename(params.plistPath, dest);
    return dest;
  } catch {
    return null;
  }
}

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

export async function maybeRepairGatewayServiceConfig(
  cfg: ArgentConfig,
  mode: "local" | "remote",
  runtime: RuntimeEnv,
  prompter: DoctorPrompter,
  options?: { configPath?: string },
) {
  if (resolveIsNixMode(process.env)) {
    note("Nix mode detected; skipping Argent service updates.", "Argent gateway");
    return;
  }

  if (mode === "remote") {
    note("Gateway mode is remote; skipping the local Argent service audit.", "Argent gateway");
    return;
  }

  const service = resolveGatewayService();
  let command: Awaited<ReturnType<typeof service.readCommand>> | null = null;
  try {
    command = await service.readCommand(process.env);
  } catch {
    command = null;
  }
  if (!command && isAlternateHomeScope(process.env)) {
    note(
      [
        "- Existing Argent gateway service is loaded for the primary user home.",
        `- Current HOME: ${process.env.HOME ?? ""}`,
        `- Primary HOME: ${os.userInfo().homedir}`,
        "- Skipping live service config audit for this alternate-home doctor run.",
      ].join("\n"),
      "Argent gateway service config",
    );
    return;
  }
  if (!command) {
    return;
  }

  const port = resolveDoctorConfigPort(cfg);
  const currentStateDir = resolveStateDir(process.env, os.homedir);
  if (
    !isServiceScopedToCurrentDoctorRun({
      serviceEnv: command.environment,
      programArguments: command.programArguments,
      configPath: options?.configPath,
      stateDir: currentStateDir,
      port,
    })
  ) {
    const serviceConfigPath = command.environment?.ARGENT_CONFIG_PATH?.trim();
    const serviceStateDir = command.environment?.ARGENT_STATE_DIR?.trim();
    const servicePort = resolveServicePort({
      serviceEnv: command.environment,
      programArguments: command.programArguments,
    });
    const lines = [
      "- Existing Argent gateway service belongs to a different config/state scope.",
      serviceConfigPath ? `- Service config: ${serviceConfigPath}` : null,
      serviceStateDir ? `- Service state: ${serviceStateDir}` : null,
      servicePort !== null ? `- Service port: ${servicePort}` : null,
      options?.configPath ? `- Current config: ${options.configPath}` : null,
      `- Current port: ${port}`,
      `- Skipping live service config audit for this doctor run.`,
    ].filter((line): line is string => Boolean(line));
    note(lines.join("\n"), "Argent gateway service config");
    return;
  }

  const audit = await auditGatewayServiceConfig({
    env: process.env,
    command,
  });
  const needsNodeRuntime = needsNodeRuntimeMigration(audit.issues);
  const systemNodeInfo = needsNodeRuntime
    ? await resolveSystemNodeInfo({ env: process.env })
    : null;
  const systemNodePath = systemNodeInfo?.supported ? systemNodeInfo.path : null;
  if (needsNodeRuntime && !systemNodePath) {
    const warning = renderSystemNodeWarning(systemNodeInfo);
    if (warning) {
      note(warning, "Argent gateway runtime");
    }
    note(
      "System Node 22+ not found. Install via Homebrew/apt/choco and rerun doctor to migrate off Bun/version managers.",
      "Argent gateway runtime",
    );
  }

  const runtimeChoice = detectGatewayRuntime(command.programArguments);
  const { programArguments, workingDirectory, environment } = await buildGatewayInstallPlan({
    env: process.env,
    port,
    token: cfg.gateway?.auth?.token ?? process.env.ARGENT_GATEWAY_TOKEN,
    runtime: needsNodeRuntime && systemNodePath ? "node" : runtimeChoice,
    nodePath: systemNodePath ?? undefined,
    warn: (message, title) => note(message, title),
    config: cfg,
  });
  const expectedEntrypoint = findGatewayEntrypoint(programArguments);
  const currentEntrypoint = findGatewayEntrypoint(command.programArguments);
  if (
    expectedEntrypoint &&
    currentEntrypoint &&
    normalizeExecutablePath(expectedEntrypoint) !== normalizeExecutablePath(currentEntrypoint)
  ) {
    audit.issues.push({
      code: SERVICE_AUDIT_CODES.gatewayEntrypointMismatch,
      message: "Gateway service entrypoint does not match the current install.",
      detail: `${currentEntrypoint} -> ${expectedEntrypoint}`,
      level: "recommended",
    });
  }

  if (audit.issues.length === 0) {
    return;
  }

  note(
    audit.issues
      .map((issue) =>
        issue.detail ? `- ${issue.message} (${issue.detail})` : `- ${issue.message}`,
      )
      .join("\n"),
    "Argent gateway service config",
  );

  const aggressiveIssues = audit.issues.filter((issue) => issue.level === "aggressive");
  const needsAggressive = aggressiveIssues.length > 0;

  if (needsAggressive && !prompter.shouldForce) {
    note(
      "Custom or unexpected service edits detected. Rerun with --force to overwrite.",
      "Argent gateway service config",
    );
  }

  const repair = needsAggressive
    ? await prompter.confirmAggressive({
        message: "Overwrite gateway service config with current defaults now?",
        initialValue: Boolean(prompter.shouldForce),
      })
    : await prompter.confirmRepair({
        message: "Update the Argent gateway service config to the recommended defaults now?",
        initialValue: true,
      });
  if (!repair) {
    return;
  }
  try {
    await service.install({
      env: process.env,
      stdout: process.stdout,
      programArguments,
      workingDirectory,
      environment,
    });
  } catch (err) {
    runtime.error(`Gateway service update failed: ${String(err)}`);
  }
}

export async function maybeScanExtraGatewayServices(
  options: DoctorOptions,
  runtime: RuntimeEnv,
  prompter: DoctorPrompter,
) {
  const extraServices = await findExtraGatewayServices(process.env, {
    deep: options.deep,
  });
  if (extraServices.length === 0) {
    return;
  }

  note(
    extraServices.map((svc) => `- ${svc.label} (${svc.scope}, ${svc.detail})`).join("\n"),
    "Other gateway-like services detected",
  );

  const legacyServices = extraServices.filter((svc) => svc.legacy === true);
  if (legacyServices.length > 0) {
    const shouldRemove = await prompter.confirmSkipInNonInteractive({
      message: "Remove legacy gateway services (clawdbot/moltbot) now?",
      initialValue: true,
    });
    if (shouldRemove) {
      const removed: string[] = [];
      const failed: string[] = [];
      for (const svc of legacyServices) {
        if (svc.platform !== "darwin") {
          failed.push(`${svc.label} (${svc.platform})`);
          continue;
        }
        if (svc.scope !== "user") {
          failed.push(`${svc.label} (${svc.scope})`);
          continue;
        }
        const plistPath = extractDetailPath(svc.detail, "plist:");
        if (!plistPath) {
          failed.push(`${svc.label} (missing plist path)`);
          continue;
        }
        const dest = await cleanupLegacyLaunchdService({
          label: svc.label,
          plistPath,
        });
        removed.push(dest ? `${svc.label} -> ${dest}` : svc.label);
      }
      if (removed.length > 0) {
        note(removed.map((line) => `- ${line}`).join("\n"), "Legacy gateway services removed");
      }
      if (failed.length > 0) {
        note(failed.map((line) => `- ${line}`).join("\n"), "Legacy gateway cleanup skipped");
      }
      if (removed.length > 0) {
        runtime.log("Legacy gateway services removed. Installing Argent gateway next.");
      }
    }
  }

  const cleanupHints = renderGatewayServiceCleanupHints();
  if (cleanupHints.length > 0) {
    note(cleanupHints.map((hint) => `- ${hint}`).join("\n"), "Argent cleanup hints");
  }

  note(
    [
      "Recommendation: run a single gateway per machine for most setups.",
      "One gateway supports multiple agents.",
      "If you need multiple gateways (e.g., a rescue bot on the same host), isolate ports + config/state (see docs: /gateway#multiple-gateways-same-host).",
    ].join("\n"),
    "Argent gateway recommendation",
  );
}
