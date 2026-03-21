/**
 * Podcast Planning Tool
 *
 * Converts scripts/outlines into a normalized payload for `podcast_generate`
 * and returns a production runbook (research -> render -> publish).
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { readNumberParam, readStringParam } from "./common.js";

const DEFAULT_MODEL_ID = "eleven_v3";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_192";

const PlanPersonaSchema = Type.Object({
  id: Type.String({
    description: "Persona key (for example: argent, juniper, host).",
  }),
  voice_id: Type.String({
    description: "ElevenLabs voice ID for the persona.",
  }),
  aliases: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional speaker aliases used in scripts (for example: ARGENT, HOST, JUNIPER).",
      maxItems: 12,
    }),
  ),
});

const PlanDialogueLineSchema = Type.Object({
  text: Type.String({
    description: "Dialogue text for one spoken line or paragraph.",
  }),
  persona: Type.Optional(
    Type.String({
      description: "Persona ID from personas[].id.",
    }),
  ),
  voice_id: Type.Optional(
    Type.String({
      description: "Explicit voice ID for this line (overrides persona map).",
    }),
  ),
});

const PlanMusicSchema = Type.Object({
  intro_path: Type.Optional(Type.String()),
  outro_path: Type.Optional(Type.String()),
  bed_path: Type.Optional(Type.String()),
  intro_volume: Type.Optional(Type.Number()),
  outro_volume: Type.Optional(Type.Number()),
  bed_volume: Type.Optional(Type.Number()),
  ducking: Type.Optional(Type.Boolean()),
});

const PlanPublishSchema = Type.Object({
  spotify: Type.Optional(
    Type.Boolean({
      description: "Include Spotify publishing checklist. Default: true.",
    }),
  ),
  youtube: Type.Optional(
    Type.Boolean({
      description: "Include YouTube publishing checklist. Default: false.",
    }),
  ),
  heygen: Type.Optional(
    Type.Boolean({
      description: "Include HeyGen video generation checklist. Default: false.",
    }),
  ),
  spotify_show: Type.Optional(
    Type.String({
      description: "Optional show identifier/name for operations notes.",
    }),
  ),
  youtube_channel: Type.Optional(
    Type.String({
      description: "Optional YouTube channel reference for operations notes.",
    }),
  ),
});

const PodcastPlanSchema = Type.Object({
  title: Type.String({
    description: "Episode title.",
  }),
  script: Type.Optional(
    Type.String({
      description:
        "Optional raw script block with speaker labels like 'ARGENT: ...' or 'JUNIPER: ...'.",
    }),
  ),
  dialogue: Type.Optional(
    Type.Array(PlanDialogueLineSchema, {
      minItems: 1,
      description:
        "Optional pre-structured dialogue lines. Use this OR script. If both are passed, dialogue is used.",
    }),
  ),
  personas: Type.Array(PlanPersonaSchema, {
    minItems: 1,
    maxItems: 3,
    description: "One to three speaking personas.",
  }),
  default_voice_id: Type.Optional(
    Type.String({
      description: "Fallback voice ID when a script speaker cannot be mapped.",
    }),
  ),
  model_id: Type.Optional(Type.String()),
  output_format: Type.Optional(Type.String()),
  stability: Type.Optional(Type.Number()),
  seed: Type.Optional(Type.Number()),
  music: Type.Optional(PlanMusicSchema),
  publish: Type.Optional(PlanPublishSchema),
  publish_time_local: Type.Optional(
    Type.String({
      description: "Desired publish time, local (for example 08:00).",
    }),
  ),
  timezone: Type.Optional(
    Type.String({
      description: "IANA timezone (for example America/Chicago).",
    }),
  ),
});

type Persona = {
  id: string;
  voiceId: string;
  aliases: string[];
};

type PlannedDialogueLine = {
  text: string;
  persona?: string;
  voice_id: string;
};

type SpeakerMatch = {
  personaId: string;
  voiceId: string;
};

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseBooleanLike(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
    if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  }
  return defaultValue;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function parsePersonas(params: Record<string, unknown>): Persona[] {
  const raw = params.personas;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("personas required");
  }
  if (raw.length > 3) {
    throw new Error("personas supports a maximum of 3 entries");
  }

  const personas: Persona[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object") {
      throw new Error(`personas[${i}] must be an object`);
    }
    const p = entry as Record<string, unknown>;
    const id = typeof p.id === "string" ? p.id.trim() : "";
    const voiceId = typeof p.voice_id === "string" ? p.voice_id.trim() : "";
    if (!id) throw new Error(`personas[${i}].id required`);
    if (!voiceId) throw new Error(`personas[${i}].voice_id required`);
    if (ids.has(id)) throw new Error(`Duplicate persona id: ${id}`);
    ids.add(id);
    const aliases = Array.isArray(p.aliases)
      ? p.aliases
          .filter((a) => typeof a === "string")
          .map((a) => a.trim())
          .filter(Boolean)
      : [];
    personas.push({ id, voiceId, aliases });
  }
  return personas;
}

function buildSpeakerIndex(personas: Persona[]): Map<string, SpeakerMatch> {
  const index = new Map<string, SpeakerMatch>();
  for (const persona of personas) {
    const keys = [persona.id, ...persona.aliases];
    for (const key of keys) {
      const normalized = normalizeKey(key);
      if (!normalized) continue;
      if (!index.has(normalized)) {
        index.set(normalized, { personaId: persona.id, voiceId: persona.voiceId });
      }
    }
  }
  return index;
}

function coerceMusicObject(raw: unknown): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  if (typeof raw !== "object") {
    throw new Error("music must be an object");
  }
  return raw as Record<string, unknown>;
}

function parseStructuredDialogue(params: {
  rawDialogue: unknown;
  speakerIndex: Map<string, SpeakerMatch>;
  defaultVoiceId?: string;
}): { lines: PlannedDialogueLine[]; warnings: string[] } {
  const warnings: string[] = [];
  const lines: PlannedDialogueLine[] = [];
  const raw = params.rawDialogue;

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("dialogue must be a non-empty array");
  }

  for (let i = 0; i < raw.length; i += 1) {
    const line = raw[i];
    if (!line || typeof line !== "object") {
      throw new Error(`dialogue[${i}] must be an object`);
    }
    const rec = line as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    if (!text) throw new Error(`dialogue[${i}].text required`);

    const explicitVoice =
      typeof rec.voice_id === "string" && rec.voice_id.trim() ? rec.voice_id.trim() : undefined;

    const personaRaw =
      typeof rec.persona === "string" && rec.persona.trim() ? rec.persona.trim() : undefined;
    const personaMatch = personaRaw ? params.speakerIndex.get(normalizeKey(personaRaw)) : undefined;

    const voiceId = explicitVoice || personaMatch?.voiceId || params.defaultVoiceId;
    if (!voiceId) {
      throw new Error(
        `dialogue[${i}] missing voice source (set voice_id, persona, or default_voice_id)`,
      );
    }

    if (personaRaw && !personaMatch) {
      warnings.push(`dialogue[${i}] persona "${personaRaw}" not mapped; fallback voice applied`);
    }

    lines.push({
      text,
      persona: personaMatch?.personaId || personaRaw,
      voice_id: voiceId,
    });
  }

  return { lines, warnings };
}

function parseScriptDialogue(params: {
  script: string;
  speakerIndex: Map<string, SpeakerMatch>;
  defaultVoiceId?: string;
}): {
  lines: PlannedDialogueLine[];
  warnings: string[];
  ignoredLines: number;
  speakersDetected: string[];
} {
  const warnings: string[] = [];
  const lines: PlannedDialogueLine[] = [];
  const speakersDetected = new Set<string>();
  let ignoredLines = 0;
  let currentLineIndex = -1;
  let currentSpeakerRaw = "";

  const speakerRegex = /^([A-Za-z0-9][A-Za-z0-9 _-]{0,40})\s*:\s*(.+)$/;
  const rawLines = params.script.split(/\r?\n/);

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      ignoredLines += 1;
      continue;
    }

    const match = speakerRegex.exec(line);
    if (match) {
      const speakerRaw = match[1]!.trim();
      const spokenText = match[2]!.trim();
      if (!spokenText) {
        ignoredLines += 1;
        continue;
      }
      speakersDetected.add(speakerRaw);
      const mapped = params.speakerIndex.get(normalizeKey(speakerRaw));
      const voiceId = mapped?.voiceId || params.defaultVoiceId;
      if (!voiceId) {
        warnings.push(
          `Speaker "${speakerRaw}" has no mapped voice and no default_voice_id; line skipped`,
        );
        ignoredLines += 1;
        currentLineIndex = -1;
        currentSpeakerRaw = "";
        continue;
      }
      lines.push({
        text: spokenText,
        persona: mapped?.personaId,
        voice_id: voiceId,
      });
      currentLineIndex = lines.length - 1;
      currentSpeakerRaw = speakerRaw;
      if (!mapped) {
        warnings.push(`Speaker "${speakerRaw}" is unmapped; fallback voice applied`);
      }
      continue;
    }

    // Continue previous speaker paragraph blocks when script uses multiline prose.
    if (currentLineIndex >= 0) {
      lines[currentLineIndex]!.text = `${lines[currentLineIndex]!.text} ${line}`.trim();
      continue;
    }

    ignoredLines += 1;
    if (!currentSpeakerRaw) {
      warnings.push(`Unattributed script line ignored: "${line.slice(0, 80)}"`);
    }
  }

  if (lines.length === 0) {
    throw new Error("No usable dialogue lines parsed from script");
  }

  return {
    lines,
    warnings,
    ignoredLines,
    speakersDetected: [...speakersDetected],
  };
}

function buildRunbook(params: {
  title: string;
  publishSpotify: boolean;
  publishYouTube: boolean;
  publishHeygen: boolean;
  timezone: string;
  publishTimeLocal: string;
}): Array<Record<string, unknown>> {
  const steps: Array<Record<string, unknown>> = [
    {
      id: "research",
      objective: "Dispatch family/minion agents to gather overnight AI stories and source links.",
      tools: ["sessions_spawn", "sessions_send", "web_search", "web_fetch", "memory_store"],
      output: "Ranked story shortlist with citations and one deep-dive candidate.",
    },
    {
      id: "script",
      objective: "Draft host+cohost script with clear segment timing and ad slot.",
      tools: ["podcast_plan"],
      output: "Normalized dialogue payload for podcast_generate.",
    },
    {
      id: "audio_render",
      objective: "Render one-shot dialogue and apply optional intro/outro/bed mix.",
      tools: ["podcast_generate"],
      output: "Final MP3 in ~/argent/media/podcast.",
    },
  ];

  if (params.publishSpotify) {
    steps.push({
      id: "publish_spotify",
      objective: "Publish episode to Spotify for Creators.",
      method:
        "Use Spotify for Creators web flow (no public upload API endpoint for direct episode publishing).",
      output: "Episode live on Spotify feed.",
    });
  }

  if (params.publishHeygen) {
    steps.push({
      id: "generate_video",
      objective: "Generate headless/avatar video with HeyGen using final podcast audio/script.",
      method:
        "Use HeyGen Video Agent or v2 Video Generation API with avatar_id and script; poll video status until completed.",
      output: "Rendered MP4/WebM video asset.",
    });
  }

  if (params.publishYouTube) {
    steps.push({
      id: "publish_youtube",
      objective: "Upload rendered video to YouTube with metadata and schedule/publish settings.",
      method: "Use YouTube Data API videos.insert (resumable upload recommended for reliability).",
      output: "YouTube video URL and publish confirmation.",
    });
  }

  steps.push({
    id: "ops_log",
    objective: "Store URLs, metrics, and issues in memory/tasks for daily iteration.",
    tools: ["memory_store", "tasks"],
    output: "Postmortem + next episode improvements.",
  });

  steps.push({
    id: "schedule",
    objective: "Target publish time",
    target: `${params.publishTimeLocal} ${params.timezone}`,
  });

  return steps;
}

export function createPodcastPlanTool(): AnyAgentTool {
  return {
    label: "Podcast Plan",
    name: "podcast_plan",
    description: `Plan a full podcast production run and emit a ready-to-use payload for podcast_generate.

Supports:
- Script parsing from SPEAKER: text format
- Persona-to-voice mapping (1-3 personas)
- Direct dialogue normalization
- Daily runbook for research, generation, and publishing (Spotify/HeyGen/YouTube)

Use this before podcast_generate when producing full episodes.`,
    parameters: PodcastPlanSchema,
    execute: async (_toolCallId, args) => {
      try {
        const params = args as Record<string, unknown>;
        const title = readStringParam(params, "title", { required: true });
        const personas = parsePersonas(params);
        const speakerIndex = buildSpeakerIndex(personas);

        const defaultVoiceId = readStringParam(params, "default_voice_id");
        const modelId = readStringParam(params, "model_id") || DEFAULT_MODEL_ID;
        const outputFormat = readStringParam(params, "output_format") || DEFAULT_OUTPUT_FORMAT;
        const stability = clamp(readNumberParam(params, "stability") ?? 0.5, 0, 1);
        const seedRaw = readNumberParam(params, "seed", { integer: true });
        const seed = seedRaw === undefined ? undefined : Math.trunc(seedRaw);
        const music = coerceMusicObject(params.music);

        const publish = (params.publish as Record<string, unknown> | undefined) || {};
        const publishSpotify = parseBooleanLike(publish.spotify, true);
        const publishYouTube = parseBooleanLike(publish.youtube, false);
        const publishHeygen = parseBooleanLike(publish.heygen, false);
        const timezone = readStringParam(params, "timezone") || "America/Chicago";
        const publishTimeLocal = readStringParam(params, "publish_time_local") || "08:00";

        let plannedDialogue: PlannedDialogueLine[] = [];
        const warnings: string[] = [];
        const parseSummary: Record<string, unknown> = {
          source: "dialogue",
          ignoredLines: 0,
          speakersDetected: [],
        };

        if (Array.isArray(params.dialogue) && params.dialogue.length > 0) {
          const parsed = parseStructuredDialogue({
            rawDialogue: params.dialogue,
            speakerIndex,
            defaultVoiceId,
          });
          plannedDialogue = parsed.lines;
          warnings.push(...parsed.warnings);
          parseSummary.source = "dialogue";
        } else {
          const script = readStringParam(params, "script", { required: true });
          const parsed = parseScriptDialogue({
            script,
            speakerIndex,
            defaultVoiceId,
          });
          plannedDialogue = parsed.lines;
          warnings.push(...parsed.warnings);
          parseSummary.source = "script";
          parseSummary.ignoredLines = parsed.ignoredLines;
          parseSummary.speakersDetected = parsed.speakersDetected;
        }

        const podcastGeneratePayload: Record<string, unknown> = {
          title,
          dialogue: plannedDialogue,
          personas: personas.map((p) => ({ id: p.id, voice_id: p.voiceId })),
          model_id: modelId,
          output_format: outputFormat,
          stability,
        };
        if (defaultVoiceId) {
          podcastGeneratePayload.default_voice_id = defaultVoiceId;
        }
        if (seed !== undefined) {
          podcastGeneratePayload.seed = seed;
        }
        if (music) {
          podcastGeneratePayload.music = music;
        }

        const runbook = buildRunbook({
          title,
          publishSpotify,
          publishYouTube,
          publishHeygen,
          timezone,
          publishTimeLocal,
        });

        const automationPrompt = [
          `Produce "${title}" for today.`,
          "1) Dispatch minion/family agents to gather top AI stories with source links.",
          "2) Build concise segment outline + deep-dive + sponsor slot.",
          "3) Call podcast_plan to normalize script/personas.",
          "4) Call podcast_generate to render final MP3 with music mix.",
          publishSpotify
            ? "5) Publish to Spotify for Creators and capture the episode URL."
            : "5) Skip Spotify publishing (disabled).",
          publishHeygen
            ? "6) Generate HeyGen video from script/audio and capture video URL."
            : "6) Skip HeyGen generation (disabled).",
          publishYouTube
            ? "7) Upload video to YouTube and capture watch URL."
            : "7) Skip YouTube upload (disabled).",
          "8) Save links + metrics + blockers into memory/tasks.",
        ].join("\n");

        const result = {
          title,
          parse: {
            ...parseSummary,
            lineCount: plannedDialogue.length,
            warnings,
          },
          podcast_generate: podcastGeneratePayload,
          runbook,
          publish: {
            spotify: publishSpotify,
            youtube: publishYouTube,
            heygen: publishHeygen,
            spotify_show:
              typeof publish.spotify_show === "string" ? publish.spotify_show : undefined,
            youtube_channel:
              typeof publish.youtube_channel === "string" ? publish.youtube_channel : undefined,
          },
          automation: {
            timezone,
            publish_time_local: publishTimeLocal,
            prompt: automationPrompt,
          },
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Podcast planning failed: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  };
}
