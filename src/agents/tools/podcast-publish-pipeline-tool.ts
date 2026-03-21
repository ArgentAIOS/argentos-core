/**
 * Podcast Publish Pipeline Tool
 *
 * Orchestrates:
 * 1) podcast_generate
 * 2) heygen_video (optional)
 * 3) youtube_metadata_generate
 * 4) youtube_thumbnail_generate
 * 5) YouTube upload + thumbnail set (optional)
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import type { AgentToolResult } from "../../agent-core/core.js";
import type { ArgentConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import { createHeygenVideoTool } from "./heygen-video-tool.js";
import { createPodcastGenerateTool } from "./podcast-generate-tool.js";
import { createYoutubeMetadataTool } from "./youtube-metadata-tool.js";
import { createYoutubeThumbnailTool } from "./youtube-thumbnail-tool.js";

const YOUTUBE_THUMBNAIL_ENDPOINT = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";
const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DEFAULT_STYLE_PROFILE_PATH = path.resolve(
  process.cwd(),
  "skills/podcast-production/references/youtube-style-creator-longform.json",
);

const PipelineSchema = Type.Object({
  mode: Type.Optional(Type.Union([Type.Literal("plan"), Type.Literal("run")])),
  fail_fast: Type.Optional(Type.Boolean()),
  podcast_generate: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      description: "Payload passed directly to podcast_generate.",
    }),
  ),
  heygen: Type.Optional(
    Type.Object({
      enabled: Type.Optional(Type.Boolean()),
      wait_for_completion: Type.Optional(Type.Boolean()),
      poll_interval_sec: Type.Optional(Type.Number()),
      max_poll_attempts: Type.Optional(Type.Number()),
      output_dir: Type.Optional(Type.String()),
      params: Type.Optional(
        Type.Unsafe<Record<string, unknown>>({
          description: "Payload passed to heygen_video (action defaults to generate_video).",
        }),
      ),
    }),
  ),
  youtube_metadata: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      description: "Payload passed to youtube_metadata_generate.",
    }),
  ),
  youtube_thumbnail: Type.Optional(
    Type.Object({
      enabled: Type.Optional(Type.Boolean()),
      params: Type.Optional(
        Type.Unsafe<Record<string, unknown>>({
          description: "Payload passed to youtube_thumbnail_generate.",
        }),
      ),
    }),
  ),
  youtube_upload: Type.Optional(
    Type.Object({
      enabled: Type.Optional(Type.Boolean()),
      video_path: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      category_id: Type.Optional(Type.String()),
      privacy_status: Type.Optional(
        Type.Union([Type.Literal("private"), Type.Literal("unlisted"), Type.Literal("public")]),
      ),
      publish_at: Type.Optional(Type.String()),
      made_for_kids: Type.Optional(Type.Boolean()),
      notify_subscribers: Type.Optional(Type.Boolean()),
      access_token: Type.Optional(Type.String()),
      refresh_token: Type.Optional(Type.String()),
      client_id: Type.Optional(Type.String()),
      client_secret: Type.Optional(Type.String()),
      set_thumbnail: Type.Optional(Type.Boolean()),
    }),
  ),
});

type JsonObject = Record<string, unknown>;

type UploadConfig = {
  enabled: boolean;
  videoPath?: string;
  title?: string;
  description?: string;
  tags: string[];
  categoryId: string;
  privacyStatus: "private" | "unlisted" | "public";
  publishAt?: string;
  madeForKids: boolean;
  notifySubscribers: boolean;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  setThumbnail: boolean;
};

function parseBooleanLike(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
    if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  }
  return fallback;
}

function toJsonObject(raw: unknown, label: string): JsonObject {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} must be an object`);
  }
  return raw as JsonObject;
}

function extractMediaPath(result: AgentToolResult<unknown>): string | undefined {
  const details = result.details;
  if (details && typeof details === "object") {
    const pathValue = (details as JsonObject).path;
    if (typeof pathValue === "string" && pathValue.trim()) {
      return path.resolve(pathValue.trim());
    }
  }
  const textEntry = result.content.find((entry) => entry.type === "text");
  const text = typeof textEntry?.text === "string" ? textEntry.text : "";
  const mediaMatch = text.match(/MEDIA:([^\n\r]+)/);
  if (mediaMatch?.[1]) {
    return path.resolve(mediaMatch[1].trim());
  }
  return undefined;
}

function normalizeHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((tag) => typeof tag === "string")
    .map((tag) => (tag as string).trim().replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 20);
}

function parseUploadConfig(raw: unknown): UploadConfig {
  const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as JsonObject) : {};
  const tagsRaw = Array.isArray(rec.tags)
    ? rec.tags.filter((v) => typeof v === "string").map((v) => String(v).trim())
    : [];
  return {
    enabled: parseBooleanLike(rec.enabled, false),
    videoPath: readStringParam(rec, "video_path"),
    title: readStringParam(rec, "title"),
    description: readStringParam(rec, "description"),
    tags: tagsRaw.filter(Boolean),
    categoryId: readStringParam(rec, "category_id") || "28",
    privacyStatus:
      (readStringParam(rec, "privacy_status") as UploadConfig["privacyStatus"] | undefined) ||
      "private",
    publishAt: readStringParam(rec, "publish_at"),
    madeForKids: parseBooleanLike(rec.made_for_kids, false),
    notifySubscribers: parseBooleanLike(rec.notify_subscribers, false),
    accessToken: readStringParam(rec, "access_token"),
    refreshToken: readStringParam(rec, "refresh_token"),
    clientId: readStringParam(rec, "client_id"),
    clientSecret: readStringParam(rec, "client_secret"),
    setThumbnail: parseBooleanLike(rec.set_thumbnail, true),
  };
}

function safeReadToolDetails(result: AgentToolResult<unknown>): JsonObject {
  if (result.details && typeof result.details === "object") {
    return result.details as JsonObject;
  }
  const textEntry = result.content.find((entry) => entry.type === "text");
  if (typeof textEntry?.text === "string") {
    try {
      const parsed = JSON.parse(textEntry.text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as JsonObject;
      }
    } catch {
      // no-op
    }
  }
  return {};
}

function getHeygenStatus(payload: JsonObject): string {
  const direct = payload.status;
  if (typeof direct === "string" && direct.trim()) return direct.trim().toLowerCase();
  const data = payload.data;
  if (data && typeof data === "object") {
    const nested = (data as JsonObject).status;
    if (typeof nested === "string" && nested.trim()) return nested.trim().toLowerCase();
  }
  return "";
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveVideoMime(videoPath: string): string {
  const lower = videoPath.toLowerCase();
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  return "video/mp4";
}

function resolveImageMime(imagePath: string): string {
  const lower = imagePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function refreshYouTubeAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  const res = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await res.json().catch(async () => ({ raw: await res.text() }))) as JsonObject;
  if (!res.ok) {
    throw new Error(`YouTube token refresh failed (${res.status}): ${JSON.stringify(payload)}`);
  }
  const token = payload.access_token;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("YouTube token refresh returned no access_token");
  }
  return token;
}

async function resolveYouTubeAccessToken(params: {
  upload: UploadConfig;
  config?: ArgentConfig;
  agentSessionKey?: string;
}): Promise<{ accessToken: string; refreshed: boolean }> {
  const directAccessToken =
    params.upload.accessToken ||
    resolveServiceKey("YOUTUBE_ACCESS_TOKEN", params.config, {
      sessionKey: params.agentSessionKey,
      source: "podcast_publish_pipeline",
    }) ||
    process.env.YOUTUBE_ACCESS_TOKEN;
  if (directAccessToken) {
    return { accessToken: directAccessToken, refreshed: false };
  }

  const refreshToken =
    params.upload.refreshToken ||
    resolveServiceKey("YOUTUBE_REFRESH_TOKEN", params.config, {
      sessionKey: params.agentSessionKey,
      source: "podcast_publish_pipeline",
    }) ||
    resolveServiceKey("GOOGLE_REFRESH_TOKEN", params.config, {
      sessionKey: params.agentSessionKey,
      source: "podcast_publish_pipeline",
    }) ||
    process.env.YOUTUBE_REFRESH_TOKEN ||
    process.env.GOOGLE_REFRESH_TOKEN;
  const clientId =
    params.upload.clientId ||
    resolveServiceKey("GOOGLE_CLIENT_ID", params.config, {
      sessionKey: params.agentSessionKey,
      source: "podcast_publish_pipeline",
    }) ||
    resolveServiceKey("YOUTUBE_CLIENT_ID", params.config, {
      sessionKey: params.agentSessionKey,
      source: "podcast_publish_pipeline",
    }) ||
    process.env.GOOGLE_CLIENT_ID ||
    process.env.YOUTUBE_CLIENT_ID;
  const clientSecret =
    params.upload.clientSecret ||
    resolveServiceKey("GOOGLE_CLIENT_SECRET", params.config, {
      sessionKey: params.agentSessionKey,
      source: "podcast_publish_pipeline",
    }) ||
    resolveServiceKey("YOUTUBE_CLIENT_SECRET", params.config, {
      sessionKey: params.agentSessionKey,
      source: "podcast_publish_pipeline",
    }) ||
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.YOUTUBE_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      "No YouTube OAuth credentials found. Provide YOUTUBE_ACCESS_TOKEN or YOUTUBE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.",
    );
  }

  const refreshed = await refreshYouTubeAccessToken({
    refreshToken,
    clientId,
    clientSecret,
  });
  return { accessToken: refreshed, refreshed: true };
}

async function youtubeUploadResumable(params: {
  accessToken: string;
  upload: UploadConfig;
  videoPath: string;
}): Promise<JsonObject> {
  const bytes = fs.readFileSync(params.videoPath);
  const mimeType = resolveVideoMime(params.videoPath);

  const query = new URLSearchParams({
    part: "snippet,status",
    uploadType: "resumable",
    notifySubscribers: params.upload.notifySubscribers ? "true" : "false",
  });
  const endpoint = `https://www.googleapis.com/upload/youtube/v3/videos?${query.toString()}`;

  const metadata: JsonObject = {
    snippet: {
      title: params.upload.title,
      description: params.upload.description,
      tags: params.upload.tags,
      categoryId: params.upload.categoryId,
    },
    status: {
      privacyStatus: params.upload.privacyStatus,
      selfDeclaredMadeForKids: params.upload.madeForKids,
      ...(params.upload.publishAt ? { publishAt: params.upload.publishAt } : {}),
    },
  };

  const initRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(bytes.length),
    },
    body: JSON.stringify(metadata),
  });
  const initText = await initRes.text();
  if (!initRes.ok) {
    throw new Error(`YouTube resumable init failed (${initRes.status}): ${initText}`);
  }

  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) {
    throw new Error("YouTube resumable init returned no upload location header");
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.length),
    },
    body: bytes,
  });

  const uploadPayload = (await uploadRes
    .json()
    .catch(async () => ({ raw: await uploadRes.text() }))) as JsonObject;
  if (!uploadRes.ok) {
    throw new Error(
      `YouTube upload failed (${uploadRes.status}): ${JSON.stringify(uploadPayload)}`,
    );
  }
  return uploadPayload;
}

async function youtubeSetThumbnail(params: {
  accessToken: string;
  videoId: string;
  thumbnailPath: string;
}): Promise<JsonObject> {
  const bytes = fs.readFileSync(params.thumbnailPath);
  const mimeType = resolveImageMime(params.thumbnailPath);
  const endpoint = `${YOUTUBE_THUMBNAIL_ENDPOINT}?videoId=${encodeURIComponent(params.videoId)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": mimeType,
      "Content-Length": String(bytes.length),
    },
    body: bytes,
  });
  const payload = (await res.json().catch(async () => ({ raw: await res.text() }))) as JsonObject;
  if (!res.ok) {
    throw new Error(`YouTube thumbnail set failed (${res.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

export function createPodcastPublishPipelineTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  return {
    label: "Podcast Publish Pipeline",
    name: "podcast_publish_pipeline",
    description: `Run the podcast production pipeline end-to-end:

1) Render audio (podcast_generate)
2) Render HeyGen video (optional)
3) Generate YouTube metadata
4) Generate thumbnail
5) Upload to YouTube (optional)

Use mode=plan to validate configuration and preview resolved steps.
Spotify publish remains a manual Spotify for Creators web step.`,
    parameters: PipelineSchema,
    execute: async (_toolCallId, args) => {
      const params = args as JsonObject;
      const mode = (readStringParam(params, "mode") || "run") as "plan" | "run";
      const failFast = parseBooleanLike(params.fail_fast, true);

      try {
        const podcastPayloadRaw = params.podcast_generate;
        const hasPodcast = Boolean(
          podcastPayloadRaw &&
          typeof podcastPayloadRaw === "object" &&
          !Array.isArray(podcastPayloadRaw),
        );
        if (!hasPodcast) {
          throw new Error("podcast_generate payload required");
        }
        const podcastPayload = toJsonObject(podcastPayloadRaw, "podcast_generate");
        const podcastTitle =
          readStringParam(podcastPayload, "title") ||
          readStringParam(params, "title") ||
          "Podcast Episode";

        const heygenRaw =
          params.heygen && typeof params.heygen === "object" && !Array.isArray(params.heygen)
            ? (params.heygen as JsonObject)
            : {};
        const heygenEnabled = parseBooleanLike(heygenRaw.enabled, false);
        const heygenWait = parseBooleanLike(heygenRaw.wait_for_completion, true);
        const heygenPollIntervalSec = Math.max(
          1,
          readNumberParam(heygenRaw, "poll_interval_sec") ?? 12,
        );
        const heygenMaxPollAttempts = Math.max(
          1,
          Math.trunc(readNumberParam(heygenRaw, "max_poll_attempts") ?? 80),
        );

        const upload = parseUploadConfig(params.youtube_upload);
        const metadataRequested =
          Boolean(params.youtube_metadata) || Boolean(params.youtube_thumbnail) || upload.enabled;
        const thumbnailRaw =
          params.youtube_thumbnail &&
          typeof params.youtube_thumbnail === "object" &&
          !Array.isArray(params.youtube_thumbnail)
            ? (params.youtube_thumbnail as JsonObject)
            : {};
        const thumbnailEnabled = parseBooleanLike(thumbnailRaw.enabled, metadataRequested);

        const plan = {
          mode,
          fail_fast: failFast,
          steps: [
            { id: "podcast_generate", enabled: true },
            { id: "heygen_video", enabled: heygenEnabled, wait_for_completion: heygenWait },
            { id: "youtube_metadata_generate", enabled: metadataRequested },
            { id: "youtube_thumbnail_generate", enabled: thumbnailEnabled },
            { id: "youtube_upload", enabled: upload.enabled },
            { id: "spotify_publish", enabled: true, mode: "manual_web" },
          ],
        };

        if (mode === "plan") {
          return jsonResult({
            status: "planned",
            title: podcastTitle,
            plan,
            notes: [
              "Use youtube_upload.enabled=true to publish immediately after generation.",
              "If heygen is enabled, pass script/scenes/raw_payload in heygen.params.",
            ],
          });
        }

        const runSummary: JsonObject = {
          title: podcastTitle,
          plan,
          outputs: {},
          warnings: [] as string[],
        };

        const podcastTool = createPodcastGenerateTool({
          agentSessionKey: options?.agentSessionKey,
          config: options?.config,
        });
        const podcastResult = await podcastTool.execute(
          "pipeline-podcast-generate",
          podcastPayload,
        );
        const podcastMediaPath = extractMediaPath(podcastResult);
        if (!podcastMediaPath || !fs.existsSync(podcastMediaPath)) {
          throw new Error("podcast_generate did not produce a valid MEDIA path");
        }
        (runSummary.outputs as JsonObject).podcast_audio_path = podcastMediaPath;
        (runSummary.outputs as JsonObject).podcast_generate = safeReadToolDetails(podcastResult);

        let heygenVideoPath: string | undefined;
        let heygenVideoId: string | undefined;
        if (heygenEnabled) {
          const heygenTool = createHeygenVideoTool({
            agentSessionKey: options?.agentSessionKey,
            config: options?.config,
          });
          const heygenParamsRaw =
            heygenRaw.params &&
            typeof heygenRaw.params === "object" &&
            !Array.isArray(heygenRaw.params)
              ? { ...(heygenRaw.params as JsonObject) }
              : {};
          if (!readStringParam(heygenParamsRaw, "action")) {
            heygenParamsRaw.action = "generate_video";
          }
          const generateResult = await heygenTool.execute(
            "pipeline-heygen-generate",
            heygenParamsRaw,
          );
          const generateDetails = safeReadToolDetails(generateResult);
          heygenVideoId = readStringParam(generateDetails, "video_id");
          (runSummary.outputs as JsonObject).heygen_generate = generateDetails;

          if (heygenWait) {
            if (!heygenVideoId) {
              throw new Error("heygen_video returned no video_id for completion polling");
            }
            let statusPayload: JsonObject = {};
            let completed = false;
            for (let attempt = 1; attempt <= heygenMaxPollAttempts; attempt += 1) {
              const statusResult = await heygenTool.execute("pipeline-heygen-status", {
                action: "video_status",
                video_id: heygenVideoId,
              });
              statusPayload = safeReadToolDetails(statusResult);
              const status = getHeygenStatus(statusPayload);
              if (status === "completed" || status === "complete" || status === "done") {
                completed = true;
                break;
              }
              if (status === "failed" || status === "error" || status === "canceled") {
                throw new Error(`heygen_video failed with status=${status}`);
              }
              await delay(heygenPollIntervalSec * 1000);
            }
            if (!completed) {
              throw new Error(
                `heygen_video did not complete after ${heygenMaxPollAttempts} status checks`,
              );
            }

            const downloadResult = await heygenTool.execute("pipeline-heygen-download", {
              action: "download_video",
              video_id: heygenVideoId,
              output_dir: readStringParam(heygenRaw, "output_dir"),
            });
            heygenVideoPath = extractMediaPath(downloadResult);
            if (!heygenVideoPath || !fs.existsSync(heygenVideoPath)) {
              throw new Error("heygen_video download did not produce a valid MEDIA path");
            }
            (runSummary.outputs as JsonObject).heygen_status = statusPayload;
            (runSummary.outputs as JsonObject).heygen_video_path = heygenVideoPath;
          }
        }

        let metadataDetails: JsonObject | undefined;
        if (metadataRequested) {
          const metadataInput =
            params.youtube_metadata &&
            typeof params.youtube_metadata === "object" &&
            !Array.isArray(params.youtube_metadata)
              ? { ...(params.youtube_metadata as JsonObject) }
              : {};
          if (!readStringParam(metadataInput, "episode_title")) {
            metadataInput.episode_title = podcastTitle;
          }
          if (
            !readStringParam(metadataInput, "style_profile_path") &&
            fs.existsSync(DEFAULT_STYLE_PROFILE_PATH)
          ) {
            metadataInput.style_profile_path = DEFAULT_STYLE_PROFILE_PATH;
          }
          const metadataTool = createYoutubeMetadataTool();
          const metadataResult = await metadataTool.execute(
            "pipeline-youtube-metadata",
            metadataInput,
          );
          metadataDetails = safeReadToolDetails(metadataResult);
          (runSummary.outputs as JsonObject).youtube_metadata = metadataDetails;
        }

        let thumbnailPath: string | undefined;
        if (thumbnailEnabled) {
          const thumbnailParams =
            thumbnailRaw.params &&
            typeof thumbnailRaw.params === "object" &&
            !Array.isArray(thumbnailRaw.params)
              ? { ...(thumbnailRaw.params as JsonObject) }
              : {};
          if (!readStringParam(thumbnailParams, "headline")) {
            const brief =
              metadataDetails &&
              metadataDetails.thumbnail_brief &&
              typeof metadataDetails.thumbnail_brief === "object"
                ? (metadataDetails.thumbnail_brief as JsonObject)
                : {};
            const fallbackHeadline = readStringParam(brief, "headline") || podcastTitle;
            thumbnailParams.headline = fallbackHeadline;
            const fallbackSubheadline = readStringParam(brief, "subheadline");
            if (fallbackSubheadline && !readStringParam(thumbnailParams, "subheadline")) {
              thumbnailParams.subheadline = fallbackSubheadline;
            }
            if (!readStringParam(thumbnailParams, "topic")) {
              thumbnailParams.topic = podcastTitle;
            }
          }
          const thumbnailTool = createYoutubeThumbnailTool({
            agentSessionKey: options?.agentSessionKey,
            config: options?.config,
          });
          const thumbnailResult = await thumbnailTool.execute(
            "pipeline-youtube-thumbnail",
            thumbnailParams,
          );
          thumbnailPath = extractMediaPath(thumbnailResult);
          if (!thumbnailPath || !fs.existsSync(thumbnailPath)) {
            throw new Error("youtube_thumbnail_generate did not produce a valid MEDIA path");
          }
          (runSummary.outputs as JsonObject).youtube_thumbnail_path = thumbnailPath;
        }

        if (upload.enabled) {
          const resolvedVideoPath = upload.videoPath
            ? path.resolve(upload.videoPath)
            : heygenVideoPath
              ? path.resolve(heygenVideoPath)
              : undefined;
          if (!resolvedVideoPath || !fs.existsSync(resolvedVideoPath)) {
            throw new Error(
              "youtube_upload enabled but no valid video path found. Provide youtube_upload.video_path or enable heygen with wait_for_completion.",
            );
          }

          const metadataTitle = readStringParam(metadataDetails || {}, "recommended_title");
          const metadataDescription = readStringParam(metadataDetails || {}, "description");
          const metadataTags = normalizeHashtags((metadataDetails || {}).hashtags);
          const finalUploadConfig: UploadConfig = {
            ...upload,
            title: upload.title || metadataTitle || podcastTitle,
            description: upload.description || metadataDescription || "",
            tags: upload.tags.length > 0 ? upload.tags : metadataTags,
          };

          const { accessToken, refreshed } = await resolveYouTubeAccessToken({
            upload: finalUploadConfig,
            config: options?.config,
            agentSessionKey: options?.agentSessionKey,
          });
          const uploadPayload = await youtubeUploadResumable({
            accessToken,
            upload: finalUploadConfig,
            videoPath: resolvedVideoPath,
          });
          const uploadedVideoId = readStringParam(uploadPayload, "id");
          const uploadResult: JsonObject = {
            refreshed_access_token: refreshed,
            response: uploadPayload,
            watch_url: uploadedVideoId
              ? `https://www.youtube.com/watch?v=${uploadedVideoId}`
              : null,
          };

          if (
            finalUploadConfig.setThumbnail &&
            uploadedVideoId &&
            thumbnailPath &&
            fs.existsSync(thumbnailPath)
          ) {
            uploadResult.thumbnail_response = await youtubeSetThumbnail({
              accessToken,
              videoId: uploadedVideoId,
              thumbnailPath,
            });
          }

          (runSummary.outputs as JsonObject).youtube_upload = uploadResult;
        }

        (runSummary.outputs as JsonObject).spotify_publish = {
          mode: "manual_web",
          next_step: "Open Spotify for Creators and publish the rendered episode assets.",
        };

        return jsonResult({
          status: "completed",
          ...runSummary,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (failFast) {
          return {
            content: [{ type: "text", text: `Podcast publish pipeline failed: ${msg}` }],
            details: { error: msg, mode, fail_fast: failFast },
          };
        }
        return jsonResult({
          status: "partial_failure",
          error: msg,
          mode,
          fail_fast: failFast,
        });
      }
    },
  };
}
