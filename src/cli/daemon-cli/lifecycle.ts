import type { DaemonLifecycleOptions } from "./types.js";
import { loadConfig, resolveGatewayPort } from "../../config/config.js";
import { validateGatewayAuthConfig } from "../../config/gateway-auth-validation.js";
import { resolveIsNixMode } from "../../config/paths.js";
import { resolveGatewayService } from "../../daemon/service.js";
import { renderSystemdUnavailableHints } from "../../daemon/systemd-hints.js";
import { isSystemdUserServiceAvailable } from "../../daemon/systemd.js";
import { isWSL } from "../../infra/wsl.js";
import { defaultRuntime } from "../../runtime.js";
import { formatCliCommand } from "../command-format.js";
import { buildDaemonServiceSnapshot, createNullWriter, emitDaemonActionJson } from "./response.js";
import {
  DEFAULT_RESTART_HEALTH_ATTEMPTS,
  DEFAULT_RESTART_HEALTH_DELAY_MS,
  renderRestartDiagnostics,
  terminateStaleGatewayPids,
  waitForGatewayHealthyRestart,
} from "./restart-health.js";
import { parsePortFromArgs, renderGatewayServiceStartHints } from "./shared.js";

const POST_RESTART_HEALTH_ATTEMPTS = DEFAULT_RESTART_HEALTH_ATTEMPTS;
const POST_RESTART_HEALTH_DELAY_MS = DEFAULT_RESTART_HEALTH_DELAY_MS;

async function resolveGatewayRestartPort() {
  const service = resolveGatewayService();
  const command = await service.readCommand(process.env).catch(() => null);
  const serviceEnv = command?.environment ?? undefined;
  const mergedEnv = {
    ...(process.env as Record<string, string | undefined>),
    ...(serviceEnv ?? undefined),
  } as NodeJS.ProcessEnv;
  const portFromArgs = parsePortFromArgs(command?.programArguments);
  return portFromArgs ?? resolveGatewayPort(loadConfig(), mergedEnv);
}

export async function runDaemonUninstall(opts: DaemonLifecycleOptions = {}) {
  const json = Boolean(opts.json);
  const stdout = json ? createNullWriter() : process.stdout;
  const emit = (payload: {
    ok: boolean;
    result?: string;
    message?: string;
    error?: string;
    service?: {
      label: string;
      loaded: boolean;
      loadedText: string;
      notLoadedText: string;
    };
  }) => {
    if (!json) {
      return;
    }
    emitDaemonActionJson({ action: "uninstall", ...payload });
  };
  const fail = (message: string) => {
    if (json) {
      emit({ ok: false, error: message });
    } else {
      defaultRuntime.error(message);
    }
    defaultRuntime.exit(1);
  };

  if (resolveIsNixMode(process.env)) {
    fail("Nix mode detected; service uninstall is disabled.");
    return;
  }

  const service = resolveGatewayService();
  let loaded = false;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch {
    loaded = false;
  }
  if (loaded) {
    try {
      await service.stop({ env: process.env, stdout });
    } catch {
      // Best-effort stop; final loaded check gates success.
    }
  }
  try {
    await service.uninstall({ env: process.env, stdout });
  } catch (err) {
    fail(`Gateway uninstall failed: ${String(err)}`);
    return;
  }

  loaded = false;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch {
    loaded = false;
  }
  if (loaded) {
    fail("Gateway service still loaded after uninstall.");
    return;
  }
  emit({
    ok: true,
    result: "uninstalled",
    service: buildDaemonServiceSnapshot(service, loaded),
  });
}

export async function runDaemonStart(opts: DaemonLifecycleOptions = {}) {
  const json = Boolean(opts.json);
  const stdout = json ? createNullWriter() : process.stdout;
  const emit = (payload: {
    ok: boolean;
    result?: string;
    message?: string;
    error?: string;
    hints?: string[];
    service?: {
      label: string;
      loaded: boolean;
      loadedText: string;
      notLoadedText: string;
    };
  }) => {
    if (!json) {
      return;
    }
    emitDaemonActionJson({ action: "start", ...payload });
  };
  const fail = (message: string, hints?: string[]) => {
    if (json) {
      emit({ ok: false, error: message, hints });
    } else {
      defaultRuntime.error(message);
    }
    defaultRuntime.exit(1);
  };

  const service = resolveGatewayService();
  let loaded = false;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch (err) {
    fail(`Gateway service check failed: ${String(err)}`);
    return;
  }
  if (!loaded) {
    let hints = renderGatewayServiceStartHints();
    if (process.platform === "linux") {
      const systemdAvailable = await isSystemdUserServiceAvailable().catch(() => false);
      if (!systemdAvailable) {
        hints = [...hints, ...renderSystemdUnavailableHints({ wsl: await isWSL() })];
      }
    }
    emit({
      ok: true,
      result: "not-loaded",
      message: `Gateway service ${service.notLoadedText}.`,
      hints,
      service: buildDaemonServiceSnapshot(service, loaded),
    });
    if (!json) {
      defaultRuntime.log(`Gateway service ${service.notLoadedText}.`);
      for (const hint of hints) {
        defaultRuntime.log(`Start with: ${hint}`);
      }
    }
    return;
  }
  try {
    await service.restart({ env: process.env, stdout });
  } catch (err) {
    const hints = renderGatewayServiceStartHints();
    fail(`Gateway start failed: ${String(err)}`, hints);
    return;
  }

  let started = true;
  try {
    started = await service.isLoaded({ env: process.env });
  } catch {
    started = true;
  }
  emit({
    ok: true,
    result: "started",
    service: buildDaemonServiceSnapshot(service, started),
  });
}

export async function runDaemonStop(opts: DaemonLifecycleOptions = {}) {
  const json = Boolean(opts.json);
  const stdout = json ? createNullWriter() : process.stdout;
  const emit = (payload: {
    ok: boolean;
    result?: string;
    message?: string;
    error?: string;
    service?: {
      label: string;
      loaded: boolean;
      loadedText: string;
      notLoadedText: string;
    };
  }) => {
    if (!json) {
      return;
    }
    emitDaemonActionJson({ action: "stop", ...payload });
  };
  const fail = (message: string) => {
    if (json) {
      emit({ ok: false, error: message });
    } else {
      defaultRuntime.error(message);
    }
    defaultRuntime.exit(1);
  };

  const service = resolveGatewayService();
  let loaded = false;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch (err) {
    fail(`Gateway service check failed: ${String(err)}`);
    return;
  }
  if (!loaded) {
    emit({
      ok: true,
      result: "not-loaded",
      message: `Gateway service ${service.notLoadedText}.`,
      service: buildDaemonServiceSnapshot(service, loaded),
    });
    if (!json) {
      defaultRuntime.log(`Gateway service ${service.notLoadedText}.`);
    }
    return;
  }
  try {
    await service.stop({ env: process.env, stdout });
  } catch (err) {
    fail(`Gateway stop failed: ${String(err)}`);
    return;
  }

  let stopped = false;
  try {
    stopped = await service.isLoaded({ env: process.env });
  } catch {
    stopped = false;
  }
  emit({
    ok: true,
    result: "stopped",
    service: buildDaemonServiceSnapshot(service, stopped),
  });
}

/**
 * Restart the gateway service service.
 * @returns `true` if restart succeeded, `false` if the service was not loaded.
 * Throws/exits on check or restart failures.
 */
export async function runDaemonRestart(opts: DaemonLifecycleOptions = {}): Promise<boolean> {
  const json = Boolean(opts.json);
  const stdout = json ? createNullWriter() : process.stdout;
  const restartPort = await resolveGatewayRestartPort().catch(() =>
    resolveGatewayPort(loadConfig(), process.env),
  );
  const restartWaitMs = POST_RESTART_HEALTH_ATTEMPTS * POST_RESTART_HEALTH_DELAY_MS;
  const restartWaitSeconds = Math.round(restartWaitMs / 1000);
  const emit = (payload: {
    ok: boolean;
    result?: string;
    message?: string;
    error?: string;
    hints?: string[];
    service?: {
      label: string;
      loaded: boolean;
      loadedText: string;
      notLoadedText: string;
    };
  }) => {
    if (!json) {
      return;
    }
    emitDaemonActionJson({ action: "restart", ...payload });
  };
  const fail = (message: string, hints?: string[]) => {
    if (json) {
      emit({ ok: false, error: message, hints });
    } else {
      defaultRuntime.error(message);
    }
    defaultRuntime.exit(1);
  };

  const authIssues = validateGatewayAuthConfig(loadConfig());
  if (authIssues.length > 0) {
    const issue = authIssues[0];
    fail(`Gateway restart blocked: ${issue.message}`, [
      'Run `argent config set gateway.auth.token "<token>"` when mode=token, or switch mode.',
    ]);
    return false;
  }

  const service = resolveGatewayService();
  let loaded = false;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch (err) {
    fail(`Gateway service check failed: ${String(err)}`);
    return false;
  }
  if (!loaded) {
    let hints = renderGatewayServiceStartHints();
    if (process.platform === "linux") {
      const systemdAvailable = await isSystemdUserServiceAvailable().catch(() => false);
      if (!systemdAvailable) {
        hints = [...hints, ...renderSystemdUnavailableHints({ wsl: await isWSL() })];
      }
    }
    emit({
      ok: true,
      result: "not-loaded",
      message: `Gateway service ${service.notLoadedText}.`,
      hints,
      service: buildDaemonServiceSnapshot(service, loaded),
    });
    if (!json) {
      defaultRuntime.log(`Gateway service ${service.notLoadedText}.`);
      for (const hint of hints) {
        defaultRuntime.log(`Start with: ${hint}`);
      }
    }
    return false;
  }
  try {
    await service.restart({ env: process.env, stdout });
    let health = await waitForGatewayHealthyRestart({
      service,
      port: restartPort,
      attempts: POST_RESTART_HEALTH_ATTEMPTS,
      delayMs: POST_RESTART_HEALTH_DELAY_MS,
      includeUnknownListenersAsStale: process.platform === "win32",
    });

    if (!health.healthy && health.staleGatewayPids.length > 0) {
      const staleMsg = `Found stale gateway process(es): ${health.staleGatewayPids.join(", ")}.`;
      if (!json) {
        defaultRuntime.log(staleMsg);
        defaultRuntime.log("Stopping stale process(es) and retrying restart...");
      }
      await terminateStaleGatewayPids(health.staleGatewayPids);
      await service.restart({ env: process.env, stdout });
      health = await waitForGatewayHealthyRestart({
        service,
        port: restartPort,
        attempts: POST_RESTART_HEALTH_ATTEMPTS,
        delayMs: POST_RESTART_HEALTH_DELAY_MS,
        includeUnknownListenersAsStale: process.platform === "win32",
      });
    }

    if (!health.healthy) {
      const diagnostics = renderRestartDiagnostics(health);
      const timeoutLine = `Timed out after ${restartWaitSeconds}s waiting for gateway port ${restartPort} to become healthy.`;
      const runningNoPortLine =
        health.runtime.status === "running" && health.portUsage.status !== "busy"
          ? `Gateway process is running but port ${restartPort} is not listening.`
          : null;
      if (!json) {
        defaultRuntime.log(timeoutLine);
        if (runningNoPortLine) {
          defaultRuntime.log(runningNoPortLine);
        }
        for (const line of diagnostics) {
          defaultRuntime.log(line);
        }
      }
      fail(`Gateway restart timed out after ${restartWaitSeconds}s waiting for health checks.`, [
        formatCliCommand("argent gateway status --deep"),
        formatCliCommand("argent doctor"),
      ]);
      return false;
    }

    let restarted = true;
    try {
      restarted = await service.isLoaded({ env: process.env });
    } catch {
      restarted = true;
    }
    emit({
      ok: true,
      result: "restarted",
      service: buildDaemonServiceSnapshot(service, restarted),
    });
    return true;
  } catch (err) {
    const hints = renderGatewayServiceStartHints();
    fail(`Gateway restart failed: ${String(err)}`, hints);
    return false;
  }
}
