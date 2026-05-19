/**
 * Audio/Sound Generation Tool
 *
 * Generates sound effects using ElevenLabs or FAL audio models.
 * NOT for TTS — use the `tts` tool for text-to-speech.
 * Returns MEDIA:{path} for dashboard rendering.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { readStringParam, readNumberParam } from "./common.js";

const AudioGenSchema = Type.Object({
  prompt: Type.String({
    description:
      "Description of the sound effect or audio to generate (e.g. 'rain on a tin roof', 'dramatic orchestral hit').",
  }),
  provider: Type.Optional(
    Type.Union([Type.Literal("elevenlabs"), Type.Literal("fal")], {
      description: 'Provider: "elevenlabs" (default) or "fal".',
    }),
  ),
  duration: Type.Optional(
    Type.Number({ description: "Duration in seconds (max 22 for ElevenLabs). Optional." }),
  ),
});

type Provider = "elevenlabs" | "fal";

function resolveProvider(params: {
  requested?: string;
  agentSessionKey?: string;
  config?: ArgentConfig;
}): { provider: Provider; apiKey: string } | null {
  const order: { provider: Provider; envKey: string }[] = [
    { provider: "elevenlabs", envKey: "ELEVENLABS_API_KEY" },
    { provider: "fal", envKey: "FAL_API_KEY" },
  ];

  if (params.requested) {
    const match = order.find((o) => o.provider === params.requested);
    if (match) {
      const key = resolveServiceKey(match.envKey, params.config, {
        sessionKey: params.agentSessionKey,
        source: "audio_generate",
      });
      if (key) return { provider: match.provider, apiKey: key };
      return null;
    }
    return null;
  }

  for (const entry of order) {
    const key = resolveServiceKey(entry.envKey, params.config, {
      sessionKey: params.agentSessionKey,
      source: "audio_generate",
    });
    if (key) return { provider: entry.provider, apiKey: key };
  }
  return null;
}

async function generateElevenLabs(
  prompt: string,
  apiKey: string,
  opts: { duration?: number },
): Promise<string> {
  const body: Record<string, unknown> = { text: prompt };
  if (opts.duration) body.duration_seconds = Math.min(opts.duration, 22);

  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs sound generation failed (${res.status}): ${errText}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audiogen-"));
  const filePath = path.join(dir, `audio-${Date.now()}.mp3`);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

async function generateFal(
  prompt: string,
  apiKey: string,
  opts: { duration?: number },
): Promise<string> {
  const body: Record<string, unknown> = {
    prompt,
    seconds_total: opts.duration || 10,
  };

  const res = await fetch("https://fal.run/fal-ai/stable-audio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`FAL audio generation failed (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as { audio_file?: { url?: string } };
  const audioUrl = json.audio_file?.url;
  if (!audioUrl) throw new Error("FAL returned no audio URL");

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Failed to download FAL audio: ${audioRes.status}`);

  const buf = Buffer.from(await audioRes.arrayBuffer());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audiogen-"));
  const filePath = path.join(dir, `audio-${Date.now()}.mp3`);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

export function createAudioGenerationTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  return {
    label: "Audio Generation",
    name: "audio_generate",
    description: `Generate sound effects and audio from text descriptions.

NOT for text-to-speech — use the "tts" tool for that.

PROVIDERS (auto-selected if not specified):
- elevenlabs (default): Sound effects (rain, explosions, ambient)
- fal: Stable Audio — music and soundscapes

Returns a MEDIA: path. Copy the MEDIA line exactly into your response.`,
    parameters: AudioGenSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const prompt = readStringParam(params, "prompt", { required: true });
      const provider = readStringParam(params, "provider") as Provider | undefined;
      const duration = readNumberParam(params, "duration");

      const resolved = resolveProvider({
        requested: provider,
        agentSessionKey: options?.agentSessionKey,
        config: options?.config,
      });
      if (!resolved) {
        return {
          content: [
            {
              type: "text",
              text: provider
                ? `No API key found for provider "${provider}".`
                : "No audio generation API keys available. Set ELEVENLABS_API_KEY or FAL_API_KEY.",
            },
          ],
        };
      }

      try {
        let filePath: string;

        switch (resolved.provider) {
          case "elevenlabs":
            filePath = await generateElevenLabs(prompt, resolved.apiKey, { duration });
            break;
          case "fal":
            filePath = await generateFal(prompt, resolved.apiKey, { duration });
            break;
        }

        return {
          content: [{ type: "text", text: `MEDIA:${filePath}` }],
          details: { path: filePath, provider: resolved.provider },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text", text: `Audio generation failed (${resolved.provider}): ${msg}` },
          ],
          details: { error: msg, provider: resolved.provider },
        };
      }
    },
  };
}
