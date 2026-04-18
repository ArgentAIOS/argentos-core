import type { ArgentConfig } from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import type { OnboardOptions } from "../onboard-types.js";
import { formatCliCommand } from "../../cli/command-format.js";
import { resolveGatewayPort, writeConfigFile } from "../../config/config.js";
import { logConfigUpdated } from "../../config/logging.js";
import {
  applyLocalRuntimeConfig,
  DEFAULT_EMBEDDING_MODEL,
  normalizeLocalRuntimeChoice,
  resolveDefaultLocalTextModel,
} from "../../wizard/onboarding.local-runtime.js";
import { DEFAULT_GATEWAY_DAEMON_RUNTIME } from "../daemon-runtime.js";
import { healthCommand } from "../health.js";
import {
  applyWizardMetadata,
  DEFAULT_WORKSPACE,
  ensureWorkspaceAndSessions,
  resolveControlUiLinks,
  waitForGatewayReachable,
} from "../onboard-helpers.js";
import { inferAuthChoiceFromFlags } from "./local/auth-choice-inference.js";
import { applyNonInteractiveAuthChoice } from "./local/auth-choice.js";
import { installGatewayDaemonNonInteractive } from "./local/daemon-install.js";
import { applyNonInteractiveGatewayConfig } from "./local/gateway-config.js";
import { logNonInteractiveOnboardingJson } from "./local/output.js";
import { applyNonInteractiveSkillsConfig } from "./local/skills-config.js";
import { resolveNonInteractiveWorkspaceDir } from "./local/workspace.js";

export async function runNonInteractiveOnboardingLocal(params: {
  opts: OnboardOptions;
  runtime: RuntimeEnv;
  baseConfig: ArgentConfig;
}) {
  const { opts, runtime, baseConfig } = params;
  const mode = "local" as const;

  const workspaceDir = resolveNonInteractiveWorkspaceDir({
    opts,
    baseConfig,
    defaultWorkspaceDir: DEFAULT_WORKSPACE,
  });

  let nextConfig: ArgentConfig = {
    ...baseConfig,
    agents: {
      ...baseConfig.agents,
      defaults: {
        ...baseConfig.agents?.defaults,
        workspace: workspaceDir,
      },
    },
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
  };

  const localRuntime = normalizeLocalRuntimeChoice(opts.localRuntime);
  if (opts.localRuntime && !localRuntime) {
    runtime.error(`Invalid --local-runtime "${String(opts.localRuntime)}" (use ollama|lmstudio).`);
    runtime.exit(1);
    return;
  }

  if (localRuntime) {
    nextConfig = applyLocalRuntimeConfig({
      choice: localRuntime,
      config: nextConfig,
      textModel: opts.localTextModel?.trim() || resolveDefaultLocalTextModel(localRuntime),
      embeddingModel: opts.localEmbeddingModel?.trim() || DEFAULT_EMBEDDING_MODEL,
    });
  }

  const inferredAuthChoice = inferAuthChoiceFromFlags(opts);

  let authChoice: string | undefined;

  // Support multiple API key flags — set up all provided providers
  if (!opts.authChoice && inferredAuthChoice.matches.length > 1) {
    authChoice = inferredAuthChoice.matches.map((m) => m.authChoice).join(",");
    for (const match of inferredAuthChoice.matches) {
      const result = await applyNonInteractiveAuthChoice({
        nextConfig,
        authChoice: match.authChoice,
        opts,
        runtime,
        baseConfig,
      });
      if (result) {
        nextConfig = result;
      }
    }
  } else {
    authChoice = opts.authChoice ?? inferredAuthChoice.choice ?? "skip";
    const nextConfigAfterAuth = await applyNonInteractiveAuthChoice({
      nextConfig,
      authChoice,
      opts,
      runtime,
      baseConfig,
    });
    if (!nextConfigAfterAuth) {
      return;
    }
    nextConfig = nextConfigAfterAuth;
  }

  if (localRuntime) {
    nextConfig = applyLocalRuntimeConfig({
      choice: localRuntime,
      config: nextConfig,
      textModel: opts.localTextModel?.trim() || resolveDefaultLocalTextModel(localRuntime),
      embeddingModel: opts.localEmbeddingModel?.trim() || DEFAULT_EMBEDDING_MODEL,
    });
  }

  const gatewayBasePort = resolveGatewayPort(baseConfig);
  const gatewayResult = applyNonInteractiveGatewayConfig({
    nextConfig,
    opts,
    runtime,
    defaultPort: gatewayBasePort,
  });
  if (!gatewayResult) {
    return;
  }
  nextConfig = gatewayResult.nextConfig;

  nextConfig = applyNonInteractiveSkillsConfig({ nextConfig, opts, runtime });

  nextConfig = applyWizardMetadata(nextConfig, { command: "onboard", mode });
  await writeConfigFile(nextConfig);
  logConfigUpdated(runtime);

  await ensureWorkspaceAndSessions(workspaceDir, runtime, {
    skipBootstrap: Boolean(nextConfig.agents?.defaults?.skipBootstrap),
  });

  await installGatewayDaemonNonInteractive({
    nextConfig,
    opts,
    runtime,
    port: gatewayResult.port,
    gatewayToken: gatewayResult.gatewayToken,
  });

  const daemonRuntimeRaw = opts.daemonRuntime ?? DEFAULT_GATEWAY_DAEMON_RUNTIME;
  if (!opts.skipHealth) {
    const links = resolveControlUiLinks({
      bind: gatewayResult.bind as "auto" | "lan" | "loopback" | "custom" | "tailnet",
      port: gatewayResult.port,
      customBindHost: nextConfig.gateway?.customBindHost,
      basePath: undefined,
    });
    await waitForGatewayReachable({
      url: links.wsUrl,
      token: gatewayResult.gatewayToken,
      deadlineMs: 15_000,
    });
    await healthCommand({ json: false, timeoutMs: 10_000 }, runtime);
  }

  logNonInteractiveOnboardingJson({
    opts,
    runtime,
    mode,
    workspaceDir,
    authChoice,
    localRuntime,
    gateway: {
      port: gatewayResult.port,
      bind: gatewayResult.bind,
      authMode: gatewayResult.authMode,
      tailscaleMode: gatewayResult.tailscaleMode,
    },
    installDaemon: Boolean(opts.installDaemon),
    daemonRuntime: opts.installDaemon ? daemonRuntimeRaw : undefined,
    skipSkills: Boolean(opts.skipSkills),
    skipHealth: Boolean(opts.skipHealth),
  });

  if (!opts.json) {
    runtime.log(
      `Tip: run \`${formatCliCommand("argent configure --section web")}\` to store your Brave API key for web_search. Docs: https://docs.argent.ai/tools/web`,
    );
  }
}
