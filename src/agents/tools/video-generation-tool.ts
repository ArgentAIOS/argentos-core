/**
 * Video Generation Tool
 *
 * Generates videos using Kling (via PIAPI). Async polling pattern.
 * Returns MEDIA:{path} for dashboard rendering.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { resolveMinimaxApiKey } from "../../agents/minimax-vlm.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { readStringParam, readNumberParam } from "./common.js";

const VideoGenSchema = Type.Object({
  prompt: Type.String({ description: "Description of the video to generate." }),
  provider: Type.Optional(
    Type.Union([Type.Literal("kling"), Type.Literal("minimax")], {
      description: 'Provider: "kling" (PIAPI) or "minimax" (Hailuo 2.3). Auto-selected.',
    }),
  ),
  image: Type.Optional(
    Type.String({ description: "Image path or URL for image-to-video generation." }),
  ),
  duration: Type.Optional(
    Type.Number({ description: "Video duration in seconds (5 or 10, default 5)." }),
  ),
  aspect_ratio: Type.Optional(
    Type.String({ description: 'Aspect ratio, e.g. "16:9", "9:16", "1:1". Default "16:9".' }),
  ),
  mode: Type.Optional(
    Type.Union([Type.Literal("standard"), Type.Literal("professional")], {
      description: 'Generation mode: "standard" (default) or "professional".',
    }),
  ),
});

const HTTP_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 45_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 5_000;
const log = createSubsystemLogger("tools/video-generate");

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveTotalTimeoutMs(): number {
  const raw = process.env.ARGENT_VIDEO_TOOL_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_TOTAL_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 15_000) {
    return DEFAULT_TOTAL_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

function timeoutBudget(remainingMs: number, maxMs: number): number {
  return Math.max(1_000, Math.min(maxMs, remainingMs));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  timeoutLabel: string,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new Error(`${timeoutLabel}: request timed out after ${timeoutMs}ms`, { cause: err });
    }
    throw err;
  }
}

async function generateKling(
  prompt: string,
  apiKey: string,
  opts: {
    image?: string;
    duration?: number;
    aspect_ratio?: string;
    mode?: string;
    overallTimeoutMs?: number;
  },
): Promise<string> {
  // Submit task — duration must be integer (5 or 10), not string
  const input: Record<string, unknown> = {
    prompt,
    duration: opts.duration === 10 ? 10 : 5,
    aspect_ratio: opts.aspect_ratio || "16:9",
    mode: opts.mode === "professional" ? "pro" : "std",
    version: "2.6",
  };

  // If image provided, try to read it or use URL
  if (opts.image) {
    if (opts.image.startsWith("http://") || opts.image.startsWith("https://")) {
      input.image_url = opts.image;
    } else if (fs.existsSync(opts.image)) {
      // Convert local file to base64 data URL
      const buf = fs.readFileSync(opts.image);
      const ext = path.extname(opts.image).slice(1).toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`;
      input.image_url = `data:${mime};base64,${buf.toString("base64")}`;
    }
  }

  const deadlineMs =
    Date.now() + Math.max(15_000, opts.overallTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS);
  const remainingMs = () => Math.max(0, deadlineMs - Date.now());
  const submitRes = await fetchWithTimeout(
    "https://api.piapi.ai/api/v1/task",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model: "kling",
        task_type: "video_generation",
        input,
      }),
    },
    timeoutBudget(remainingMs(), HTTP_TIMEOUT_MS),
    "KLING_SUBMIT_TIMEOUT",
  );

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`Kling task submission failed (${submitRes.status}): ${errText}`);
  }

  const submitJson = (await submitRes.json()) as { data?: { task_id?: string } };
  const taskId = submitJson.data?.task_id;
  if (!taskId) throw new Error("Kling returned no task_id");

  // Poll for completion
  const startTime = Date.now();

  while (remainingMs() > 0) {
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(250, remainingMs())));

    let pollRes: Response;
    try {
      pollRes = await fetchWithTimeout(
        `https://api.piapi.ai/api/v1/task/${taskId}`,
        {
          headers: { "x-api-key": apiKey },
        },
        timeoutBudget(remainingMs(), HTTP_TIMEOUT_MS),
        "KLING_POLL_TIMEOUT",
      );
    } catch {
      continue;
    }

    if (!pollRes.ok) continue;

    // PIAPI response: { code, data: { status, output: { works: [{ video: { resource } }] } } }
    const pollJson = (await pollRes.json()) as {
      data?: {
        status?: string;
        output?: {
          works?: Array<{
            video?: { resource?: string; resource_without_watermark?: string };
          }>;
        };
        error?: { code?: number; message?: string };
      };
    };

    const status = pollJson.data?.status?.toLowerCase();

    if (status === "completed") {
      const work = pollJson.data?.output?.works?.[0];
      const videoUrl = work?.video?.resource_without_watermark || work?.video?.resource;
      if (!videoUrl) throw new Error("Kling completed but returned no video URL in output.works");

      // Download video
      const videoRes = await fetchWithTimeout(
        videoUrl,
        undefined,
        timeoutBudget(remainingMs(), DOWNLOAD_TIMEOUT_MS),
        "KLING_DOWNLOAD_TIMEOUT",
      );
      if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`);

      const buf = Buffer.from(await videoRes.arrayBuffer());
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidgen-"));
      const filePath = path.join(dir, `video-${Date.now()}.mp4`);
      fs.writeFileSync(filePath, buf);
      return filePath;
    }

    if (status === "failed") {
      const errMsg = pollJson.data?.error?.message || "Unknown error";
      throw new Error(`Kling generation failed: ${errMsg}`);
    }

    // Still processing — continue polling
  }

  const elapsedMs = Date.now() - startTime;
  throw new Error(`Video generation timed out after ${elapsedMs}ms`);
}

async function generateMinimax(
  prompt: string,
  apiKey: string,
  opts: {
    image?: string;
    duration?: number;
    aspect_ratio?: string;
    overallTimeoutMs?: number;
  },
): Promise<string> {
  // Choose model based on whether image is provided
  const hasImage = Boolean(opts.image);
  const model = hasImage ? "I2V-01-HD" : "T2V-01-HD";

  const body: Record<string, unknown> = { model, prompt };
  if (opts.duration === 10) body.duration = 10;
  if (opts.aspect_ratio) body.aspect_ratio = opts.aspect_ratio;
  if (opts.image) {
    if (opts.image.startsWith("http://") || opts.image.startsWith("https://")) {
      body.first_frame_image = opts.image;
    } else if (fs.existsSync(opts.image)) {
      const buf = fs.readFileSync(opts.image);
      const ext = path.extname(opts.image).slice(1).toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`;
      body.first_frame_image = `data:${mime};base64,${buf.toString("base64")}`;
    }
  }

  const deadlineMs =
    Date.now() + Math.max(15_000, opts.overallTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS);
  const remainingMs = () => Math.max(0, deadlineMs - Date.now());
  const submitRes = await fetchWithTimeout(
    "https://api.minimax.io/v1/video_generation",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    timeoutBudget(remainingMs(), HTTP_TIMEOUT_MS),
    "MINIMAX_SUBMIT_TIMEOUT",
  );

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`MiniMax video submission failed (${submitRes.status}): ${errText}`);
  }

  const submitJson = (await submitRes.json()) as {
    task_id?: string;
    base_resp?: { status_code?: number; status_msg?: string };
  };
  if (submitJson.base_resp?.status_code && submitJson.base_resp.status_code !== 0) {
    throw new Error(`MiniMax video error: ${submitJson.base_resp.status_msg}`);
  }
  const taskId = submitJson.task_id;
  if (!taskId) throw new Error("MiniMax returned no task_id");

  // Poll for completion
  const startTime = Date.now();

  while (remainingMs() > 0) {
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(250, remainingMs())));

    let pollRes: Response;
    try {
      pollRes = await fetchWithTimeout(
        `https://api.minimax.io/v1/query/video_generation?task_id=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
        timeoutBudget(remainingMs(), HTTP_TIMEOUT_MS),
        "MINIMAX_POLL_TIMEOUT",
      );
    } catch {
      continue;
    }
    if (!pollRes.ok) continue;

    const pollJson = (await pollRes.json()) as {
      status?: string;
      file_id?: string;
      download_url?: string;
      base_resp?: { status_code?: number; status_msg?: string };
    };

    if (pollJson.status === "Success") {
      const videoUrl = pollJson.download_url;
      if (!videoUrl) throw new Error("MiniMax completed but no download URL");
      const videoRes = await fetchWithTimeout(
        videoUrl,
        undefined,
        timeoutBudget(remainingMs(), DOWNLOAD_TIMEOUT_MS),
        "MINIMAX_DOWNLOAD_TIMEOUT",
      );
      if (!videoRes.ok) throw new Error(`Failed to download MiniMax video: ${videoRes.status}`);
      const buf = Buffer.from(await videoRes.arrayBuffer());
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidgen-mm-"));
      const filePath = path.join(dir, `video-${Date.now()}.mp4`);
      fs.writeFileSync(filePath, buf);
      return filePath;
    }

    if (pollJson.status === "Fail") {
      throw new Error(
        `MiniMax video generation failed: ${pollJson.base_resp?.status_msg ?? "unknown error"}`,
      );
    }
  }

  const elapsedMs = Date.now() - startTime;
  throw new Error(`MiniMax video generation timed out after ${elapsedMs}ms`);
}

export function createVideoGenerationTool(): AnyAgentTool {
  return {
    label: "Video Generation",
    name: "video_generate",
    description: `Generate videos from text descriptions or images.

PROVIDERS (auto-selected):
- minimax: MiniMax Hailuo 2.3 — SOTA quality, 1080p, 6-10s (requires MINIMAX_API_KEY)
- kling: Kling 2.6 via PIAPI — text-to-video, image-to-video (requires PIAPI_KLING_API_KEY)

Note: Video generation takes 30-120 seconds. Returns a MEDIA: path.`,
    parameters: VideoGenSchema,
    execute: async (_toolCallId, args) => {
      const startedAt = Date.now();
      const params = args as Record<string, unknown>;
      const prompt = readStringParam(params, "prompt", { required: true });
      const image = readStringParam(params, "image");
      const duration = readNumberParam(params, "duration", { integer: true });
      const aspect_ratio = readStringParam(params, "aspect_ratio");
      const mode = readStringParam(params, "mode") as "standard" | "professional" | undefined;
      const requestedProvider = readStringParam(params, "provider");
      const totalTimeoutMs = resolveTotalTimeoutMs();

      // Auto-select provider based on available keys
      const minimaxKey = resolveMinimaxApiKey();
      const klingKey = process.env.PIAPI_KLING_API_KEY?.trim();

      let provider: "minimax" | "kling";
      if (requestedProvider === "minimax" || requestedProvider === "kling") {
        provider = requestedProvider;
      } else if (minimaxKey) {
        provider = "minimax";
      } else if (klingKey) {
        provider = "kling";
      } else {
        return {
          content: [
            {
              type: "text",
              text: "No video generation API key configured. Set MINIMAX_API_KEY or PIAPI_KLING_API_KEY.",
            },
          ],
          details: { error: "no_api_key" },
        };
      }

      log.info("video_generate start", {
        provider,
        requestedProvider: requestedProvider ?? "auto",
        hasImage: Boolean(image),
        duration,
        aspect_ratio,
        mode,
        totalTimeoutMs,
      });

      try {
        let filePath: string;
        if (provider === "minimax") {
          filePath = await generateMinimax(prompt, minimaxKey!, {
            image,
            duration,
            aspect_ratio,
            overallTimeoutMs: totalTimeoutMs,
          });
        } else {
          filePath = await generateKling(prompt, klingKey!, {
            image,
            duration,
            aspect_ratio,
            mode,
            overallTimeoutMs: totalTimeoutMs,
          });
        }
        log.info("video_generate done", {
          provider,
          durationMs: Date.now() - startedAt,
        });
        return {
          content: [{ type: "text", text: `MEDIA:${filePath}` }],
          details: { path: filePath, provider },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("video_generate failed", {
          provider,
          durationMs: Date.now() - startedAt,
          reason: msg,
        });
        return {
          content: [{ type: "text", text: `Video generation failed (${provider}): ${msg}` }],
          details: { error: msg, provider },
        };
      }
    },
  };
}
