/**
 * Audio Alert Tool
 *
 * Generates and delivers an audio alert to the operator via the dashboard.
 * For reminders, cron jobs, urgent notifications, and proactive alerts.
 * Pre-renders audio with ElevenLabs v3 for instant playback.
 * Returns MEDIA:{path} + [ALERT:title] markers for dashboard rendering.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import os from "node:os";
import type { ArgentConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { readStringParam } from "./common.js";

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

const AudioAlertSchema = Type.Object({
  message: Type.String({
    description:
      "The spoken alert text. Supports ElevenLabs v3 audio tags like [urgent], [excited], [whisper] for expressive delivery.",
  }),
  urgency: Type.Optional(
    Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("urgent")], {
      description:
        'Alert urgency level: "info" (default), "warning", or "urgent". Controls dashboard toast style.',
    }),
  ),
  title: Type.Optional(
    Type.String({
      description:
        "Short title for the dashboard alert toast. Defaults to first 60 chars of message.",
    }),
  ),
  voice: Type.Optional(
    Type.String({
      description:
        'Voice name (jessica, lily, aria, sarah, charlie, george, rachel, adam, sam, josh) or ElevenLabs voice ID. Default: "jessica".',
    }),
  ),
  mood: Type.Optional(
    Type.String({
      description:
        'Mood hint that adjusts voice settings. "urgent" = low stability (more expressive), "calm" = high stability, default = balanced.',
    }),
  ),
});

export function extractAudioAlertToolText(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("content" in result)) {
    return undefined;
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textBlock = content.find(
    (item) =>
      item &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
  ) as { text?: string } | undefined;
  return textBlock?.text?.trim() || undefined;
}

export function buildInjectedAudioAlertMessage(params: {
  toolText?: string;
  title: string;
  summaryText: string;
  urgency?: "info" | "warning" | "urgent";
}) {
  const summaryText = params.summaryText.trim() || params.title.trim();
  const markerLines =
    typeof params.toolText === "string"
      ? params.toolText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(
            (line) =>
              /^\[(?:ALERT|ALERT_WARN|ALERT_URGENT):[^\]]+\]$/i.test(line) ||
              /^MEDIA:[^\s]+/i.test(line),
          )
      : [];

  if (markerLines.length > 0) {
    return [...markerLines, summaryText].join("\n");
  }

  const marker =
    params.urgency === "urgent"
      ? `[ALERT_URGENT:${params.title}]`
      : params.urgency === "warning"
        ? `[ALERT_WARN:${params.title}]`
        : `[ALERT:${params.title}]`;
  return `${marker}\n${summaryText}`;
}

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
  return voice;
}

/** Map mood to stability value. */
function moodToStability(mood?: string): number {
  if (!mood) return 0.5;
  const m = mood.toLowerCase().trim();
  if (m === "urgent" || m === "excited" || m === "dramatic") return 0.0;
  if (m === "calm" || m === "soothing" || m === "gentle") return 1.0;
  if (m === "warning" || m === "serious") return 0.25;
  return 0.5;
}

/** Sanitize a string for use in a filename. */
function sanitizeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function callElevenLabsTTS(opts: {
  text: string;
  voiceId: string;
  modelId: string;
  apiKey: string;
  stability: number;
}): Promise<{ ok: true; buffer: Buffer } | { ok: false; status: number; error: string }> {
  const isV3 = opts.modelId === "eleven_v3";
  const stability = isV3 ? snapStabilityForV3(opts.stability) : opts.stability;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}?output_format=mp3_44100_128`,
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
          style: 0,
          speed: 1.0,
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

export function createAudioAlertTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  return {
    label: "Audio Alert",
    name: "audio_alert",
    description: `Generate and deliver an audio alert to the operator via the dashboard.

Use for reminders, cron job notifications, scheduled nudges, urgent events, and proactive alerts.
Pre-renders audio with ElevenLabs for instant playback — the dashboard auto-plays it.

The tool emits [ALERT:title] + MEDIA:{path} markers. Copy them exactly into your response.

VOICES: jessica (default), lily, aria, sarah, charlie, george, rachel, adam, sam, josh — or pass a raw ElevenLabs voice ID.
URGENCY: "info" (default), "warning", "urgent" — controls toast style in dashboard.
MOOD: "urgent"/"excited" = expressive, "calm"/"gentle" = steady, default = balanced.`,
    parameters: AudioAlertSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const message = readStringParam(params, "message", { required: true });
      const urgency = (readStringParam(params, "urgency") || "info") as
        | "info"
        | "warning"
        | "urgent";
      const title = readStringParam(params, "title") || message.slice(0, 60);
      const voice = readStringParam(params, "voice");
      const mood = readStringParam(params, "mood");

      const apiKey =
        resolveServiceKey("ELEVENLABS_API_KEY", options?.config, {
          sessionKey: options?.agentSessionKey,
          source: "audio_alert",
        }) ||
        resolveServiceKey("XI_API_KEY", options?.config, {
          sessionKey: options?.agentSessionKey,
          source: "audio_alert",
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
      const stability = moodToStability(mood);

      // Build output path in /tmp for ephemeral alert audio
      const timestamp = Date.now();
      const slug = sanitizeSlug(title);
      const filePath = `${os.tmpdir()}/argent-alert-${timestamp}-${slug}.mp3`;

      // Try v3 first, fallback to turbo v2.5
      const models = [DEFAULT_MODEL, FALLBACK_MODEL];
      let lastError = "";

      for (const modelId of models) {
        try {
          const result = await callElevenLabsTTS({
            text: message,
            voiceId,
            modelId,
            apiKey,
            stability,
          });

          if (result.ok) {
            fs.writeFileSync(filePath, result.buffer);

            // Schedule cleanup after 2 minutes
            setTimeout(() => {
              try {
                fs.unlinkSync(filePath);
              } catch {}
            }, 120_000);

            // Build alert marker based on urgency
            const alertMarker =
              urgency === "urgent"
                ? `[ALERT_URGENT:${title}]`
                : urgency === "warning"
                  ? `[ALERT_WARN:${title}]`
                  : `[ALERT:${title}]`;

            return {
              content: [
                {
                  type: "text",
                  text: `${alertMarker}\nMEDIA:${filePath}\nAudio alert delivered: ${title}`,
                },
              ],
              details: {
                path: filePath,
                model: modelId,
                voice: voice || DEFAULT_VOICE,
                voiceId,
                urgency,
                title,
                sizeBytes: result.buffer.length,
              },
            };
          }

          lastError = `${modelId} failed (${result.status}): ${result.error}`;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }

      // TTS failed — still emit alert marker (visual-only fallback)
      const alertMarker =
        urgency === "urgent"
          ? `[ALERT_URGENT:${title}]`
          : urgency === "warning"
            ? `[ALERT_WARN:${title}]`
            : `[ALERT:${title}]`;

      return {
        content: [
          {
            type: "text",
            text: `${alertMarker}\nAudio generation failed (visual alert only): ${lastError}`,
          },
        ],
        details: { error: lastError, urgency, title },
      };
    },
  };
}
