/**
 * Podcast Generation Tool
 *
 * One-shot multi-persona dialogue generation via ElevenLabs Text-to-Dialogue,
 * plus optional FFmpeg post-mix for music overlays (intro/outro/bed).
 */

import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ArgentConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { resolveServiceKeyAsync } from "../../infra/service-keys.js";
import { readNumberParam, readStringParam } from "./common.js";

const execFileAsync = promisify(execFile);

const DEFAULT_MODEL_ID = "eleven_v3";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_192";

const DialogueLineSchema = Type.Object({
  text: Type.String({
    description:
      "Dialogue line text. Supports Eleven v3 expressive tags like [excited], [whispers], [laughs], [pause].",
  }),
  voice_id: Type.Optional(
    Type.String({
      description:
        "ElevenLabs voice ID for this line. Optional if persona is set and mapped in personas.",
    }),
  ),
  persona: Type.Optional(
    Type.String({
      description:
        "Persona key for this line (for example: 'argent', 'juniper'). Optional if voice_id is set.",
    }),
  ),
});

const PersonaSchema = Type.Object({
  id: Type.String({
    description: "Persona key (for example: 'argent', 'juniper', 'host').",
  }),
  voice_id: Type.String({
    description: "ElevenLabs voice ID for this persona.",
  }),
});

const MusicSchema = Type.Object({
  intro_path: Type.Optional(
    Type.String({
      description: "Path to intro music/effect file to prepend before dialogue.",
    }),
  ),
  outro_path: Type.Optional(
    Type.String({
      description: "Path to outro music/effect file to append after dialogue.",
    }),
  ),
  bed_path: Type.Optional(
    Type.String({
      description: "Path to background music bed to mix underneath the generated dialogue.",
    }),
  ),
  intro_volume: Type.Optional(
    Type.Number({
      description: "Intro gain multiplier. Default: 1.0",
    }),
  ),
  outro_volume: Type.Optional(
    Type.Number({
      description: "Outro gain multiplier. Default: 1.0",
    }),
  ),
  bed_volume: Type.Optional(
    Type.Number({
      description: "Music bed gain multiplier. Default: 0.16",
    }),
  ),
  ducking: Type.Optional(
    Type.Boolean({
      description:
        "When true, background bed is ducked under dialogue via sidechain compression. Default: true.",
    }),
  ),
});

const PodcastGenerateSchema = Type.Object({
  dialogue: Type.Array(DialogueLineSchema, {
    minItems: 1,
    description:
      "Ordered dialogue lines for one-shot generation. Can represent one, two, or three personas.",
  }),
  personas: Type.Optional(
    Type.Array(PersonaSchema, {
      maxItems: 3,
      description:
        "Optional persona-to-voice map (1-3 personas). Use with dialogue[].persona for cleaner scripts.",
    }),
  ),
  default_voice_id: Type.Optional(
    Type.String({
      description:
        "Fallback ElevenLabs voice ID used when a dialogue line does not specify voice_id or persona.",
    }),
  ),
  title: Type.Optional(
    Type.String({
      description: "Episode/file title used for output filename.",
    }),
  ),
  model_id: Type.Optional(
    Type.String({
      description: `ElevenLabs model ID. Default: ${DEFAULT_MODEL_ID}.`,
    }),
  ),
  output_format: Type.Optional(
    Type.String({
      description: `Audio output format for ElevenLabs dialogue render. Default: ${DEFAULT_OUTPUT_FORMAT}.`,
    }),
  ),
  stability: Type.Optional(
    Type.Number({
      description: "Dialogue stability 0.0-1.0. Default: 0.5.",
    }),
  ),
  seed: Type.Optional(
    Type.Number({
      description: "Optional deterministic seed for more consistent reruns.",
    }),
  ),
  output_dir: Type.Optional(
    Type.String({
      description:
        "Optional output directory. Default: ~/argent/media/podcast. Relative paths resolve from current working directory.",
    }),
  ),
  music: Type.Optional(MusicSchema),
});

type ElevenDialogueInput = {
  text: string;
  voice_id: string;
};

type ParsedMusicOptions = {
  introPath?: string;
  outroPath?: string;
  bedPath?: string;
  introVolume: number;
  outroVolume: number;
  bedVolume: number;
  ducking: boolean;
};

function sanitizeFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function boolFromUnknown(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const lower = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(lower)) return true;
    if (["0", "false", "no", "off"].includes(lower)) return false;
  }
  return fallback;
}

function resolvePath(rawPath: string): string {
  const abs = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Audio path not found: ${abs}`);
  }
  return abs;
}

function resolveOutputDirectory(raw?: string): string {
  const outDir = raw
    ? path.resolve(raw)
    : path.join(process.env.HOME || os.homedir(), "argent", "media", "podcast");
  fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

function extensionForOutputFormat(outputFormat: string): string {
  if (outputFormat.startsWith("mp3_")) return ".mp3";
  if (outputFormat.startsWith("opus_")) return ".opus";
  if (outputFormat.startsWith("pcm_")) return ".pcm";
  return ".audio";
}

function parsePersonaMap(rawPersonas: unknown): Map<string, string> {
  const personaMap = new Map<string, string>();
  if (rawPersonas === undefined) return personaMap;
  if (!Array.isArray(rawPersonas)) {
    throw new Error("personas must be an array when provided");
  }
  if (rawPersonas.length > 3) {
    throw new Error("personas supports a maximum of 3 entries");
  }
  for (const entry of rawPersonas) {
    if (!entry || typeof entry !== "object") {
      throw new Error("personas entries must be objects");
    }
    const persona = entry as Record<string, unknown>;
    const id = typeof persona.id === "string" ? persona.id.trim() : "";
    const voiceId = typeof persona.voice_id === "string" ? persona.voice_id.trim() : "";
    if (!id) throw new Error("personas[].id required");
    if (!voiceId) throw new Error(`personas[${id}].voice_id required`);
    if (personaMap.has(id)) throw new Error(`Duplicate persona id: ${id}`);
    personaMap.set(id, voiceId);
  }
  return personaMap;
}

function parseDialogueInputs(params: Record<string, unknown>): {
  inputs: ElevenDialogueInput[];
  personaIdsUsed: string[];
} {
  const rawDialogue = params.dialogue;
  if (!Array.isArray(rawDialogue) || rawDialogue.length === 0) {
    throw new Error("dialogue must contain at least one line");
  }

  const personaMap = parsePersonaMap(params.personas);
  const defaultVoiceId = readStringParam(params, "default_voice_id");
  const inputs: ElevenDialogueInput[] = [];
  const personaIdsUsed = new Set<string>();

  for (let idx = 0; idx < rawDialogue.length; idx += 1) {
    const line = rawDialogue[idx];
    if (!line || typeof line !== "object") {
      throw new Error(`dialogue[${idx}] must be an object`);
    }
    const record = line as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) {
      throw new Error(`dialogue[${idx}].text required`);
    }

    let voiceId =
      typeof record.voice_id === "string" && record.voice_id.trim()
        ? record.voice_id.trim()
        : undefined;

    if (!voiceId && typeof record.persona === "string" && record.persona.trim()) {
      const personaId = record.persona.trim();
      voiceId = personaMap.get(personaId);
      if (!voiceId) {
        throw new Error(`dialogue[${idx}] references unknown persona: ${personaId}`);
      }
      personaIdsUsed.add(personaId);
    }

    if (!voiceId && defaultVoiceId) {
      voiceId = defaultVoiceId;
    }

    if (!voiceId) {
      throw new Error(
        `dialogue[${idx}] missing voice source (set voice_id, persona, or default_voice_id)`,
      );
    }

    inputs.push({ text, voice_id: voiceId });
  }

  return { inputs, personaIdsUsed: [...personaIdsUsed] };
}

function parseMusicOptions(params: Record<string, unknown>): ParsedMusicOptions | undefined {
  const rawMusic = params.music;
  if (!rawMusic) return undefined;
  if (typeof rawMusic !== "object") {
    throw new Error("music must be an object when provided");
  }

  const m = rawMusic as Record<string, unknown>;
  const introPath =
    typeof m.intro_path === "string" && m.intro_path.trim() ? resolvePath(m.intro_path) : undefined;
  const outroPath =
    typeof m.outro_path === "string" && m.outro_path.trim() ? resolvePath(m.outro_path) : undefined;
  const bedPath =
    typeof m.bed_path === "string" && m.bed_path.trim() ? resolvePath(m.bed_path) : undefined;

  if (!introPath && !outroPath && !bedPath) return undefined;

  const introVolume = clamp(typeof m.intro_volume === "number" ? m.intro_volume : 1.0, 0, 4);
  const outroVolume = clamp(typeof m.outro_volume === "number" ? m.outro_volume : 1.0, 0, 4);
  const bedVolume = clamp(typeof m.bed_volume === "number" ? m.bed_volume : 0.16, 0, 1.5);
  const ducking = boolFromUnknown(m.ducking, true);

  return {
    introPath,
    outroPath,
    bedPath,
    introVolume,
    outroVolume,
    bedVolume,
    ducking,
  };
}

async function callTextToDialogue(params: {
  apiKey: string;
  inputs: ElevenDialogueInput[];
  modelId: string;
  outputFormat: string;
  stability: number;
  seed?: number;
}): Promise<Buffer> {
  const url = `https://api.elevenlabs.io/v1/text-to-dialogue?output_format=${encodeURIComponent(params.outputFormat)}`;
  const body: Record<string, unknown> = {
    inputs: params.inputs,
    model_id: params.modelId,
    settings: {
      stability: params.stability,
    },
  };
  if (params.seed !== undefined) {
    body.seed = params.seed;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": params.apiKey,
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs dialogue failed (${res.status}): ${err}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function ensureFfmpeg(): Promise<void> {
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 12_000 });
  } catch {
    throw new Error("FFmpeg not found on PATH. Install ffmpeg to enable podcast music mixing.");
  }
}

async function concatAudio(params: {
  firstPath: string;
  secondPath: string;
  outPath: string;
  firstVolume: number;
  secondVolume: number;
}): Promise<void> {
  const filter = `[0:a]volume=${params.firstVolume}[a0];[1:a]volume=${params.secondVolume}[a1];[a0][a1]concat=n=2:v=0:a=1[out]`;
  await execFileAsync(
    "ffmpeg",
    [
      "-i",
      params.firstPath,
      "-i",
      params.secondPath,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-ar",
      "44100",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-y",
      params.outPath,
    ],
    { timeout: 240_000 },
  );
}

async function mixBedTrack(params: {
  dialoguePath: string;
  bedPath: string;
  outPath: string;
  bedVolume: number;
  ducking: boolean;
}): Promise<void> {
  const filter = params.ducking
    ? `[1:a]volume=${params.bedVolume}[bed];[bed][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[ducked];[0:a][ducked]amix=inputs=2:duration=first:normalize=0[mix];[mix]alimiter=limit=0.95[out]`
    : `[1:a]volume=${params.bedVolume}[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0[mix];[mix]alimiter=limit=0.95[out]`;
  await execFileAsync(
    "ffmpeg",
    [
      "-i",
      params.dialoguePath,
      "-stream_loop",
      "-1",
      "-i",
      params.bedPath,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-ar",
      "44100",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-y",
      params.outPath,
    ],
    { timeout: 300_000 },
  );
}

async function mixMusicLayers(params: {
  dialoguePath: string;
  finalPath: string;
  music: ParsedMusicOptions;
}): Promise<{ finalPath: string; stages: string[] }> {
  await ensureFfmpeg();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-podcast-mix-"));
  const stages: string[] = [];
  let workingPath = params.dialoguePath;

  try {
    if (params.music.introPath) {
      const introPath = path.join(tmpDir, "step-intro.mp3");
      await concatAudio({
        firstPath: params.music.introPath,
        secondPath: workingPath,
        outPath: introPath,
        firstVolume: params.music.introVolume,
        secondVolume: 1.0,
      });
      workingPath = introPath;
      stages.push("intro");
    }

    if (params.music.outroPath) {
      const outroPath = path.join(tmpDir, "step-outro.mp3");
      await concatAudio({
        firstPath: workingPath,
        secondPath: params.music.outroPath,
        outPath: outroPath,
        firstVolume: 1.0,
        secondVolume: params.music.outroVolume,
      });
      workingPath = outroPath;
      stages.push("outro");
    }

    if (params.music.bedPath) {
      const bedMixedPath = path.join(tmpDir, "step-bed.mp3");
      await mixBedTrack({
        dialoguePath: workingPath,
        bedPath: params.music.bedPath,
        outPath: bedMixedPath,
        bedVolume: params.music.bedVolume,
        ducking: params.music.ducking,
      });
      workingPath = bedMixedPath;
      stages.push(params.music.ducking ? "bed_ducked" : "bed");
    }

    if (workingPath !== params.finalPath) {
      fs.copyFileSync(workingPath, params.finalPath);
    }

    return { finalPath: params.finalPath, stages };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function createPodcastGenerateTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  return {
    label: "Podcast Generate",
    name: "podcast_generate",
    description: `Generate a full multi-persona podcast dialogue in one ElevenLabs Text-to-Dialogue call.

Designed for one, two, or three speaking personas.
Pass dialogue[] lines with either voice_id per line, or persona + personas[] mapping.

Optional post-mix stage:
- intro_path: prepend intro music/SFX
- outro_path: append outro music/SFX
- bed_path: mix background bed under dialogue
- ducking: auto-duck bed under spoken dialogue (default on)

This tool does NOT stitch per-line TTS clips; it renders dialogue in one shot, then applies optional FFmpeg music layering.

Returns MEDIA:{path} for playback/publishing.`,
    parameters: PodcastGenerateSchema,
    execute: async (_toolCallId, args) => {
      try {
        const params = args as Record<string, unknown>;
        const { inputs, personaIdsUsed } = parseDialogueInputs(params);
        const modelId = readStringParam(params, "model_id") || DEFAULT_MODEL_ID;
        const outputFormat = readStringParam(params, "output_format") || DEFAULT_OUTPUT_FORMAT;
        const title = readStringParam(params, "title") || "podcast-episode";
        const outputDir = resolveOutputDirectory(readStringParam(params, "output_dir"));
        const stability = clamp(readNumberParam(params, "stability") ?? 0.5, 0, 1);
        const seedParam = readNumberParam(params, "seed", { integer: true });
        const seed = seedParam === undefined ? undefined : Math.trunc(seedParam);
        const music = parseMusicOptions(params);

        const apiKey =
          (await resolveServiceKeyAsync("ELEVENLABS_API_KEY", options?.config, {
            sessionKey: options?.agentSessionKey,
            source: "podcast_generate",
          })) ||
          (await resolveServiceKeyAsync("XI_API_KEY", options?.config, {
            sessionKey: options?.agentSessionKey,
            source: "podcast_generate",
          }));
        if (!apiKey) {
          return {
            content: [
              {
                type: "text",
                text: "No ElevenLabs API key found. Add ELEVENLABS_API_KEY (or XI_API_KEY) in Settings > API Keys.",
              },
            ],
          };
        }

        if (music && !outputFormat.startsWith("mp3_")) {
          return {
            content: [
              {
                type: "text",
                text: "Music mixing currently requires an mp3 output_format (for example mp3_44100_192).",
              },
            ],
          };
        }

        const slug = sanitizeFilename(title || "podcast");
        const stamp = Date.now();
        const rawExtension = extensionForOutputFormat(outputFormat);
        const rawPath = path.join(outputDir, `${stamp}-${slug}-dialogue${rawExtension}`);
        const finalPath = music ? path.join(outputDir, `${stamp}-${slug}-mixed.mp3`) : rawPath;

        const audio = await callTextToDialogue({
          apiKey,
          inputs,
          modelId,
          outputFormat,
          stability,
          seed,
        });
        fs.writeFileSync(rawPath, audio);

        let mixedStages: string[] = [];
        let outputPath = rawPath;
        if (music) {
          const mix = await mixMusicLayers({
            dialoguePath: rawPath,
            finalPath,
            music,
          });
          outputPath = mix.finalPath;
          mixedStages = mix.stages;
        }

        return {
          content: [{ type: "text", text: `MEDIA:${outputPath}` }],
          details: {
            path: outputPath,
            rawPath,
            modelId,
            outputFormat,
            stability,
            seed,
            lineCount: inputs.length,
            personaCount: new Set(inputs.map((line) => line.voice_id)).size,
            personaIdsUsed,
            mixedStages,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Podcast generation failed: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  };
}
