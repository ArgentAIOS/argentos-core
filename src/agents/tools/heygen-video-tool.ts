/**
 * HeyGen Video Tool
 *
 * Supports avatar/voice listing, scene-aware payload generation, status polling,
 * and downloads.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { type AnyAgentTool, jsonResult, readNumberParam, readStringParam } from "./common.js";

const HEYGEN_BASE_URL = "https://api.heygen.com";
const DEFAULT_LIST_MAX_ITEMS = 40;
const MAX_LIST_MAX_ITEMS = 200;
const URL_PREVIEW_MAX_CHARS = 180;

const SceneSchema = Type.Object({
  avatar_id: Type.Optional(Type.String()),
  avatar_style: Type.Optional(Type.String()),
  script: Type.Optional(Type.String()),
  voice_id: Type.Optional(Type.String()),
  audio_url: Type.Optional(Type.String()),
  speed: Type.Optional(Type.Number()),
  background_type: Type.Optional(
    Type.Union([Type.Literal("color"), Type.Literal("image"), Type.Literal("video")]),
  ),
  background_value: Type.Optional(Type.String()),
  background_play_style: Type.Optional(
    Type.Union([Type.Literal("fit_to_scene"), Type.Literal("crop_to_fill")]),
  ),
  character_scale: Type.Optional(Type.Number()),
  character_offset_x: Type.Optional(Type.Number()),
  character_offset_y: Type.Optional(Type.Number()),
  character_matting: Type.Optional(Type.Boolean()),
  character_matting_color: Type.Optional(Type.String()),
});

const HeygenVideoSchema = Type.Object({
  action: Type.Union([
    Type.Literal("list_avatars"),
    Type.Literal("list_voices"),
    Type.Literal("build_payload"),
    Type.Literal("generate_video"),
    Type.Literal("video_status"),
    Type.Literal("download_video"),
  ]),
  // generation
  endpoint: Type.Optional(
    Type.String({
      description:
        "Generation endpoint path. Default: /v2/video/generate. For advanced flows, pass /v1/video_agent/generate with raw_payload.",
    }),
  ),
  raw_payload: Type.Optional(
    Type.Unsafe<Record<string, unknown> | string>({
      description:
        "Optional raw JSON object (or JSON string) sent as the request body for build_payload/generate_video.",
    }),
  ),
  default_avatar_id: Type.Optional(
    Type.String({
      description:
        "Default avatar for payload builder. Falls back to HEYGEN_DEFAULT_AVATAR_ID if omitted.",
    }),
  ),
  avatar_id: Type.Optional(
    Type.String({
      description:
        "HeyGen avatar ID used when generate_video builds payload from simplified params.",
    }),
  ),
  avatar_style: Type.Optional(
    Type.String({
      description: "Avatar style, default: normal.",
    }),
  ),
  script: Type.Optional(
    Type.String({
      description: "Text script for text-to-video voice mode.",
    }),
  ),
  voice_id: Type.Optional(
    Type.String({
      description: "HeyGen voice ID for text voice mode.",
    }),
  ),
  audio_url: Type.Optional(
    Type.String({
      description:
        "Public audio URL for audio-driven voice mode. If provided, voice.type becomes audio.",
    }),
  ),
  speed: Type.Optional(
    Type.Number({
      description: "Voice speed multiplier for text voice mode.",
    }),
  ),
  character_scale: Type.Optional(Type.Number()),
  character_offset_x: Type.Optional(Type.Number()),
  character_offset_y: Type.Optional(Type.Number()),
  character_matting: Type.Optional(Type.Boolean()),
  character_matting_color: Type.Optional(Type.String()),
  scenes: Type.Optional(
    Type.Array(SceneSchema, {
      minItems: 1,
      maxItems: 24,
      description:
        "Optional multi-scene inputs. Each scene becomes one video_inputs[] entry (useful for B-roll/cut-style sequencing).",
    }),
  ),
  dimension_width: Type.Optional(Type.Number()),
  dimension_height: Type.Optional(Type.Number()),
  aspect_ratio: Type.Optional(
    Type.Union([Type.Literal("16:9"), Type.Literal("9:16"), Type.Literal("1:1")]),
  ),
  background_type: Type.Optional(
    Type.Union([Type.Literal("color"), Type.Literal("image"), Type.Literal("video")]),
  ),
  background_value: Type.Optional(
    Type.String({
      description: "Background value/url/color depending on background_type.",
    }),
  ),
  background_play_style: Type.Optional(
    Type.Union([Type.Literal("fit_to_scene"), Type.Literal("crop_to_fill")]),
  ),
  // status + download
  video_id: Type.Optional(
    Type.String({
      description: "HeyGen video ID for video_status or download_video.",
    }),
  ),
  video_url: Type.Optional(
    Type.String({
      description: "Direct video URL for download_video.",
    }),
  ),
  output_dir: Type.Optional(
    Type.String({
      description: "Output directory for download_video. Default: ~/argent/media/video",
    }),
  ),
  include_raw: Type.Optional(
    Type.Boolean({
      description:
        "Include the full raw API payload for list_avatars/list_voices. Warning: can be large.",
    }),
  ),
  max_items: Type.Optional(
    Type.Number({
      description: "Maximum items returned for list_avatars/list_voices (default 40, max 200).",
    }),
  ),
});

type AspectRatio = "16:9" | "9:16" | "1:1";

function parseObjectParam(raw: unknown, label: string): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return undefined;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${label} must be a JSON object`);
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `${label} must be valid JSON object: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  throw new Error(`${label} must be an object or JSON string`);
}

function readOptionalString(rec: Record<string, unknown>, key: string): string | undefined {
  const raw = rec[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function readOptionalBoolean(rec: Record<string, unknown>, key: string): boolean | undefined {
  const raw = rec[key];
  return typeof raw === "boolean" ? raw : undefined;
}

function readOptionalNumber(
  rec: Record<string, unknown>,
  key: string,
  pathLabel: string,
): number | undefined {
  const raw = rec[key];
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`${pathLabel}.${key} must be a number`);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function resolveAspectDimensions(aspect?: string): { width: number; height: number } | undefined {
  if (!aspect) return undefined;
  if (aspect === "16:9") return { width: 1280, height: 720 };
  if (aspect === "9:16") return { width: 720, height: 1280 };
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  return undefined;
}

function resolveOutputDir(raw?: string): string {
  const dir = raw
    ? path.resolve(raw)
    : path.join(process.env.HOME || os.homedir(), "argent", "media", "video");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extractVideoId(payload: Record<string, unknown>): string | undefined {
  const direct = payload.video_id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const data = payload.data;
  if (data && typeof data === "object") {
    const nested = (data as Record<string, unknown>).video_id;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return undefined;
}

function extractVideoUrl(payload: Record<string, unknown>): string | undefined {
  const direct = payload.video_url;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const url = payload.url;
  if (typeof url === "string" && url.trim()) return url.trim();
  const data = payload.data;
  if (data && typeof data === "object") {
    const nestedData = data as Record<string, unknown>;
    const nestedVideoUrl = nestedData.video_url;
    if (typeof nestedVideoUrl === "string" && nestedVideoUrl.trim()) return nestedVideoUrl.trim();
    const nestedUrl = nestedData.url;
    if (typeof nestedUrl === "string" && nestedUrl.trim()) return nestedUrl.trim();
  }
  return undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function compactPreviewUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  if (url.length <= URL_PREVIEW_MAX_CHARS) {
    return url;
  }
  return `${url.slice(0, URL_PREVIEW_MAX_CHARS)}…`;
}

function extractListItems(
  payload: Record<string, unknown>,
  keys: string[],
): Record<string, unknown>[] {
  const candidates: unknown[] = [];
  const data = payload.data;

  for (const key of keys) {
    candidates.push(payload[key]);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      candidates.push((data as Record<string, unknown>)[key]);
    }
  }
  candidates.push(data);

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    const rows = candidate.filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    );
    if (rows.length > 0) {
      return rows;
    }
  }

  return [];
}

function summarizeAvatarList(payload: Record<string, unknown>, maxItems: number) {
  const rows = extractListItems(payload, ["avatars", "talking_photos", "items"]);
  const total = rows.length;
  const sliced = rows.slice(0, maxItems);
  const avatars = sliced.map((row, idx) => {
    const avatarId = firstString(row, ["avatar_id", "talking_photo_id", "id"]);
    const name = firstString(row, ["avatar_name", "talking_photo_name", "name", "title"]);
    const preview = compactPreviewUrl(
      firstString(row, ["preview_image_url", "thumbnail_url", "preview_url", "image_url"]),
    );
    const style = firstString(row, ["avatar_style", "style"]);
    return {
      index: idx + 1,
      ...(avatarId ? { avatar_id: avatarId } : {}),
      ...(name ? { name } : {}),
      ...(style ? { style } : {}),
      ...(preview ? { preview_image_url: preview } : {}),
    };
  });

  return {
    action: "list_avatars",
    total,
    returned: avatars.length,
    truncated: total > avatars.length,
    avatars,
  };
}

function summarizeVoiceList(payload: Record<string, unknown>, maxItems: number) {
  const rows = extractListItems(payload, ["voices", "items"]);
  const total = rows.length;
  const sliced = rows.slice(0, maxItems);
  const voices = sliced.map((row, idx) => {
    const voiceId = firstString(row, ["voice_id", "id"]);
    const name = firstString(row, ["name", "voice_name", "title"]);
    const language = firstString(row, ["language", "language_code", "lang"]);
    const gender = firstString(row, ["gender"]);
    return {
      index: idx + 1,
      ...(voiceId ? { voice_id: voiceId } : {}),
      ...(name ? { name } : {}),
      ...(language ? { language } : {}),
      ...(gender ? { gender } : {}),
    };
  });

  return {
    action: "list_voices",
    total,
    returned: voices.length,
    truncated: total > voices.length,
    voices,
  };
}

async function heygenRequest(params: {
  method?: "GET" | "POST";
  path: string;
  apiKey: string;
  body?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const url = `${HEYGEN_BASE_URL}${params.path}`;
  const res = await fetch(url, {
    method: params.method || "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`HeyGen API error (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

function buildVoiceInput(
  record: Record<string, unknown>,
  pathLabel: string,
): Record<string, unknown> {
  const script = readOptionalString(record, "script");
  const voiceId = readOptionalString(record, "voice_id");
  const audioUrl = readOptionalString(record, "audio_url");
  const speed = readOptionalNumber(record, "speed", pathLabel);

  if (!script && !audioUrl) {
    throw new Error(`${pathLabel} requires either script or audio_url`);
  }

  if (audioUrl) {
    return {
      type: "audio",
      audio_url: audioUrl,
    };
  }

  return {
    type: "text",
    input_text: script,
    ...(voiceId ? { voice_id: voiceId } : {}),
    ...(speed !== undefined ? { speed } : {}),
  };
}

function buildBackgroundInput(
  record: Record<string, unknown>,
  pathLabel: string,
): Record<string, unknown> | undefined {
  const backgroundType = readOptionalString(record, "background_type");
  const backgroundValue = readOptionalString(record, "background_value");
  const playStyle = readOptionalString(record, "background_play_style");

  if (backgroundType && !backgroundValue) {
    throw new Error(`${pathLabel}.background_value required when background_type is provided`);
  }
  if (!backgroundType && backgroundValue) {
    throw new Error(`${pathLabel}.background_type required when background_value is provided`);
  }
  if (!backgroundType || !backgroundValue) return undefined;

  return {
    type: backgroundType,
    value: backgroundValue,
    ...(playStyle ? { play_style: playStyle } : {}),
  };
}

function buildCharacterInput(
  record: Record<string, unknown>,
  avatarId: string,
  pathLabel: string,
): Record<string, unknown> {
  const avatarStyle = readOptionalString(record, "avatar_style") || "normal";
  const scale = readOptionalNumber(record, "character_scale", pathLabel);
  const offsetX = readOptionalNumber(record, "character_offset_x", pathLabel);
  const offsetY = readOptionalNumber(record, "character_offset_y", pathLabel);
  const matting = readOptionalBoolean(record, "character_matting");
  const mattingColor = readOptionalString(record, "character_matting_color");

  const character: Record<string, unknown> = {
    type: "avatar",
    avatar_id: avatarId,
    avatar_style: avatarStyle,
  };

  if (scale !== undefined) {
    character.scale = clamp(scale, 0.1, 4);
  }
  if (offsetX !== undefined || offsetY !== undefined) {
    character.offset = {
      x: offsetX ?? 0,
      y: offsetY ?? 0,
    };
  }
  if (matting !== undefined) {
    character.matting = matting;
  }
  if (mattingColor) {
    character.matting_color = mattingColor;
  }

  return character;
}

function buildVideoInput(params: {
  record: Record<string, unknown>;
  avatarId: string;
  pathLabel: string;
}): Record<string, unknown> {
  const voice = buildVoiceInput(params.record, params.pathLabel);
  const character = buildCharacterInput(params.record, params.avatarId, params.pathLabel);
  const background = buildBackgroundInput(params.record, params.pathLabel);

  return {
    character,
    voice,
    ...(background ? { background } : {}),
  };
}

function buildGenerationPayload(
  params: Record<string, unknown>,
  defaultAvatarId?: string,
): Record<string, unknown> {
  const scenesRaw = params.scenes;
  const videoInputs: Record<string, unknown>[] = [];

  if (Array.isArray(scenesRaw) && scenesRaw.length > 0) {
    for (let idx = 0; idx < scenesRaw.length; idx += 1) {
      const rawScene = scenesRaw[idx];
      if (!rawScene || typeof rawScene !== "object" || Array.isArray(rawScene)) {
        throw new Error(`scenes[${idx}] must be an object`);
      }
      const scene = rawScene as Record<string, unknown>;
      const sceneAvatarId = readOptionalString(scene, "avatar_id") || defaultAvatarId;
      if (!sceneAvatarId) {
        throw new Error(`scenes[${idx}] missing avatar_id and no default_avatar_id available`);
      }
      videoInputs.push(
        buildVideoInput({
          record: scene,
          avatarId: sceneAvatarId,
          pathLabel: `scenes[${idx}]`,
        }),
      );
    }
  } else {
    const avatarId = readStringParam(params, "avatar_id") || defaultAvatarId;
    if (!avatarId) {
      throw new Error("generate_video requires avatar_id (or default_avatar_id)");
    }
    videoInputs.push(
      buildVideoInput({
        record: params,
        avatarId,
        pathLabel: "params",
      }),
    );
  }

  const width = readNumberParam(params, "dimension_width", { integer: true });
  const height = readNumberParam(params, "dimension_height", { integer: true });
  const aspectRatio = readStringParam(params, "aspect_ratio") as AspectRatio | undefined;

  let dimension: { width: number; height: number } | undefined;
  if (width && height) {
    dimension = {
      width: Math.max(64, width),
      height: Math.max(64, height),
    };
  } else {
    dimension = resolveAspectDimensions(aspectRatio);
  }

  return {
    video_inputs: videoInputs,
    ...(dimension ? { dimension } : {}),
  };
}

export function createHeygenVideoTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  return {
    label: "HeyGen Video",
    name: "heygen_video",
    description: `Create and manage HeyGen avatar videos.

ACTIONS:
- list_avatars: list available avatars
- list_voices: list available voices
- build_payload: preview generated payload without submitting a job
- generate_video: submit a generation job (simplified params, scenes[], or raw_payload)
- video_status: get status for a video_id
- download_video: download by video_url or by resolving video_id status

Supports scene sequencing via scenes[] for cut-style/B-roll compositions.

Requires HEYGEN_API_KEY (or HEYGEN_TOKEN).`,
    parameters: HeygenVideoSchema,
    execute: async (_toolCallId, args) => {
      try {
        const params = args as Record<string, unknown>;
        const action = readStringParam(params, "action", { required: true });

        const apiKey =
          resolveServiceKey("HEYGEN_API_KEY", options?.config, {
            sessionKey: options?.agentSessionKey,
            source: "heygen_video",
          }) ||
          resolveServiceKey("HEYGEN_TOKEN", options?.config, {
            sessionKey: options?.agentSessionKey,
            source: "heygen_video",
          });
        if (!apiKey) {
          return {
            content: [
              {
                type: "text",
                text: "No HeyGen API key found. Add HEYGEN_API_KEY in Settings > API Keys.",
              },
            ],
          };
        }

        const defaultAvatarId =
          readStringParam(params, "default_avatar_id") ||
          resolveServiceKey("HEYGEN_DEFAULT_AVATAR_ID", options?.config, {
            sessionKey: options?.agentSessionKey,
            source: "heygen_video",
          }) ||
          process.env.HEYGEN_DEFAULT_AVATAR_ID ||
          undefined;
        const includeRaw = readOptionalBoolean(params, "include_raw") === true;
        const requestedMaxItems = readNumberParam(params, "max_items", { integer: true });
        const maxItems = clamp(requestedMaxItems ?? DEFAULT_LIST_MAX_ITEMS, 1, MAX_LIST_MAX_ITEMS);

        if (action === "list_avatars") {
          const result = await heygenRequest({
            path: "/v2/avatars",
            apiKey,
          });
          const summary = summarizeAvatarList(result, maxItems);
          return jsonResult(includeRaw ? { ...summary, raw: result } : summary);
        }

        if (action === "list_voices") {
          const result = await heygenRequest({
            path: "/v2/voices",
            apiKey,
          });
          const summary = summarizeVoiceList(result, maxItems);
          return jsonResult(includeRaw ? { ...summary, raw: result } : summary);
        }

        if (action === "build_payload") {
          const rawPayload = parseObjectParam(params.raw_payload, "raw_payload");
          const payload = rawPayload || buildGenerationPayload(params, defaultAvatarId);
          return jsonResult({
            payload,
            default_avatar_id: defaultAvatarId || null,
          });
        }

        if (action === "generate_video") {
          const endpoint = readStringParam(params, "endpoint") || "/v2/video/generate";
          const rawPayload = parseObjectParam(params.raw_payload, "raw_payload");
          const payload = rawPayload || buildGenerationPayload(params, defaultAvatarId);
          const result = await heygenRequest({
            method: "POST",
            path: endpoint.startsWith("/") ? endpoint : `/${endpoint}`,
            apiKey,
            body: payload,
          });
          const videoId = extractVideoId(result);
          return jsonResult({
            ...result,
            video_id: videoId,
            status_hint: videoId
              ? `Use heygen_video action=video_status video_id=${videoId}`
              : "No video_id found in response; inspect raw payload.",
          });
        }

        if (action === "video_status") {
          const videoId = readStringParam(params, "video_id", { required: true });
          const result = await heygenRequest({
            path: `/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
            apiKey,
          });
          return jsonResult(result);
        }

        if (action === "download_video") {
          const providedUrl = readStringParam(params, "video_url");
          const videoId = readStringParam(params, "video_id");

          let videoUrl = providedUrl;
          let statusPayload: Record<string, unknown> | undefined;
          if (!videoUrl && videoId) {
            statusPayload = await heygenRequest({
              path: `/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
              apiKey,
            });
            videoUrl = extractVideoUrl(statusPayload);
          }

          if (!videoUrl) {
            throw new Error(
              "download_video requires video_url or video_id with resolvable video_url",
            );
          }

          const downloadRes = await fetch(videoUrl);
          if (!downloadRes.ok) {
            throw new Error(`Video download failed (${downloadRes.status})`);
          }
          const ext = videoUrl.includes(".webm") ? ".webm" : ".mp4";
          const outDir = resolveOutputDir(readStringParam(params, "output_dir"));
          const baseId = videoId || `heygen-${Date.now()}`;
          const filePath = path.join(outDir, `${baseId}${ext}`);
          const buf = Buffer.from(await downloadRes.arrayBuffer());
          fs.writeFileSync(filePath, buf);
          return {
            content: [{ type: "text", text: `MEDIA:${filePath}` }],
            details: {
              path: filePath,
              video_url: videoUrl,
              video_id: videoId,
              status_payload: statusPayload,
              size_bytes: buf.length,
            },
          };
        }

        throw new Error(`Unsupported action: ${action}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `HeyGen tool failed: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  };
}
