import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { OnboardOptions } from "../commands/onboard-types.js";
import type { ArgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { GatewayWizardSettings, WizardFlow } from "./onboarding.types.js";
import type { WizardPrompter } from "./prompts.js";
import { DEFAULT_BOOTSTRAP_FILENAME } from "../agents/workspace.js";
import { resolveCliName } from "../cli/cli-name.js";
import { formatCliCommand } from "../cli/command-format.js";
import { installCompletion } from "../cli/completion-cli.js";
import {
  buildGatewayInstallPlan,
  gatewayInstallErrorHint,
} from "../commands/daemon-install-helpers.js";
import {
  DEFAULT_GATEWAY_DAEMON_RUNTIME,
  GATEWAY_DAEMON_RUNTIME_OPTIONS,
} from "../commands/daemon-runtime.js";
import {
  checkShellCompletionStatus,
  ensureCompletionCacheExists,
} from "../commands/doctor-completion.js";
import { formatHealthCheckFailure } from "../commands/health-format.js";
import { healthCommand } from "../commands/health.js";
import {
  detectBrowserOpenSupport,
  formatControlUiSshHint,
  openUrl,
  probeGatewayReachable,
  waitForGatewayReachable,
  resolveControlUiLinks,
} from "../commands/onboard-helpers.js";
import { resolveGatewayService } from "../daemon/service.js";
import { isSystemdUserServiceAvailable } from "../daemon/systemd.js";
import { ensureControlUiAssetsBuilt } from "../infra/control-ui-assets.js";
import { restoreTerminalState } from "../terminal/restore.js";
import { runTui } from "../tui/tui.js";
import { resolveUserPath } from "../utils.js";

const execFileAsync = promisify(execFile);
const WIZARD_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const AOS_GOOGLE_PREFLIGHT_PATH = path.join(
  WIZARD_REPO_ROOT,
  "tools",
  "aos",
  "aos-google",
  "installer",
  "preflight_gws.py",
);

type AosGooglePreflightCheck = {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
};

type AosGooglePreflightPayload = {
  ok: boolean;
  tool?: string;
  backend?: string;
  checks?: AosGooglePreflightCheck[];
  next_steps?: string[];
  error?: string;
  details?: string;
};

async function runAosGooglePreflight(params: {
  installMissing?: boolean;
  requireAuth?: boolean;
}): Promise<AosGooglePreflightPayload | null> {
  try {
    await fs.access(AOS_GOOGLE_PREFLIGHT_PATH);
  } catch {
    return null;
  }

  const args = [AOS_GOOGLE_PREFLIGHT_PATH];
  if (params.installMissing === true) args.push("--install-missing");
  if (params.requireAuth !== false) args.push("--require-auth");
  args.push("--json");

  try {
    const { stdout } = await execFileAsync("python3", args, {
      cwd: WIZARD_REPO_ROOT,
      encoding: "utf8",
    });
    return JSON.parse(stdout) as AosGooglePreflightPayload;
  } catch (err) {
    const stdout =
      err && typeof err === "object" && "stdout" in err && typeof err.stdout === "string"
        ? err.stdout
        : "";
    if (stdout.trim()) {
      try {
        return JSON.parse(stdout) as AosGooglePreflightPayload;
      } catch {
        // fall through
      }
    }
    return {
      ok: false,
      tool: "aos-google",
      error: "Failed to run aos-google preflight",
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

type FinalizeOnboardingOptions = {
  flow: WizardFlow;
  opts: OnboardOptions;
  baseConfig: ArgentConfig;
  nextConfig: ArgentConfig;
  workspaceDir: string;
  settings: GatewayWizardSettings;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
};

export async function finalizeOnboardingWizard(
  options: FinalizeOnboardingOptions,
): Promise<{ launchedTui: boolean }> {
  const { flow, opts, baseConfig, nextConfig, settings, prompter, runtime } = options;

  const withWizardProgress = async <T>(
    label: string,
    options: { doneMessage?: string },
    work: (progress: { update: (message: string) => void }) => Promise<T>,
  ): Promise<T> => {
    const progress = prompter.progress(label);
    try {
      return await work(progress);
    } finally {
      progress.stop(options.doneMessage);
    }
  };

  const systemdAvailable =
    process.platform === "linux" ? await isSystemdUserServiceAvailable() : true;
  if (process.platform === "linux" && !systemdAvailable) {
    await prompter.note(
      "Systemd user services are unavailable. Skipping lingering checks and service install.",
      "Linux service model",
    );
  }

  if (process.platform === "linux" && systemdAvailable) {
    const { ensureSystemdUserLingerInteractive } = await import("../commands/systemd-linger.js");
    await ensureSystemdUserLingerInteractive({
      runtime,
      prompter: {
        confirm: prompter.confirm,
        note: prompter.note,
      },
      reason:
        "Linux installs use a systemd user service by default. Without lingering, systemd stops the user session on logout/idle and kills the Gateway.",
      requireConfirm: false,
    });
  }

  const explicitInstallDaemon =
    typeof opts.installDaemon === "boolean" ? opts.installDaemon : undefined;
  let installDaemon: boolean;
  if (explicitInstallDaemon !== undefined) {
    installDaemon = explicitInstallDaemon;
  } else if (process.platform === "linux" && !systemdAvailable) {
    installDaemon = false;
  } else if (flow === "quickstart") {
    installDaemon = true;
  } else {
    installDaemon = await prompter.confirm({
      message: "Install Gateway service (recommended)",
      initialValue: true,
    });
  }

  if (process.platform === "linux" && !systemdAvailable && installDaemon) {
    await prompter.note(
      "Systemd user services are unavailable; skipping service install. Use your container supervisor or `docker compose up -d`.",
      "Gateway service",
    );
    installDaemon = false;
  }

  if (installDaemon) {
    const daemonRuntime =
      flow === "quickstart"
        ? DEFAULT_GATEWAY_DAEMON_RUNTIME
        : await prompter.select({
            message: "Gateway service runtime",
            options: GATEWAY_DAEMON_RUNTIME_OPTIONS,
            initialValue: opts.daemonRuntime ?? DEFAULT_GATEWAY_DAEMON_RUNTIME,
          });
    if (flow === "quickstart") {
      await prompter.note(
        "Argent Quickstart uses Node for the Gateway service. It is the stable path for first bring-up.",
        "Gateway runtime",
      );
    }
    const service = resolveGatewayService();
    const loaded = await service.isLoaded({ env: process.env });
    if (loaded) {
      const action = await prompter.select({
        message: "Gateway service already installed",
        options: [
          { value: "restart", label: "Restart the existing service" },
          { value: "reinstall", label: "Reinstall from this workspace" },
          { value: "skip", label: "Leave it as-is" },
        ],
      });
      if (action === "restart") {
        await withWizardProgress(
          "Gateway service",
          { doneMessage: "Gateway service restarted." },
          async (progress) => {
            progress.update("Restarting Gateway service…");
            await service.restart({
              env: process.env,
              stdout: process.stdout,
            });
          },
        );
      } else if (action === "reinstall") {
        await withWizardProgress(
          "Gateway service",
          { doneMessage: "Gateway service uninstalled." },
          async (progress) => {
            progress.update("Uninstalling Gateway service…");
            await service.uninstall({ env: process.env, stdout: process.stdout });
          },
        );
      }
    }

    if (!loaded || (loaded && !(await service.isLoaded({ env: process.env })))) {
      const progress = prompter.progress("Gateway service");
      let installError: string | null = null;
      try {
        progress.update("Preparing Gateway service…");
        const { programArguments, workingDirectory, environment } = await buildGatewayInstallPlan({
          env: process.env,
          port: settings.port,
          token: settings.gatewayToken,
          runtime: daemonRuntime,
          warn: (message, title) => prompter.note(message, title),
          config: nextConfig,
        });

        progress.update("Installing Gateway service…");
        await service.install({
          env: process.env,
          stdout: process.stdout,
          programArguments,
          workingDirectory,
          environment,
        });
      } catch (err) {
        installError = err instanceof Error ? err.message : String(err);
      } finally {
        progress.stop(
          installError ? "Gateway service install failed." : "Gateway service installed.",
        );
      }
      if (installError) {
        await prompter.note(`Gateway service install failed: ${installError}`, "Gateway");
        await prompter.note(gatewayInstallErrorHint(), "Gateway");
      }
    }
  }

  if (!opts.skipHealth) {
    const probeLinks = resolveControlUiLinks({
      bind: nextConfig.gateway?.bind ?? "loopback",
      port: settings.port,
      customBindHost: nextConfig.gateway?.customBindHost,
      basePath: undefined,
    });
    // Daemon install/restart can briefly flap the WS; wait a bit so health check doesn't false-fail.
    await waitForGatewayReachable({
      url: probeLinks.wsUrl,
      token: settings.gatewayToken,
      deadlineMs: 15_000,
    });
    try {
      await healthCommand({ json: false, timeoutMs: 10_000 }, runtime);
    } catch (err) {
      runtime.error(formatHealthCheckFailure(err));
      await prompter.note(
        [
          "Docs:",
          "https://docs.argent.ai/gateway/health",
          "https://docs.argent.ai/gateway/troubleshooting",
        ].join("\n"),
        "Health check help",
      );
    }
  }

  const controlUiEnabled =
    nextConfig.gateway?.controlUi?.enabled ?? baseConfig.gateway?.controlUi?.enabled ?? true;
  if (!opts.skipUi && controlUiEnabled) {
    const controlUiAssets = await ensureControlUiAssetsBuilt(runtime);
    if (!controlUiAssets.ok && controlUiAssets.message) {
      runtime.error(controlUiAssets.message);
    }
  }

  const aosGooglePreflight = await runAosGooglePreflight({ requireAuth: true });
  if (aosGooglePreflight) {
    if (aosGooglePreflight.ok) {
      await prompter.note(
        "AOS Google Workspace preflight passed. gws, auth, and sanitize defaults are ready.",
        "AOS Google Workspace",
      );
    } else {
      const failingChecks = Array.isArray(aosGooglePreflight.checks)
        ? aosGooglePreflight.checks.filter((check) => !check.ok).map((check) => check.name)
        : [];
      await prompter.note(
        [
          "AOS Google Workspace preflight needs operator attention.",
          failingChecks.length > 0 ? `Failing checks: ${failingChecks.join(", ")}` : null,
          Array.isArray(aosGooglePreflight.next_steps) && aosGooglePreflight.next_steps.length > 0
            ? `Next steps:\n- ${aosGooglePreflight.next_steps.join("\n- ")}`
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
        "AOS Google Workspace",
      );
      const runRemediation = await prompter.confirm({
        message: "Attempt gws install/auth preflight remediation now",
        initialValue: false,
      });
      if (runRemediation) {
        const remediation = await runAosGooglePreflight({
          installMissing: true,
          requireAuth: true,
        });
        if (remediation?.ok) {
          await prompter.note(
            "AOS Google Workspace remediation passed. The runtime is ready.",
            "AOS Google Workspace",
          );
        } else {
          const remediationFailures = Array.isArray(remediation?.checks)
            ? remediation.checks.filter((check) => !check.ok).map((check) => check.name)
            : [];
          await prompter.note(
            [
              "AOS Google Workspace still needs manual follow-up.",
              remediationFailures.length > 0
                ? `Failing checks: ${remediationFailures.join(", ")}`
                : null,
            ]
              .filter(Boolean)
              .join("\n"),
            "AOS Google Workspace",
          );
        }
      }
    }
  }

  await prompter.note(
    [
      "You can add companion nodes later if you want a wider Argent presence:",
      "- macOS app for native system integration and notifications",
      "- iOS app for mobile camera and canvas flows",
      "- Android app for mobile camera and canvas flows",
    ].join("\n"),
    "Companion apps",
  );

  const controlUiBasePath =
    nextConfig.gateway?.controlUi?.basePath ?? baseConfig.gateway?.controlUi?.basePath;
  const links = resolveControlUiLinks({
    bind: settings.bind,
    port: settings.port,
    customBindHost: settings.customBindHost,
    basePath: controlUiBasePath,
  });
  const tokenParam =
    settings.authMode === "token" && settings.gatewayToken
      ? `?token=${encodeURIComponent(settings.gatewayToken)}`
      : "";
  const authedUrl = `${links.httpUrl}${tokenParam}`;
  const gatewayProbe = await probeGatewayReachable({
    url: links.wsUrl,
    token: settings.authMode === "token" ? settings.gatewayToken : undefined,
    password: settings.authMode === "password" ? nextConfig.gateway?.auth?.password : "",
  });
  const gatewayStatusLine = gatewayProbe.ok
    ? "Gateway: reachable"
    : `Gateway: not detected${gatewayProbe.detail ? ` (${gatewayProbe.detail})` : ""}`;
  const bootstrapPath = path.join(
    resolveUserPath(options.workspaceDir),
    DEFAULT_BOOTSTRAP_FILENAME,
  );
  const hasBootstrap = await fs
    .access(bootstrapPath)
    .then(() => true)
    .catch(() => false);

  await prompter.note(
    [
      "Argent dashboard: http://127.0.0.1:8080/",
      `Gateway WS: ${links.wsUrl}`,
      gatewayStatusLine,
      "Docs: https://docs.argent.ai/web/control-ui",
    ]
      .filter(Boolean)
      .join("\n"),
    "Control UI",
  );

  let controlUiOpened = false;
  let controlUiOpenHint: string | undefined;
  let seededInBackground = false;
  let hatchChoice: "tui" | "web" | "later" | null = null;
  let launchedTui = false;

  if (!opts.skipUi && gatewayProbe.ok) {
    if (hasBootstrap) {
      await prompter.note(
        [
          "This is the first live moment for Argent in this workspace.",
          "Take your time. The more grounded your starting context is, the better the continuity will feel.",
          "The first-run ritual will start from BOOTSTRAP.md.",
        ].join("\n"),
        "Bring Argent online",
      );
    }

    await prompter.note(
      [
        "Gateway token: shared auth for the Gateway and the dashboard.",
        "Stored in: ~/.argentos/argent.json (gateway.auth.token) or ARGENT_GATEWAY_TOKEN.",
        "The web UI also keeps a local browser copy for reconnects.",
        `Get the tokenized dashboard link anytime: ${formatCliCommand("argent dashboard --no-open")}`,
      ].join("\n"),
      "Dashboard access",
    );

    // App download and launch choice is handled by the installer script after onboarding.
    // Just show a note about what's coming next.
    hatchChoice = "later";
    await prompter.note(
      [
        "Argent.app will be installed next (downloaded from argentos.ai).",
        "",
        "You can also access Argent at:",
        "  Dashboard: http://127.0.0.1:8080/",
        `  CLI: ${formatCliCommand("argent chat")}`,
      ].join("\n"),
      "Almost there",
    );
  } else if (opts.skipUi) {
    await prompter.note("Skipping Control UI/TUI prompts.", "Control UI");
  }

  // Use console.log for remaining notes — prompter.note() blocks the terminal
  // when piped through /dev/tty, preventing the installer from continuing.
  console.log(
    "\n  Workspace: back up once you like the initial state — https://docs.argent.ai/concepts/agent-workspace",
  );
  console.log("  Security: harden the setup — https://docs.argent.ai/security");

  // Shell completion setup
  const cliName = resolveCliName();
  const completionStatus = await checkShellCompletionStatus(cliName);

  if (completionStatus.usesSlowPattern) {
    // Case 1: Profile uses slow dynamic pattern - silently upgrade to cached version
    const cacheGenerated = await ensureCompletionCacheExists(cliName);
    if (cacheGenerated) {
      await installCompletion(completionStatus.shell, true, cliName);
    }
  } else if (completionStatus.profileInstalled && !completionStatus.cacheExists) {
    // Case 2: Profile has completion but no cache - auto-fix silently
    await ensureCompletionCacheExists(cliName);
  } else if (!completionStatus.profileInstalled) {
    // Case 3: No completion — auto-install without prompting (prompter.confirm blocks in installer)
    const cacheGenerated = await ensureCompletionCacheExists(cliName);
    if (cacheGenerated) {
      await installCompletion(completionStatus.shell, true, cliName);
      console.log(
        `  Shell completion: installed for ${completionStatus.shell}. Restart your shell to activate.`,
      );
    } else {
      console.log(`  Shell completion: run \`${cliName} completion --install\` later.`);
    }
  }
  // Case 4: Both profile and cache exist (using cached version) - all good, nothing to do

  const shouldOpenControlUi =
    !opts.skipUi &&
    settings.authMode === "token" &&
    Boolean(settings.gatewayToken) &&
    hatchChoice === null;
  if (shouldOpenControlUi) {
    const browserSupport = await detectBrowserOpenSupport();
    if (browserSupport.ok) {
      controlUiOpened = await openUrl(authedUrl);
      if (!controlUiOpened) {
        controlUiOpenHint = formatControlUiSshHint({
          port: settings.port,
          basePath: controlUiBasePath,
          token: settings.gatewayToken,
        });
      }
    } else {
      controlUiOpenHint = formatControlUiSshHint({
        port: settings.port,
        basePath: controlUiBasePath,
        token: settings.gatewayToken,
      });
    }

    console.log(`  Dashboard: ${authedUrl}`);
    if (false)
      await prompter.note(
        // disabled — blocks installer
        [
          `Dashboard link (with token): ${authedUrl}`,
          controlUiOpened
            ? "Opened in your browser. Keep that tab open as Argent's control surface."
            : "Open this URL in a browser on this machine to reach Argent's control surface.",
          controlUiOpenHint,
        ]
          .filter(Boolean)
          .join("\n"),
        "Dashboard ready",
      );
  }

  const webSearchKey = (nextConfig.tools?.web?.search?.apiKey ?? "").trim();
  const webSearchEnv = (process.env.BRAVE_API_KEY ?? "").trim();
  const hasWebSearchKey = Boolean(webSearchKey || webSearchEnv);
  if (hasWebSearchKey) {
    console.log("  Web search: enabled — https://docs.argent.ai/tools/web");
  } else {
    console.log(
      "  Web search: not configured — set BRAVE_API_KEY or run: argent configure --section web",
    );
  }

  // Use console.log instead of prompter.note/outro — clack prompts block
  // the terminal when piped through /dev/tty, preventing the installer from
  // continuing to the Argent.app download and launch steps.
  console.log("\n  ✓ Argent is online. Finishing setup...\n");

  return { launchedTui };
}
