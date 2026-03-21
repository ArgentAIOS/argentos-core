/**
 * YouTube Thumbnail Tool
 *
 * Generates thumbnail images tuned for YouTube packaging.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { readStringParam } from "./common.js";

const ThumbnailSchema = Type.Object({
  headline: Type.String({
    description: "Primary thumbnail text/headline.",
  }),
  subheadline: Type.Optional(Type.String()),
  topic: Type.Optional(Type.String()),
  show_name: Type.Optional(Type.String()),
  style: Type.Optional(Type.String()),
  brand_notes: Type.Optional(Type.String()),
  provider: Type.Optional(
    Type.Union([Type.Literal("gemini"), Type.Literal("openai"), Type.Literal("fal")], {
      description: "Image provider override.",
    }),
  ),
  model: Type.Optional(Type.String()),
  aspect_ratio: Type.Optional(
    Type.Union([Type.Literal("16:9"), Type.Literal("1:1"), Type.Literal("9:16")]),
  ),
  size: Type.Optional(Type.String()),
  quality: Type.Optional(Type.Union([Type.Literal("standard"), Type.Literal("hd")])),
  output_dir: Type.Optional(Type.String()),
  custom_prompt: Type.Optional(Type.String()),
});

type Provider = "gemini" | "openai" | "fal";

function resolveOutputDir(raw?: string): string {
  const dir = raw
    ? path.resolve(raw)
    : path.join(process.env.HOME || os.homedir(), "argent", "media", "thumbnails");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function resolveProvider(params: {
  requested?: string;
  config?: ArgentConfig;
  agentSessionKey?: string;
}): { provider: Provider; apiKey: string } | null {
  const order: Array<{ provider: Provider; env: string }> = [
    { provider: "gemini", env: "GOOGLE_GEMINI_API_KEY" },
    { provider: "openai", env: "OPENAI_API_KEY" },
    { provider: "fal", env: "FAL_API_KEY" },
  ];

  if (params.requested) {
    const match = order.find((entry) => entry.provider === params.requested);
    if (!match) return null;
    const key =
      resolveServiceKey(match.env, params.config, {
        sessionKey: params.agentSessionKey,
        source: "youtube_thumbnail_generate",
      }) || process.env[match.env];
    return key ? { provider: match.provider, apiKey: key } : null;
  }

  for (const entry of order) {
    const key =
      resolveServiceKey(entry.env, params.config, {
        sessionKey: params.agentSessionKey,
        source: "youtube_thumbnail_generate",
      }) || process.env[entry.env];
    if (key) return { provider: entry.provider, apiKey: key };
  }
  return null;
}

function buildPrompt(params: {
  headline: string;
  subheadline?: string;
  topic?: string;
  showName?: string;
  style?: string;
  brandNotes?: string;
  customPrompt?: string;
}): string {
  if (params.customPrompt?.trim()) return params.customPrompt.trim();

  const parts = [
    "YouTube thumbnail image, high contrast, ultra clear, professional composition.",
    `Main headline text: "${params.headline}".`,
    params.subheadline ? `Secondary text: "${params.subheadline}".` : "",
    params.topic ? `Topic context: ${params.topic}.` : "",
    params.showName ? `Show branding: ${params.showName}.` : "",
    params.style
      ? `Art direction: ${params.style}.`
      : "Art direction: futuristic newsroom, cinematic lighting, clean background.",
    params.brandNotes ? `Brand notes: ${params.brandNotes}.` : "",
    "Ensure readable typography, strong focal point, 16:9 thumbnail-safe layout.",
    "No watermarks, no logos from other brands, no extra unreadable text.",
  ];
  return parts.filter(Boolean).join(" ");
}

function saveImage(params: {
  buffer: Buffer;
  outputDir: string;
  headline: string;
  ext: string;
}): string {
  const stamp = Date.now();
  const file = `${stamp}-${safeSlug(params.headline || "thumbnail")}.${params.ext}`;
  const filePath = path.join(params.outputDir, file);
  fs.writeFileSync(filePath, params.buffer);
  return filePath;
}

async function generateGemini(params: {
  prompt: string;
  apiKey: string;
  model?: string;
  aspectRatio?: string;
}): Promise<{ buffer: Buffer; ext: string }> {
  const model = params.model || "gemini-2.5-flash-image";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: params.prompt }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      ...(params.aspectRatio
        ? {
            imageGenerationConfig: {
              aspectRatio: params.aspectRatio,
            },
          }
        : {}),
    },
  };

  const res = await fetch(`${url}?key=${params.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini thumbnail generation failed (${res.status}): ${err}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data: string; mimeType: string };
        }>;
      };
    }>;
  };
  const parts = json.candidates?.[0]?.content?.parts || [];
  const image = parts.find((part) => part.inlineData)?.inlineData;
  if (!image?.data) {
    throw new Error("Gemini returned no image data");
  }
  const ext = image.mimeType?.includes("png") ? "png" : "jpg";
  return {
    buffer: Buffer.from(image.data, "base64"),
    ext,
  };
}

async function generateOpenAI(params: {
  prompt: string;
  apiKey: string;
  model?: string;
  size?: string;
  quality?: string;
}): Promise<{ buffer: Buffer; ext: string }> {
  const body: Record<string, unknown> = {
    model: params.model || "dall-e-3",
    prompt: params.prompt,
    response_format: "b64_json",
    n: 1,
    size: params.size || "1792x1024",
    quality: params.quality || "hd",
  };
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI thumbnail generation failed (${res.status}): ${err}`);
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI returned no image data");
  }
  return {
    buffer: Buffer.from(b64, "base64"),
    ext: "png",
  };
}

function falImageSizeForAspect(aspectRatio?: string): string {
  if (aspectRatio === "16:9") return "landscape_16_9";
  if (aspectRatio === "9:16") return "portrait_16_9";
  if (aspectRatio === "1:1") return "square_hd";
  return "landscape_16_9";
}

async function generateFal(params: {
  prompt: string;
  apiKey: string;
  model?: string;
  aspectRatio?: string;
}): Promise<{ buffer: Buffer; ext: string }> {
  const model = params.model || "fal-ai/flux-pro/v1.1";
  const body = {
    prompt: params.prompt,
    image_size: falImageSizeForAspect(params.aspectRatio),
    num_images: 1,
  };
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${params.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FAL thumbnail generation failed (${res.status}): ${err}`);
  }
  const json = (await res.json()) as { images?: Array<{ url?: string }> };
  const imageUrl = json.images?.[0]?.url;
  if (!imageUrl) {
    throw new Error("FAL returned no image URL");
  }
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) {
    throw new Error(`Failed to download FAL image (${imageRes.status})`);
  }
  const ext = imageUrl.includes(".jpg") || imageUrl.includes(".jpeg") ? "jpg" : "png";
  return {
    buffer: Buffer.from(await imageRes.arrayBuffer()),
    ext,
  };
}

export function createYoutubeThumbnailTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  return {
    label: "YouTube Thumbnail",
    name: "youtube_thumbnail_generate",
    description: `Generate a YouTube-ready thumbnail image.

Use this after youtube_metadata_generate to turn thumbnail headline/brief into an image.
Returns MEDIA:{path}.`,
    parameters: ThumbnailSchema,
    execute: async (_toolCallId, args) => {
      try {
        const params = args as Record<string, unknown>;
        const headline = readStringParam(params, "headline", { required: true });
        const subheadline = readStringParam(params, "subheadline");
        const topic = readStringParam(params, "topic");
        const showName = readStringParam(params, "show_name");
        const style = readStringParam(params, "style");
        const brandNotes = readStringParam(params, "brand_notes");
        const customPrompt = readStringParam(params, "custom_prompt");
        const aspectRatio = readStringParam(params, "aspect_ratio") || "16:9";
        const size = readStringParam(params, "size");
        const quality = readStringParam(params, "quality");
        const model = readStringParam(params, "model");
        const requestedProvider = readStringParam(params, "provider");

        const resolved = resolveProvider({
          requested: requestedProvider,
          config: options?.config,
          agentSessionKey: options?.agentSessionKey,
        });
        if (!resolved) {
          return {
            content: [
              {
                type: "text",
                text: requestedProvider
                  ? `No API key found for provider "${requestedProvider}".`
                  : "No image provider key found. Add GOOGLE_GEMINI_API_KEY, OPENAI_API_KEY, or FAL_API_KEY.",
              },
            ],
          };
        }

        const prompt = buildPrompt({
          headline,
          subheadline,
          topic,
          showName,
          style,
          brandNotes,
          customPrompt,
        });
        const outputDir = resolveOutputDir(readStringParam(params, "output_dir"));

        let generated: { buffer: Buffer; ext: string };
        if (resolved.provider === "gemini") {
          generated = await generateGemini({
            prompt,
            apiKey: resolved.apiKey,
            model,
            aspectRatio,
          });
        } else if (resolved.provider === "openai") {
          generated = await generateOpenAI({
            prompt,
            apiKey: resolved.apiKey,
            model,
            size,
            quality,
          });
        } else {
          generated = await generateFal({
            prompt,
            apiKey: resolved.apiKey,
            model,
            aspectRatio,
          });
        }

        const filePath = saveImage({
          buffer: generated.buffer,
          outputDir,
          headline,
          ext: generated.ext,
        });
        return {
          content: [{ type: "text", text: `MEDIA:${filePath}` }],
          details: {
            path: filePath,
            provider: resolved.provider,
            prompt,
            aspect_ratio: aspectRatio,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `YouTube thumbnail generation failed: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  };
}
