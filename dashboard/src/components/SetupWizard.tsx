import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  Mic2,
  Rocket,
  RotateCcw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  LLM_PROVIDER_CARDS,
  SEARCH_PROVIDER_CARDS,
  VOICE_PROVIDER_CARDS,
  buildModelChoicesFromApi,
  deriveProviderAwareModelConfig,
  evaluateOnboardingStatus,
  getProviderFallbackModels,
  inferProviderFromModelRef,
  type LlmProviderId,
  type ProviderModelChoice,
  type SearchProviderId,
  type VoiceProviderId,
} from "../lib/onboardingStack";

interface SetupWizardProps {
  isOpen: boolean;
  onComplete: () => void;
}

const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 300 : -300, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -300 : 300, opacity: 0 }),
};

const STEP_META = [
  { title: "Welcome", icon: Rocket },
  { title: "Providers", icon: Key },
  { title: "Model & Access", icon: Cpu },
  { title: "Complete", icon: CheckCircle },
] as const;

const ACCENT_CLASSES: Record<string, { border: string; bg: string; text: string; badge: string }> = {
  amber: {
    border: "border-amber-500/50",
    bg: "bg-amber-600/10",
    text: "text-amber-300",
    badge: "bg-amber-600/20 text-amber-300",
  },
  emerald: {
    border: "border-emerald-500/50",
    bg: "bg-emerald-600/10",
    text: "text-emerald-300",
    badge: "bg-emerald-600/20 text-emerald-300",
  },
  violet: {
    border: "border-violet-500/50",
    bg: "bg-violet-600/10",
    text: "text-violet-300",
    badge: "bg-violet-600/20 text-violet-300",
  },
  cyan: {
    border: "border-cyan-500/50",
    bg: "bg-cyan-600/10",
    text: "text-cyan-300",
    badge: "bg-cyan-600/20 text-cyan-300",
  },
  slate: {
    border: "border-slate-500/50",
    bg: "bg-slate-600/10",
    text: "text-slate-200",
    badge: "bg-slate-600/20 text-slate-200",
  },
};

function defaultProfileName(provider: LlmProviderId | null): string {
  if (!provider || provider === "local") {
    return "";
  }
  return `${provider}:default`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function SetupWizard({ isOpen, onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [llmProvider, setLlmProvider] = useState<LlmProviderId | null>(null);
  const [voiceProvider, setVoiceProvider] = useState<VoiceProviderId>("edge");
  const [searchProvider, setSearchProvider] = useState<SearchProviderId>("brave");
  const [token, setToken] = useState("");
  const [profileName, setProfileName] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [modelOptions, setModelOptions] = useState<ProviderModelChoice[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [validationSummary, setValidationSummary] = useState<string[]>([]);
  const [showToken, setShowToken] = useState(false);

  const selectedProviderCard = useMemo(
    () => LLM_PROVIDER_CARDS.find((card) => card.id === llmProvider) ?? null,
    [llmProvider],
  );
  const accent = selectedProviderCard
    ? ACCENT_CLASSES[selectedProviderCard.accent]
    : ACCENT_CLASSES.amber;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let cancelled = false;

    const bootstrap = async () => {
      setError("");
      setValidationSummary([]);
      setStep(0);
      setDirection(1);
      try {
        const [modelsData, authData, ttsData, searchData] = await Promise.all([
          fetchJson<{
            model: unknown;
            subagentModel: string | null;
            modelRouter: Record<string, unknown> | null;
          }>("/api/settings/models"),
          fetchJson<{ profiles: Array<{ key: string; provider: string; type?: string | null }> }>(
            "/api/settings/auth-profiles",
          ),
          fetchJson<{ provider?: VoiceProviderId }>("/api/settings/tts"),
          fetchJson<{ provider?: SearchProviderId }>("/api/settings/search").catch(() => ({
            provider: "brave" as SearchProviderId,
          })),
        ]);
        if (cancelled) {
          return;
        }

        const primaryRef =
          typeof modelsData.model === "string"
            ? modelsData.model
            : (modelsData.model as { primary?: string } | null)?.primary;
        const inferredProvider = (inferProviderFromModelRef(primaryRef) || null) as
          | LlmProviderId
          | null;
        const firstAuthProvider = (authData.profiles[0]?.provider || null) as LlmProviderId | null;
        const nextProvider = inferredProvider ?? firstAuthProvider ?? "openai";

        setLlmProvider(nextProvider);
        setSelectedModel(typeof primaryRef === "string" ? primaryRef : "");
        setVoiceProvider((ttsData.provider as VoiceProviderId | undefined) || "edge");
        setSearchProvider((searchData.provider as SearchProviderId | undefined) || "brave");
        setProfileName(defaultProfileName(nextProvider));

        const status = evaluateOnboardingStatus({
          authProfiles: authData.profiles || [],
          modelConfig: modelsData,
        });
        setValidationSummary(status.reasons);
      } catch (err) {
        if (!cancelled) {
          console.error("[SetupWizard] Failed to load existing onboarding state", err);
          setLlmProvider("openai");
          setProfileName(defaultProfileName("openai"));
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!llmProvider) {
      return;
    }
    let cancelled = false;

    const loadModels = async () => {
      setModelsLoading(true);
      setError("");
      try {
        const fallback = getProviderFallbackModels(llmProvider);
        if (llmProvider === "local") {
          if (!cancelled) {
            setModelOptions(fallback);
            setSelectedModel((current) => current || fallback[0]?.id || "");
          }
          return;
        }

        const data = await fetchJson<{
          models?: Array<{ id?: string; model?: string; alias?: string | null; verified?: boolean }>;
        }>(`/api/settings/provider-models?provider=${encodeURIComponent(llmProvider)}&limit=40`);
        if (cancelled) {
          return;
        }

        const nextOptions = buildModelChoicesFromApi(llmProvider, data.models || []);
        setModelOptions(nextOptions);
        setSelectedModel((current) =>
          nextOptions.some((entry) => entry.id === current) ? current : (nextOptions[0]?.id ?? ""),
        );
      } catch (err) {
        if (!cancelled) {
          console.warn("[SetupWizard] Falling back to curated model list", err);
          const fallback = getProviderFallbackModels(llmProvider);
          setModelOptions(fallback);
          setSelectedModel((current) => current || fallback[0]?.id || "");
        }
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
        }
      }
    };

    if (llmProvider !== "local") {
      setProfileName((current) => {
        const trimmed = current.trim();
        return trimmed.length > 0 ? trimmed : defaultProfileName(llmProvider);
      });
    } else {
      setProfileName("");
      setToken("");
      setShowToken(false);
    }

    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [llmProvider]);

  function goNext() {
    setDirection(1);
    setStep((value) => Math.min(value + 1, STEP_META.length - 1));
  }

  function goBack() {
    setDirection(-1);
    setStep((value) => Math.max(value - 1, 0));
  }

  async function saveAuthProfile() {
    if (!llmProvider || llmProvider === "local") {
      return;
    }
    if (!token.trim()) {
      throw new Error("Add an API key before continuing.");
    }

    const normalizedProfileName = profileName.trim() || defaultProfileName(llmProvider);
    const [providerPart, ...rest] = normalizedProfileName.split(":");
    const provider = providerPart?.trim() || llmProvider;
    const name = rest.length > 0 ? rest.join(":").trim() || "default" : "default";
    const key = `${provider}:${name}`;
    const payload = {
      provider,
      name,
      token: token.trim(),
      type: "api_key",
      key,
      profile: {
        type: "api_key",
        provider,
        key: token.trim(),
      },
    };

    const createRes = await fetch("/api/settings/auth-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (createRes.ok) {
      return;
    }
    if (createRes.status !== 409) {
      const data = await createRes.json().catch(() => ({}));
      throw new Error(data?.error || `Failed to save auth profile (${createRes.status})`);
    }

    const updateRes = await fetch(`/api/settings/auth-profiles/${encodeURIComponent(key)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim() }),
    });
    if (!updateRes.ok) {
      const data = await updateRes.json().catch(() => ({}));
      throw new Error(data?.error || `Failed to update auth profile (${updateRes.status})`);
    }
  }

  async function validateBeforeFinish() {
    const [authData, modelsData] = await Promise.all([
      fetchJson<{ profiles: Array<{ key: string; provider: string; type?: string | null }> }>(
        "/api/settings/auth-profiles",
      ),
      fetchJson<{
        model: unknown;
        subagentModel: string | null;
        modelRouter: Record<string, unknown> | null;
      }>("/api/settings/models"),
    ]);

    const status = evaluateOnboardingStatus({
      authProfiles: authData.profiles || [],
      modelConfig: modelsData,
    });
    setValidationSummary(status.reasons);
    if (!status.valid) {
      throw new Error(status.reasons[0] || "The selected provider stack is still not usable.");
    }
  }

  async function saveStep() {
    if (!llmProvider) {
      setError("Pick a chat provider before continuing.");
      return;
    }
    if (!selectedModel) {
      setError("Choose a default model before continuing.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (llmProvider !== "local") {
        await saveAuthProfile();
      }

      const derived = deriveProviderAwareModelConfig({ llmProvider, selectedModel });

      await fetchJson("/api/settings/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: voiceProvider }),
      });

      await fetchJson("/api/settings/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: searchProvider, enabled: true }),
      });

      await fetchJson("/api/settings/models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: derived.model,
          subagentModel: derived.subagentModel,
          modelRouter: derived.modelRouter,
        }),
      });

      await validateBeforeFinish();
      goNext();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save onboarding settings.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  function renderStepIndicator() {
    return (
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEP_META.map((stepMeta, index) => (
          <div key={stepMeta.title} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
                index < step
                  ? "bg-amber-600 text-white"
                  : index === step
                    ? "bg-amber-600/20 border-2 border-amber-500 text-amber-400"
                    : "bg-white/5 border border-white/10 text-white/30"
              }`}
            >
              {index < step ? <CheckCircle className="w-4 h-4" /> : index + 1}
            </div>
            {index < STEP_META.length - 1 && (
              <div
                className={`w-8 h-0.5 transition-all duration-300 ${
                  index < step ? "bg-amber-600" : "bg-white/10"
                }`}
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  function renderWelcome() {
    return (
      <div className="flex flex-col items-center text-center px-4">
        <div className="w-20 h-20 rounded-2xl bg-amber-600/20 flex items-center justify-center mb-6">
          <Rocket className="w-10 h-10 text-amber-400" />
        </div>
        <h2 className="text-3xl font-bold text-white mb-3">
          Set up ArgentOS around your providers
        </h2>
        <p className="text-white/60 text-lg max-w-xl mb-8">
          Choose the chat, voice, and search stack you actually want. Argent will derive
          usable defaults from that stack instead of silently falling back to
          Anthropic-first assumptions.
        </p>
        <button
          onClick={goNext}
          className="flex items-center gap-2 px-8 py-3 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg transition-colors"
        >
          Start guided setup
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  function renderProviders() {
    return (
      <div className="px-4 max-w-3xl mx-auto w-full space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Choose your provider stack</h2>
          <p className="text-white/50 text-sm max-w-2xl mx-auto">
            Every graphical install should leave this wizard with an intentional chat
            provider, a voice provider, and a search provider. Pick the path that
            matches how you actually plan to use Argent.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-white/80 text-sm font-medium">
            <Key className="w-4 h-4 text-amber-300" />
            Chat / LLM provider
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {LLM_PROVIDER_CARDS.map((card) => {
              const classes = ACCENT_CLASSES[card.accent];
              const selected = llmProvider === card.id;
              return (
                <button
                  key={card.id}
                  onClick={() => {
                    setLlmProvider(card.id);
                    setError("");
                  }}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    selected
                      ? `${classes.bg} ${classes.border}`
                      : "bg-[#1a1a2e] border-white/10 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="text-white font-medium">{card.label}</div>
                      <div
                        className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${classes.badge}`}
                      >
                        {card.recommended}
                      </div>
                    </div>
                    {selected && (
                      <CheckCircle className={`w-4 h-4 ${classes.text} flex-shrink-0`} />
                    )}
                  </div>
                  <p className="text-white/55 text-xs leading-5 mb-3">{card.description}</p>
                  <div className="inline-flex items-center gap-1 text-[11px] text-white/45">
                    <ExternalLink className="w-3 h-3" />
                    Get keys at {card.keyUrl.replace(/^https?:\/\//, "")}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-white/80 text-sm font-medium">
              <Mic2 className="w-4 h-4 text-amber-300" />
              Voice provider
            </div>
            {VOICE_PROVIDER_CARDS.map((card) => (
              <button
                key={card.id}
                onClick={() => setVoiceProvider(card.id)}
                className={`w-full rounded-lg border p-3 text-left transition-all ${
                  voiceProvider === card.id
                    ? "bg-white/10 border-white/25"
                    : "bg-[#1a1a2e] border-white/10 hover:border-white/20"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-white text-sm font-medium">{card.label}</div>
                    <p className="text-white/45 text-xs mt-1 leading-5">{card.description}</p>
                  </div>
                  {voiceProvider === card.id && (
                    <CheckCircle className="w-4 h-4 text-amber-300 flex-shrink-0" />
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-white/80 text-sm font-medium">
              <Search className="w-4 h-4 text-amber-300" />
              Search provider
            </div>
            {SEARCH_PROVIDER_CARDS.map((card) => (
              <button
                key={card.id}
                onClick={() => setSearchProvider(card.id)}
                className={`w-full rounded-lg border p-3 text-left transition-all ${
                  searchProvider === card.id
                    ? "bg-white/10 border-white/25"
                    : "bg-[#1a1a2e] border-white/10 hover:border-white/20"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-white text-sm font-medium">{card.label}</div>
                    <p className="text-white/45 text-xs mt-1 leading-5">{card.description}</p>
                  </div>
                  {searchProvider === card.id && (
                    <CheckCircle className="w-4 h-4 text-amber-300 flex-shrink-0" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            onClick={goBack}
            className="flex items-center gap-1 text-white/40 hover:text-white/70 text-sm transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={goNext}
            disabled={!llmProvider}
            className="flex items-center gap-2 px-6 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-white/10 disabled:text-white/30 text-white font-medium rounded-lg transition-colors text-sm"
          >
            Continue
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  function renderModelAndAccess() {
    return (
      <div className="px-4 max-w-3xl mx-auto w-full space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Model access and defaults</h2>
          <p className="text-white/50 text-sm max-w-2xl mx-auto">
            Argent will save the model, subagent model, and router tiers from this
            provider so chat does not silently fall back to a provider you never chose.
          </p>
        </div>

        {llmProvider && llmProvider !== "local" && (
          <div className={`rounded-xl border p-4 ${accent.bg} ${accent.border}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-white font-medium mb-1">Hosted provider access</div>
                <div className="text-white/55 text-sm leading-6">
                  Save the API key you want Argent to use for {selectedProviderCard?.label}.
                  You can rotate or replace it later in Settings → API Keys.
                </div>
              </div>
              <a
                href={selectedProviderCard?.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-white/65 hover:text-white"
              >
                Where to get keys
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="grid gap-3 md:grid-cols-2 mt-4">
              <div>
                <label className="text-white/60 text-xs font-medium block mb-1">API key</label>
                <div className="relative">
                  <input
                    type={showToken ? "text" : "password"}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="Paste your provider key"
                    className="w-full bg-[#12121f] border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:border-amber-500/50 focus:outline-none pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-white/60 text-xs font-medium block mb-1">
                  Profile name
                </label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder={defaultProfileName(llmProvider)}
                  className="w-full bg-[#12121f] border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:border-amber-500/50 focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {llmProvider === "local" && (
          <div className="rounded-xl border border-slate-500/30 bg-slate-600/10 p-4 text-left">
            <div className="flex items-start gap-3">
              <RotateCcw className="w-5 h-5 text-slate-200 mt-0.5" />
              <div>
                <div className="text-white font-medium">Local-only setup</div>
                <p className="text-white/55 text-sm mt-1 leading-6">
                  Argent will route primary chat, subagents, and router tiers to the local
                  Ollama default instead of any hosted provider. You can re-open this wizard
                  later if you want to add a hosted stack.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-white/80 text-sm font-medium">
            <Cpu className="w-4 h-4 text-amber-300" />
            Default model
          </div>
          {modelsLoading ? (
            <div className="rounded-lg border border-white/10 bg-[#1a1a2e] px-4 py-6 text-sm text-white/50">
              Loading provider-aware model choices…
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {modelOptions.map((model) => {
                const selected = model.id === selectedModel;
                return (
                  <button
                    key={model.id}
                    onClick={() => setSelectedModel(model.id)}
                    className={`rounded-xl border p-4 text-left transition-all ${
                      selected
                        ? `${accent.bg} ${accent.border}`
                        : "bg-[#1a1a2e] border-white/10 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <div className="text-white font-medium">{model.name}</div>
                        {model.badge && (
                          <div
                            className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${accent.badge}`}
                          >
                            {model.badge}
                          </div>
                        )}
                      </div>
                      {selected && (
                        <CheckCircle className={`w-4 h-4 ${accent.text} flex-shrink-0`} />
                      )}
                    </div>
                    <div className="text-white/45 text-xs leading-5">{model.description}</div>
                    <div className="text-white/30 text-[11px] font-mono mt-3 truncate">
                      {model.id}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {validationSummary.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-left">
            <div className="text-white text-sm font-medium mb-2">Current validation notes</div>
            <ul className="space-y-1 text-white/55 text-xs list-disc list-inside">
              {validationSummary.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            onClick={goBack}
            className="flex items-center gap-1 text-white/40 hover:text-white/70 text-sm transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={() => void saveStep()}
            disabled={!llmProvider || !selectedModel || saving || modelsLoading}
            className="flex items-center gap-2 px-6 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-white/10 disabled:text-white/30 text-white font-medium rounded-lg transition-colors text-sm"
          >
            {saving ? "Saving…" : "Save provider-aware defaults"}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  function renderComplete() {
    const selectedModelMeta = modelOptions.find((entry) => entry.id === selectedModel) ?? null;

    return (
      <div className="flex flex-col items-center text-center px-4">
        <div className="w-20 h-20 rounded-2xl bg-green-600/20 flex items-center justify-center mb-6">
          <CheckCircle className="w-10 h-10 text-green-400" />
        </div>
        <h2 className="text-3xl font-bold text-white mb-3">Your stack is ready</h2>
        <p className="text-white/50 text-sm mb-6 max-w-lg leading-6">
          Argent saved chat, subagent, router, voice, and search defaults from your
          selections. You can relaunch this setup later from Settings if your provider
          mix changes.
        </p>

        <div className="bg-[#1a1a2e] border border-white/10 rounded-lg p-4 w-full max-w-lg text-left mb-8">
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/40">Chat provider</span>
              <span className="text-white">{selectedProviderCard?.label || llmProvider}</span>
            </div>
            <div className="h-px bg-white/5" />
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/40">Default model</span>
              <span className="text-white">{selectedModelMeta?.name || selectedModel}</span>
            </div>
            <div className="h-px bg-white/5" />
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/40">Voice provider</span>
              <span className="text-white">
                {VOICE_PROVIDER_CARDS.find((card) => card.id === voiceProvider)?.label}
              </span>
            </div>
            <div className="h-px bg-white/5" />
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/40">Search provider</span>
              <span className="text-white">
                {SEARCH_PROVIDER_CARDS.find((card) => card.id === searchProvider)?.label}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onComplete}
          className="flex items-center gap-2 px-8 py-3 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg transition-colors"
        >
          Start using ArgentOS
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const stepRenderers = [renderWelcome, renderProviders, renderModelAndAccess, renderComplete];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-[#0d0d1a]/95 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="w-full max-w-5xl mx-4"
          >
            {renderStepIndicator()}

            <div className="relative overflow-hidden min-h-[520px] flex items-center justify-center">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={step}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="w-full"
                >
                  {stepRenderers[step]()}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
