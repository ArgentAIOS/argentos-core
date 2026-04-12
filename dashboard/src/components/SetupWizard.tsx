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
import { useState } from "react";

interface SetupWizardProps {
  isOpen: boolean;
  onComplete: () => void;
}

type AuthType = "setup-token" | "api-key" | "minimax-key" | "glm-key" | "skip" | null;

function getModelOptions(authType: AuthType) {
  if (authType === "minimax-key") {
    return [
      {
        id: "minimax/MiniMax-M2.5",
        name: "MiniMax M2.5",
        badge: "Recommended",
        description: "Latest MiniMax model. Fast, capable, and cost-effective for most tasks.",
        icon: Zap,
      },
      {
        id: "minimax/MiniMax-M2.1",
        name: "MiniMax M2.1",
        badge: "Balanced",
        description: "Strong reasoning and coding. Good balance of speed and power.",
        icon: Brain,
      },
      {
        id: "minimax/MiniMax-M2",
        name: "MiniMax M2",
        badge: "Efficient",
        description: "Lightweight and fast. Great for simple tasks and high-volume use.",
        icon: Sparkles,
      },
    ];
  }
  if (authType === "glm-key") {
    return [
      {
        id: "zai/glm-4-plus",
        name: "GLM-4 Plus",
        badge: "Recommended",
        description: "Most capable GLM model. Best for complex reasoning, coding, and analysis.",
        icon: Brain,
      },
      {
        id: "zai/glm-4",
        name: "GLM-4",
        badge: "Balanced",
        description: "Strong general-purpose model. Great balance for most tasks.",
        icon: Zap,
      },
      {
        id: "zai/glm-4-flash",
        name: "GLM-4 Flash",
        badge: "Fastest",
        description: "Fastest and most affordable. Perfect for lightweight tasks.",
        icon: Sparkles,
      },
    ];
  }
  // Anthropic (default)
  return [
    {
      id: "anthropic/claude-sonnet-4-6",
      name: "Sonnet",
      badge: "Recommended",
      description: "Best balance of speed and intelligence. Good for most tasks.",
      icon: Zap,
    },
    {
      id: "anthropic/claude-opus-4-6",
      name: "Opus",
      badge: "Most Capable",
      description: "Most capable. Best for complex reasoning and coding.",
      icon: Brain,
    },
    {
      id: "anthropic/claude-haiku-4-5",
      name: "Haiku",
      badge: "Fastest",
      description: "Fastest and most affordable. Great for simple tasks.",
      icon: Sparkles,
    },
  ];
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
  const [selectedModel, setSelectedModel] = useState("anthropic/claude-sonnet-4-6");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showToken, setShowToken] = useState(false);

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

  async function saveModel() {
    setSaving(true);
    setError("");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch("/api/settings/models", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ defaultModel: selectedModel }),
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
                <div className="text-white font-medium">Claude API Key</div>
                <div className="text-white/40 text-xs mt-0.5">
                  From{" "}
                  <code className="text-amber-400/70 bg-white/5 px-1 rounded">
                    console.anthropic.com/settings/keys
                  </code>
                </div>
              </div>
            </div>
          </button>

          {/* API Key card */}
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

          {/* MiniMax Coding Plan key */}
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
                  <span className="text-violet-400/70">platform.minimaxi.com</span>. Includes text,
                  vision, TTS, video &amp; music.
                </div>
              </div>
            </div>
          </button>

          {/* GLM / ZhipuAI key */}
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
                  ? "Claude API Key"
                  : authType === "minimax-key"
                    ? "MiniMax API Key"
                    : authType === "glm-key"
                      ? "GLM API Key"
                      : "API Key"}
              </label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    authType === "setup-token"
                      ? "sk-ant-api03-..."
                      : authType === "minimax-key"
                        ? "sk-cp-... or eyJ..."
                        : authType === "glm-key"
                          ? "your-glm-api-key"
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
    const modelOptions = getModelOptions(authType);
    // Default-select first option when provider changes and current selection doesn't match
    const providerLabel =
      authType === "minimax-key" ? "MiniMax" : authType === "glm-key" ? "GLM" : "Claude";
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
                  <Icon className={`w-5 h-5 ${isSelected ? "text-amber-400" : "text-white/40"}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">{model.name}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          model.badge === "Recommended"
                            ? "bg-amber-600/20 text-amber-400"
                            : model.badge === "Most Capable" || model.badge === "Balanced"
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
                saveModel();
              }}
              disabled={saving}
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
          ? `Claude API key saved as ${profileName}`
          : `API key saved as ${profileName}`;

    const modelName =
      getModelOptions(authType).find((m) => m.id === selectedModel)?.name || selectedModel;

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
