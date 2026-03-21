/**
 * TTS Generation Tool
 *
 * Generates high-quality speech audio files using ElevenLabs v3 API.
 * For podcasts, narration, audio messages, and long-form audio content.
 * Supports v3 audio tags for expressive delivery.
 * Returns MEDIA:{path} for dashboard playback.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { readStringParam, readNumberParam } from "./common.js";

/** Built-in voice map: name → ElevenLabs voice ID */
const VOICE_MAP: Record<string, string> = {
  jessica: "cgSgspJ2msm6clMCkdW9",
  lily: "pFZP5JQG7iQjIQuC4Bku",
  aria: "9BWtsMINqrJLrRacOk9x",
  sarah: "EXAVITQu4vr4xnSDxMaL",
  charlie: "IKne3meq5aSn9XLyUdCD",
  george: "JBFqnCBsd6RMkjVDRZzb",
  rachel: "21m00Tcm4TlvDq8ikWAM",
  adam: "pNInz6obpgDQGcFmaJgB",
  sam: "yoZ06aMxZJJ28mfd3POQ",
  josh: "TxGEqnHWrfWFTfGW9XjX",
};

const DEFAULT_VOICE = "jessica";
const DEFAULT_MODEL = "eleven_v3";
const FALLBACK_MODEL = "eleven_turbo_v2_5";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

const TtsGenerateSchema = Type.Object({
  text: Type.String({
    description:
      "The text to convert to speech. Supports ElevenLabs v3 audio tags in [square brackets] for expressive delivery. " +
      "Examples: [excited] Oh wow! [laughs], [whispers] Don't tell anyone [pause] but I know a secret. " +
      "Key tag categories: Emotions ([happy], [nervous], [nostalgic], [mischievous]), " +
      "Delivery ([whispers], [shouts], [sarcastic], [commanding], [breathy], [sing-song]), " +
      "Reactions ([laughs], [sighs], [gasps], [clears throat], [crying]), " +
      "Pacing ([pause], [dramatic pause], [rushed], [drawn out], [hesitates], [trails off]), " +
      "Performance ([deadpan delivery], [over the top], [narrator], [voice-over], [podcast host]). " +
      "Use 1-3 tags per segment for best results. Tags are free-form; descriptive phrases also work.",
  }),
  voice: Type.Optional(
    Type.String({
      description:
        "Voice name (jessica, lily, aria, sarah, charlie, george, rachel, adam, sam, josh) or ElevenLabs voice ID. Default: jessica.",
    }),
  ),
  title: Type.Optional(
    Type.String({
      description: "Title for the audio file (used in filename). Default: tts.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "ElevenLabs model ID. Default: eleven_v3 (best quality, audio tag support). Fallback: eleven_turbo_v2_5.",
    }),
  ),
  output_format: Type.Optional(
    Type.String({
      description: 'Output format: "mp3_44100_128" (default), "mp3_44100_192", "pcm_44100".',
    }),
  ),
  stability: Type.Optional(
    Type.Number({
      description:
        "Voice stability 0-1. For v3: snapped to nearest of 0.0, 0.5, or 1.0. Default: 0.5.",
    }),
  ),
  style: Type.Optional(
    Type.Number({
      description: "Style exaggeration 0-1. Default: 0.",
    }),
  ),
  speed: Type.Optional(
    Type.Number({
      description: "Speaking speed 0.5-2.0. Default: 1.0.",
    }),
  ),
});

/** Snap stability to the nearest v3-valid value (0.0, 0.5, or 1.0). */
function snapStabilityForV3(stability: number): number {
  if (stability <= 0.25) return 0.0;
  if (stability >= 0.75) return 1.0;
  return 0.5;
}

/** Resolve a voice name or ID to an ElevenLabs voice ID. */
function resolveVoiceId(voice?: string): string {
  if (!voice) return VOICE_MAP[DEFAULT_VOICE];
  const lower = voice.toLowerCase().trim();
  if (VOICE_MAP[lower]) return VOICE_MAP[lower];
  // Assume it's a raw ElevenLabs voice ID
  return voice;
}

/** Sanitize a string for use in a filename. */
function sanitizeFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Ensure the output directory exists and return the full file path. */
function resolveOutputPath(title?: string): string {
  const workspace = process.env.HOME
    ? path.join(process.env.HOME, "argent", "media", "tts")
    : path.join(os.tmpdir(), "argent-tts");
  fs.mkdirSync(workspace, { recursive: true });

  const timestamp = Date.now();
  const slug = sanitizeFilename(title || "tts");
  return path.join(workspace, `${timestamp}-${slug}.mp3`);
}

async function callElevenLabsTTS(opts: {
  text: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  apiKey: string;
  stability: number;
  style: number;
  speed: number;
}): Promise<{ ok: true; buffer: Buffer } | { ok: false; status: number; error: string }> {
  const isV3 = opts.modelId === "eleven_v3";
  const stability = isV3 ? snapStabilityForV3(opts.stability) : opts.stability;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}?output_format=${opts.outputFormat}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": opts.apiKey,
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: opts.text,
        model_id: opts.modelId,
        voice_settings: {
          stability,
          similarity_boost: 0.75,
          style: opts.style,
          speed: opts.speed,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    return { ok: false, status: res.status, error: errText };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, buffer: buf };
}

export function createTtsGenerateTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  return {
    label: "TTS Generate",
    name: "tts_generate",
    description: `Generate speech audio files using ElevenLabs v3 with full audio tag support.

Use for podcasts, narration, audio messages, expressive audio content, and long-form speech.
Supports v3 audio tags in [square brackets]: [excited], [whispers], [pause], [laughs], etc.
Do NOT use SSML/XML tags (<break>, <emphasis>) — v3 uses bracket-style tags only.
NOT for real-time conversational TTS — use the "tts" tool for that.

VOICES: jessica (default), lily, aria, sarah, charlie, george, rachel, adam, sam, josh — or pass a raw ElevenLabs voice ID.

PODCAST STANDARD: Jessica voice + v3 tags + expressive delivery. Tag generously for podcasts.

Returns a MEDIA: path. Copy the MEDIA line exactly into your response.`,
    parameters: TtsGenerateSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const text = readStringParam(params, "text", { required: true });
      const voice = readStringParam(params, "voice");
      const title = readStringParam(params, "title");
      const model = readStringParam(params, "model");
      const outputFormat = readStringParam(params, "output_format") || DEFAULT_OUTPUT_FORMAT;
      const stability = readNumberParam(params, "stability") ?? 0.5;
      const style = readNumberParam(params, "style") ?? 0;
      const speed = readNumberParam(params, "speed") ?? 1.0;

      const apiKey =
        resolveServiceKey("ELEVENLABS_API_KEY", options?.config, {
          sessionKey: options?.agentSessionKey,
          source: "tts_generate",
        }) ||
        resolveServiceKey("XI_API_KEY", options?.config, {
          sessionKey: options?.agentSessionKey,
          source: "tts_generate",
        });
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "No ElevenLabs API key found. Add one in Dashboard Settings > API Keys, or set ELEVENLABS_API_KEY in your environment.",
            },
          ],
        };
      }

      const voiceId = resolveVoiceId(voice);
      const filePath = resolveOutputPath(title);

      // Try primary model, then fallback
      const models = model ? [model] : [DEFAULT_MODEL, FALLBACK_MODEL];
      let lastError = "";

      for (const modelId of models) {
        try {
          const result = await callElevenLabsTTS({
            text,
            voiceId,
            modelId,
            outputFormat,
            apiKey,
            stability,
            style,
            speed,
          });

          if (result.ok) {
            fs.writeFileSync(filePath, result.buffer);
            return {
              content: [{ type: "text", text: `MEDIA:${filePath}` }],
              details: {
                path: filePath,
                model: modelId,
                voice: voice || DEFAULT_VOICE,
                voiceId,
                sizeBytes: result.buffer.length,
              },
            };
          }

          lastError = `${modelId} failed (${result.status}): ${result.error}`;
          // If user explicitly picked a model, don't fallback
          if (model) break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          if (model) break;
        }
      }

      return {
        content: [{ type: "text", text: `TTS generation failed: ${lastError}` }],
        details: { error: lastError },
      };
    },
  };
}
