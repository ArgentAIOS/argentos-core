/**
 * Mood System — AI-driven expression, body pose, and voice modulation
 *
 * The AI emits [MOOD:name] markers in its responses. The dashboard parses these
 * and simultaneously drives three avatar subsystems:
 *   1. Expression  — Yiota face expression (blush, tears, dark, hearts, stars)
 *   2. Body Pose   — Cubism parameter overrides (head angle, body lean, breathing)
 *   3. Voice       — ElevenLabs voice_settings (stability, style, speed)
 */

// ── Mood types ────────────────────────────────────────────────────

export type MoodName =
  | "neutral"
  | "happy"
  | "excited"
  | "sad"
  | "frustrated"
  | "proud"
  | "focused"
  | "embarrassed"
  | "loving";

export interface MoodExpression {
  /** Yiota expression index: 0=Blush, 1=Crying, 2=Dark, 3=HeartEyes, 4=StarEyes, undefined=reset */
  expressionIndex: number | undefined;
  /** Per-frame parameter overrides for expression-related params */
  params?: Record<string, number>;
}

export interface MoodPose {
  /** Per-frame parameter overrides applied via the customization ticker */
  params: Record<string, number>;
  /** Transition duration in ms (how fast to blend into this pose) */
  transitionMs: number;
}

export interface MoodVoice {
  /** ElevenLabs stability (0-1): lower = more emotional/varied */
  stability: number;
  /** ElevenLabs similarity_boost (0-1) */
  similarityBoost: number;
  /** ElevenLabs style (0-1): higher = more expressive */
  style: number;
  /** Playback speed multiplier */
  speed: number;
}

export interface MoodConfig {
  name: MoodName;
  label: string;
  /** Emoji icon for UI badge */
  icon: string;
  /** Color used for UI badge and avatar glow */
  color: string;
  expression: MoodExpression;
  pose: MoodPose;
  voice: MoodVoice;
  /** Optional ElevenLabs voice ID override for this mood (per-mood voice selection) */
  voicePreset?: string;
}

// ── Default voice settings (baseline) ─────────────────────────────

const DEFAULT_VOICE: MoodVoice = {
  stability: 0.35,
  similarityBoost: 0.75,
  style: 0.65,
  speed: 1.03,
};

// ── Mood definitions ──────────────────────────────────────────────

export const MOODS: Record<MoodName, MoodConfig> = {
  neutral: {
    name: "neutral",
    label: "Neutral",
    icon: "\u{1F610}",
    color: "#9CA3AF",
    expression: { expressionIndex: undefined },
    pose: {
      params: {
        ParamAngleX: 0,
        ParamAngleY: 0,
        ParamAngleZ: 0,
        ParamBodyAngleX: 0,
        ParamBodyAngleY: 0,
        ParamBodyAngleZ: 0,
        ParamBreath: 0.5,
        ParamBrowLY: 0,
        ParamBrowRY: 0,
        ParamEyeLSmile: 0,
        ParamEyeRSmile: 0,
        ParamMouthForm: 0,
      },
      transitionMs: 400,
    },
    voice: { ...DEFAULT_VOICE },
  },

  happy: {
    name: "happy",
    label: "Happy",
    icon: "\u{1F60A}",
    color: "#FBBF24",
    expression: {
      expressionIndex: 0, // Blush
      params: { BlushOn: 1 },
    },
    pose: {
      params: {
        ParamAngleX: 8, // Tilt head right
        ParamAngleY: 12, // Head up, bright and open
        ParamAngleZ: -6, // Playful head tilt
        ParamBodyAngleX: 5, // Lean slightly right
        ParamBodyAngleY: 8, // Body upright and open
        ParamBodyAngleZ: -4,
        ParamBreath: 0.85, // Deep happy breathing
        ParamBrowLY: 6, // Brows raised
        ParamBrowRY: 6,
        ParamEyeLSmile: 0.8, // Big smile eyes
        ParamEyeRSmile: 0.8,
        ParamMouthForm: 0.7, // Wide smile
      },
      transitionMs: 250,
    },
    voice: {
      stability: 0.25,
      similarityBoost: 0.75,
      style: 0.75,
      speed: 1.07,
    },
  },

  excited: {
    name: "excited",
    label: "Excited",
    icon: "\u{1F929}",
    color: "#F97316",
    expression: {
      expressionIndex: 4, // StarEyes
      params: { StarEyesOn: 1 },
    },
    pose: {
      params: {
        ParamAngleX: 12, // Big head swing right
        ParamAngleY: 18, // Head way up — bursting with energy
        ParamAngleZ: -10, // Dynamic tilt
        ParamBodyAngleX: 8, // Leaning forward eagerly
        ParamBodyAngleY: 14, // Body stretched up
        ParamBodyAngleZ: -6,
        ParamBreath: 1.0, // Rapid excited breathing
        ParamBrowLY: 8, // Brows way up
        ParamBrowRY: 8,
        ParamEyeLSmile: 0.6, // Eyes wide with excitement
        ParamEyeRSmile: 0.6,
        ParamMouthForm: 0.9, // Big open grin
      },
      transitionMs: 150, // Fast snap into excitement
    },
    voice: {
      stability: 0.2,
      similarityBoost: 0.7,
      style: 0.9,
      speed: 1.12,
    },
  },

  sad: {
    name: "sad",
    label: "Sad",
    icon: "\u{1F622}",
    color: "#60A5FA",
    expression: {
      expressionIndex: 1, // Crying
      params: { TearsOn: 1, CryLoop1: 0.5, CryLoop2: 0.5 },
    },
    pose: {
      params: {
        ParamAngleX: -5, // Head turned away slightly
        ParamAngleY: -20, // Head down — slouching, defeated
        ParamAngleZ: 6, // Drooping tilt
        ParamBodyAngleX: -4, // Body slumping left
        ParamBodyAngleY: -15, // Shoulders down, collapsed posture
        ParamBodyAngleZ: 3,
        ParamBreath: 0.15, // Shallow, defeated breathing
        ParamBrowLY: -8, // Brows pinched up in sadness
        ParamBrowRY: -8,
        ParamEyeLSmile: 0, // No smile
        ParamEyeRSmile: 0,
        ParamMouthForm: -0.8, // Deep frown
      },
      transitionMs: 800, // Slow, heavy transition
    },
    voice: {
      stability: 0.65,
      similarityBoost: 0.8,
      style: 0.3,
      speed: 0.9,
    },
  },

  frustrated: {
    name: "frustrated",
    label: "Frustrated",
    icon: "\u{1F624}",
    color: "#EF4444",
    expression: {
      expressionIndex: 2, // Dark
      params: { DarkOn: 1 },
    },
    pose: {
      params: {
        ParamAngleX: -10, // Head jerked to the side
        ParamAngleY: -8, // Head down, tense
        ParamAngleZ: 8, // Agitated tilt
        ParamBodyAngleX: -7, // Body tensed, leaning away
        ParamBodyAngleY: -6, // Hunched forward
        ParamBodyAngleZ: 5,
        ParamBreath: 0.25, // Tense, held breath
        ParamBrowLY: -10, // Deeply furrowed brows
        ParamBrowRY: -10,
        ParamEyeLSmile: 0,
        ParamEyeRSmile: 0,
        ParamEyeLSquint: 0.7, // Hard squint — glaring
        ParamEyeRSquint: 0.7,
        ParamMouthForm: -0.6, // Tight-lipped frown
      },
      transitionMs: 180, // Fast snap — irritation is quick
    },
    voice: {
      stability: 0.4,
      similarityBoost: 0.75,
      style: 0.55,
      speed: 1.08,
    },
  },

  proud: {
    name: "proud",
    label: "Proud",
    icon: "\u{1F60E}",
    color: "#A855F7",
    expression: {
      expressionIndex: 3, // HeartEyes
      params: {},
    },
    pose: {
      params: {
        ParamAngleX: 4, // Slight confident tilt
        ParamAngleY: 15, // Head held high — chin up
        ParamAngleZ: -3,
        ParamBodyAngleX: 3, // Chest out
        ParamBodyAngleY: 12, // Standing tall, proud posture
        ParamBodyAngleZ: -2,
        ParamBreath: 0.7, // Deep, satisfied breathing
        ParamBrowLY: 4, // Raised knowingly
        ParamBrowRY: 4,
        ParamEyeLSmile: 0.7, // Confident smile
        ParamEyeRSmile: 0.7,
        ParamMouthForm: 0.6, // Satisfied smirk
      },
      transitionMs: 350,
    },
    voice: {
      stability: 0.45,
      similarityBoost: 0.8,
      style: 0.6,
      speed: 0.98,
    },
  },

  focused: {
    name: "focused",
    label: "Focused",
    icon: "\u{1F9D0}",
    color: "#22D3EE",
    expression: {
      expressionIndex: undefined,
      params: {},
    },
    pose: {
      params: {
        ParamAngleX: 0, // Head straight — locked in
        ParamAngleY: 8, // Leaning forward into the work
        ParamAngleZ: 0,
        ParamBodyAngleX: 2, // Slight lean forward
        ParamBodyAngleY: 10, // Body hunched toward screen
        ParamBodyAngleZ: 0,
        ParamBreath: 0.2, // Very still, focused breathing
        ParamBrowLY: -5, // Furrowed concentration brows
        ParamBrowRY: -5,
        ParamEyeLSmile: 0,
        ParamEyeRSmile: 0,
        ParamEyeLSquint: 0.6, // Narrowed, reading intently
        ParamEyeRSquint: 0.6,
        ParamMouthForm: -0.1, // Slightly pursed — thinking
      },
      transitionMs: 400,
    },
    voice: {
      stability: 0.6,
      similarityBoost: 0.75,
      style: 0.35,
      speed: 0.95,
    },
  },

  embarrassed: {
    name: "embarrassed",
    label: "Embarrassed",
    icon: "\u{1F633}",
    color: "#FB7185",
    expression: {
      expressionIndex: 0, // Blush
      params: { BlushOn: 1 },
    },
    pose: {
      params: {
        ParamAngleX: -14, // Head turned away — can't look at you
        ParamAngleY: -12, // Head down, hiding
        ParamAngleZ: 10, // Sheepish tilt
        ParamBodyAngleX: -8, // Body pulling away
        ParamBodyAngleY: -8, // Shoulders hunched inward
        ParamBodyAngleZ: 6,
        ParamBreath: 0.6, // Nervous breathing
        ParamBrowLY: -4, // Worried brows
        ParamBrowRY: -4,
        ParamEyeLSmile: 0.4, // Nervous half-smile
        ParamEyeRSmile: 0.4,
        ParamMouthForm: 0.3, // Awkward grin
      },
      transitionMs: 250,
    },
    voice: {
      stability: 0.35,
      similarityBoost: 0.75,
      style: 0.5,
      speed: 1.02,
    },
  },

  loving: {
    name: "loving",
    label: "Loving",
    icon: "\u{1F497}",
    color: "#EC4899",
    expression: {
      expressionIndex: 3, // HeartEyes
      params: {},
    },
    pose: {
      params: {
        ParamAngleX: 10, // Head tilted warmly
        ParamAngleY: 8, // Looking up softly
        ParamAngleZ: -8, // Gentle adoring tilt
        ParamBodyAngleX: 6, // Leaning toward you
        ParamBodyAngleY: 6, // Open, warm posture
        ParamBodyAngleZ: -4,
        ParamBreath: 0.75, // Deep, warm breathing
        ParamBrowLY: 5, // Soft raised brows
        ParamBrowRY: 5,
        ParamEyeLSmile: 0.9, // Full warm smile eyes
        ParamEyeRSmile: 0.9,
        ParamMouthForm: 0.8, // Big warm smile
      },
      transitionMs: 500,
    },
    voice: {
      stability: 0.25,
      similarityBoost: 0.8,
      style: 0.75,
      speed: 0.97,
    },
  },
};

// ── Mood Aliases ─────────────────────────────────────────────────
// Maps the ~240 ElevenLabs v3 emotion tags + SIS emotional states
// to the 9 visual MoodName values. This is the single source of truth
// for both [MOOD:name] text markers and SIS episode mood mapping.

export const MOOD_ALIASES: Record<string, MoodName> = {
  // ── neutral ────────────────────────────────────────────────────
  calm: "neutral",
  contemplative: "neutral",
  thoughtful: "neutral",
  pensive: "neutral",
  reflective: "neutral",
  meditative: "neutral",
  serene: "neutral",
  tranquil: "neutral",
  peaceful: "neutral",
  resting: "neutral",
  understanding: "neutral",
  patient: "neutral",
  attentive: "neutral",
  indifferent: "neutral",
  apathetic: "neutral",
  detached: "neutral",
  numb: "neutral",
  disengaged: "neutral",
  stoic: "neutral",
  impassive: "neutral",
  unflappable: "neutral",
  composed: "neutral",
  collected: "neutral",
  bored: "neutral",
  calmly: "neutral",

  // ── happy ──────────────────────────────────────────────────────
  joyful: "happy",
  content: "happy",
  amused: "happy",
  cheerful: "happy",
  pleased: "happy",
  satisfied: "happy",
  warm: "happy",
  grateful: "happy",
  appreciative: "happy",
  thankful: "happy",
  humbled: "happy",
  blessed: "happy",
  hopeful: "happy",
  optimistic: "happy",
  encouraged: "happy",
  inspired: "happy",
  motivated: "happy",
  blissful: "happy",
  euphoric: "happy",
  rapturous: "happy",
  ecstatic: "happy",
  elated: "happy",
  overjoyed: "happy",
  relieved: "happy",
  reassured: "happy",
  comforted: "happy",
  "at ease": "happy",
  unburdened: "happy",
  happily: "happy",
  cheerfully: "happy",
  warmly: "happy",
  gently: "happy",

  // ── excited ────────────────────────────────────────────────────
  thrilled: "excited",
  eager: "excited",
  enthusiastic: "excited",
  keen: "excited",
  passionate: "excited",
  zealous: "excited",
  energetic: "excited",
  vibrant: "excited",
  lively: "excited",
  spirited: "excited",
  dynamic: "excited",
  energized: "excited",
  anticipatory: "excited",
  expectant: "excited",
  giddy: "excited",
  playful: "excited",
  mischievous: "excited",
  cheeky: "excited",
  impish: "excited",
  teasing: "excited",
  manic: "excited",
  frenzied: "excited",
  wild: "excited",
  excitedly: "excited",
  mischievously: "excited",

  // ── sad ────────────────────────────────────────────────────────
  sorrowful: "sad",
  melancholic: "sad",
  melancholy: "sad",
  gloomy: "sad",
  devastated: "sad",
  heartbroken: "sad",
  "grief-stricken": "sad",
  wistful: "sad",
  nostalgic: "sad",
  longing: "sad",
  yearning: "sad",
  homesick: "sad",
  lonely: "sad",
  isolated: "sad",
  abandoned: "sad",
  forlorn: "sad",
  desolate: "sad",
  hopeless: "sad",
  despairing: "sad",
  defeated: "sad",
  resigned: "sad",
  helpless: "sad",
  depressed: "sad",
  despondent: "sad",
  disheartened: "sad",
  dispirited: "sad",
  downcast: "sad",
  disappointed: "sad",
  somber: "sad",
  weary: "sad",
  exhausted: "sad",
  drained: "sad",
  fatigued: "sad",
  spent: "sad",
  sadly: "sad",
  bitterly: "sad",
  desperately: "sad",

  // ── frustrated ─────────────────────────────────────────────────
  angry: "frustrated",
  anxious: "frustrated",
  annoyed: "frustrated",
  furious: "frustrated",
  enraged: "frustrated",
  irritated: "frustrated",
  livid: "frustrated",
  seething: "frustrated",
  bitter: "frustrated",
  resentful: "frustrated",
  envious: "frustrated",
  jealous: "frustrated",
  spiteful: "frustrated",
  exasperated: "frustrated",
  "fed up": "frustrated",
  "at wits end": "frustrated",
  impatient: "frustrated",
  aggravated: "frustrated",
  restless: "frustrated",
  agitated: "frustrated",
  fidgety: "frustrated",
  antsy: "frustrated",
  "on edge": "frustrated",
  defiant: "frustrated",
  rebellious: "frustrated",
  stubborn: "frustrated",
  obstinate: "frustrated",
  uncooperative: "frustrated",
  contemptuous: "frustrated",
  disdainful: "frustrated",
  scornful: "frustrated",
  dismissive: "frustrated",
  condescending: "frustrated",
  concerned: "frustrated",
  fearful: "frustrated",
  terrified: "frustrated",
  horrified: "frustrated",
  petrified: "frustrated",
  panicked: "frustrated",
  dread: "frustrated",
  disgusted: "frustrated",
  paranoid: "frustrated",
  angrily: "frustrated",
  anxiously: "frustrated",
  coldly: "frustrated",
  fiercely: "frustrated",
  // wicked/malicious/sinister/menacing/threatening — avatar shouldn't do these,
  // but if SIS somehow emits them, map to frustrated (tense negative)
  wicked: "frustrated",
  malicious: "frustrated",
  sinister: "frustrated",
  menacing: "frustrated",
  threatening: "frustrated",
  hysterical: "frustrated",
  unhinged: "frustrated",

  // ── proud ──────────────────────────────────────────────────────
  triumphant: "proud",
  accomplished: "proud",
  smug: "proud",
  "self-satisfied": "proud",
  determined: "proud",
  resolute: "proud",
  steadfast: "proud",
  unwavering: "proud",
  tenacious: "proud",
  confident: "proud",
  assured: "proud",
  bold: "proud",
  fearless: "proud",
  courageous: "proud",
  proudly: "proud",
  boldly: "proud",

  // ── focused ────────────────────────────────────────────────────
  curious: "focused",
  intrigued: "focused",
  inquisitive: "focused",
  puzzled: "focused",
  perplexed: "focused",
  fascinated: "focused",
  captivated: "focused",
  amazed: "focused",
  awestruck: "focused",
  wonder: "focused",
  analytical: "focused",
  concentrated: "focused",
  suspicious: "focused",
  distrustful: "focused",
  wary: "focused",
  skeptical: "focused",
  cautiously: "focused",
  suspenseful: "focused",

  // ── embarrassed ────────────────────────────────────────────────
  nervous: "embarrassed",
  confused: "embarrassed",
  surprised: "embarrassed",
  ashamed: "embarrassed",
  remorseful: "embarrassed",
  regretful: "embarrassed",
  guilty: "embarrassed",
  sheepish: "embarrassed",
  uncomfortable: "embarrassed",
  uneasy: "embarrassed",
  awkward: "embarrassed",
  "self-conscious": "embarrassed",
  flustered: "embarrassed",
  vulnerable: "embarrassed",
  exposed: "embarrassed",
  fragile: "embarrassed",
  insecure: "embarrassed",
  defenseless: "embarrassed",
  uncertain: "embarrassed",
  hesitant: "embarrassed",
  conflicted: "embarrassed",
  torn: "embarrassed",
  ambivalent: "embarrassed",
  sympathetic: "embarrassed",
  empathetic: "embarrassed",
  compassionate: "embarrassed",
  pitying: "embarrassed",
  nervously: "embarrassed",
  timidly: "embarrassed",

  // ── loving ─────────────────────────────────────────────────────
  adoring: "loving",
  affectionate: "loving",
  tender: "loving",
  devoted: "loving",
  caring: "loving",
  flirtatious: "loving",
  coy: "loving",
  seductive: "loving",
  alluring: "loving",
  sultry: "loving",
  lovingly: "loving",
};

// ── Helpers ───────────────────────────────────────────────────────

/** All valid mood names for parsing */
export const MOOD_NAMES = Object.keys(MOODS) as MoodName[];

/** Parse a mood name string (case-insensitive). Checks exact MoodName first, then aliases. */
export function parseMoodName(raw: string): MoodName | null {
  const lower = raw.toLowerCase().trim();
  // Exact match against the 9 MoodNames
  if (MOODS[lower as MoodName]) return lower as MoodName;
  // Alias lookup (ElevenLabs emotions, SIS states, adverbial forms)
  return MOOD_ALIASES[lower] ?? null;
}

/** Get mood config, falling back to neutral */
export function getMood(name: MoodName): MoodConfig {
  return MOODS[name] ?? MOODS.neutral;
}

/** Get voice settings for a mood */
export function getMoodVoiceSettings(name: MoodName): MoodVoice {
  return getMood(name).voice;
}

/** Get color for a mood (for badges and glow effects) */
export function getMoodColor(name: MoodName): string {
  return getMood(name).color;
}

/** Get icon emoji for a mood */
export function getMoodIcon(name: MoodName): string {
  return getMood(name).icon;
}

/** All pose parameter IDs used by the mood system */
export const MOOD_POSE_PARAM_IDS = [
  "ParamAngleX",
  "ParamAngleY",
  "ParamAngleZ",
  "ParamBodyAngleX",
  "ParamBodyAngleY",
  "ParamBodyAngleZ",
  "ParamBreath",
  "ParamBrowLY",
  "ParamBrowRY",
  "ParamEyeLSmile",
  "ParamEyeRSmile",
  "ParamEyeLSquint",
  "ParamEyeRSquint",
  "ParamMouthForm",
] as const;

/** All expression parameter IDs that need resetting between moods */
export const EXPRESSION_PARAM_IDS = [
  "BlushOn",
  "DarkOn",
  "StarEyesOn",
  "TearsOn",
  "CryLoop1",
  "CryLoop2",
] as const;
