/**
 * Image Generation Tool
 *
 * Generates images using Gemini (default), OpenAI DALL-E, or FAL Flux.
 * Returns MEDIA:{path} for dashboard rendering.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { readStringParam } from "./common.js";

const ImageGenSchema = Type.Object({
  prompt: Type.String({ description: "Description of the image to generate." }),
  provider: Type.Optional(
    Type.Union([Type.Literal("gemini"), Type.Literal("openai"), Type.Literal("fal")], {
      description: 'Provider: "gemini" (default), "openai", or "fal".',
    }),
  ),
  size: Type.Optional(
    Type.String({ description: 'Image size, e.g. "1024x1024", "1792x1024". OpenAI only.' }),
  ),
  aspect_ratio: Type.Optional(
    Type.String({ description: 'Aspect ratio, e.g. "1:1", "16:9", "9:16", "4:3". Gemini/FAL.' }),
  ),
  quality: Type.Optional(
    Type.Union([Type.Literal("standard"), Type.Literal("hd")], {
      description: "Quality level. OpenAI only.",
    }),
  ),
  model: Type.Optional(Type.String({ description: "Override specific model name." })),
});

type Provider = "gemini" | "openai" | "fal";

function resolveProvider(
  requested?: string,
  cfg?: Record<string, unknown>,
  sessionKey?: string,
): { provider: Provider; apiKey: string; source: string } | null {
  const order: { provider: Provider; envKeys: string[] }[] = [
    {
      provider: "gemini",
      envKeys: ["GOOGLE_GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"],
    },
    { provider: "openai", envKeys: ["OPENAI_API_KEY"] },
    { provider: "fal", envKeys: ["FAL_API_KEY"] },
  ];

  const resolveKey = (envKey: string): { apiKey: string; source: string } | null => {
    const accessContext = {
      sessionKey,
      source: "image_generate",
    };
    const serviceKey = resolveServiceKey(envKey, cfg, accessContext)?.trim();
    if (serviceKey) {
      return { apiKey: serviceKey, source: `service-keys:${envKey}` };
    }
    const envKeyValue = process.env[envKey]?.trim();
    if (envKeyValue) {
      return { apiKey: envKeyValue, source: `env:${envKey}` };
    }
    return null;
  };

  if (requested) {
    const match = order.find((o) => o.provider === requested);
    if (!match) return null;
    for (const envKey of match.envKeys) {
      const key = resolveKey(envKey);
      if (key) return { provider: match.provider, ...key };
    }
    return null;
  }

  for (const entry of order) {
    for (const envKey of entry.envKeys) {
      const key = resolveKey(envKey);
      if (key) return { provider: entry.provider, ...key };
    }
  }
  return null;
}

function saveTempImage(data: Buffer, ext = "png"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imggen-"));
  const filePath = path.join(dir, `image-${Date.now()}.${ext}`);
  fs.writeFileSync(filePath, data);
  return filePath;
}

async function generateGemini(
  prompt: string,
  apiKey: string,
  opts: { aspect_ratio?: string; model?: string },
): Promise<string> {
  const model = opts.model || "gemini-2.5-flash-image";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const generationConfig: Record<string, unknown> = {
    responseModalities: ["TEXT", "IMAGE"],
  };
  if (opts.aspect_ratio) {
    generationConfig.imageGenerationConfig = { aspectRatio: opts.aspect_ratio };
  }

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig,
  };

  const res = await fetch(`${url}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini image generation failed (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }>;
      };
    }>;
  };

  const parts = json.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error("Gemini returned no content");

  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart?.inlineData) throw new Error("Gemini returned no image data");

  const ext = imagePart.inlineData.mimeType.includes("png") ? "png" : "jpg";
  const buf = Buffer.from(imagePart.inlineData.data, "base64");
  return saveTempImage(buf, ext);
}

async function generateOpenAI(
  prompt: string,
  apiKey: string,
  opts: { size?: string; quality?: string; model?: string },
): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model || "dall-e-3",
    prompt,
    n: 1,
    response_format: "b64_json",
  };
  if (opts.size) body.size = opts.size;
  if (opts.quality) body.quality = opts.quality;

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI image generation failed (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");

  const buf = Buffer.from(b64, "base64");
  return saveTempImage(buf, "png");
}

async function generateFal(
  prompt: string,
  apiKey: string,
  opts: { aspect_ratio?: string; model?: string },
): Promise<string> {
  const model = opts.model || "fal-ai/flux-pro/v1.1";
  const url = `https://fal.run/${model}`;

  let imageSize = "square_hd";
  if (opts.aspect_ratio === "16:9") imageSize = "landscape_16_9";
  else if (opts.aspect_ratio === "9:16") imageSize = "portrait_16_9";
  else if (opts.aspect_ratio === "4:3") imageSize = "landscape_4_3";

  const body = { prompt, image_size: imageSize, num_images: 1 };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`FAL image generation failed (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as { images?: Array<{ url?: string }> };
  const imageUrl = json.images?.[0]?.url;
  if (!imageUrl) throw new Error("FAL returned no image URL");

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to download FAL image: ${imgRes.status}`);

  const buf = Buffer.from(await imgRes.arrayBuffer());
  const ext = imageUrl.includes(".jpg") || imageUrl.includes(".jpeg") ? "jpg" : "png";
  return saveTempImage(buf, ext);
}

export function createImageGenerationTool(): AnyAgentTool {
  return {
    label: "Image Generation",
    name: "image_generate",
    description: `Generate images from text descriptions.

PROVIDERS (auto-selected if not specified):
- gemini (default): Google Gemini — fast, free
- openai: DALL-E 3 — high quality
- fal: Flux Pro — artistic

Returns a MEDIA: path. Copy the MEDIA line exactly into your response.`,
    parameters: ImageGenSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const prompt = readStringParam(params, "prompt", { required: true });
      const provider = readStringParam(params, "provider") as Provider | undefined;
      const size = readStringParam(params, "size");
      const aspect_ratio = readStringParam(params, "aspect_ratio");
      const quality = readStringParam(params, "quality") as "standard" | "hd" | undefined;
      const model = readStringParam(params, "model");

      const resolved = resolveProvider(provider, undefined, _toolCallId);
      if (!resolved) {
        return {
          content: [
            {
              type: "text",
              text: provider
                ? `No API key found for provider "${provider}". Set the appropriate env var.`
                : "No image generation API keys available. Set GOOGLE_GEMINI_API_KEY, GOOGLE_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or FAL_API_KEY.",
            },
          ],
        };
      }

      try {
        let filePath: string;

        switch (resolved.provider) {
          case "gemini":
            filePath = await generateGemini(prompt, resolved.apiKey, { aspect_ratio, model });
            break;
          case "openai":
            filePath = await generateOpenAI(prompt, resolved.apiKey, { size, quality, model });
            break;
          case "fal":
            filePath = await generateFal(prompt, resolved.apiKey, { aspect_ratio, model });
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
            { type: "text", text: `Image generation failed (${resolved.provider}): ${msg}` },
          ],
          details: { error: msg, provider: resolved.provider },
        };
      }
    },
  };
}
