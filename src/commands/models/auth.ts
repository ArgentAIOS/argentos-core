import { confirm as clackConfirm, select as clackSelect, text as clackText } from "@clack/prompts";
import type { AuthProfileCredential } from "../../agents/auth-profiles/types.js";
import type { ModelTier } from "../../models/types.js";
import type {
  ProviderAuthMethod,
  ProviderAuthResult,
  ProviderPlugin,
  ProviderRecommendedModel,
} from "../../plugins/types.js";
import type { RuntimeEnv } from "../../runtime.js";
import {
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { upsertAuthProfile } from "../../agents/auth-profiles.js";
import { normalizeProviderId } from "../../agents/model-selection.js";
import { loginOpenAICodexDevice } from "../../agents/openai-codex-auth.js";
import { resolveDefaultAgentWorkspaceDir } from "../../agents/workspace.js";
import { formatCliCommand } from "../../cli/command-format.js";
import { parseDurationMs } from "../../cli/parse-duration.js";
import { readConfigFileSnapshot, type ArgentConfig } from "../../config/config.js";
import { logConfigUpdated } from "../../config/logging.js";
import { resolvePluginProviders } from "../../plugins/providers.js";
import { stylePromptHint, stylePromptMessage } from "../../terminal/prompt-style.js";
import { createClackPrompter } from "../../wizard/clack-prompter.js";
import { validateAnthropicSetupToken } from "../auth-token.js";
import { isHeadlessSession, isRemoteEnvironment } from "../oauth-env.js";
import { createVpsAwareOAuthHandlers } from "../oauth-flow.js";
import { applyAuthProfileConfig } from "../onboard-auth.js";
import { writeOAuthCredentials } from "../onboard-auth.js";
import { openUrl } from "../onboard-helpers.js";
import {
  applyOpenAICodexModelDefault,
  OPENAI_CODEX_DEFAULT_MODEL,
} from "../openai-codex-model-default.js";
import { updateConfig } from "./shared.js";

const confirm = (params: Parameters<typeof clackConfirm>[0]) =>
  clackConfirm({
    ...params,
    message: stylePromptMessage(params.message),
  });
const text = (params: Parameters<typeof clackText>[0]) =>
  clackText({
    ...params,
    message: stylePromptMessage(params.message),
  });
const select = <T>(params: Parameters<typeof clackSelect<T>>[0]) =>
  clackSelect({
    ...params,
    message: stylePromptMessage(params.message),
    options: params.options.map((opt) =>
      opt.hint === undefined ? opt : { ...opt, hint: stylePromptHint(opt.hint) },
    ),
  });

type TokenProvider = "anthropic";

function resolveTokenProvider(raw?: string): TokenProvider | "custom" | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeProviderId(trimmed);
  if (normalized === "anthropic") {
    return "anthropic";
  }
  return "custom";
}

function resolveDefaultTokenProfileId(provider: string): string {
  return `${normalizeProviderId(provider)}:manual`;
}

export async function modelsAuthSetupTokenCommand(
  opts: { provider?: string; yes?: boolean },
  runtime: RuntimeEnv,
) {
  const provider = resolveTokenProvider(opts.provider ?? "anthropic");
  if (provider !== "anthropic") {
    throw new Error("Only --provider anthropic is supported for setup-token.");
  }

  if (!process.stdin.isTTY) {
    throw new Error("setup-token requires an interactive TTY.");
  }

  if (!opts.yes) {
    const proceed = await confirm({
      message: "Do you already have the `claude setup-token` value ready for Argent?",
      initialValue: true,
    });
    if (!proceed) {
      return;
    }
  }

  const tokenInput = await text({
    message: "Paste the Anthropic setup-token for Argent",
    validate: (value) => validateAnthropicSetupToken(String(value ?? "")),
  });
  const token = String(tokenInput).trim();
  const profileId = resolveDefaultTokenProfileId(provider);

  upsertAuthProfile({
    profileId,
    credential: {
      type: "token",
      provider,
      token,
    },
  });

  await updateConfig((cfg) =>
    applyAuthProfileConfig(cfg, {
      profileId,
      provider,
      mode: "token",
    }),
  );

  logConfigUpdated(runtime);
  runtime.log(`Auth profile: ${profileId} (${provider}/token)`);
}

export async function modelsAuthPasteTokenCommand(
  opts: {
    provider?: string;
    profileId?: string;
    expiresIn?: string;
  },
  runtime: RuntimeEnv,
) {
  const rawProvider = opts.provider?.trim();
  if (!rawProvider) {
    throw new Error("Missing --provider.");
  }
  const provider = normalizeProviderId(rawProvider);
  const profileId = opts.profileId?.trim() || resolveDefaultTokenProfileId(provider);

  const tokenInput = await text({
    message: `Paste the token Argent should use for ${provider}`,
    validate: (value) => (value?.trim() ? undefined : "Required"),
  });
  const token = String(tokenInput).trim();

  const expires =
    opts.expiresIn?.trim() && opts.expiresIn.trim().length > 0
      ? Date.now() + parseDurationMs(String(opts.expiresIn).trim(), { defaultUnit: "d" })
      : undefined;

  upsertAuthProfile({
    profileId,
    credential: {
      type: "token",
      provider,
      token,
      ...(expires ? { expires } : {}),
    },
  });

  await updateConfig((cfg) => applyAuthProfileConfig(cfg, { profileId, provider, mode: "token" }));

  logConfigUpdated(runtime);
  runtime.log(`Auth profile: ${profileId} (${provider}/token)`);
}

export async function modelsAuthAddCommand(_opts: Record<string, never>, runtime: RuntimeEnv) {
  const provider = (await select({
    message: "Which provider should Argent authenticate with?",
    options: [
      { value: "anthropic", label: "anthropic" },
      { value: "custom", label: "custom (type provider id)" },
    ],
  })) as TokenProvider | "custom";

  const providerId =
    provider === "custom"
      ? normalizeProviderId(
          String(
            await text({
              message: "Provider id for Argent",
              validate: (value) => (value?.trim() ? undefined : "Required"),
            }),
          ),
        )
      : provider;

  const method = (await select({
    message: "How should Argent receive the credential?",
    options: [
      ...(providerId === "anthropic"
        ? [
            {
              value: "setup-token",
              label: "setup-token (claude)",
              hint: "Paste a setup-token from `claude setup-token`",
            },
          ]
        : []),
      { value: "paste", label: "paste token" },
    ],
  })) as "setup-token" | "paste";

  if (method === "setup-token") {
    await modelsAuthSetupTokenCommand({ provider: providerId }, runtime);
    return;
  }

  const profileIdDefault = resolveDefaultTokenProfileId(providerId);
  const profileId = String(
    await text({
      message: "Auth profile id",
      initialValue: profileIdDefault,
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
  ).trim();

  const wantsExpiry = await confirm({
    message: "Does this credential expire?",
    initialValue: false,
  });
  const expiresIn = wantsExpiry
    ? String(
        await text({
          message: "Expires in (duration)",
          initialValue: "365d",
          validate: (value) => {
            try {
              parseDurationMs(String(value ?? ""), { defaultUnit: "d" });
              return undefined;
            } catch {
              return "Invalid duration (e.g. 365d, 12h, 30m)";
            }
          },
        }),
      ).trim()
    : undefined;

  await modelsAuthPasteTokenCommand({ provider: providerId, profileId, expiresIn }, runtime);
}

type LoginOptions = {
  provider?: string;
  method?: string;
  setDefault?: boolean;
};

/**
 * Post-auth sanity check for the Codex device-code flow. The flow can return
 * a partial / empty credential after a timeout or expired code; downstream
 * writes would silently persist something useless. Fail loud here so the
 * user sees the failure and re-runs.
 *
 * Equivalent to subctl's auth.json `tokens` field check.
 *
 * Exported for direct unit testing.
 */
export function assertOpenAICodexCredentialsValid(
  creds: { access?: string; refresh?: string } | null | undefined,
): asserts creds is { access: string; refresh: string } {
  if (!creds) {
    throw new Error("OpenAI Codex OAuth did not return credentials.");
  }
  if (!creds.access || !creds.refresh) {
    throw new Error(
      `OpenAI Codex OAuth completed but tokens are missing — re-run \`${formatCliCommand("argent models auth login --provider openai-codex")}\`.`,
    );
  }
}

async function runBuiltInOpenAICodexLogin(params: {
  opts: LoginOptions;
  runtime: RuntimeEnv;
  prompter: ReturnType<typeof createClackPrompter>;
  agentDir: string;
}) {
  const resolveOAuthEmail = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : "default";

  // Headless / SSH detection: codex's OAuth flow needs a browser somewhere,
  // but on a remote shell the local machine has none. Print an explicit
  // device-code education message and skip the local browser-open attempt.
  // The device-auth API endpoints we hit (server-side) require the per-account
  // "Enable device code authorization for Codex" toggle in ChatGPT web →
  // Settings → Security; without it the user gets a confusing error and a
  // round-trip back to settings — the inline note cuts a support cycle.
  const headless = isHeadlessSession();
  if (headless) {
    await params.prompter.note(
      [
        "Detected headless / SSH session — using device-code flow.",
        "Codex will print a URL and a short code. Open the URL in any browser,",
        "paste the code, and approve.",
        "",
        "NOTE: device-code requires that you've enabled it once in",
        'ChatGPT web → Settings → Security → "Enable device code authorization',
        "for Codex\" for the account you're authenticating.",
      ].join("\n"),
      "OpenAI Codex headless login",
    );
  }

  const creds = await loginOpenAICodexDevice({
    onStart: async (info) => {
      params.runtime.log("Open this URL in your browser:");
      params.runtime.log(`  ${info.verificationUri}`);
      params.runtime.log("Enter this code:");
      params.runtime.log(`  ${info.userCode}`);
      if (!headless) {
        await openUrl(info.verificationUri);
      }
      await params.prompter.note(
        [`Open: ${info.verificationUri}`, `Code: ${info.userCode}`].join("\n"),
        "OpenAI Codex device login",
      );
    },
    onProgress: (message) => {
      params.runtime.log(message);
    },
  });

  assertOpenAICodexCredentialsValid(creds);

  await writeOAuthCredentials("openai-codex", creds, params.agentDir);
  const profileId = `openai-codex:${resolveOAuthEmail((creds as Record<string, unknown>).email)}`;
  await updateConfig((cfg) => {
    let next = applyAuthProfileConfig(cfg, {
      profileId,
      provider: "openai-codex",
      mode: "oauth",
    });
    if (params.opts.setDefault) {
      next = applyOpenAICodexModelDefault(next).next;
    }
    return next;
  });

  logConfigUpdated(params.runtime);
  params.runtime.log(`Auth profile: ${profileId} (openai-codex/oauth)`);
  if (params.opts.setDefault) {
    params.runtime.log(`Default model set to ${OPENAI_CODEX_DEFAULT_MODEL}`);
  } else {
    params.runtime.log(
      `Default model available: ${OPENAI_CODEX_DEFAULT_MODEL} (use --set-default to apply)`,
    );
  }
}

function resolveProviderMatch(
  providers: ProviderPlugin[],
  rawProvider?: string,
): ProviderPlugin | null {
  const raw = rawProvider?.trim();
  if (!raw) {
    return null;
  }
  const normalized = normalizeProviderId(raw);
  return (
    providers.find((provider) => normalizeProviderId(provider.id) === normalized) ??
    providers.find(
      (provider) =>
        provider.aliases?.some((alias) => normalizeProviderId(alias) === normalized) ?? false,
    ) ??
    null
  );
}

function pickAuthMethod(provider: ProviderPlugin, rawMethod?: string): ProviderAuthMethod | null {
  const raw = rawMethod?.trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  return (
    provider.auth.find((method) => method.id.toLowerCase() === normalized) ??
    provider.auth.find((method) => method.label.toLowerCase() === normalized) ??
    null
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mergeConfigPatch<T>(base: T, patch: unknown): T {
  if (!isPlainRecord(base) || !isPlainRecord(patch)) {
    return patch as T;
  }

  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = next[key];
    if (isPlainRecord(existing) && isPlainRecord(value)) {
      next[key] = mergeConfigPatch(existing, value);
    } else {
      next[key] = value;
    }
  }
  return next as T;
}

export function applyDefaultModel(cfg: ArgentConfig, model: string): ArgentConfig {
  const models = { ...cfg.agents?.defaults?.models };
  models[model] = models[model] ?? {};

  const existingModel = cfg.agents?.defaults?.model;
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models,
        model: {
          ...(existingModel && typeof existingModel === "object" && "fallbacks" in existingModel
            ? { fallbacks: (existingModel as { fallbacks?: string[] }).fallbacks }
            : undefined),
          primary: model,
        },
      },
    },
  };
}

/**
 * Split a provider-qualified model id (e.g. "qwen-portal/coder-model") into
 * provider + model parts for the routing-profile tier mapping schema. Falls
 * back to passing the bare model id through with the caller-supplied provider.
 */
function splitQualifiedModel(
  fallbackProvider: string,
  qualified: string,
): { provider: string; model: string } {
  const slash = qualified.indexOf("/");
  if (slash <= 0) {
    return { provider: fallbackProvider, model: qualified };
  }
  return {
    provider: qualified.slice(0, slash),
    model: qualified.slice(slash + 1),
  };
}

/**
 * Apply a plugin-declared recommended model to the routing profile for a
 * specific tier. If no `activeProfile` is set on modelRouter, writes to the
 * top-level `modelRouter.tiers.<tier>` legacy slot. Otherwise updates the
 * active profile's tier mapping.
 *
 * Also keeps the bare `agents.defaults.model.primary` in sync as a useful
 * non-router fallback (matches openai-codex behavior).
 */
export function applyTieredRecommendedModel(
  cfg: ArgentConfig,
  providerId: string,
  modelId: string,
  tier: ModelTier,
): ArgentConfig {
  const { provider: resolvedProvider, model: resolvedModel } = splitQualifiedModel(
    providerId,
    modelId,
  );
  const mapping = { provider: resolvedProvider, model: resolvedModel };

  const existingRouter = cfg.agents?.defaults?.modelRouter ?? {};
  const activeProfile = existingRouter.activeProfile;

  let nextRouter = existingRouter;
  if (activeProfile) {
    const profiles = { ...(existingRouter.profiles ?? {}) };
    const existingProfile = profiles[activeProfile] ?? { tiers: {} };
    profiles[activeProfile] = {
      ...existingProfile,
      tiers: {
        ...(existingProfile.tiers ?? {}),
        [tier]: mapping,
      },
    };
    nextRouter = { ...existingRouter, profiles };
  } else {
    nextRouter = {
      ...existingRouter,
      tiers: {
        ...(existingRouter.tiers ?? {}),
        [tier]: mapping,
      },
    };
  }

  const withPrimary = applyDefaultModel(cfg, modelId);
  return {
    ...withPrimary,
    agents: {
      ...withPrimary.agents,
      defaults: {
        ...withPrimary.agents?.defaults,
        modelRouter: nextRouter,
      },
    },
  };
}

/**
 * Resolve the model recommendation to apply when `--set-default` is true.
 *
 * Precedence (highest first):
 *   1. Plugin manifest `recommendedModel` (the GH #190 design).
 *   2. Per-auth-method `result.defaultModel` (legacy; auth.run-returned hint).
 *
 * Returns null when the plugin declares no recommendation in either place,
 * which lets the dispatch emit a clear "ignored" warning.
 */
export function resolveRecommendedModel(
  provider: ProviderPlugin,
  result: ProviderAuthResult,
): ProviderRecommendedModel | null {
  if (provider.recommendedModel) {
    return provider.recommendedModel;
  }
  if (result.defaultModel) {
    return { id: result.defaultModel };
  }
  return null;
}

function credentialMode(credential: AuthProfileCredential): "api_key" | "oauth" | "token" {
  if (credential.type === "api_key") {
    return "api_key";
  }
  if (credential.type === "token") {
    return "token";
  }
  return "oauth";
}

export async function modelsAuthLoginCommand(opts: LoginOptions, runtime: RuntimeEnv) {
  if (!process.stdin.isTTY) {
    throw new Error("models auth login requires an interactive TTY.");
  }

  const snapshot = await readConfigFileSnapshot();
  if (!snapshot.valid) {
    const issues = snapshot.issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n");
    throw new Error(`Invalid config at ${snapshot.path}\n${issues}`);
  }

  const config = snapshot.config;
  const defaultAgentId = resolveDefaultAgentId(config);
  const agentDir = resolveAgentDir(config, defaultAgentId);
  const workspaceDir =
    resolveAgentWorkspaceDir(config, defaultAgentId) ?? resolveDefaultAgentWorkspaceDir();
  const requestedProviderId = normalizeProviderId(String(opts.provider ?? ""));
  const prompter = createClackPrompter();

  if (requestedProviderId === "openai-codex") {
    await runBuiltInOpenAICodexLogin({
      opts,
      runtime,
      prompter,
      agentDir,
    });
    return;
  }

  const providers = resolvePluginProviders({ config, workspaceDir });
  if (providers.length === 0) {
    throw new Error(
      `No provider plugins found. Install one via \`${formatCliCommand("argent plugins install")}\`.`,
    );
  }

  const requestedProvider = opts.provider?.trim();
  const matchedRequestedProvider = resolveProviderMatch(providers, requestedProvider);
  if (requestedProvider && !matchedRequestedProvider) {
    const available = providers.map((provider) => provider.id).join(", ");
    throw new Error(
      `Unknown provider "${requestedProvider}" for models auth login. ` +
        `Available providers: ${available || "(none)"}.`,
    );
  }
  const selectedProvider =
    matchedRequestedProvider ??
    (await prompter
      .select({
        message: "Select a provider",
        options: providers.map((provider) => ({
          value: provider.id,
          label: provider.label,
          hint: provider.docsPath ? `Docs: ${provider.docsPath}` : undefined,
        })),
      })
      .then((id) => resolveProviderMatch(providers, String(id))));

  if (!selectedProvider) {
    throw new Error("Unknown provider. Use --provider <id> to pick a provider plugin.");
  }

  const chosenMethod =
    pickAuthMethod(selectedProvider, opts.method) ??
    (selectedProvider.auth.length === 1
      ? selectedProvider.auth[0]
      : await prompter
          .select({
            message: `Auth method for ${selectedProvider.label}`,
            options: selectedProvider.auth.map((method) => ({
              value: method.id,
              label: method.label,
              hint: method.hint,
            })),
          })
          .then((id) => selectedProvider.auth.find((method) => method.id === String(id))));

  if (!chosenMethod) {
    throw new Error("Unknown auth method. Use --method <id> to select one.");
  }

  const isRemote = isRemoteEnvironment();
  const result: ProviderAuthResult = await chosenMethod.run({
    config,
    agentDir,
    workspaceDir,
    prompter,
    runtime,
    isRemote,
    openUrl: async (url) => {
      await openUrl(url);
    },
    oauth: {
      createVpsAwareHandlers: (params) => createVpsAwareOAuthHandlers(params),
    },
  });

  for (const profile of result.profiles) {
    upsertAuthProfile({
      profileId: profile.profileId,
      credential: profile.credential,
      agentDir,
    });
  }

  const recommendation = resolveRecommendedModel(selectedProvider, result);

  await updateConfig((cfg) => {
    let next = cfg;
    if (result.configPatch) {
      next = mergeConfigPatch(next, result.configPatch);
    }
    for (const profile of result.profiles) {
      next = applyAuthProfileConfig(next, {
        profileId: profile.profileId,
        provider: profile.credential.provider,
        mode: credentialMode(profile.credential),
      });
    }
    if (opts.setDefault && recommendation) {
      if (recommendation.tier) {
        next = applyTieredRecommendedModel(
          next,
          selectedProvider.id,
          recommendation.id,
          recommendation.tier,
        );
      } else {
        next = applyDefaultModel(next, recommendation.id);
      }
    }
    return next;
  });

  logConfigUpdated(runtime);
  for (const profile of result.profiles) {
    runtime.log(
      `Auth profile: ${profile.profileId} (${profile.credential.provider}/${credentialMode(profile.credential)})`,
    );
  }
  if (recommendation) {
    if (opts.setDefault) {
      runtime.log(
        recommendation.tier
          ? `Default model set to ${recommendation.id} (tier: ${recommendation.tier})`
          : `Default model set to ${recommendation.id}`,
      );
    } else {
      runtime.log(`Default model available: ${recommendation.id} (use --set-default to apply)`);
    }
  } else if (opts.setDefault) {
    // GH #190: surface a clear warning rather than silently no-opping when
    // `--set-default` is passed for a plugin that declares no recommendedModel.
    runtime.log(
      `--set-default ignored: provider "${selectedProvider.id}" does not declare a recommended model.`,
    );
  }
  if (result.notes && result.notes.length > 0) {
    await prompter.note(result.notes.join("\n"), "Provider notes");
  }
}
