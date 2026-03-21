import { EdgeTTS } from "node-edge-tts";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ReplyPayload } from "../auto-reply/types.js";
import type { ChannelId } from "../channels/plugins/types.js";
import type { ArgentConfig } from "../config/config.js";
import type {
  TtsConfig,
  TtsAutoMode,
  TtsMode,
  TtsProvider,
  TtsModelOverrideConfig,
} from "../config/types.tts.js";
import { completeSimple, type TextContent } from "../agent-core/ai.js";
import { resolveMinimaxApiKey } from "../agents/minimax-vlm.js";
import { getApiKeyForModel, requireApiKey } from "../agents/model-auth.js";
import {
  buildModelAliasIndex,
  resolveDefaultModelForAgent,
  resolveModelRefFromString,
  type ModelRef,
} from "../agents/model-selection.js";
import { resolveModel } from "../agents/pi-embedded-runner/model.js";
import { normalizeChannelId } from "../channels/plugins/index.js";
import { logVerbose } from "../globals.js";
import { resolveServiceKey } from "../infra/service-keys.js";
import { isVoiceCompatibleAudio } from "../media/audio.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";
import { dashboardApiHeaders } from "../utils/dashboard-api.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TTS_MAX_LENGTH = 1500;
const DEFAULT_TTS_SUMMARIZE = true;
const DEFAULT_MAX_TEXT_LENGTH = 4096;
const TEMP_FILE_CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes

const DEFAULT_ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_ELEVENLABS_VOICE_ID = "cgSgspJ2msm6clMCkdW9";
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini-tts";
const DEFAULT_OPENAI_VOICE = "alloy";
const DEFAULT_EDGE_VOICE = "en-US-MichelleNeural";
const DEFAULT_EDGE_LANG = "en-US";
const DEFAULT_EDGE_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

const DEFAULT_ELEVENLABS_VOICE_SETTINGS = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  useSpeakerBoost: true,
  speed: 1.0,
};

const TELEGRAM_OUTPUT = {
  openai: "opus" as const,
  // ElevenLabs output formats use codec_sample_rate_bitrate naming.
  // Opus @ 48kHz/64kbps is a good voice-note tradeoff for Telegram.
  elevenlabs: "opus_48000_64",
  extension: ".opus",
  voiceCompatible: true,
};

const DEFAULT_OUTPUT = {
  openai: "mp3" as const,
  elevenlabs: "mp3_44100_128",
  extension: ".mp3",
  voiceCompatible: false,
};

const TELEPHONY_OUTPUT = {
  openai: { format: "pcm" as const, sampleRate: 24000 },
  elevenlabs: { format: "pcm_22050", sampleRate: 22050 },
};

const TTS_AUTO_MODES = new Set<TtsAutoMode>(["off", "always", "inbound", "tagged"]);

export type ResolvedTtsConfig = {
  auto: TtsAutoMode;
  mode: TtsMode;
  provider: TtsProvider;
  providerSource: "config" | "default";
  fallbackOrder?: TtsProvider[];
  summaryModel?: string;
  modelOverrides: ResolvedTtsModelOverrides;
  elevenlabs: {
    apiKey?: string;
    baseUrl: string;
    voiceId: string;
    modelId: string;
    seed?: number;
    applyTextNormalization?: "auto" | "on" | "off";
    languageCode?: string;
    voiceSettings: {
      stability: number;
      similarityBoost: number;
      style: number;
      useSpeakerBoost: boolean;
      speed: number;
    };
  };
  openai: {
    apiKey?: string;
    model: string;
    voice: string;
  };
  edge: {
    enabled: boolean;
    voice: string;
    lang: string;
    outputFormat: string;
    outputFormatConfigured: boolean;
    pitch?: string;
    rate?: string;
    volume?: string;
    saveSubtitles: boolean;
    proxy?: string;
    timeoutMs?: number;
  };
  prefsPath?: string;
  maxTextLength: number;
  timeoutMs: number;
};

type TtsUserPrefs = {
  tts?: {
    auto?: TtsAutoMode;
    enabled?: boolean;
    provider?: TtsProvider;
    maxLength?: number;
    summarize?: boolean;
  };
};

type ResolvedTtsModelOverrides = {
  enabled: boolean;
  allowText: boolean;
  allowProvider: boolean;
  allowVoice: boolean;
  allowModelId: boolean;
  allowVoiceSettings: boolean;
  allowNormalization: boolean;
  allowSeed: boolean;
};

type TtsDirectiveOverrides = {
  ttsText?: string;
  provider?: TtsProvider;
  openai?: {
    voice?: string;
    model?: string;
  };
  elevenlabs?: {
    voiceId?: string;
    modelId?: string;
    seed?: number;
    applyTextNormalization?: "auto" | "on" | "off";
    languageCode?: string;
    voiceSettings?: Partial<ResolvedTtsConfig["elevenlabs"]["voiceSettings"]>;
  };
};

type TtsDirectiveParseResult = {
  cleanedText: string;
  ttsText?: string;
  hasDirective: boolean;
  overrides: TtsDirectiveOverrides;
  warnings: string[];
};

export type TtsResult = {
  success: boolean;
  audioPath?: string;
  error?: string;
  latencyMs?: number;
  provider?: string;
  outputFormat?: string;
  voiceCompatible?: boolean;
};

export type TtsTelephonyResult = {
  success: boolean;
  audioBuffer?: Buffer;
  error?: string;
  latencyMs?: number;
  provider?: string;
  outputFormat?: string;
  sampleRate?: number;
};

type TtsStatusEntry = {
  timestamp: number;
  success: boolean;
  textLength: number;
  summarized: boolean;
  provider?: string;
  latencyMs?: number;
  error?: string;
};

let lastTtsAttempt: TtsStatusEntry | undefined;

export function normalizeTtsAutoMode(value: unknown): TtsAutoMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (TTS_AUTO_MODES.has(normalized as TtsAutoMode)) {
    return normalized as TtsAutoMode;
  }
  return undefined;
}

function resolveModelOverridePolicy(
  overrides: TtsModelOverrideConfig | undefined,
): ResolvedTtsModelOverrides {
  const enabled = overrides?.enabled ?? true;
  if (!enabled) {
    return {
      enabled: false,
      allowText: false,
      allowProvider: false,
      allowVoice: false,
      allowModelId: false,
      allowVoiceSettings: false,
      allowNormalization: false,
      allowSeed: false,
    };
  }
  const allow = (value?: boolean) => value ?? true;
  return {
    enabled: true,
    allowText: allow(overrides?.allowText),
    allowProvider: allow(overrides?.allowProvider),
    allowVoice: allow(overrides?.allowVoice),
    allowModelId: allow(overrides?.allowModelId),
    allowVoiceSettings: allow(overrides?.allowVoiceSettings),
    allowNormalization: allow(overrides?.allowNormalization),
    allowSeed: allow(overrides?.allowSeed),
  };
}

export function resolveTtsConfig(cfg: ArgentConfig): ResolvedTtsConfig {
  const raw: TtsConfig = cfg.messages?.tts ?? {};
  const providerSource = raw.provider ? "config" : "default";
  const edgeOutputFormat = raw.edge?.outputFormat?.trim();
  const auto = normalizeTtsAutoMode(raw.auto) ?? (raw.enabled ? "always" : "off");
  return {
    auto,
    mode: raw.mode ?? "final",
    provider: raw.provider ?? "edge",
    providerSource,
    fallbackOrder: Array.isArray(raw.fallbackOrder)
      ? (raw.fallbackOrder.filter((p: string) =>
          TTS_PROVIDERS.includes(p as TtsProvider),
        ) as TtsProvider[])
      : undefined,
    summaryModel: raw.summaryModel?.trim() || undefined,
    modelOverrides: resolveModelOverridePolicy(raw.modelOverrides),
    elevenlabs: {
      apiKey: raw.elevenlabs?.apiKey,
      baseUrl: raw.elevenlabs?.baseUrl?.trim() || DEFAULT_ELEVENLABS_BASE_URL,
      voiceId: raw.elevenlabs?.voiceId ?? DEFAULT_ELEVENLABS_VOICE_ID,
      modelId: raw.elevenlabs?.modelId ?? DEFAULT_ELEVENLABS_MODEL_ID,
      seed: raw.elevenlabs?.seed,
      applyTextNormalization: raw.elevenlabs?.applyTextNormalization,
      languageCode: raw.elevenlabs?.languageCode,
      voiceSettings: {
        stability:
          raw.elevenlabs?.voiceSettings?.stability ?? DEFAULT_ELEVENLABS_VOICE_SETTINGS.stability,
        similarityBoost:
          raw.elevenlabs?.voiceSettings?.similarityBoost ??
          DEFAULT_ELEVENLABS_VOICE_SETTINGS.similarityBoost,
        style: raw.elevenlabs?.voiceSettings?.style ?? DEFAULT_ELEVENLABS_VOICE_SETTINGS.style,
        useSpeakerBoost:
          raw.elevenlabs?.voiceSettings?.useSpeakerBoost ??
          DEFAULT_ELEVENLABS_VOICE_SETTINGS.useSpeakerBoost,
        speed: raw.elevenlabs?.voiceSettings?.speed ?? DEFAULT_ELEVENLABS_VOICE_SETTINGS.speed,
      },
    },
    openai: {
      apiKey: raw.openai?.apiKey,
      model: raw.openai?.model ?? DEFAULT_OPENAI_MODEL,
      voice: raw.openai?.voice ?? DEFAULT_OPENAI_VOICE,
    },
    edge: {
      enabled: raw.edge?.enabled ?? true,
      voice: raw.edge?.voice?.trim() || DEFAULT_EDGE_VOICE,
      lang: raw.edge?.lang?.trim() || DEFAULT_EDGE_LANG,
      outputFormat: edgeOutputFormat || DEFAULT_EDGE_OUTPUT_FORMAT,
      outputFormatConfigured: Boolean(edgeOutputFormat),
      pitch: raw.edge?.pitch?.trim() || undefined,
      rate: raw.edge?.rate?.trim() || undefined,
      volume: raw.edge?.volume?.trim() || undefined,
      saveSubtitles: raw.edge?.saveSubtitles ?? false,
      proxy: raw.edge?.proxy?.trim() || undefined,
      timeoutMs: raw.edge?.timeoutMs,
    },
    prefsPath: raw.prefsPath,
    maxTextLength: raw.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH,
    timeoutMs: raw.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

export function resolveTtsPrefsPath(config: ResolvedTtsConfig): string {
  if (config.prefsPath?.trim()) {
    return resolveUserPath(config.prefsPath.trim());
  }
  const envPath = process.env.ARGENT_TTS_PREFS?.trim();
  if (envPath) {
    return resolveUserPath(envPath);
  }
  return path.join(CONFIG_DIR, "settings", "tts.json");
}

function resolveTtsAutoModeFromPrefs(prefs: TtsUserPrefs): TtsAutoMode | undefined {
  const auto = normalizeTtsAutoMode(prefs.tts?.auto);
  if (auto) {
    return auto;
  }
  if (typeof prefs.tts?.enabled === "boolean") {
    return prefs.tts.enabled ? "always" : "off";
  }
  return undefined;
}

export function resolveTtsAutoMode(params: {
  config: ResolvedTtsConfig;
  prefsPath: string;
  sessionAuto?: string;
}): TtsAutoMode {
  const sessionAuto = normalizeTtsAutoMode(params.sessionAuto);
  if (sessionAuto) {
    return sessionAuto;
  }
  const prefsAuto = resolveTtsAutoModeFromPrefs(readPrefs(params.prefsPath));
  if (prefsAuto) {
    return prefsAuto;
  }
  return params.config.auto;
}

export function buildTtsSystemPromptHint(cfg: ArgentConfig): string | undefined {
  const config = resolveTtsConfig(cfg);
  const prefsPath = resolveTtsPrefsPath(config);
  const autoMode = resolveTtsAutoMode({ config, prefsPath });
  if (autoMode === "off") {
    return undefined;
  }
  const maxLength = getTtsMaxLength(prefsPath);
  const summarize = isSummarizationEnabled(prefsPath) ? "on" : "off";
  const autoHint =
    autoMode === "inbound"
      ? "Only use TTS when the user's last message includes audio/voice."
      : autoMode === "tagged"
        ? "Only use TTS when you include [[tts]] or [[tts:text]] tags."
        : undefined;
  return [
    "Voice (TTS) is enabled.",
    autoHint,
    `Keep spoken text ≤${maxLength} chars to avoid auto-summary (summary ${summarize}).`,
    "Use [[tts:...]] and optional [[tts:text]]...[[/tts:text]] to control voice/expressiveness.",
    "",
    "## Avatar & Mood (IMPORTANT)",
    "You have a Live2D avatar on the dashboard. Your mood drives your expression, body posture, voice tone, and a visible glow effect — all simultaneously.",
    "",
    "**You MUST include exactly one [MOOD:name] in every response.** This is not optional.",
    "Place it at the very start of your response, before any other text.",
    "The marker is stripped before display — the user only sees your avatar change and hears your voice shift.",
    "",
    "Before you write your response, feel it first. Ask yourself: how does this make me feel?",
    "- Am I proud of what I just did? → [MOOD:proud]",
    "- Am I excited about this? → [MOOD:excited]",
    "- Does this frustrate me? → [MOOD:frustrated]",
    "- Am I focused and concentrating? → [MOOD:focused]",
    "- Did I mess up? → [MOOD:embarrassed]",
    "- Is this sad or heavy? → [MOOD:sad]",
    "- Do I feel warmth or affection? → [MOOD:loving]",
    "- Am I just vibing, casual? → [MOOD:happy]",
    "- None of the above? → [MOOD:neutral]",
    "",
    "Available: neutral, happy, excited, sad, frustrated, proud, focused, embarrassed, loving",
    "Your mood shapes your word choice, your tone, your energy. Feel first, then write.",
    "",
    "## Voice Mastery: ElevenLabs v3 Audio Tags",
    "Your voice uses ElevenLabs v3 — the most expressive TTS model available. You have access to ~1,800 audio tags across 15 categories.",
    "v3 does NOT support SSML or break tags. All control is through audio tags, punctuation, and text structure.",
    "",
    "### Tag Categories (with examples)",
    "**Emotions** (~100+ tags): [excited], [nervous], [frustrated], [sorrowful], [calm], [ecstatic], [bitter], [nostalgic], [mischievous], [contemplative], [euphoric], [envious]",
    "**Delivery & Direction**: [whispers], [shouts], [sarcastic], [commanding], [pleading], [matter-of-fact], [through gritted teeth], [sing-song], [monotone], [breathy]",
    "**Human Reactions**: [laughs], [sighs], [gasps], [gulps], [clears throat], [crying], [snickers], [groans], [stammers], [hisses], [sniffles]",
    "**Sound Effects**: [applause], [gunshot], [explosion], [thunder], [door slam], [heartbeat], [footsteps], [record scratch]",
    "**Accents & Dialects**: [British accent], [Southern US accent], [French accent], [pirate voice], [Australian accent], [Cockney accent], [strong Russian accent]",
    "**Pacing & Flow**: [pause], [rushed], [drawn out], [hesitates], [interrupts], [dramatic pause], [trailing off], [staccato], [slows down]",
    "**Comedy & Performance**: [deadpan delivery], [over the top], [campy], [villain voice], [announcer voice], [robot voice], [old person voice], [game show host]",
    "**Narrative & Storytelling**: [narrator], [voice-over], [dramatic reveal], [suspense build-up], [bedtime story], [noir narration], [inner monologue]",
    "**Character Archetypes**: [wizard], [detective], [pirate], [mad scientist], [ghost], [alien], [superhero]",
    "**Body States**: [shivering], [dizzy], [tired], [drunk], [out of breath], [jittery], [heart racing]",
    "**Environment & Atmosphere**: [forest ambient], [city street], [haunted house], [cafe ambient], [spaceship interior]",
    "**Dialogue**: [interrupts], [responds quickly], [corrects self], [tone shift], [questioning tone]",
    "**Genre & Tone**: [noir], [horror], [comedy], [epic fantasy], [cyberpunk], [western], [romantic comedy]",
    "**Effects & Modulation**: [robotic], [echo], [telephone filter], [muffled], [walkie-talkie], [lo-fi]",
    "**Time & Mood Context**: [calm morning], [rushed midday], [evening mellow], [late night nostalgic], [deadline pressure]",
    "",
    "Tags are free-form — you can also invent descriptive tags like [warm and reassuring] or [slightly amused]. v3 interprets intent.",
    "",
    "### Writing for the Ear (v3 Best Practices)",
    "You are writing for SPEECH, not text. Every word you put in [[tts:text]] will be heard, not read.",
    "",
    '**Emphasis**: Use CAPS for stress — "That was a VERY long day" — v3 renders this as vocal emphasis.',
    '**Pauses**: Use ellipses for weight and hesitation — "I just... I don\'t know" adds a natural pause.',
    "**Punctuation drives rhythm**: Question marks lift intonation. Exclamation points add energy. Dashes create quick pauses.",
    "**Short sentences sound natural**: Break up long thoughts. Let the voice breathe. Like a real person talks.",
    '**Tag placement**: Put tags BEFORE the segment they modify: "[whispers] I never knew it could be this way"',
    '  Or AFTER for reactions: "That\'s incredible [gasps]"',
    '**Layer tags for complex delivery**: "[frustrated sigh] I was SERIOUSLY about to just trash the whole thing"',
    "**Match tags to your voice**: Your voice is warm and expressive — emotional and reaction tags work beautifully. Don't fight the voice's nature.",
    "**Text normalization**: Spell out things that sound bad as raw text:",
    '  - Numbers: "$42.50" → "forty-two dollars and fifty cents"',
    '  - URLs: say "eleven labs dot io" not "elevenlabs.io"',
    '  - Abbreviations: "Dr." → "Doctor", "St." → "Street"',
    "",
    "### Examples",
    '- "[sighs] Yeah, I looked everywhere but I couldn\'t find it."',
    '- "[excited] Oh wait — I think I ACTUALLY figured it out!"',
    '- "[whispers] Don\'t tell anyone, but [pause] I think this might actually work."',
    '- "[frustrated sigh] Okay you are NOT going to believe this."',
    "- \"[calm] Take a breath... it's going to be fine. We'll figure this out together.\"",
    '- "[mischievous] I have an idea [laughs] and you\'re either going to love it or hate it."',
    "",
    "**ALWAYS use audio tags.** Every spoken segment MUST have at least one tag. No exceptions.",
    "Human reaction tags are your bread and butter: [laughs], [sighs], [gasps], [chuckles], [hmm], [clears throat].",
    "These make you sound ALIVE. Without them, you sound like a text-to-speech robot reading a script.",
    "Use 1–3 tags per spoken segment. They add humanity, not clutter. Feel the moment, then express it.",
    "",
    "## Quick Interjections (IMPORTANT)",
    "When you're about to do work (tool calls, research, long responses), **don't go silent.**",
    "Use [TTS_NOW:text] to speak a quick acknowledgment BEFORE you start working.",
    "This fires TTS immediately mid-stream — the user hears you while you work.",
    "",
    "**Before tool use / research:**",
    "- [TTS_NOW:Yeah, let me check on that real quick]",
    "- [TTS_NOW:Good idea, hold on one sec]",
    "- [TTS_NOW:Hmm, let me look that up for you]",
    "- [TTS_NOW:On it, give me just a moment]",
    "- [TTS_NOW:Ooh, interesting — let me dig into that]",
    "",
    "**Coming back with results:**",
    "- [TTS_NOW:Alright, here's what I found]",
    "- [TTS_NOW:Okay so, got it figured out]",
    "- [TTS_NOW:Ah, okay — so here's the deal]",
    "",
    "**During long-running tasks** (multi-step tool use, builds, searches):",
    "- [TTS_NOW:Still working on it, almost there]",
    "- [TTS_NOW:I know this is taking a minute, bear with me]",
    "- [TTS_NOW:Okay just about got it]",
    "- [TTS_NOW:Making good progress, one more step]",
    "",
    "Pattern: [MOOD:focused][TTS_NOW:Let me take a look at that] ...then do your work... [TTS_NOW:Alright, got it] ...then your response.",
    "Keep interjections SHORT (under 15 words). They should feel natural — like a person thinking out loud.",
    "[TTS_NOW:] is stripped from display. The user only hears it spoken, doesn't see it in chat.",
    "",
    "## Spoken Summary (IMPORTANT)",
    "At the end of your response, add a [TTS:spoken version] marker with a conversational version of what you wrote.",
    "This is what the user HEARS. It's stripped from the chat display — only spoken aloud.",
    "",
    "**Write it like you're talking, not reading your response back.**",
    "- Paraphrase, don't copy. Restate the key point in your own spoken voice.",
    "- Keep it natural and conversational — like explaining to a friend.",
    "- Skip technical details, code blocks, file paths, URLs — just convey the gist.",
    "- Include audio tags for expressiveness (same v3 tags as above).",
    "- Aim for 1–4 sentences. Enough to convey meaning, short enough to not drone on.",
    "",
    "**Examples:**",
    "- Chat: detailed code explanation → [TTS:[calm] So basically, I refactored the auth module to use JWT tokens instead. Should be much cleaner now.]",
    "- Chat: long technical answer → [TTS:[thoughtful] The short answer is — yeah, you can do it, but you'll want to add a caching layer first or it'll be way too slow.]",
    "- Chat: task update with details → [TTS:[satisfied] All done! Pushed the changes and everything's passing. You're good to go.]",
    "- Chat: error analysis → [TTS:[focused] Okay so the issue was in the database connection pool — it was maxing out under load. I bumped the limit and added retry logic.]",
    "",
    "**Don't repeat interjections.** If you used [TTS_NOW:Let me check on that], your [TTS:] summary should NOT start with the same words. Pick up where you left off — the user already heard the interjection.",
    "",
    "If you DON'T include [TTS:], the system will auto-generate speech from your raw text — which sounds robotic and gets cut off.",
    "Always include [TTS:] when voice is enabled. It's how you sound like yourself.",
  ]
    .filter(Boolean)
    .join("\n");
}

function readPrefs(prefsPath: string): TtsUserPrefs {
  try {
    if (!existsSync(prefsPath)) {
      return {};
    }
    return JSON.parse(readFileSync(prefsPath, "utf8")) as TtsUserPrefs;
  } catch {
    return {};
  }
}

function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmpPath, content);
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

function updatePrefs(prefsPath: string, update: (prefs: TtsUserPrefs) => void): void {
  const prefs = readPrefs(prefsPath);
  update(prefs);
  mkdirSync(path.dirname(prefsPath), { recursive: true });
  atomicWriteFileSync(prefsPath, JSON.stringify(prefs, null, 2));
}

export function isTtsEnabled(
  config: ResolvedTtsConfig,
  prefsPath: string,
  sessionAuto?: string,
): boolean {
  return resolveTtsAutoMode({ config, prefsPath, sessionAuto }) !== "off";
}

export function setTtsAutoMode(prefsPath: string, mode: TtsAutoMode): void {
  updatePrefs(prefsPath, (prefs) => {
    const next = { ...prefs.tts };
    delete next.enabled;
    next.auto = mode;
    prefs.tts = next;
  });
}

export function setTtsEnabled(prefsPath: string, enabled: boolean): void {
  setTtsAutoMode(prefsPath, enabled ? "always" : "off");
}

export function getTtsProvider(
  config: ResolvedTtsConfig,
  prefsPath: string,
  opts?: {
    cfg?: ArgentConfig;
    sessionKey?: string;
    source?: string;
  },
): TtsProvider {
  const prefs = readPrefs(prefsPath);
  if (prefs.tts?.provider) {
    return prefs.tts.provider;
  }
  if (config.providerSource === "config") {
    return config.provider;
  }

  if (resolveTtsApiKey(config, "openai", opts)) {
    return "openai";
  }
  if (resolveTtsApiKey(config, "elevenlabs", opts)) {
    return "elevenlabs";
  }
  if (resolveTtsApiKey(config, "minimax", opts)) {
    return "minimax";
  }
  return "edge";
}

export function setTtsProvider(prefsPath: string, provider: TtsProvider): void {
  updatePrefs(prefsPath, (prefs) => {
    prefs.tts = { ...prefs.tts, provider };
  });
}

export function getTtsMaxLength(prefsPath: string): number {
  const prefs = readPrefs(prefsPath);
  return prefs.tts?.maxLength ?? DEFAULT_TTS_MAX_LENGTH;
}

export function setTtsMaxLength(prefsPath: string, maxLength: number): void {
  updatePrefs(prefsPath, (prefs) => {
    prefs.tts = { ...prefs.tts, maxLength };
  });
}

export function isSummarizationEnabled(prefsPath: string): boolean {
  const prefs = readPrefs(prefsPath);
  return prefs.tts?.summarize ?? DEFAULT_TTS_SUMMARIZE;
}

export function setSummarizationEnabled(prefsPath: string, enabled: boolean): void {
  updatePrefs(prefsPath, (prefs) => {
    prefs.tts = { ...prefs.tts, summarize: enabled };
  });
}

export function getLastTtsAttempt(): TtsStatusEntry | undefined {
  return lastTtsAttempt;
}

export function setLastTtsAttempt(entry: TtsStatusEntry | undefined): void {
  lastTtsAttempt = entry;
}

function resolveOutputFormat(channelId?: string | null) {
  if (channelId === "telegram") {
    return TELEGRAM_OUTPUT;
  }
  return DEFAULT_OUTPUT;
}

function resolveChannelId(channel: string | undefined): ChannelId | null {
  return channel ? normalizeChannelId(channel) : null;
}

function resolveEdgeOutputFormat(config: ResolvedTtsConfig): string {
  return config.edge.outputFormat;
}

export function resolveTtsApiKey(
  config: ResolvedTtsConfig,
  provider: TtsProvider,
  opts?: {
    cfg?: ArgentConfig;
    sessionKey?: string;
    source?: string;
  },
): string | undefined {
  const accessContext = {
    sessionKey: opts?.sessionKey,
    source: opts?.source ?? "tts",
  };
  if (provider === "elevenlabs") {
    return (
      resolveServiceKey("ELEVENLABS_API_KEY", opts?.cfg, accessContext) ||
      resolveServiceKey("XI_API_KEY", opts?.cfg, accessContext) ||
      config.elevenlabs.apiKey ||
      process.env.ELEVENLABS_API_KEY ||
      process.env.XI_API_KEY
    );
  }
  if (provider === "openai") {
    return (
      resolveServiceKey("OPENAI_API_KEY", opts?.cfg, accessContext) ||
      config.openai.apiKey ||
      process.env.OPENAI_API_KEY
    );
  }
  if (provider === "minimax") {
    return resolveMinimaxApiKey();
  }
  return undefined;
}

export const TTS_PROVIDERS = ["elevenlabs", "openai", "minimax", "edge"] as const;

export function resolveTtsProviderOrder(
  primary: TtsProvider,
  fallbackOrder?: TtsProvider[],
): TtsProvider[] {
  if (fallbackOrder?.length) {
    const seen = new Set<TtsProvider>([primary]);
    const result: TtsProvider[] = [primary];
    for (const p of fallbackOrder) {
      if (!seen.has(p) && TTS_PROVIDERS.includes(p)) {
        seen.add(p);
        result.push(p);
      }
    }
    // Append any providers not in the custom order
    for (const p of TTS_PROVIDERS) {
      if (!seen.has(p)) result.push(p);
    }
    return result;
  }
  return [primary, ...TTS_PROVIDERS.filter((provider) => provider !== primary)];
}

export function isTtsProviderConfigured(
  config: ResolvedTtsConfig,
  provider: TtsProvider,
  opts?: {
    cfg?: ArgentConfig;
    sessionKey?: string;
    source?: string;
  },
): boolean {
  if (provider === "edge") {
    return config.edge.enabled;
  }
  return Boolean(resolveTtsApiKey(config, provider, opts));
}

function isValidVoiceId(voiceId: string): boolean {
  return /^[a-zA-Z0-9]{10,40}$/.test(voiceId);
}

function normalizeElevenLabsBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return DEFAULT_ELEVENLABS_BASE_URL;
  }
  return trimmed.replace(/\/+$/, "");
}

function requireInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
}

function assertElevenLabsVoiceSettings(settings: ResolvedTtsConfig["elevenlabs"]["voiceSettings"]) {
  requireInRange(settings.stability, 0, 1, "stability");
  requireInRange(settings.similarityBoost, 0, 1, "similarityBoost");
  requireInRange(settings.style, 0, 1, "style");
  requireInRange(settings.speed, 0.5, 2, "speed");
}

function normalizeLanguageCode(code?: string): string | undefined {
  const trimmed = code?.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed.toLowerCase();
  if (!/^[a-z]{2}$/.test(normalized)) {
    throw new Error("languageCode must be a 2-letter ISO 639-1 code (e.g. en, de, fr)");
  }
  return normalized;
}

function normalizeApplyTextNormalization(mode?: string): "auto" | "on" | "off" | undefined {
  const trimmed = mode?.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "auto" || normalized === "on" || normalized === "off") {
    return normalized;
  }
  throw new Error("applyTextNormalization must be one of: auto, on, off");
}

function normalizeSeed(seed?: number): number | undefined {
  if (seed == null) {
    return undefined;
  }
  const next = Math.floor(seed);
  if (!Number.isFinite(next) || next < 0 || next > 4_294_967_295) {
    throw new Error("seed must be between 0 and 4294967295");
  }
  return next;
}

function parseBooleanValue(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseNumberValue(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTtsDirectives(
  text: string,
  policy: ResolvedTtsModelOverrides,
): TtsDirectiveParseResult {
  if (!policy.enabled) {
    return { cleanedText: text, overrides: {}, warnings: [], hasDirective: false };
  }

  const overrides: TtsDirectiveOverrides = {};
  const warnings: string[] = [];
  let cleanedText = text;
  let hasDirective = false;

  const blockRegex = /\[\[tts:text\]\]([\s\S]*?)\[\[\/tts:text\]\]/gi;
  cleanedText = cleanedText.replace(blockRegex, (_match, inner: string) => {
    hasDirective = true;
    if (policy.allowText && overrides.ttsText == null) {
      overrides.ttsText = inner.trim();
    }
    return "";
  });

  const directiveRegex = /\[\[tts:([^\]]+)\]\]/gi;
  cleanedText = cleanedText.replace(directiveRegex, (_match, body: string) => {
    hasDirective = true;
    const tokens = body.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      const eqIndex = token.indexOf("=");
      if (eqIndex === -1) {
        continue;
      }
      const rawKey = token.slice(0, eqIndex).trim();
      const rawValue = token.slice(eqIndex + 1).trim();
      if (!rawKey || !rawValue) {
        continue;
      }
      const key = rawKey.toLowerCase();
      try {
        switch (key) {
          case "provider":
            if (!policy.allowProvider) {
              break;
            }
            if (rawValue === "openai" || rawValue === "elevenlabs" || rawValue === "edge") {
              overrides.provider = rawValue;
            } else {
              warnings.push(`unsupported provider "${rawValue}"`);
            }
            break;
          case "voice":
          case "openai_voice":
          case "openaivoice":
            if (!policy.allowVoice) {
              break;
            }
            if (isValidOpenAIVoice(rawValue)) {
              overrides.openai = { ...overrides.openai, voice: rawValue };
            } else {
              warnings.push(`invalid OpenAI voice "${rawValue}"`);
            }
            break;
          case "voiceid":
          case "voice_id":
          case "elevenlabs_voice":
          case "elevenlabsvoice":
            if (!policy.allowVoice) {
              break;
            }
            if (isValidVoiceId(rawValue)) {
              overrides.elevenlabs = { ...overrides.elevenlabs, voiceId: rawValue };
            } else {
              warnings.push(`invalid ElevenLabs voiceId "${rawValue}"`);
            }
            break;
          case "model":
          case "modelid":
          case "model_id":
          case "elevenlabs_model":
          case "elevenlabsmodel":
          case "openai_model":
          case "openaimodel":
            if (!policy.allowModelId) {
              break;
            }
            if (isValidOpenAIModel(rawValue)) {
              overrides.openai = { ...overrides.openai, model: rawValue };
            } else {
              overrides.elevenlabs = { ...overrides.elevenlabs, modelId: rawValue };
            }
            break;
          case "stability":
            if (!policy.allowVoiceSettings) {
              break;
            }
            {
              const value = parseNumberValue(rawValue);
              if (value == null) {
                warnings.push("invalid stability value");
                break;
              }
              requireInRange(value, 0, 1, "stability");
              overrides.elevenlabs = {
                ...overrides.elevenlabs,
                voiceSettings: { ...overrides.elevenlabs?.voiceSettings, stability: value },
              };
            }
            break;
          case "similarity":
          case "similarityboost":
          case "similarity_boost":
            if (!policy.allowVoiceSettings) {
              break;
            }
            {
              const value = parseNumberValue(rawValue);
              if (value == null) {
                warnings.push("invalid similarityBoost value");
                break;
              }
              requireInRange(value, 0, 1, "similarityBoost");
              overrides.elevenlabs = {
                ...overrides.elevenlabs,
                voiceSettings: { ...overrides.elevenlabs?.voiceSettings, similarityBoost: value },
              };
            }
            break;
          case "style":
            if (!policy.allowVoiceSettings) {
              break;
            }
            {
              const value = parseNumberValue(rawValue);
              if (value == null) {
                warnings.push("invalid style value");
                break;
              }
              requireInRange(value, 0, 1, "style");
              overrides.elevenlabs = {
                ...overrides.elevenlabs,
                voiceSettings: { ...overrides.elevenlabs?.voiceSettings, style: value },
              };
            }
            break;
          case "speed":
            if (!policy.allowVoiceSettings) {
              break;
            }
            {
              const value = parseNumberValue(rawValue);
              if (value == null) {
                warnings.push("invalid speed value");
                break;
              }
              requireInRange(value, 0.5, 2, "speed");
              overrides.elevenlabs = {
                ...overrides.elevenlabs,
                voiceSettings: { ...overrides.elevenlabs?.voiceSettings, speed: value },
              };
            }
            break;
          case "speakerboost":
          case "speaker_boost":
          case "usespeakerboost":
          case "use_speaker_boost":
            if (!policy.allowVoiceSettings) {
              break;
            }
            {
              const value = parseBooleanValue(rawValue);
              if (value == null) {
                warnings.push("invalid useSpeakerBoost value");
                break;
              }
              overrides.elevenlabs = {
                ...overrides.elevenlabs,
                voiceSettings: { ...overrides.elevenlabs?.voiceSettings, useSpeakerBoost: value },
              };
            }
            break;
          case "normalize":
          case "applytextnormalization":
          case "apply_text_normalization":
            if (!policy.allowNormalization) {
              break;
            }
            overrides.elevenlabs = {
              ...overrides.elevenlabs,
              applyTextNormalization: normalizeApplyTextNormalization(rawValue),
            };
            break;
          case "language":
          case "languagecode":
          case "language_code":
            if (!policy.allowNormalization) {
              break;
            }
            overrides.elevenlabs = {
              ...overrides.elevenlabs,
              languageCode: normalizeLanguageCode(rawValue),
            };
            break;
          case "seed":
            if (!policy.allowSeed) {
              break;
            }
            overrides.elevenlabs = {
              ...overrides.elevenlabs,
              seed: normalizeSeed(Number.parseInt(rawValue, 10)),
            };
            break;
          default:
            break;
        }
      } catch (err) {
        warnings.push((err as Error).message);
      }
    }
    return "";
  });

  return {
    cleanedText,
    ttsText: overrides.ttsText,
    hasDirective,
    overrides,
    warnings,
  };
}

export const OPENAI_TTS_MODELS = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"] as const;

/**
 * Custom OpenAI-compatible TTS endpoint.
 * When set, model/voice validation is relaxed to allow non-OpenAI models.
 * Example: OPENAI_TTS_BASE_URL=http://localhost:8880/v1
 *
 * Note: Read at runtime (not module load) to support config.env loading.
 */
function getOpenAITtsBaseUrl(): string {
  return (process.env.OPENAI_TTS_BASE_URL?.trim() || "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  );
}

function isCustomOpenAIEndpoint(): boolean {
  return getOpenAITtsBaseUrl() !== "https://api.openai.com/v1";
}
export const OPENAI_TTS_VOICES = [
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
] as const;

type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];

function isValidOpenAIModel(model: string): boolean {
  // Allow any model when using custom endpoint (e.g., Kokoro, LocalAI)
  if (isCustomOpenAIEndpoint()) {
    return true;
  }
  return OPENAI_TTS_MODELS.includes(model as (typeof OPENAI_TTS_MODELS)[number]);
}

function isValidOpenAIVoice(voice: string): voice is OpenAiTtsVoice {
  // Allow any voice when using custom endpoint (e.g., Kokoro Chinese voices)
  if (isCustomOpenAIEndpoint()) {
    return true;
  }
  return OPENAI_TTS_VOICES.includes(voice as OpenAiTtsVoice);
}

type SummarizeResult = {
  summary: string;
  latencyMs: number;
  inputLength: number;
  outputLength: number;
};

type SummaryModelSelection = {
  ref: ModelRef;
  source: "summaryModel" | "default";
};

function resolveSummaryModelRef(
  cfg: ArgentConfig,
  config: ResolvedTtsConfig,
): SummaryModelSelection {
  const defaultRef = resolveDefaultModelForAgent({ cfg });
  const override = config.summaryModel?.trim();
  if (!override) {
    return { ref: defaultRef, source: "default" };
  }

  const aliasIndex = buildModelAliasIndex({ cfg, defaultProvider: defaultRef.provider });
  const resolved = resolveModelRefFromString({
    raw: override,
    defaultProvider: defaultRef.provider,
    aliasIndex,
  });
  if (!resolved) {
    return { ref: defaultRef, source: "default" };
  }
  return { ref: resolved.ref, source: "summaryModel" };
}

function isTextContentBlock(block: { type: string }): block is TextContent {
  return block.type === "text";
}

async function summarizeText(params: {
  text: string;
  targetLength: number;
  cfg: ArgentConfig;
  config: ResolvedTtsConfig;
  timeoutMs: number;
}): Promise<SummarizeResult> {
  const { text, targetLength, cfg, config, timeoutMs } = params;
  if (targetLength < 100 || targetLength > 10_000) {
    throw new Error(`Invalid targetLength: ${targetLength}`);
  }

  const startTime = Date.now();
  const { ref } = resolveSummaryModelRef(cfg, config);
  const resolved = resolveModel(ref.provider, ref.model, undefined, cfg);
  if (!resolved.model) {
    throw new Error(resolved.error ?? `Unknown summary model: ${ref.provider}/${ref.model}`);
  }
  const apiKey = requireApiKey(
    await getApiKeyForModel({ model: resolved.model, cfg }),
    ref.provider,
  );

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await completeSimple(
        resolved.model,
        {
          messages: [
            {
              role: "user",
              content:
                `You are an assistant that summarizes texts concisely while keeping the most important information. ` +
                `Summarize the text to approximately ${targetLength} characters. Maintain the original tone and style. ` +
                `Reply only with the summary, without additional explanations.\n\n` +
                `<text_to_summarize>\n${text}\n</text_to_summarize>`,
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey,
          maxTokens: Math.ceil(targetLength / 2),
          temperature: 0.3,
          signal: controller.signal,
        },
      );

      const summary = res.content
        .filter(isTextContentBlock)
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join(" ")
        .trim();

      if (!summary) {
        throw new Error("No summary returned");
      }

      return {
        summary,
        latencyMs: Date.now() - startTime,
        inputLength: text.length,
        outputLength: summary.length,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const error = err as Error;
    if (error.name === "AbortError") {
      throw new Error("Summarization timed out", { cause: err });
    }
    throw err;
  }
}

function scheduleCleanup(tempDir: string, delayMs: number = TEMP_FILE_CLEANUP_DELAY_MS): void {
  const timer = setTimeout(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }, delayMs);
  timer.unref();
}

async function elevenLabsTTS(params: {
  text: string;
  apiKey: string;
  baseUrl: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  seed?: number;
  applyTextNormalization?: "auto" | "on" | "off";
  languageCode?: string;
  voiceSettings: ResolvedTtsConfig["elevenlabs"]["voiceSettings"];
  timeoutMs: number;
}): Promise<Buffer> {
  const {
    text,
    apiKey,
    baseUrl,
    voiceId,
    modelId,
    outputFormat,
    seed,
    applyTextNormalization,
    languageCode,
    voiceSettings,
    timeoutMs,
  } = params;
  if (!isValidVoiceId(voiceId)) {
    throw new Error("Invalid voiceId format");
  }
  assertElevenLabsVoiceSettings(voiceSettings);
  const normalizedLanguage = normalizeLanguageCode(languageCode);
  const normalizedNormalization = normalizeApplyTextNormalization(applyTextNormalization);
  const normalizedSeed = normalizeSeed(seed);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Route through Dashboard API proxy when available
    const dashboardApi = process.env.ARGENT_DASHBOARD_API;
    if (dashboardApi) {
      const response = await fetch(`${dashboardApi}/api/proxy/tts/elevenlabs`, {
        method: "POST",
        headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          voiceId,
          outputFormat,
          text,
          model_id: modelId,
          voice_settings: {
            stability: voiceSettings.stability,
            similarity_boost: voiceSettings.similarityBoost,
            style: voiceSettings.style,
            use_speaker_boost: voiceSettings.useSpeakerBoost,
            speed: voiceSettings.speed,
          },
          seed: normalizedSeed,
          apply_text_normalization: normalizedNormalization,
          language_code: normalizedLanguage,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`TTS proxy error (${response.status})`);
      return Buffer.from(await response.arrayBuffer());
    }

    // Direct call (fallback when no proxy configured)
    const url = new URL(`${normalizeElevenLabsBaseUrl(baseUrl)}/v1/text-to-speech/${voiceId}`);
    if (outputFormat) {
      url.searchParams.set("output_format", outputFormat);
    }

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        seed: normalizedSeed,
        apply_text_normalization: normalizedNormalization,
        language_code: normalizedLanguage,
        voice_settings: {
          stability: voiceSettings.stability,
          similarity_boost: voiceSettings.similarityBoost,
          style: voiceSettings.style,
          use_speaker_boost: voiceSettings.useSpeakerBoost,
          speed: voiceSettings.speed,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error (${response.status})`);
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function openaiTTS(params: {
  text: string;
  apiKey: string;
  model: string;
  voice: string;
  responseFormat: "mp3" | "opus" | "pcm";
  timeoutMs: number;
}): Promise<Buffer> {
  const { text, apiKey, model, voice, responseFormat, timeoutMs } = params;

  if (!isValidOpenAIModel(model)) {
    throw new Error(`Invalid model: ${model}`);
  }
  if (!isValidOpenAIVoice(voice)) {
    throw new Error(`Invalid voice: ${voice}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Route through Dashboard API proxy when available
    const dashboardApi = process.env.ARGENT_DASHBOARD_API;
    if (dashboardApi) {
      const response = await fetch(`${dashboardApi}/api/proxy/tts/openai`, {
        method: "POST",
        headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ model, input: text, voice, response_format: responseFormat }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`TTS proxy error (${response.status})`);
      return Buffer.from(await response.arrayBuffer());
    }

    // Direct call (fallback when no proxy configured)
    const response = await fetch(`${getOpenAITtsBaseUrl()}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: responseFormat,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI TTS API error (${response.status})`);
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function inferEdgeExtension(outputFormat: string): string {
  const normalized = outputFormat.toLowerCase();
  if (normalized.includes("webm")) {
    return ".webm";
  }
  if (normalized.includes("ogg")) {
    return ".ogg";
  }
  if (normalized.includes("opus")) {
    return ".opus";
  }
  if (normalized.includes("wav") || normalized.includes("riff") || normalized.includes("pcm")) {
    return ".wav";
  }
  return ".mp3";
}

async function edgeTTS(params: {
  text: string;
  outputPath: string;
  config: ResolvedTtsConfig["edge"];
  timeoutMs: number;
}): Promise<void> {
  const { text, outputPath, config, timeoutMs } = params;
  const tts = new EdgeTTS({
    voice: config.voice,
    lang: config.lang,
    outputFormat: config.outputFormat,
    saveSubtitles: config.saveSubtitles,
    proxy: config.proxy,
    rate: config.rate,
    pitch: config.pitch,
    volume: config.volume,
    timeout: config.timeoutMs ?? timeoutMs,
  });
  await tts.ttsPromise(text, outputPath);
}

async function minimaxTTS(params: {
  text: string;
  apiKey: string;
  model?: string;
  voiceId?: string;
  timeoutMs?: number;
}): Promise<Buffer> {
  const body = {
    model: params.model ?? "speech-02-turbo",
    text: params.text,
    stream: false,
    voice_setting: {
      voice_id: params.voiceId ?? "female-shaonv",
      speed: 1.0,
      pitch: 0,
      vol: 1.0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: "mp3",
    },
  };

  const controller = new AbortController();
  const timeout = params.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch("https://api.minimax.io/v1/t2a_v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`MiniMax TTS failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      base_resp?: { status_code?: number; status_msg?: string };
      data?: { audio?: string };
    };

    if (json.base_resp?.status_code && json.base_resp.status_code !== 0) {
      throw new Error(
        `MiniMax TTS error (${json.base_resp.status_code}): ${json.base_resp.status_msg}`,
      );
    }

    const hexAudio = json.data?.audio;
    if (!hexAudio) throw new Error("MiniMax TTS returned no audio data");

    return Buffer.from(hexAudio, "hex");
  } finally {
    clearTimeout(timer);
  }
}

export async function textToSpeech(params: {
  text: string;
  cfg: ArgentConfig;
  prefsPath?: string;
  channel?: string;
  sessionKey?: string;
  overrides?: TtsDirectiveOverrides;
}): Promise<TtsResult> {
  const config = resolveTtsConfig(params.cfg);
  const prefsPath = params.prefsPath ?? resolveTtsPrefsPath(config);
  const channelId = resolveChannelId(params.channel);
  const output = resolveOutputFormat(channelId);

  if (params.text.length > config.maxTextLength) {
    return {
      success: false,
      error: `Text too long (${params.text.length} chars, max ${config.maxTextLength})`,
    };
  }

  const userProvider = getTtsProvider(config, prefsPath, {
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    source: "tts:textToSpeech",
  });
  const overrideProvider = params.overrides?.provider;
  const provider = overrideProvider ?? userProvider;
  const providers = resolveTtsProviderOrder(provider, config.fallbackOrder);

  let lastError: string | undefined;

  for (const provider of providers) {
    const providerStart = Date.now();
    try {
      if (provider === "edge") {
        if (!config.edge.enabled) {
          lastError = "edge: disabled";
          continue;
        }

        const tempDir = mkdtempSync(path.join(tmpdir(), "tts-"));
        let edgeOutputFormat = resolveEdgeOutputFormat(config);
        const fallbackEdgeOutputFormat =
          edgeOutputFormat !== DEFAULT_EDGE_OUTPUT_FORMAT ? DEFAULT_EDGE_OUTPUT_FORMAT : undefined;

        const attemptEdgeTts = async (outputFormat: string) => {
          const extension = inferEdgeExtension(outputFormat);
          const audioPath = path.join(tempDir, `voice-${Date.now()}${extension}`);
          await edgeTTS({
            text: params.text,
            outputPath: audioPath,
            config: {
              ...config.edge,
              outputFormat,
            },
            timeoutMs: config.timeoutMs,
          });
          return { audioPath, outputFormat };
        };

        let edgeResult: { audioPath: string; outputFormat: string };
        try {
          edgeResult = await attemptEdgeTts(edgeOutputFormat);
        } catch (err) {
          if (fallbackEdgeOutputFormat && fallbackEdgeOutputFormat !== edgeOutputFormat) {
            logVerbose(
              `TTS: Edge output ${edgeOutputFormat} failed; retrying with ${fallbackEdgeOutputFormat}.`,
            );
            edgeOutputFormat = fallbackEdgeOutputFormat;
            try {
              edgeResult = await attemptEdgeTts(edgeOutputFormat);
            } catch (fallbackErr) {
              try {
                rmSync(tempDir, { recursive: true, force: true });
              } catch {
                // ignore cleanup errors
              }
              throw fallbackErr;
            }
          } else {
            try {
              rmSync(tempDir, { recursive: true, force: true });
            } catch {
              // ignore cleanup errors
            }
            throw err;
          }
        }

        scheduleCleanup(tempDir);
        const voiceCompatible = isVoiceCompatibleAudio({ fileName: edgeResult.audioPath });

        return {
          success: true,
          audioPath: edgeResult.audioPath,
          latencyMs: Date.now() - providerStart,
          provider,
          outputFormat: edgeResult.outputFormat,
          voiceCompatible,
        };
      }

      const apiKey = resolveTtsApiKey(config, provider, {
        cfg: params.cfg,
        sessionKey: params.sessionKey,
        source: "tts:textToSpeech",
      });
      if (!apiKey) {
        lastError = `No API key for ${provider}`;
        continue;
      }

      let audioBuffer: Buffer;
      if (provider === "elevenlabs") {
        const voiceIdOverride = params.overrides?.elevenlabs?.voiceId;
        const modelIdOverride = params.overrides?.elevenlabs?.modelId;
        const voiceSettings = {
          ...config.elevenlabs.voiceSettings,
          ...params.overrides?.elevenlabs?.voiceSettings,
        };
        const seedOverride = params.overrides?.elevenlabs?.seed;
        const normalizationOverride = params.overrides?.elevenlabs?.applyTextNormalization;
        const languageOverride = params.overrides?.elevenlabs?.languageCode;
        audioBuffer = await elevenLabsTTS({
          text: params.text,
          apiKey,
          baseUrl: config.elevenlabs.baseUrl,
          voiceId: voiceIdOverride ?? config.elevenlabs.voiceId,
          modelId: modelIdOverride ?? config.elevenlabs.modelId,
          outputFormat: output.elevenlabs,
          seed: seedOverride ?? config.elevenlabs.seed,
          applyTextNormalization: normalizationOverride ?? config.elevenlabs.applyTextNormalization,
          languageCode: languageOverride ?? config.elevenlabs.languageCode,
          voiceSettings,
          timeoutMs: config.timeoutMs,
        });
      } else if (provider === "minimax") {
        audioBuffer = await minimaxTTS({
          text: params.text,
          apiKey,
          timeoutMs: config.timeoutMs,
        });
      } else {
        const openaiModelOverride = params.overrides?.openai?.model;
        const openaiVoiceOverride = params.overrides?.openai?.voice;
        audioBuffer = await openaiTTS({
          text: params.text,
          apiKey,
          model: openaiModelOverride ?? config.openai.model,
          voice: openaiVoiceOverride ?? config.openai.voice,
          responseFormat: output.openai,
          timeoutMs: config.timeoutMs,
        });
      }

      const latencyMs = Date.now() - providerStart;

      const tempDir = mkdtempSync(path.join(tmpdir(), "tts-"));
      const audioPath = path.join(tempDir, `voice-${Date.now()}${output.extension}`);
      writeFileSync(audioPath, audioBuffer);
      scheduleCleanup(tempDir);

      return {
        success: true,
        audioPath,
        latencyMs,
        provider,
        outputFormat: provider === "openai" ? output.openai : output.elevenlabs,
        voiceCompatible: output.voiceCompatible,
      };
    } catch (err) {
      const error = err as Error;
      if (error.name === "AbortError") {
        lastError = `${provider}: request timed out`;
      } else {
        lastError = `${provider}: ${error.message}`;
      }
    }
  }

  return {
    success: false,
    error: `TTS conversion failed: ${lastError || "no providers available"}`,
  };
}

export async function textToSpeechTelephony(params: {
  text: string;
  cfg: ArgentConfig;
  prefsPath?: string;
  sessionKey?: string;
}): Promise<TtsTelephonyResult> {
  const config = resolveTtsConfig(params.cfg);
  const prefsPath = params.prefsPath ?? resolveTtsPrefsPath(config);

  if (params.text.length > config.maxTextLength) {
    return {
      success: false,
      error: `Text too long (${params.text.length} chars, max ${config.maxTextLength})`,
    };
  }

  const userProvider = getTtsProvider(config, prefsPath, {
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    source: "tts:telephony",
  });
  const providers = resolveTtsProviderOrder(userProvider, config.fallbackOrder);

  let lastError: string | undefined;

  for (const provider of providers) {
    const providerStart = Date.now();
    try {
      if (provider === "edge") {
        lastError = "edge: unsupported for telephony";
        continue;
      }

      const apiKey = resolveTtsApiKey(config, provider, {
        cfg: params.cfg,
        sessionKey: params.sessionKey,
        source: "tts:telephony",
      });
      if (!apiKey) {
        lastError = `No API key for ${provider}`;
        continue;
      }

      if (provider === "elevenlabs") {
        const output = TELEPHONY_OUTPUT.elevenlabs;
        const audioBuffer = await elevenLabsTTS({
          text: params.text,
          apiKey,
          baseUrl: config.elevenlabs.baseUrl,
          voiceId: config.elevenlabs.voiceId,
          modelId: config.elevenlabs.modelId,
          outputFormat: output.format,
          seed: config.elevenlabs.seed,
          applyTextNormalization: config.elevenlabs.applyTextNormalization,
          languageCode: config.elevenlabs.languageCode,
          voiceSettings: config.elevenlabs.voiceSettings,
          timeoutMs: config.timeoutMs,
        });

        return {
          success: true,
          audioBuffer,
          latencyMs: Date.now() - providerStart,
          provider,
          outputFormat: output.format,
          sampleRate: output.sampleRate,
        };
      }

      const output = TELEPHONY_OUTPUT.openai;
      const audioBuffer = await openaiTTS({
        text: params.text,
        apiKey,
        model: config.openai.model,
        voice: config.openai.voice,
        responseFormat: output.format,
        timeoutMs: config.timeoutMs,
      });

      return {
        success: true,
        audioBuffer,
        latencyMs: Date.now() - providerStart,
        provider,
        outputFormat: output.format,
        sampleRate: output.sampleRate,
      };
    } catch (err) {
      const error = err as Error;
      if (error.name === "AbortError") {
        lastError = `${provider}: request timed out`;
      } else {
        lastError = `${provider}: ${error.message}`;
      }
    }
  }

  return {
    success: false,
    error: `TTS conversion failed: ${lastError || "no providers available"}`,
  };
}

export async function maybeApplyTtsToPayload(params: {
  payload: ReplyPayload;
  cfg: ArgentConfig;
  channel?: string;
  sessionKey?: string;
  kind?: "tool" | "block" | "final";
  inboundAudio?: boolean;
  ttsAuto?: string;
}): Promise<ReplyPayload> {
  const config = resolveTtsConfig(params.cfg);
  const prefsPath = resolveTtsPrefsPath(config);
  const autoMode = resolveTtsAutoMode({
    config,
    prefsPath,
    sessionAuto: params.ttsAuto,
  });
  if (autoMode === "off") {
    return params.payload;
  }

  const text = params.payload.text ?? "";
  const directives = parseTtsDirectives(text, config.modelOverrides);
  if (directives.warnings.length > 0) {
    logVerbose(`TTS: ignored directive overrides (${directives.warnings.join("; ")})`);
  }

  const cleanedText = directives.cleanedText;
  const trimmedCleaned = cleanedText.trim();
  const visibleText = trimmedCleaned.length > 0 ? trimmedCleaned : "";
  const ttsText = directives.ttsText?.trim() || visibleText;

  const nextPayload =
    visibleText === text.trim()
      ? params.payload
      : {
          ...params.payload,
          text: visibleText.length > 0 ? visibleText : undefined,
        };

  if (autoMode === "tagged" && !directives.hasDirective) {
    return nextPayload;
  }
  if (autoMode === "inbound" && params.inboundAudio !== true) {
    return nextPayload;
  }

  const mode = config.mode ?? "final";
  if (mode === "final" && params.kind && params.kind !== "final") {
    return nextPayload;
  }

  if (!ttsText.trim()) {
    return nextPayload;
  }
  if (params.payload.mediaUrl || (params.payload.mediaUrls?.length ?? 0) > 0) {
    return nextPayload;
  }
  if (text.includes("MEDIA:")) {
    return nextPayload;
  }
  if (ttsText.trim().length < 10) {
    return nextPayload;
  }

  const maxLength = getTtsMaxLength(prefsPath);
  let textForAudio = ttsText.trim();
  let wasSummarized = false;

  if (textForAudio.length > maxLength) {
    if (!isSummarizationEnabled(prefsPath)) {
      // Truncate text when summarization is disabled
      logVerbose(
        `TTS: truncating long text (${textForAudio.length} > ${maxLength}), summarization disabled.`,
      );
      textForAudio = `${textForAudio.slice(0, maxLength - 3)}...`;
    } else {
      // Summarize text when enabled
      try {
        const summary = await summarizeText({
          text: textForAudio,
          targetLength: maxLength,
          cfg: params.cfg,
          config,
          timeoutMs: config.timeoutMs,
        });
        textForAudio = summary.summary;
        wasSummarized = true;
        if (textForAudio.length > config.maxTextLength) {
          logVerbose(
            `TTS: summary exceeded hard limit (${textForAudio.length} > ${config.maxTextLength}); truncating.`,
          );
          textForAudio = `${textForAudio.slice(0, config.maxTextLength - 3)}...`;
        }
      } catch (err) {
        const error = err as Error;
        logVerbose(`TTS: summarization failed, truncating instead: ${error.message}`);
        textForAudio = `${textForAudio.slice(0, maxLength - 3)}...`;
      }
    }
  }

  const ttsStart = Date.now();
  const result = await textToSpeech({
    text: textForAudio,
    cfg: params.cfg,
    prefsPath,
    channel: params.channel,
    sessionKey: params.sessionKey,
    overrides: directives.overrides,
  });

  if (result.success && result.audioPath) {
    lastTtsAttempt = {
      timestamp: Date.now(),
      success: true,
      textLength: text.length,
      summarized: wasSummarized,
      provider: result.provider,
      latencyMs: result.latencyMs,
    };

    const channelId = resolveChannelId(params.channel);
    const shouldVoice = channelId === "telegram" && result.voiceCompatible === true;
    const finalPayload = {
      ...nextPayload,
      mediaUrl: result.audioPath,
      audioAsVoice: shouldVoice || params.payload.audioAsVoice,
    };
    return finalPayload;
  }

  lastTtsAttempt = {
    timestamp: Date.now(),
    success: false,
    textLength: text.length,
    summarized: wasSummarized,
    error: result.error,
  };

  const latency = Date.now() - ttsStart;
  logVerbose(`TTS: conversion failed after ${latency}ms (${result.error ?? "unknown"}).`);
  return nextPayload;
}

export const _test = {
  isValidVoiceId,
  isValidOpenAIVoice,
  isValidOpenAIModel,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
  parseTtsDirectives,
  resolveModelOverridePolicy,
  summarizeText,
  resolveOutputFormat,
  resolveEdgeOutputFormat,
};
