import { cancel, confirm, isCancel, multiselect } from "@clack/prompts";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import {
  isNixMode,
  loadConfig,
  resolveConfigPath,
  resolveOAuthDir,
  resolveStateDir,
} from "../config/config.js";
import { resolveDashboardApiService, resolveDashboardUiService } from "../daemon/dashboard-service.js";
import { type GatewayService, resolveGatewayService } from "../daemon/service.js";
import { stylePromptHint, stylePromptMessage, stylePromptTitle } from "../terminal/prompt-style.js";
import { resolveHomeDir, resolveUserPath } from "../utils.js";
import { collectWorkspaceDirs, isPathWithin, removePath } from "./cleanup-utils.js";

type UninstallScope = "service" | "install" | "state" | "workspace" | "app";

export type UninstallOptions = {
  service?: boolean;
  install?: boolean;
  state?: boolean;
  workspace?: boolean;
  app?: boolean;
  all?: boolean;
  yes?: boolean;
  nonInteractive?: boolean;
  dryRun?: boolean;
};

const multiselectStyled = <T>(params: Parameters<typeof multiselect<T>>[0]) =>
  multiselect({
    ...params,
    message: stylePromptMessage(params.message),
    options: params.options.map((opt) =>
      opt.hint === undefined ? opt : { ...opt, hint: stylePromptHint(opt.hint) },
    ),
  });

function buildScopeSelection(opts: UninstallOptions): {
  scopes: Set<UninstallScope>;
  hadExplicit: boolean;
} {
  const hadExplicit = Boolean(
    opts.all || opts.service || opts.install || opts.state || opts.workspace || opts.app,
  );
  const scopes = new Set<UninstallScope>();
  if (opts.all || opts.service) {
    scopes.add("service");
  }
  if (opts.all || opts.install) {
    scopes.add("install");
  }
  if (opts.all || opts.state) {
    scopes.add("state");
  }
  if (opts.all || opts.workspace) {
    scopes.add("workspace");
  }
  if (opts.all || opts.app) {
    scopes.add("app");
  }
  return { scopes, hadExplicit };
}

async function stopAndUninstallService(params: {
  name: string;
  runtime: RuntimeEnv;
  service: GatewayService;
}): Promise<boolean> {
  const { name, runtime, service } = params;
  if (isNixMode) {
    runtime.error(`${name}: Nix mode detected; service uninstall is disabled.`);
    return false;
  }
  let loaded = false;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch (err) {
    runtime.error(`${name} check failed: ${String(err)}`);
    return false;
  }
  if (loaded) {
    try {
      await service.stop({ env: process.env, stdout: process.stdout });
    } catch (err) {
      runtime.error(`${name} stop failed: ${String(err)}`);
    }
  } else {
    runtime.log(`${name} ${service.notLoadedText}; removing installed service files if present.`);
  }
  try {
    await service.uninstall({ env: process.env, stdout: process.stdout });
    return true;
  } catch (err) {
    runtime.error(`${name} uninstall failed: ${String(err)}`);
    return false;
  }
}

function resolveInstallFootprintTargets(stateDir: string): string[] {
  const targets = new Set<string>();
  const installPackageDir =
    process.env.ARGENT_INSTALL_PACKAGE_DIR?.trim() ||
    path.join(stateDir, "lib", "node_modules", "argentos");
  const runtimeDir = process.env.ARGENT_RUNTIME_DIR?.trim() || path.join(stateDir, "runtime");
  const dashboardDir = path.join(stateDir, "dashboard");
  const gitDir = process.env.ARGENTOS_GIT_DIR?.trim() || "~/argentos";

  targets.add(resolveUserPath(installPackageDir));
  targets.add(resolveUserPath(runtimeDir));
  targets.add(resolveUserPath(dashboardDir));
  targets.add(resolveUserPath(gitDir));
  targets.add(resolveUserPath("~/.argent"));

  for (const binDir of ["~/bin", "/usr/local/bin"]) {
    for (const command of ["argent", "argentos"]) {
      targets.add(resolveUserPath(path.posix.join(binDir, command)));
    }
  }

  return [...targets];
}

async function removeInstallFootprint(runtime: RuntimeEnv, stateDir: string, dryRun?: boolean) {
  const targets = resolveInstallFootprintTargets(stateDir);
  for (const target of targets) {
    await removePath(target, runtime, { dryRun, label: target });
  }
}

function clearMacAppDefaults(runtime: RuntimeEnv, dryRun?: boolean) {
  if (process.platform !== "darwin") {
    return;
  }
  if (dryRun) {
    runtime.log("[dry-run] remove Argent.app defaults (ai.argent.mac)");
    return;
  }
  const result = spawnSync("defaults", ["delete", "ai.argent.mac"], { encoding: "utf8" });
  if (result.error) {
    runtime.error(`Failed to remove Argent.app defaults: ${String(result.error)}`);
    return;
  }
  if ((result.status ?? 1) === 0) {
    runtime.log("Removed Argent.app defaults");
    return;
  }
  runtime.log("Argent.app defaults not found.");
}

async function removeMacApp(runtime: RuntimeEnv, dryRun?: boolean) {
  if (process.platform !== "darwin") {
    return;
  }
  await removePath("/Applications/Argent.app", runtime, {
    dryRun,
    label: "/Applications/Argent.app",
  });
}

export async function uninstallCommand(runtime: RuntimeEnv, opts: UninstallOptions) {
  const { scopes, hadExplicit } = buildScopeSelection(opts);
  const interactive = !opts.nonInteractive;
  if (!interactive && !opts.yes) {
    runtime.error("Non-interactive mode requires --yes.");
    runtime.exit(1);
    return;
  }

  if (!hadExplicit) {
    if (!interactive) {
      runtime.error("Non-interactive mode requires explicit scopes (use --all).");
      runtime.exit(1);
      return;
    }
    const selection = await multiselectStyled<UninstallScope>({
      message: "Uninstall which components?",
      options: [
        {
          value: "service",
          label: "Managed services",
          hint: "gateway + dashboard launch agents",
        },
        {
          value: "install",
          label: "Install footprint",
          hint: "wrappers + runtime snapshot + checkout",
        },
        { value: "state", label: "State + config", hint: "~/.argentos" },
        { value: "workspace", label: "Workspace", hint: "agent files" },
        {
          value: "app",
          label: "macOS app",
          hint: "/Applications/Argent.app",
        },
      ],
      initialValues: ["service", "install", "state", "workspace"],
    });
    if (isCancel(selection)) {
      cancel(stylePromptTitle("Uninstall cancelled.") ?? "Uninstall cancelled.");
      runtime.exit(0);
      return;
    }
    for (const value of selection) {
      scopes.add(value);
    }
  }

  if (scopes.size === 0) {
    runtime.log("Nothing selected.");
    return;
  }

  if (interactive && !opts.yes) {
    const ok = await confirm({
      message: stylePromptMessage("Proceed with uninstall?"),
    });
    if (isCancel(ok) || !ok) {
      cancel(stylePromptTitle("Uninstall cancelled.") ?? "Uninstall cancelled.");
      runtime.exit(0);
      return;
    }
  }

  const dryRun = Boolean(opts.dryRun);
  const cfg = loadConfig();
  const stateDir = resolveStateDir();
  const configPath = resolveConfigPath();
  const oauthDir = resolveOAuthDir();
  const configInsideState = isPathWithin(configPath, stateDir);
  const oauthInsideState = isPathWithin(oauthDir, stateDir);
  const workspaceDirs = collectWorkspaceDirs(cfg);

  if (scopes.has("service")) {
    if (dryRun) {
      runtime.log("[dry-run] remove gateway + dashboard services");
    } else {
      await stopAndUninstallService({
        name: "Gateway service",
        runtime,
        service: resolveGatewayService(),
      });
      await stopAndUninstallService({
        name: "Dashboard UI service",
        runtime,
        service: resolveDashboardUiService(),
      });
      await stopAndUninstallService({
        name: "Dashboard API service",
        runtime,
        service: resolveDashboardApiService(),
      });
    }
  }

  if (scopes.has("install")) {
    await removeInstallFootprint(runtime, stateDir, dryRun);
  }

  if (scopes.has("app")) {
    await removeMacApp(runtime, dryRun);
    clearMacAppDefaults(runtime, dryRun);
  }

  if (scopes.has("state")) {
    if (!scopes.has("install")) {
      const legacyStateDir = resolveUserPath("~/.argent");
      await removePath(legacyStateDir, runtime, {
        dryRun,
        label: legacyStateDir,
      });
    }
    await removePath(stateDir, runtime, { dryRun, label: stateDir });
    if (!configInsideState) {
      await removePath(configPath, runtime, { dryRun, label: configPath });
    }
    if (!oauthInsideState) {
      await removePath(oauthDir, runtime, { dryRun, label: oauthDir });
    }
  }

  if (scopes.has("workspace")) {
    for (const workspace of workspaceDirs) {
      await removePath(workspace, runtime, { dryRun, label: workspace });
    }
  }

  if (scopes.has("install")) {
    runtime.log("Local install footprint removed.");
  } else {
    runtime.log("Installed wrappers/runtime preserved. Use --install or --all to remove them.");
  }

  if (scopes.has("state") && !scopes.has("workspace")) {
    const home = resolveHomeDir();
    if (home && workspaceDirs.some((dir) => dir.startsWith(path.resolve(home)))) {
      runtime.log("Tip: workspaces were preserved. Re-run with --workspace to remove them.");
    }
  }
}
