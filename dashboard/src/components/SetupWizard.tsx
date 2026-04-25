import type { LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Rocket,
  Key,
  Cpu,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Eye,
  EyeOff,
  Zap,
  Brain,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface SetupWizardProps {
  isOpen: boolean;
  onComplete: () => void;
}

type AuthType =
  | "setup-token"
  | "api-key"
  | "minimax-key"
  | "glm-key"
  | "kimi-key"
  | "groq-key"
  | "skip"
  | null;

type ModelOption = {
  id: string;
  name: string;
  badge: string;
  description: string;
  icon: LucideIcon;
};

type AvailableModelEntry = {
  id: string;
  alias: string | null;
  params?: {
    reasoning?: boolean;
    input?: string[];
    contextWindow?: number;
    source?: string;
  } | null;
};

function providerForAuthType(authType: AuthType) {
  if (authType === "minimax-key") return "minimax";
  if (authType === "glm-key") return "zai";
  if (authType === "kimi-key") return "moonshot";
  if (authType === "groq-key") return "groq";
  return "anthropic";
}

function providerLabelForAuthType(authType: AuthType) {
  if (authType === "minimax-key") return "MiniMax";
  if (authType === "glm-key") return "GLM";
  if (authType === "kimi-key") return "Kimi";
  if (authType === "groq-key") return "Groq";
  return "Claude";
}

function parseModelRef(ref: string) {
  const slashIndex = ref.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= ref.length - 1) return null;
  return {
    provider: ref.slice(0, slashIndex),
    model: ref.slice(slashIndex + 1),
  };
}

function prettifyModelName(modelId: string) {
  return modelId
    .replace(/^openai\//, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bGpt\b/g, "GPT")
    .replace(/\bGlm\b/g, "GLM")
    .replace(/\bM2\b/g, "M2");
}

function looksLikeEmbeddingOnlyModel(modelId: string) {
  const model = modelId.toLowerCase();
  return (
    /(?:^|[-_:./])embed(?:$|[-_:./\d])/.test(model) ||
    /(?:^|[-_:./])embedding(?:$|[-_:./\d])/.test(model) ||
    /(?:^|[-_:./])embeddings?(?:$|[-_:./\d])/.test(model)
  );
}

function scoreCatalogModel(entry: AvailableModelEntry) {
  const model = entry.id.toLowerCase();
  const params = entry.params && typeof entry.params === "object" ? entry.params : null;
  if (looksLikeEmbeddingOnlyModel(model)) return -1000;
  let score = 0;
  if (params?.reasoning) score += 250;
  if (Array.isArray(params?.input) && params.input.includes("image")) score += 40;
  if (params?.contextWindow && Number.isFinite(params.contextWindow)) {
    score += Math.min(params.contextWindow / 1000, 400);
  }
  const numericVersions = Array.from(model.matchAll(/\d+(?:\.\d+)?/g))
    .map((match) => Number.parseFloat(match[0] ?? "0"))
    .filter((value) => Number.isFinite(value));
  if (numericVersions.length > 0) {
    score += Math.max(...numericVersions) * 50;
  }
  if (/opus|reason|glm-5|k2|120b|70b/.test(model)) score += 80;
  if (/sonnet|m2\.7|glm-4\.7/.test(model)) score += 60;
  if (/highspeed|turbo|flash|instant/.test(model)) score += 20;
  if (/deprecated|legacy/.test(model)) score -= 200;
  return score;
}

function describeCatalogModel(entry: AvailableModelEntry, index: number): string {
  const params = entry.params && typeof entry.params === "object" ? entry.params : null;
  const details: string[] = [];
  if (params?.contextWindow && Number.isFinite(params.contextWindow)) {
    const rounded = Math.round(params.contextWindow / 1000);
    details.push(`${rounded}K context`);
  }
  if (params?.reasoning) details.push("reasoning capable");
  if (Array.isArray(params?.input) && params.input.includes("image"))
    details.push("vision capable");
  const suffix = details.length ? ` ${details.join(", ")}.` : "";
  if (index === 0) return `Recommended current catalog option for this provider.${suffix}`;
  if (index === 1) return `Alternative current catalog option for this provider.${suffix}`;
  return `Additional model discovered from the current catalog.${suffix}`;
}

function badgeForCatalogModel(entry: AvailableModelEntry, index: number) {
  const model = entry.id.toLowerCase();
  const params = entry.params && typeof entry.params === "object" ? entry.params : null;
  if (index === 0) return "Recommended";
  if (params?.reasoning || /reason|opus|glm-5|k2|120b|70b/.test(model)) return "Reasoning";
  if (/flash|instant|speed|highspeed|turbo|haiku|8b/.test(model)) return "Fast";
  return "Catalog";
}

function iconForCatalogModel(entry: AvailableModelEntry, index: number) {
  const model = entry.id.toLowerCase();
  const params = entry.params && typeof entry.params === "object" ? entry.params : null;
  if (params?.reasoning || /reason|opus|glm-5|k2|120b|70b/.test(model)) return Brain;
  if (/flash|instant|speed|highspeed|turbo|haiku|8b/.test(model)) return Sparkles;
  return index === 0 ? Zap : Brain;
}

function getModelOptions(authType: AuthType, availableModels: AvailableModelEntry[]) {
  const provider = providerForAuthType(authType);
  const catalogOptions = availableModels
    .map((entry) => {
      const parsed = parseModelRef(entry.id);
      if (!parsed || parsed.provider !== provider) return null;
      if (looksLikeEmbeddingOnlyModel(parsed.model)) return null;
      return { entry, parsed };
    })
    .filter(
      (row): row is { entry: AvailableModelEntry; parsed: { provider: string; model: string } } =>
        row !== null,
    )
    .sort((a, b) => {
      const scoreDelta = scoreCatalogModel(b.entry) - scoreCatalogModel(a.entry);
      if (scoreDelta !== 0) return scoreDelta;
      const aName = a.entry.alias || a.parsed.model;
      const bName = b.entry.alias || b.parsed.model;
      return aName.localeCompare(bName);
    })
    .slice(0, 8)
    .map(({ entry, parsed }, index): ModelOption => {
      const alias = entry.alias?.trim();
      return {
        id: entry.id,
        name: alias || prettifyModelName(parsed.model),
        badge: badgeForCatalogModel(entry, index),
        description: describeCatalogModel(entry, index),
        icon: iconForCatalogModel(entry, index),
      };
    });

  return catalogOptions;
}

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -300 : 300,
    opacity: 0,
  }),
};

export function SetupWizard({ isOpen, onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [authType, setAuthType] = useState<AuthType>(null);
  const [token, setToken] = useState("");
  const [profileName, setProfileName] = useState("anthropic:default");
  const [selectedModel, setSelectedModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [availableModels, setAvailableModels] = useState<AvailableModelEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    setCatalogLoading(true);
    fetch("/api/settings/available-models", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load model catalog (${res.status})`);
        return res.json();
      })
      .then((data) => {
        const rows = Array.isArray(data?.models)
          ? data.models
              .map((entry: unknown): AvailableModelEntry | null => {
                if (!entry || typeof entry !== "object") return null;
                const id =
                  typeof (entry as { id?: unknown }).id === "string"
                    ? (entry as { id: string }).id.trim()
                    : "";
                if (!id || !parseModelRef(id)) return null;
                const alias =
                  typeof (entry as { alias?: unknown }).alias === "string"
                    ? (entry as { alias: string }).alias
                    : null;
                const params =
                  (entry as { params?: unknown }).params &&
                  typeof (entry as { params?: unknown }).params === "object"
                    ? ((entry as { params: AvailableModelEntry["params"] }).params ?? null)
                    : null;
                return { id, alias, params };
              })
              .filter((entry: AvailableModelEntry | null): entry is AvailableModelEntry =>
                Boolean(entry),
              )
          : [];
        if (cancelled) return;
        setAvailableModels(rows);
      })
      .catch((err) => {
        if ((err as { name?: string })?.name !== "AbortError") {
          console.warn("[SetupWizard] Model catalog unavailable; using fallback models.", err);
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!cancelled) {
          setCatalogLoading(false);
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [isOpen]);

  const modelOptions = useMemo(
    () => getModelOptions(authType, availableModels),
    [authType, availableModels],
  );

  useEffect(() => {
    if (step !== 2 || modelOptions.length === 0) return;
    if (!modelOptions.some((model) => model.id === selectedModel)) {
      setSelectedModel(modelOptions[0]?.id ?? selectedModel);
    }
  }, [modelOptions, selectedModel, step]);

  const steps = [
    { title: "Welcome", icon: Rocket },
    { title: "Authentication", icon: Key },
    { title: "Model", icon: Cpu },
    { title: "Complete", icon: CheckCircle },
  ];

  function goNext() {
    setDirection(1);
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }

  function goBack() {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function saveAuthProfile() {
    if (authType === "skip") {
      goNext();
      return;
    }
    if (!token.trim()) {
      setError("Please enter a token or API key.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const defaultProvider =
        authType === "setup-token" || authType === "api-key"
          ? "anthropic"
          : authType === "minimax-key"
            ? "minimax"
            : authType === "kimi-key"
              ? "moonshot"
              : authType === "groq-key"
                ? "groq"
                : "zai";
      const tokenValue = token.trim();
      const rawProfileName = profileName.trim();
      const profileParts = rawProfileName.split(":");
      const provider =
        profileParts.length > 1 && profileParts[0]?.trim().length
          ? profileParts[0].trim()
          : defaultProvider;
      const name =
        profileParts.length > 1
          ? profileParts.slice(1).join(":").trim() || "default"
          : rawProfileName || "default";
      const profileKey = `${provider}:${name}`;
      const profileType = authType === "setup-token" ? "token" : "api_key";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let res: Response;
      try {
        res = await fetch("/api/settings/auth-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            name,
            token: tokenValue,
            type: profileType,
            // Backward-compat payload shape used by some older API handlers.
            key: profileKey,
            profile: {
              type: profileType,
              provider,
              token: authType === "setup-token" ? tokenValue : undefined,
              key: authType !== "setup-token" ? tokenValue : undefined,
            },
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const status = Number(res.status || 0);
        const message = String(data?.error || "");
        const duplicate = status === 409 || /already exists/i.test(message);
        if (duplicate) {
          // If profile already exists, unblock onboarding and continue.
          goNext();
          return;
        }
        // Legacy fallback for older dashboard API servers.
        const isCompatCandidate =
          provider === "anthropic" &&
          (status === 404 || status === 405 || status === 500 || /not found/i.test(message));
        if (isCompatCandidate) {
          const legacyController = new AbortController();
          const legacyTimeout = setTimeout(() => legacyController.abort(), 10_000);
          try {
            const legacyRes = await fetch("/api/settings/auth", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ provider, key: tokenValue }),
              signal: legacyController.signal,
            });
            if (!legacyRes.ok) {
              const legacyData = await legacyRes.json().catch(() => ({}));
              throw new Error(legacyData.error || `Failed to save (${legacyRes.status})`);
            }
          } finally {
            clearTimeout(legacyTimeout);
          }
        } else {
          throw new Error(message || `Failed to save (${status})`);
        }
      }
      goNext();
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setError("Saving timed out after 10 seconds. Check gateway/API and try again.");
      } else {
        setError(e.message || "Failed to save auth profile.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveModel(modelOverride?: string) {
    setSaving(true);
    setError("");
    const modelToSave = modelOverride || selectedModel;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch("/api/settings/models", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ defaultModel: modelToSave }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed to save (${res.status})`);
        }
      } catch (e: any) {
        clearTimeout(timeout);
        if (e.name === "AbortError") {
          // Timed out — proceed anyway so the user isn't stuck
          goNext();
          return;
        }
        throw e;
      }
      goNext();
    } catch (e: any) {
      setError(e.message || "Failed to save model selection.");
    } finally {
      setSaving(false);
    }
  }

  function renderStepIndicator() {
    return (
      <div className="flex items-center justify-center gap-2 mb-8">
        {steps.map((s, i) => (
          <div key={s.title} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
                i < step
                  ? "bg-amber-600 text-white"
                  : i === step
                    ? "bg-amber-600/20 border-2 border-amber-500 text-amber-400"
                    : "bg-white/5 border border-white/10 text-white/30"
              }`}
            >
              {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
            </div>
            {i < steps.length - 1 && (
              <div
                className={`w-8 h-0.5 transition-all duration-300 ${
                  i < step ? "bg-amber-600" : "bg-white/10"
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
        <h2 className="text-3xl font-bold text-white mb-3">Welcome to ArgentOS</h2>
        <p className="text-white/60 text-lg max-w-md mb-8">
          Your personal AI operating system. Let's get you set up in a few quick steps.
        </p>
        <button
          onClick={goNext}
          className="flex items-center gap-2 px-8 py-3 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg transition-colors"
        >
          Get Started
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  function renderAuth() {
    return (
      <div className="px-4 max-w-lg mx-auto w-full">
        <h2 className="text-2xl font-bold text-white mb-2 text-center">Authentication</h2>
        <p className="text-white/50 text-sm text-center mb-6">
          Connect your AI provider to get started.
        </p>

        <div className="space-y-3 mb-6">
          {/* Setup Token card */}
          <div>
            <button
              onClick={() => {
                setAuthType("setup-token");
                setError("");
              }}
              className={`w-full text-left p-4 rounded-lg border transition-all ${
                authType === "setup-token"
                  ? "bg-amber-600/10 border-amber-500/50"
                  : "bg-[#1a1a2e] border-white/10 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-3">
                <Key
                  className={`w-5 h-5 ${authType === "setup-token" ? "text-amber-400" : "text-white/40"}`}
                />
                <div>
                  <div className="text-white font-medium">Claude Setup Token</div>
                  <div className="text-white/40 text-xs mt-0.5">
                    From Anthropic Max subscription. Run{" "}
                    <code className="text-amber-400/70 bg-white/5 px-1 rounded">
                      claude setup-token
                    </code>{" "}
                    in terminal.
                  </div>
                </div>
              </div>
            </button>
            <a
              href="https://docs.argentos.ai/docs/keys/anthropic-setup-token"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 ml-12 inline-flex items-center gap-1 text-xs text-amber-400/70 hover:text-amber-400 hover:underline underline-offset-2"
            >
              Get your key →
            </a>
          </div>

          {/* API Key card */}
          <div>
            <button
              onClick={() => {
                setAuthType("api-key");
                setError("");
              }}
              className={`w-full text-left p-4 rounded-lg border transition-all ${
                authType === "api-key"
                  ? "bg-amber-600/10 border-amber-500/50"
                  : "bg-[#1a1a2e] border-white/10 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-3">
                <Key
                  className={`w-5 h-5 ${authType === "api-key" ? "text-amber-400" : "text-white/40"}`}
                />
                <div>
                  <div className="text-white font-medium">Anthropic API Key</div>
                  <div className="text-white/40 text-xs mt-0.5">
                    Standard API key from console.anthropic.com. Pay per token.
                  </div>
                </div>
              </div>
            </button>
            <a
              href="https://docs.argentos.ai/docs/keys/anthropic-api-key"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 ml-12 inline-flex items-center gap-1 text-xs text-amber-400/70 hover:text-amber-400 hover:underline underline-offset-2"
            >
              Get your key →
            </a>
          </div>

          {/* MiniMax Coding Plan key */}
          <div>
            <button
              onClick={() => {
                setAuthType("minimax-key");
                setProfileName("minimax:default");
                setError("");
              }}
              className={`w-full text-left p-4 rounded-lg border transition-all ${
                authType === "minimax-key"
                  ? "bg-violet-600/10 border-violet-500/50"
                  : "bg-[#1a1a2e] border-white/10 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-3">
                <Key
                  className={`w-5 h-5 ${
                    authType === "minimax-key" ? "text-violet-400" : "text-white/40"
                  }`}
                />
                <div>
                  <div className="text-white font-medium">MiniMax API Key</div>
                  <div className="text-white/40 text-xs mt-0.5">
                    Coding Plan or standard key from{" "}
                    <span className="text-violet-400/70">platform.minimaxi.com</span>. Includes
                    text, vision, TTS, video &amp; music.
                  </div>
                </div>
              </div>
            </button>
            <a
              href="https://docs.argentos.ai/docs/keys/minimax"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 ml-12 inline-flex items-center gap-1 text-xs text-violet-400/70 hover:text-violet-400 hover:underline underline-offset-2"
            >
              Get your key →
            </a>
          </div>

          {/* GLM / ZhipuAI key */}
          <div>
            <button
              onClick={() => {
                setAuthType("glm-key");
                setProfileName("zai:default");
                setError("");
              }}
              className={`w-full text-left p-4 rounded-lg border transition-all ${
                authType === "glm-key"
                  ? "bg-cyan-600/10 border-cyan-500/50"
                  : "bg-[#1a1a2e] border-white/10 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-3">
                <Key
                  className={`w-5 h-5 ${authType === "glm-key" ? "text-cyan-400" : "text-white/40"}`}
                />
                <div>
                  <div className="text-white font-medium">GLM API Key</div>
                  <div className="text-white/40 text-xs mt-0.5">
                    ZhipuAI key from <span className="text-cyan-400/70">bigmodel.cn</span>. GLM-4
                    &amp; coding plan with bundled capabilities.
                  </div>
                </div>
              </div>
            </button>
            <a
              href="https://docs.argentos.ai/docs/keys/zai"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 ml-12 inline-flex items-center gap-1 text-xs text-cyan-400/70 hover:text-cyan-400 hover:underline underline-offset-2"
            >
              Get your key →
            </a>
          </div>

          {/* Kimi K2 / Moonshot key */}
          <div>
            <button
              onClick={() => {
                setAuthType("kimi-key");
                setProfileName("moonshot:default");
                setError("");
              }}
              className={`w-full text-left p-4 rounded-lg border transition-all ${
                authType === "kimi-key"
                  ? "bg-emerald-600/10 border-emerald-500/50"
                  : "bg-[#1a1a2e] border-white/10 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-3">
                <Key
                  className={`w-5 h-5 ${
                    authType === "kimi-key" ? "text-emerald-400" : "text-white/40"
                  }`}
                />
                <div>
                  <div className="text-white font-medium">Kimi K2 API Key</div>
                  <div className="text-white/40 text-xs mt-0.5">
                    Moonshot key from{" "}
                    <span className="text-emerald-400/70">platform.moonshot.ai</span>. 256K context,
                    long-form code &amp; reasoning.
                  </div>
                </div>
              </div>
            </button>
            <a
              href="https://docs.argentos.ai/docs/keys/kimi"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 ml-12 inline-flex items-center gap-1 text-xs text-emerald-400/70 hover:text-emerald-400 hover:underline underline-offset-2"
            >
              Get your key →
            </a>
          </div>

          {/* Groq key */}
          <div>
            <button
              onClick={() => {
                setAuthType("groq-key");
                setProfileName("groq:default");
                setError("");
              }}
              className={`w-full text-left p-4 rounded-lg border transition-all ${
                authType === "groq-key"
                  ? "bg-orange-600/10 border-orange-500/50"
                  : "bg-[#1a1a2e] border-white/10 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-3">
                <Key
                  className={`w-5 h-5 ${
                    authType === "groq-key" ? "text-orange-400" : "text-white/40"
                  }`}
                />
                <div>
                  <div className="text-white font-medium">Groq API Key</div>
                  <div className="text-white/40 text-xs mt-0.5">
                    Free tier from <span className="text-orange-400/70">console.groq.com</span>.
                    Llama, GPT-OSS, Qwen on Groq's fast LPU.
                  </div>
                </div>
              </div>
            </button>
            <a
              href="https://docs.argentos.ai/docs/keys/groq"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 ml-12 inline-flex items-center gap-1 text-xs text-orange-400/70 hover:text-orange-400 hover:underline underline-offset-2"
            >
              Get your key →
            </a>
          </div>

          {/* Skip card */}
          <button
            onClick={() => {
              setAuthType("skip");
              setError("");
            }}
            className={`w-full text-left p-4 rounded-lg border transition-all ${
              authType === "skip"
                ? "bg-amber-600/10 border-amber-500/50"
                : "bg-[#1a1a2e] border-white/10 hover:border-white/20"
            }`}
          >
            <div className="flex items-center gap-3">
              <ChevronRight
                className={`w-5 h-5 ${authType === "skip" ? "text-amber-400" : "text-white/40"}`}
              />
              <div>
                <div className="text-white font-medium">Skip for Now</div>
                <div className="text-white/40 text-xs mt-0.5">
                  You can add authentication later in Settings.
                </div>
              </div>
            </div>
          </button>
        </div>

        {/* Token/Key input */}
        {authType && authType !== "skip" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="space-y-3 mb-6 overflow-hidden"
          >
            <div>
              <label className="text-white/60 text-xs font-medium block mb-1">
                {authType === "setup-token"
                  ? "Setup Token"
                  : authType === "minimax-key"
                    ? "MiniMax API Key"
                    : authType === "glm-key"
                      ? "GLM API Key"
                      : authType === "kimi-key"
                        ? "Kimi / Moonshot API Key"
                        : authType === "groq-key"
                          ? "Groq API Key"
                          : "API Key"}
              </label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    authType === "setup-token"
                      ? "sk-ant-oat01-..."
                      : authType === "minimax-key"
                        ? "sk-cp-... or eyJ..."
                        : authType === "glm-key"
                          ? "your-glm-api-key"
                          : authType === "kimi-key"
                            ? "sk-..."
                            : authType === "groq-key"
                              ? "gsk_..."
                              : "sk-ant-api..."
                  }
                  className="w-full bg-[#12121f] border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:border-amber-500/50 focus:outline-none pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-white/60 text-xs font-medium block mb-1">Profile Name</label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder={
                  authType === "minimax-key"
                    ? "minimax:default"
                    : authType === "glm-key"
                      ? "zai:default"
                      : authType === "kimi-key"
                        ? "moonshot:default"
                        : authType === "groq-key"
                          ? "groq:default"
                          : "anthropic:default"
                }
                className="w-full bg-[#12121f] border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:border-amber-500/50 focus:outline-none"
              />
            </div>
          </motion.div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm mb-4">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            onClick={goBack}
            className="flex items-center gap-1 text-white/40 hover:text-white/70 text-sm transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={saveAuthProfile}
            disabled={!authType || saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-white/10 disabled:text-white/30 text-white font-medium rounded-lg transition-colors text-sm"
          >
            {saving ? "Saving..." : authType === "skip" ? "Skip" : "Save & Continue"}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  function renderModelSelection() {
    // Default-select first option when provider changes and current selection doesn't match
    const providerLabel = providerLabelForAuthType(authType);
    const validIds = new Set(modelOptions.map((m) => m.id));
    const effectiveModel = validIds.has(selectedModel)
      ? selectedModel
      : (modelOptions[0]?.id ?? selectedModel);
    return (
      <div className="px-4 max-w-lg mx-auto w-full">
        <h2 className="text-2xl font-bold text-white mb-2 text-center">Choose a Model</h2>
        <p className="text-white/50 text-sm text-center mb-6">
          Select your default {providerLabel} model. You can change this anytime.
        </p>
        {catalogLoading && (
          <div className="mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/50">
            Loading current model catalog...
          </div>
        )}

        {modelOptions.length > 0 ? (
          <div className="space-y-3 mb-6">
            {modelOptions.map((model) => {
              const Icon = model.icon;
              const isSelected = effectiveModel === model.id;
              return (
                <button
                  key={model.id}
                  onClick={() => setSelectedModel(model.id)}
                  className={`w-full text-left p-4 rounded-lg border transition-all ${
                    isSelected
                      ? "bg-amber-600/10 border-amber-500/50"
                      : "bg-[#1a1a2e] border-white/10 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`w-5 h-5 ${isSelected ? "text-amber-400" : "text-white/40"}`}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">{model.name}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            model.badge === "Recommended"
                              ? "bg-amber-600/20 text-amber-400"
                              : model.badge === "Reasoning" || model.badge === "Catalog"
                                ? "bg-purple-600/20 text-purple-400"
                                : "bg-green-600/20 text-green-400"
                          }`}
                        >
                          {model.badge}
                        </span>
                      </div>
                      <div className="text-white/40 text-xs mt-0.5">{model.description}</div>
                    </div>
                    {isSelected && <CheckCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2 mb-6">
            <label className="text-white/60 text-xs font-medium block">Model ID</label>
            <input
              type="text"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              placeholder={`${providerForAuthType(authType)}/model-id`}
              className="w-full bg-[#12121f] border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:border-amber-500/50 focus:outline-none font-mono"
            />
            <p className="text-white/35 text-xs">
              The live catalog did not return models for this provider. Enter a model reference or
              skip this step.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm mb-4">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            onClick={goBack}
            className="flex items-center gap-1 text-white/40 hover:text-white/70 text-sm transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={goNext}
              className="text-white/40 hover:text-white/70 text-sm transition-colors"
            >
              Skip
            </button>
            <button
              onClick={() => {
                setSelectedModel(effectiveModel);
                saveModel(effectiveModel);
              }}
              disabled={saving || !effectiveModel.trim()}
              className="flex items-center gap-2 px-6 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-white/10 disabled:text-white/30 text-white font-medium rounded-lg transition-colors text-sm"
            >
              {saving ? "Saving..." : "Continue"}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderComplete() {
    const authSummary =
      authType === "skip"
        ? "Skipped (configure in Settings)"
        : authType === "setup-token"
          ? `Setup token saved as ${profileName}`
          : `API key saved as ${profileName}`;

    const modelName = modelOptions.find((m) => m.id === selectedModel)?.name || selectedModel;

    return (
      <div className="flex flex-col items-center text-center px-4">
        <div className="w-20 h-20 rounded-2xl bg-green-600/20 flex items-center justify-center mb-6">
          <CheckCircle className="w-10 h-10 text-green-400" />
        </div>
        <h2 className="text-3xl font-bold text-white mb-3">You're All Set!</h2>
        <p className="text-white/50 text-sm mb-6 max-w-sm">
          You can manage channels, gateway, and more in Settings.
        </p>

        <div className="bg-[#1a1a2e] border border-white/10 rounded-lg p-4 w-full max-w-sm text-left mb-8">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-white/40 text-xs">Authentication</span>
              <span className="text-white text-xs">{authSummary}</span>
            </div>
            <div className="h-px bg-white/5" />
            <div className="flex items-center justify-between">
              <span className="text-white/40 text-xs">Default Model</span>
              <span className="text-white text-xs">{modelName}</span>
            </div>
          </div>
        </div>

        <button
          onClick={onComplete}
          className="flex items-center gap-2 px-8 py-3 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg transition-colors"
        >
          Start Using ArgentOS
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const stepRenderers = [renderWelcome, renderAuth, renderModelSelection, renderComplete];

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
            className="w-full max-w-xl mx-4"
          >
            {renderStepIndicator()}

            <div className="relative overflow-hidden min-h-[400px] flex items-center justify-center">
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
